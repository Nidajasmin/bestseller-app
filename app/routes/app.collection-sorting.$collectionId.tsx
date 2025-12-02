// app/routes/app.collection-settings.$collectionId.tsx
import type { LoaderFunctionArgs, ActionFunctionArgs } from "react-router";
import { useLoaderData, useParams, useNavigate, useSubmit } from "react-router";
import { useState, useEffect } from "react";
import {
  Page,
  Layout,
  Card,
  TextField,
  Select,
  Button,
  Banner,
  Text,
  Checkbox,
  Modal,
  Toast,
  InlineStack,
  BlockStack,
  Badge,
  Tabs,
  LegacyCard,
} from "@shopify/polaris";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

// Types
interface CollectionDetails {
  id: string;
  title: string;
  handle: string;
  productsCount: {
    count: number;
  };
  sortOrder?: string;
}

interface LoaderData {
  collection: CollectionDetails;
  shopDomain: string;
  savedData: {
    collectionSettings: any;
    featuredSettings: any;
    productBehaviorRules: any;
  };
}

// Define types for GraphQL responses
interface OrderLineItem {
  product: {
    id: string;
  };
  quantity: number;
  originalTotalSet: {
    shopMoney: {
      amount: string;
      currencyCode: string;
    };
  };
  discountedTotalSet?: {
    shopMoney: {
      amount: string;
      currencyCode: string;
    };
  };
}

interface Order {
  id: string;
  createdAt: string;
  lineItems: {
    edges: Array<{
      node: OrderLineItem;
    }>;
  };
}

interface ProductVariant {
  price: string;
  compareAtPrice?: string;
}

interface Product {
  id: string;
  title: string;
  tags: string[];
  totalInventory: number;
  createdAt: string;
  publishedAt: string;
  featuredImage?: {
    url: string;
    altText?: string;
  };
  variants: {
    edges: Array<{
      node: ProductVariant;
    }>;
  };
  totalSales?: number;
  totalRevenue?: number;
  discountedRevenue?: number;
}

// GraphQL Queries
const GET_COLLECTION = `#graphql
  query GetCollection($id: ID!) {
    collection(id: $id) {
      id
      title
      handle
      sortOrder
      productsCount {
        count
      }
    }
  }
`;

const UPDATE_COLLECTION_SORT_ORDER = `#graphql
  mutation collectionUpdate($input: CollectionInput!) {
    collectionUpdate(input: $input) {
      collection {
        id
        title
        sortOrder
      }
      userErrors {
        field
        message
      }
    }
  }
`;

const GET_COLLECTION_PRODUCTS = `#graphql
  query GetCollectionProducts($id: ID!, $first: Int!) {
    collection(id: $id) {
      products(first: $first) {
        edges {
          node {
            id
            title
            tags
            totalInventory
            createdAt
            publishedAt
            featuredImage {
              url
              altText
            }
            variants(first: 10) {
              edges {
                node {
                  price
                  compareAtPrice
                }
              }
            }
          }
        }
      }
    }
  }
`;

// FIXED: Removed financialStatus field from query
const GET_ORDERS_WITH_PRODUCTS = `#graphql
  query GetOrdersWithProducts($first: Int!, $query: String) {
    orders(first: $first, query: $query) {
      edges {
        node {
          id
          createdAt
          lineItems(first: 100) {
            edges {
              node {
                product {
                  id
                }
                quantity
                originalTotalSet {
                  shopMoney {
                    amount
                    currencyCode
                  }
                }
                discountedTotalSet {
                  shopMoney {
                    amount
                    currencyCode
                  }
                }
              }
            }
          }
        }
      }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }
`;

const SET_COLLECTION_PRODUCTS_ORDER = `#graphql
  mutation collectionReorderProducts($id: ID!, $moves: [MoveInput!]!) {
    collectionReorderProducts(id: $id, moves: $moves) {
      job {
        id
        done
      }
      userErrors {
        field
        message
      }
    }
  }
`;

// Helper function to construct GID from numeric ID
const constructGid = (id: string) => {
  return `gid://shopify/Collection/${id}`;
};

// Helper function to extract product ID from GID
const extractProductId = (gid: string): string => {
  const match = gid.match(/gid:\/\/shopify\/Product\/(\d+)/);
  return match ? match[1] : gid;
};

// Updated helper function with better error handling
const fetchProductMetrics = async (admin: any, lookbackDays: number, ordersRange: string, includeDiscounts: boolean) => {
  const productMetrics = new Map();
  
  // Calculate date for lookback
  const lookbackDate = new Date();
  lookbackDate.setDate(lookbackDate.getDate() - lookbackDays);
  const lookbackDateString = lookbackDate.toISOString().split('T')[0];
  
  // Build query - FIXED: Use correct filter format
  let query = `created_at:>=${lookbackDateString}`;
  if (ordersRange === "paid-orders") {
    // Use correct filter syntax for financial status
    query += " AND financial_status:paid";
  } else if (ordersRange === "fulfilled-orders") {
    query += " AND fulfillment_status:fulfilled";
  }
  
  console.log(`📊 Fetching orders with query: ${query}, includeDiscounts: ${includeDiscounts}`);
  
  let hasNextPage = true;
  let endCursor = null;
  let allOrders: Order[] = [];
  let pageCount = 0;
  
  try {
    // Fetch orders with pagination
    while (hasNextPage && pageCount < 10) { // Limit to 10 pages for safety
      const variables: any = {
        first: 50,
        query: query
      };
      
      if (endCursor) {
        variables.after = endCursor;
      }
      
      const response = await admin.graphql(GET_ORDERS_WITH_PRODUCTS, { variables });
      const data = await response.json();
      
      if (data.errors) {
        console.error("GraphQL errors fetching orders:", data.errors);
        break;
      }
      
      const orders = data.data?.orders;
      if (orders) {
        const pageOrders = orders.edges.map((edge: any) => edge.node);
        allOrders = [...allOrders, ...pageOrders];
        hasNextPage = orders.pageInfo.hasNextPage;
        endCursor = orders.pageInfo.endCursor;
        pageCount++;
        
        console.log(`📊 Page ${pageCount}: Fetched ${pageOrders.length} orders, total: ${allOrders.length}`);
      } else {
        hasNextPage = false;
      }
      
      // Break if we have enough orders
      if (allOrders.length >= 1000) {
        console.log("📊 Reached maximum order limit (1000)");
        break;
      }
    }
    
    console.log(`📊 Total orders fetched: ${allOrders.length}`);
    
    // Calculate metrics
    allOrders.forEach(order => {
      if (order.lineItems && order.lineItems.edges) {
        order.lineItems.edges.forEach((lineItemEdge: any) => {
          const lineItem = lineItemEdge.node;
          if (lineItem.product && lineItem.product.id) {
            const productId = extractProductId(lineItem.product.id);
            const quantity = lineItem.quantity || 0;
            
            // Calculate revenue with or without discounts
            let revenue = 0;
            if (includeDiscounts && lineItem.discountedTotalSet?.shopMoney?.amount) {
              // Use discounted price if discounts are included
              revenue = parseFloat(lineItem.discountedTotalSet.shopMoney.amount);
            } else {
              // Use original price if discounts are not included
              revenue = parseFloat(lineItem.originalTotalSet?.shopMoney?.amount || "0");
            }
            
            if (productMetrics.has(productId)) {
              const existing = productMetrics.get(productId);
              existing.totalSales += quantity;
              existing.totalRevenue += revenue;
              existing.orderCount += 1;
              
              // Track discounted revenue separately if needed
              if (includeDiscounts && lineItem.discountedTotalSet?.shopMoney?.amount) {
                const discountedAmount = parseFloat(lineItem.discountedTotalSet.shopMoney.amount);
                existing.discountedRevenue = (existing.discountedRevenue || 0) + discountedAmount;
              }
            } else {
              const metrics: any = {
                productId,
                totalSales: quantity,
                totalRevenue: revenue,
                orderCount: 1
              };
              
              if (includeDiscounts && lineItem.discountedTotalSet?.shopMoney?.amount) {
                metrics.discountedRevenue = parseFloat(lineItem.discountedTotalSet.shopMoney.amount);
              }
              
              productMetrics.set(productId, metrics);
            }
          }
        });
      }
    });
    
    console.log(`📊 Calculated metrics for ${productMetrics.size} products`);
    console.log(`📊 Include Discounts: ${includeDiscounts}`);
    
    // Log sample metrics for debugging
    if (productMetrics.size > 0) {
      const metricsArray = Array.from(productMetrics.values());
      console.log("Sample product metrics:", metricsArray.slice(0, 3));
    }
    
  } catch (error: any) {
    console.error("Error in fetchProductMetrics:", error.message);
    console.error("Full error:", error);
  }
  
  return productMetrics;
};

// Loader function
export async function loader({ request, params }: LoaderFunctionArgs) {
  const { admin, session } = await authenticate.admin(request);
  const { collectionId } = params;

  if (!collectionId) {
    throw new Response("Collection ID is required", { status: 400 });
  }

  try {
    const gid = constructGid(collectionId);

    // Get collection details
    const collectionResponse = await admin.graphql(GET_COLLECTION, {
      variables: { id: gid }
    });
    
    const collectionData = await collectionResponse.json() as any;
    
    if (!collectionData.data?.collection) {
      throw new Response("Collection not found", { status: 404 });
    }

    // Get collection settings
    const collectionSettingsFromDb = await prisma.collectionSetting.findUnique({
      where: {
        shopifyDomain_collectionId: {
          shopifyDomain: session.shop,
          collectionId: gid
        }
      }
    });

    // Get behavior rules
    const productBehaviorRulesFromDb = await prisma.productBehaviorRule.findUnique({
      where: {
        shopifyDomain_collectionId: {
          shopifyDomain: session.shop,
          collectionId: gid
        }
      }
    });

    return {
      collection: collectionData.data.collection,
      shopDomain: session.shop,
      savedData: {
        collectionSettings: collectionSettingsFromDb || {},
        featuredSettings: {},
        productBehaviorRules: productBehaviorRulesFromDb || {},
      }
    };
  } catch (error) {
    console.error("❌ Error loading collection data:", error);
    throw new Response("Failed to load collection data", { status: 500 });
  }
}

// Action function for saving data
export async function action({ request, params }: ActionFunctionArgs) {
  const { admin, session } = await authenticate.admin(request);
  const { collectionId } = params;
  const formData = await request.formData();
  const intent = formData.get("intent");

  if (!collectionId) {
    throw new Response("Collection ID is required", { status: 400 });
  }

  const gid = constructGid(collectionId);

  try {
    switch (intent) {
      case "update-collection-sort-order": {
        const manualSortOrder = formData.get("manualSortOrder") === "true";
        
        try {
          const response = await admin.graphql(UPDATE_COLLECTION_SORT_ORDER, {
            variables: {
              input: {
                id: gid,
                sortOrder: manualSortOrder ? "MANUAL" : "BEST_SELLING"
              }
            }
          });
          
          const data = await response.json() as any;
          
          if (data.errors || data.data?.collectionUpdate?.userErrors?.length > 0) {
            const errorMessage = data.errors?.[0]?.message || 
                                data.data?.collectionUpdate?.userErrors?.[0]?.message || 
                                "Failed to update collection sort order";
            return { success: false, error: errorMessage };
          }
          
          return { 
            success: true, 
            message: manualSortOrder ? 
              "Collection sort order updated to Manual. You can now organize products manually." : 
              "Collection sort order updated to best selling." 
          };
        } catch (error) {
          console.error("Failed to update collection sort order:", error);
          return { 
            success: false, 
            error: error instanceof Error ? error.message : "Failed to update collection sort order" 
          };
        }
      }

      case "save-position-based-settings": {
        const behaviorRules = JSON.parse(formData.get("behaviorRules") as string);
        
        await prisma.collectionSetting.upsert({
          where: {
            shopifyDomain_collectionId: {
              shopifyDomain: session.shop,
              collectionId: gid
            }
          },
          update: { 
            useCustomSorting: true,
            primarySortOrder: "position-based"
          },
          create: {
            shopifyDomain: session.shop,
            collectionId: gid,
            useCustomSorting: true,
            primarySortOrder: "position-based",
            lookbackPeriod: 180,
            ordersRange: "all-orders",
            includeDiscounts: true
          }
        });

        await prisma.productBehaviorRule.upsert({
          where: {
            shopifyDomain_collectionId: {
              shopifyDomain: session.shop,
              collectionId: gid
            }
          },
          update: behaviorRules,
          create: {
            shopifyDomain: session.shop,
            collectionId: gid,
            ...behaviorRules
          }
        });

        return { success: true, message: "Position-based settings saved successfully!" };
      }

      case "save-criteria-based-settings": {
        const settings = JSON.parse(formData.get("settings") as string);
        
        await prisma.collectionSetting.upsert({
          where: {
            shopifyDomain_collectionId: {
              shopifyDomain: session.shop,
              collectionId: gid
            }
          },
          update: { 
            useCustomSorting: true,
            primarySortOrder: `criteria-${settings.sortCriteria}-${settings.sortOrderMode}`,
            sortCriteria: settings.sortCriteria,
            sortOrderMode: settings.sortOrderMode,
            lookbackPeriod: settings.lookbackPeriod,
            ordersRange: settings.ordersRange,
            includeDiscounts: settings.includeDiscounts
          },
          create: {
            shopifyDomain: session.shop,
            collectionId: gid,
            useCustomSorting: true,
            primarySortOrder: `criteria-${settings.sortCriteria}-${settings.sortOrderMode}`,
            sortCriteria: settings.sortCriteria,
            sortOrderMode: settings.sortOrderMode,
            lookbackPeriod: settings.lookbackPeriod,
            ordersRange: settings.ordersRange,
            includeDiscounts: settings.includeDiscounts
          }
        });

        return { success: true, message: "Criteria-based settings saved successfully!" };
      }

      case "preview-sort-order": {
        const sortCriteria = formData.get("sortCriteria") as string;
        const sortOrder = formData.get("sortOrder") as string;
        const lookbackDays = parseInt(formData.get("lookbackDays") as string) || 30;
        const ordersRange = formData.get("ordersRange") as string || "all-orders";
        const includeDiscounts = formData.get("includeDiscounts") === "true";
        
        try {
          // Get collection products
          const productsResponse = await admin.graphql(GET_COLLECTION_PRODUCTS, {
            variables: { 
              id: gid, 
              first: 50
            }
          });
          
          const productsData = await productsResponse.json() as any;
          const allProducts = productsData.data?.collection?.products?.edges?.map((edge: any) => edge.node) || [];
          
          if (allProducts.length === 0) {
            return { success: false, error: "No products found in this collection" };
          }

          let sortedProducts = [...allProducts];

          // For revenue and sales criteria, fetch actual order data
          if (sortCriteria === "revenue" || sortCriteria === "sales") {
            const productMetrics = await fetchProductMetrics(admin, lookbackDays, ordersRange, includeDiscounts);
            
            // Add metrics to products and sort
            const productsWithMetrics = allProducts.map((product: Product) => {
              const productId = extractProductId(product.id);
              const metrics = productMetrics.get(productId) || {
                totalSales: 0,
                totalRevenue: 0,
                discountedRevenue: 0,
                orderCount: 0
              };
              
              return {
                ...product,
                totalSales: metrics.totalSales,
                totalRevenue: metrics.totalRevenue,
                discountedRevenue: metrics.discountedRevenue || metrics.totalRevenue
              };
            });

            if (sortCriteria === "revenue") {
              sortedProducts = productsWithMetrics.sort((a: Product, b: Product) => {
                const revenueA = includeDiscounts ? a.discountedRevenue || a.totalRevenue || 0 : a.totalRevenue || 0;
                const revenueB = includeDiscounts ? b.discountedRevenue || b.totalRevenue || 0 : b.totalRevenue || 0;
                return sortOrder === "high-to-low" ? 
                  revenueB - revenueA : 
                  revenueA - revenueB;
              });
            } else if (sortCriteria === "sales") {
              sortedProducts = productsWithMetrics.sort((a: Product, b: Product) => {
                return sortOrder === "high-to-low" ? 
                  (b.totalSales || 0) - (a.totalSales || 0) : 
                  (a.totalSales || 0) - (b.totalSales || 0);
              });
            }
          } else {
            // Sort based on other criteria
            switch (sortCriteria) {
              case "creation":
                sortedProducts.sort((a: Product, b: Product) => {
                  const dateA = new Date(a.createdAt).getTime();
                  const dateB = new Date(b.createdAt).getTime();
                  return sortOrder === "high-to-low" ? dateB - dateA : dateA - dateB;
                });
                break;
              case "publish":
                sortedProducts.sort((a: Product, b: Product) => {
                  const dateA = new Date(a.publishedAt).getTime();
                  const dateB = new Date(b.publishedAt).getTime();
                  return sortOrder === "high-to-low" ? dateB - dateA : dateA - dateB;
                });
                break;
              case "price":
                sortedProducts.sort((a: Product, b: Product) => {
                  const priceA = parseFloat(a.variants?.edges[0]?.node?.price || "0");
                  const priceB = parseFloat(b.variants?.edges[0]?.node?.price || "0");
                  return sortOrder === "high-to-low" ? priceB - priceA : priceA - priceB;
                });
                break;
              case "inventory":
                sortedProducts.sort((a: Product, b: Product) => {
                  const inventoryA = a.totalInventory || 0;
                  const inventoryB = b.totalInventory || 0;
                  return sortOrder === "high-to-low" ? inventoryB - inventoryA : inventoryA - inventoryB;
                });
                break;
            }
          }
          
          // Return the top 10 products as a preview
          const previewProducts = sortedProducts.slice(0, 10).map((product: Product) => ({
            id: product.id,
            title: product.title,
            price: product.variants?.edges[0]?.node?.price || "0",
            inventory: product.totalInventory || 0,
            createdAt: product.createdAt,
            publishedAt: product.publishedAt,
            totalSales: product.totalSales || 0,
            totalRevenue: product.totalRevenue || 0,
            discountedRevenue: product.discountedRevenue || product.totalRevenue || 0,
          }));
          
          return { 
            success: true, 
            previewProducts,
            includeDiscounts,
            message: `Preview generated for ${sortCriteria} (${sortOrder}) with ${lookbackDays} days lookback. Include discounts: ${includeDiscounts}`
          };
        } catch (error) {
          console.error("Failed to generate preview:", error);
          return { 
            success: false, 
            error: error instanceof Error ? error.message : "Failed to generate preview" 
          };
        }
      }

      case "resort-collection": {
        console.log("🚀 STARTING RESORT COLLECTION");
        
        try {
          // Get collection settings
          const collectionSettings = await prisma.collectionSetting.findUnique({
            where: {
              shopifyDomain_collectionId: {
                shopifyDomain: session.shop,
                collectionId: gid
              }
            }
          });

          // Get behavior rules
          const behaviorRules = await prisma.productBehaviorRule.findUnique({
            where: {
              shopifyDomain_collectionId: {
                shopifyDomain: session.shop,
                collectionId: gid
              }
            }
          });

          // Get all products from collection
          const productsResponse = await admin.graphql(GET_COLLECTION_PRODUCTS, {
            variables: { 
              id: gid, 
              first: 250
            }
          });
          
          const productsData = await productsResponse.json() as any;
          const allProducts = productsData.data?.collection?.products?.edges?.map((edge: any) => edge.node) || [];
          
          if (allProducts.length === 0) {
            return { success: false, error: "No products found in this collection" };
          }

          console.log(`📦 RESORT: Processing ${allProducts.length} total products`);

          let sortedProducts = [...allProducts];

          // Check sorting method
          const primarySortOrder = collectionSettings?.primarySortOrder || "random-high-low";
          const isCriteriaBased = primarySortOrder.startsWith("criteria-");
          
          if (isCriteriaBased) {
            // Use stored sort criteria and mode from database
            const sortCriteria = collectionSettings?.sortCriteria || "revenue";
            const sortOrderMode = collectionSettings?.sortOrderMode || "high-to-low";
            const lookbackDays = collectionSettings?.lookbackPeriod || 30;
            const ordersRange = collectionSettings?.ordersRange || "all-orders";
            const includeDiscounts = collectionSettings?.includeDiscounts ?? true;
            
            console.log(`🔄 Applying criteria-based sort: ${sortCriteria} (${sortOrderMode}), Include discounts: ${includeDiscounts}`);
            
            // For revenue and sales criteria, fetch actual order data
            if (sortCriteria === "revenue" || sortCriteria === "sales") {
              const productMetrics = await fetchProductMetrics(admin, lookbackDays, ordersRange, includeDiscounts);
              
              // Add metrics to products and sort
              const productsWithMetrics = allProducts.map((product: Product) => {
                const productId = extractProductId(product.id);
                const metrics = productMetrics.get(productId) || {
                  totalSales: 0,
                  totalRevenue: 0,
                  discountedRevenue: 0,
                  orderCount: 0
                };
                
                return {
                  ...product,
                  totalSales: metrics.totalSales,
                  totalRevenue: metrics.totalRevenue,
                  discountedRevenue: metrics.discountedRevenue || metrics.totalRevenue
                };
              });

              if (sortCriteria === "revenue") {
                sortedProducts = productsWithMetrics.sort((a: Product, b: Product) => {
                  const revenueA = includeDiscounts ? a.discountedRevenue || a.totalRevenue || 0 : a.totalRevenue || 0;
                  const revenueB = includeDiscounts ? b.discountedRevenue || b.totalRevenue || 0 : b.totalRevenue || 0;
                  return sortOrderMode === "high-to-low" ? 
                    revenueB - revenueA : 
                    revenueA - revenueB;
                });
              } else if (sortCriteria === "sales") {
                sortedProducts = productsWithMetrics.sort((a: Product, b: Product) => {
                  return sortOrderMode === "high-to-low" ? 
                    (b.totalSales || 0) - (a.totalSales || 0) : 
                    (a.totalSales || 0) - (b.totalSales || 0);
                });
              }
            } else {
              // Sort based on other criteria
              switch (sortCriteria) {
                case "creation":
                  sortedProducts.sort((a: Product, b: Product) => {
                    const dateA = new Date(a.createdAt).getTime();
                    const dateB = new Date(b.createdAt).getTime();
                    return sortOrderMode === "high-to-low" ? dateB - dateA : dateA - dateB;
                  });
                  break;
                case "publish":
                  sortedProducts.sort((a: Product, b: Product) => {
                    const dateA = new Date(a.publishedAt).getTime();
                    const dateB = new Date(b.publishedAt).getTime();
                    return sortOrderMode === "high-to-low" ? dateB - dateA : dateA - dateB;
                  });
                  break;
                case "price":
                  sortedProducts.sort((a: Product, b: Product) => {
                    const priceA = parseFloat(a.variants?.edges[0]?.node?.price || "0");
                    const priceB = parseFloat(b.variants?.edges[0]?.node?.price || "0");
                    return sortOrderMode === "high-to-low" ? priceB - priceA : priceA - priceB;
                  });
                  break;
                case "inventory":
                  sortedProducts.sort((a: Product, b: Product) => {
                    const inventoryA = a.totalInventory || 0;
                    const inventoryB = b.totalInventory || 0;
                    return sortOrderMode === "high-to-low" ? inventoryB - inventoryA : inventoryA - inventoryB;
                  });
                  break;
              }
            }
          } else {
            // Default to random sorting for position-based
            sortedProducts = sortedProducts.sort(() => Math.random() - 0.5);
          }

          // Apply new order to Shopify
          const moves = sortedProducts.map((product, index) => ({
            id: product.id,
            newPosition: index.toString()
          }));

          console.log("🔄 RESORT: Sending reorder request to Shopify...");

          const reorderResponse = await admin.graphql(SET_COLLECTION_PRODUCTS_ORDER, {
            variables: { 
              id: gid, 
              moves: moves 
            }
          });

          const reorderData = await reorderResponse.json() as any;

          if (reorderData.errors) {
            const errorMessage = reorderData.errors.map((err: any) => err.message).join(', ');
            console.error("❌ RESORT ERROR: GraphQL errors:", reorderData.errors);
            return { success: false, error: "GraphQL error: " + errorMessage };
          }

          if (reorderData.data?.collectionReorderProducts?.userErrors?.length > 0) {
            const errorMessage = reorderData.data.collectionReorderProducts.userErrors[0].message;
            console.error("❌ RESORT ERROR: Shopify user errors:", reorderData.data.collectionReorderProducts.userErrors);
            return { success: false, error: "Shopify error: " + errorMessage };
          }

          return { 
            success: true,
            message: "✅ Collection successfully reordered with your custom settings!",
            jobId: reorderData.data?.collectionReorderProducts?.job?.id || null
          };
          
        } catch (error) {
          console.error("💥 Resort collection error:", error);
          return { 
            success: false, 
            error: error instanceof Error ? error.message : "Failed to resort collection" 
          };
        }
      }

      default:
        return { success: false, error: "Invalid intent" };
    }
  } catch (error) {
    console.error("Action failed:", error);
    return { 
      success: false, 
      error: error instanceof Error ? error.message : "Action failed" 
    };
  }
}

const CollectionSettings = () => {
  const loaderData = useLoaderData() as LoaderData | undefined;
  const { collectionId } = useParams();
  const navigate = useNavigate();
  const submit = useSubmit();
  
  if (!loaderData) {
    return (
      <Page title="Loading...">
        <Layout>
          <Layout.Section>
            <Card>
              <Text as="p">Loading collection data...</Text>
            </Card>
          </Layout.Section>
        </Layout>
      </Page>
    );
  }

  const { collection, shopDomain, savedData } = loaderData;
  
  // State
  const [isSaving, setIsSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [resortModalActive, setResortModalActive] = useState(false);
  const [actionMessage, setActionMessage] = useState<string>("");
  const [resortMessage, setResortMessage] = useState<string>("");
  const [manualSortOrder, setManualSortOrder] = useState(false);
  
  // Position-based settings
  const [pushNewProducts, setPushNewProducts] = useState(true);
  const [pushNewProductsDays, setPushNewProductsDays] = useState("7");
  const [pushDownOutOfStock, setPushDownOutOfStock] = useState(true);
  const [outOfStockNew, setOutOfStockNew] = useState("push-down");
  const [outOfStockFeatured, setOutOfStockFeatured] = useState("push-down");
  const [outOfStockTags, setOutOfStockTags] = useState("position-defined");
  
  // Criteria-based settings
  const [sortCriteria, setSortCriteria] = useState("revenue");
  const [sortOrderMode, setSortOrderMode] = useState("high-to-low");
  const [sortLookbackDays, setSortLookbackDays] = useState("30");
  const [ordersRange, setOrdersRange] = useState("all-orders");
  const [includeDiscounts, setIncludeDiscounts] = useState(true);
  const [previewData, setPreviewData] = useState<any[]>([]);
  const [showPreview, setShowPreview] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);
  
  // Tabs state
  const [selectedTab, setSelectedTab] = useState(0);

  // Sync states with loader data
  useEffect(() => {
    setManualSortOrder(collection.sortOrder === "MANUAL");
    setPushNewProducts(savedData.productBehaviorRules?.pushNewProductsUp ?? true);
    setPushNewProductsDays(savedData.productBehaviorRules?.newProductDays?.toString() || "7");
    setPushDownOutOfStock(savedData.productBehaviorRules?.pushDownOutOfStock ?? true);
    setOutOfStockNew(savedData.productBehaviorRules?.outOfStockVsNewPriority || "push-down");
    setOutOfStockFeatured(savedData.productBehaviorRules?.outOfStockVsFeaturedPriority || "push-down");
    setOutOfStockTags(savedData.productBehaviorRules?.outOfStockVsTagsPriority || "position-defined");
    
    // Parse the primarySortOrder to determine the sorting method
    const savedPrimarySortOrder = savedData.collectionSettings?.primarySortOrder || "random-high-low";
    
    // Set initial tab based on saved data
    if (savedPrimarySortOrder === "position-based") {
      setSelectedTab(0); // Position-based tab
    } else if (savedPrimarySortOrder.startsWith("criteria-")) {
      setSelectedTab(1); // Criteria-based tab
      // Use stored fields instead of parsing
      setSortCriteria(savedData.collectionSettings?.sortCriteria || "revenue");
      setSortOrderMode(savedData.collectionSettings?.sortOrderMode || "high-to-low");
    }
    
    if (savedData.collectionSettings?.lookbackPeriod) {
      setSortLookbackDays(savedData.collectionSettings.lookbackPeriod.toString());
    }
    
    if (savedData.collectionSettings?.ordersRange) {
      setOrdersRange(savedData.collectionSettings.ordersRange);
    }

    if (savedData.collectionSettings?.includeDiscounts !== undefined) {
      setIncludeDiscounts(savedData.collectionSettings.includeDiscounts);
    }
  }, [savedData, collection]);

  // Options
  const sortCriteriaOptions = [
    { label: "Revenue Generated", value: "revenue" },
    { label: "Number of Sales", value: "sales" },
    { label: "Creation Date", value: "creation" },
    { label: "Publish Date", value: "publish" },
    { label: "Price", value: "price" },
    { label: "Inventory", value: "inventory" },
  ];

  const sortOrderModeOptions = [
    { label: "High to Low", value: "high-to-low" },
    { label: "Low to High", value: "low-to-high" },
  ];

  const lookbackDaysOptions = [
    { label: "7 days", value: "7" },
    { label: "14 days", value: "14" },
    { label: "30 days", value: "30" },
    { label: "60 days", value: "60" },
    { label: "90 days", value: "90" },
    { label: "180 days", value: "180" },
  ];

  const ordersRangeOptions = [
    { label: "All Orders", value: "all-orders" },
    { label: "Paid Orders Only", value: "paid-orders" },
    { label: "Fulfilled Orders Only", value: "fulfilled-orders" },
  ];

  const tabs = [
    {
      id: 'position-based',
      content: 'Position-based Sorting',
      accessibilityLabel: 'Position-based Sorting',
      panelID: 'position-based-panel',
    },
    {
      id: 'criteria-based',
      content: 'Criteria-based Sorting',
      accessibilityLabel: 'Criteria-based Sorting',
      panelID: 'criteria-based-panel',
    },
  ];

  // Handlers
  const handleSortOrderChange = async (value: boolean) => {
    setManualSortOrder(value);
    setActionMessage(value ? 
      "Updating collection to Manual sort order in Shopify..." : 
      "Updating collection to default sort order in Shopify...");
    
    const formData = new FormData();
    formData.append("intent", "update-collection-sort-order");
    formData.append("manualSortOrder", value.toString());
    
    try {
      submit(formData, { 
        method: "POST",
        replace: true 
      });
    } catch (error) {
      console.error("Failed to update sort order:", error);
      setActionMessage("Failed to update sort order");
    }
  };

  const handleSavePositionBasedSettings = async () => {
    setIsSaving(true);
    setActionMessage("Saving position-based settings...");
    
    const behaviorRules = {
      pushNewProductsUp: pushNewProducts,
      newProductDays: parseInt(pushNewProductsDays) || 7,
      pushDownOutOfStock: pushDownOutOfStock,
      outOfStockVsNewPriority: outOfStockNew,
      outOfStockVsFeaturedPriority: outOfStockFeatured,
      outOfStockVsTagsPriority: outOfStockTags
    };
    
    const formData = new FormData();
    formData.append("intent", "save-position-based-settings");
    formData.append("behaviorRules", JSON.stringify(behaviorRules));
    
    try {
      submit(formData, { 
        method: "POST",
        replace: true 
      });
      
      setSaveSuccess(true);
      setActionMessage("Position-based settings saved successfully!");
      setTimeout(() => {
        setSaveSuccess(false);
        setActionMessage("");
      }, 3000);
    } catch (error) {
      console.error("Save failed:", error);
      setActionMessage("Failed to save position-based settings");
    } finally {
      setIsSaving(false);
    }
  };

  const handleSaveCriteriaBasedSettings = async () => {
    setIsSaving(true);
    setActionMessage("Saving criteria-based settings...");
    
    const settings = {
      sortCriteria,
      sortOrderMode,
      lookbackPeriod: parseInt(sortLookbackDays),
      ordersRange,
      includeDiscounts
    };
    
    const formData = new FormData();
    formData.append("intent", "save-criteria-based-settings");
    formData.append("settings", JSON.stringify(settings));
    
    try {
      submit(formData, { 
        method: "POST",
        replace: true 
      });
      
      setSaveSuccess(true);
      setActionMessage("Criteria-based settings saved successfully!");
      setTimeout(() => {
        setSaveSuccess(false);
        setActionMessage("");
      }, 3000);
    } catch (error) {
      console.error("Save failed:", error);
      setActionMessage("Failed to save criteria-based settings");
    } finally {
      setIsSaving(false);
    }
  };

  const handlePreviewSortOrder = async () => {
    setPreviewLoading(true);
    setShowPreview(false);
    
    const formData = new FormData();
    formData.append("intent", "preview-sort-order");
    formData.append("sortCriteria", sortCriteria);
    formData.append("sortOrder", sortOrderMode);
    formData.append("lookbackDays", sortLookbackDays);
    formData.append("ordersRange", ordersRange);
    formData.append("includeDiscounts", includeDiscounts.toString());
    
    try {
      const response = await fetch("", {
        method: "POST",
        body: formData,
      });
      
      const data = await response.json();
      
      if (data.success) {
        setPreviewData(data.previewProducts || []);
        setShowPreview(true);
        setActionMessage(data.message || "Preview generated successfully!");
        
        // Log preview data for debugging
        console.log("Preview data:", {
          includeDiscounts: data.includeDiscounts,
          products: data.previewProducts?.map((p: any) => ({
            title: p.title,
            totalRevenue: p.totalRevenue,
            discountedRevenue: p.discountedRevenue,
            totalSales: p.totalSales
          }))
        });
      } else {
        setActionMessage(data.error || "Failed to generate preview");
      }
    } catch (error) {
      console.error("Preview failed:", error);
      setActionMessage("Failed to generate preview");
    } finally {
      setPreviewLoading(false);
    }
  };

  const handleResortCollection = async () => {
    setIsSaving(true);
    setResortMessage("");
    setActionMessage("Re-sorting collection... This may take a few moments.");
    
    const formData = new FormData();
    formData.append("intent", "resort-collection");
    
    try {
      submit(formData, { 
        method: "POST",
        replace: true 
      });
      
      setResortMessage("Collection reordering started... This may take a few moments.");
      setTimeout(() => {
        setResortModalActive(false);
        setSaveSuccess(true);
        setActionMessage("Collection successfully reordered! Changes should now be visible in Shopify.");
      }, 2000);
      
      setTimeout(() => {
        setSaveSuccess(false);
        setActionMessage("");
        setResortMessage("");
      }, 5000);
    } catch (error) {
      console.error("Resort failed:", error);
      setResortMessage("Failed to reorder collection");
      setActionMessage("Failed to reorder collection");
    } finally {
      setIsSaving(false);
    }
  };

  const toastMarkup = saveSuccess ? (
    <Toast content={actionMessage || resortMessage || "Settings saved successfully!"} onDismiss={() => setSaveSuccess(false)} />
  ) : null;

  return (
    <Page
      title={`Collection Settings: ${collection.title}`}
      primaryAction={{
        content: "Re-Sort Collection",
        onAction: () => setResortModalActive(true),
        loading: isSaving,
      }}
      secondaryActions={[
        {
          content: "Back to collections",
          onAction: () => navigate("/app"),
        },
      ]}
      backAction={{ 
        content: "Collections", 
        onAction: () => navigate("/app"),
      }}
    >
      <Layout>
        {/* Manual Sort Order Control */}
        <Layout.Section>
          <Card>
            <BlockStack gap="300">
              <Text as="h2" variant="headingMd">
                Collection Sort Order Control
              </Text>
              <Text as="p" tone="subdued">
                This setting automatically syncs with your Shopify collection. When enabled, the collection will be set to Manual sort order in Shopify. When disabled, it will revert to the default sort order.
              </Text>
              <InlineStack align="space-between">
                <Checkbox
                  label="Manual Sort Order"
                  checked={manualSortOrder}
                  onChange={handleSortOrderChange}
                  helpText={manualSortOrder ? 
                    "✅ Collection is set to Manual sort order in Shopify" : 
                    "⚠️ Collection is using default Shopify sort order"}
                />
                <Button
                  variant="plain"
                  onClick={() => window.open(`https://${shopDomain}/admin/collections/${collectionId}`, '_blank')}
                >
                  View in Shopify Admin
                </Button>
              </InlineStack>
              {manualSortOrder && (
                <Banner tone="success">
                  <Text as="p">
                    ✅ This collection is set to Manual sort order in Shopify. You can now organize products manually using the settings below.
                  </Text>
                </Banner>
              )}
              {!manualSortOrder && (
                <Banner tone="warning">
                  <Text as="p">
                    ⚠️ This collection is not set to Manual sort order. Enable "Manual Sort Order" to use custom sorting rules. Current Shopify sort order: <strong>{collection.sortOrder?.replace('_', ' ').toLowerCase()}</strong>
                  </Text>
                </Banner>
              )}
            </BlockStack>
          </Card>
        </Layout.Section>

        {/* Info Banner */}
        <Layout.Section>
          <Banner>
            <Text as="p">
              Customize sorting rules for this collection specifically. Configure how products should be ordered based on various criteria.
            </Text>
          </Banner>
        </Layout.Section>

        {/* Action Message Banner */}
        {actionMessage && (
          <Layout.Section>
            <Banner tone={saveSuccess ? "success" : "info"}>
              <Text as="p">{actionMessage}</Text>
            </Banner>
          </Layout.Section>
        )}

        <Layout.Section>
          <LegacyCard>
            <Tabs tabs={tabs} selected={selectedTab} onSelect={setSelectedTab}>
              <LegacyCard.Section>
                {/* Position-based Sorting Tab */}
                {selectedTab === 0 && (
                  <BlockStack gap="400">
                    <InlineStack align="space-between">
                      <Text as="h2" variant="headingMd">
                        Position-based Sorting
                      </Text>
                      <Button 
                        onClick={handleSavePositionBasedSettings}
                        variant="primary"
                        loading={isSaving}
                      >
                        Save Settings
                      </Button>
                    </InlineStack>

                    <Text as="p" tone="subdued">
                      Configure how products should be automatically positioned based on their characteristics like newness and stock status.
                    </Text>
                    
                    <Card>
                      <BlockStack gap="200">
                        <Text as="h3" variant="headingSm">
                          Push New Products Up
                        </Text>
                        <Text as="p" tone="subdued">
                          Automatically push newly added products to the top of the collection for a specified period.
                        </Text>
                        <InlineStack align="space-between">
                          <Checkbox
                            label="Enable push new products"
                            checked={pushNewProducts}
                            onChange={setPushNewProducts}
                          />
                          {pushNewProducts && (
                            <InlineStack gap="200">
                              <TextField
                                label="Days"
                                type="number"
                                value={pushNewProductsDays}
                                onChange={setPushNewProductsDays}
                                placeholder="7"
                                autoComplete="off"
                                min="1"
                                max="365"
                              />
                              <Text as="span">days</Text>
                            </InlineStack>
                          )}
                        </InlineStack>
                      </BlockStack>
                    </Card>

                    <Card>
                      <BlockStack gap="200">
                        <Text as="h3" variant="headingSm">
                          Push Down Out of Stock
                        </Text>
                        <Text as="p" tone="subdued">
                          Automatically push out-of-stock products to the bottom of the collection.
                        </Text>
                        <Checkbox
                          label="Enable push down out of stock"
                          checked={pushDownOutOfStock}
                          onChange={setPushDownOutOfStock}
                        />
                      </BlockStack>
                    </Card>

                    {pushNewProducts && pushDownOutOfStock && (
                      <Card>
                        <BlockStack gap="200">
                          <Text as="h3" variant="headingSm">
                            Out-of-Stock vs New Products
                          </Text>
                          <Text as="p" tone="subdued">
                            How to handle products that are both new and out-of-stock.
                          </Text>
                          <Select
                            label="Priority for new out-of-stock products"
                            options={[
                              { label: "Push down out-of-stock even if new", value: "push-down" },
                              { label: "Keep new products at top even if out-of-stock", value: "push-new" },
                            ]}
                            value={outOfStockNew}
                            onChange={setOutOfStockNew}
                          />
                        </BlockStack>
                      </Card>
                    )}

                    {pushDownOutOfStock && (
                      <Card>
                        <BlockStack gap="200">
                          <Text as="h3" variant="headingSm">
                            Out-of-Stock vs Featured
                          </Text>
                          <Text as="p" tone="subdued">
                            How to handle featured products that are out-of-stock.
                          </Text>
                          <Select
                            label="Priority for featured out-of-stock products"
                            options={[
                              { label: "Push down out-of-stock even if featured", value: "push-down" },
                              { label: "Keep featured products at top even if out-of-stock", value: "push-featured" },
                            ]}
                            value={outOfStockFeatured}
                            onChange={setOutOfStockFeatured}
                          />
                        </BlockStack>
                      </Card>
                    )}

                    {pushDownOutOfStock && (
                      <Card>
                        <BlockStack gap="200">
                          <Text as="h3" variant="headingSm">
                            Out-of-Stock vs Tags
                          </Text>
                          <Text as="p" tone="subdued">
                            How to handle tagged products that are out-of-stock.
                          </Text>
                          <Select
                            label="Priority for tagged out-of-stock products"
                            options={[
                              { label: "Keep position defined by tag", value: "position-defined" },
                              { label: "Push down out-of-stock", value: "push-down" },
                            ]}
                            value={outOfStockTags}
                            onChange={setOutOfStockTags}
                          />
                        </BlockStack>
                      </Card>
                    )}
                  </BlockStack>
                )}

                {/* Criteria-based Sorting Tab */}
                {selectedTab === 1 && (
                  <BlockStack gap="400">
                    <InlineStack align="space-between">
                      <Text as="h2" variant="headingMd">
                        Criteria-based Sorting Configuration
                      </Text>
                      <InlineStack gap="200">
                        <Button 
                          onClick={handleSaveCriteriaBasedSettings}
                          variant="primary"
                          loading={isSaving}
                        >
                          Save Settings
                        </Button>
                      </InlineStack>
                    </InlineStack>
                    
                    <Card>
                      <BlockStack gap="400">
                        <Text as="h3" variant="headingSm">
                          Sort Criteria
                        </Text>
                        
                        <InlineStack gap="400">
                          <div style={{ width: "100%" }}>
                            <Select
                              label="Sort by"
                              options={sortCriteriaOptions}
                              value={sortCriteria}
                              onChange={setSortCriteria}
                            />
                          </div>
                          
                          <div style={{ width: "100%" }}>
                            <Select
                              label="Order"
                              options={sortOrderModeOptions}
                              value={sortOrderMode}
                              onChange={setSortOrderMode}
                            />
                          </div>
                        </InlineStack>
                        
                        <Select
                          label="Lookback period"
                          options={lookbackDaysOptions}
                          value={sortLookbackDays}
                          onChange={setSortLookbackDays}
                          helpText="How many days to look back for order data (for revenue and sales calculations)"
                        />
                        
                        {(sortCriteria === "revenue" || sortCriteria === "sales") && (
                          <>
                            <Select
                              label="Orders to include"
                              options={ordersRangeOptions}
                              value={ordersRange}
                              onChange={setOrdersRange}
                              helpText="Choose which orders to include in revenue and sales calculations"
                            />
                            
                            <Checkbox
                              label="Include discounts in revenue calculation"
                              checked={includeDiscounts}
                              onChange={setIncludeDiscounts}
                              helpText={includeDiscounts ? 
                                "✅ Discounts are included in revenue calculation (net revenue)" : 
                                "❌ Discounts are NOT included in revenue calculation (gross revenue at original price)"}
                            />
                          </>
                        )}
                        
                        <InlineStack gap="200">
                          <Button
                            onClick={handlePreviewSortOrder}
                            loading={previewLoading}
                            disabled={!sortCriteria || !sortOrderMode || !sortLookbackDays}
                          >
                            Preview Sort Order
                          </Button>
                        </InlineStack>
                        
                        {showPreview && (
                          <Card>
                            <BlockStack gap="200">
                              <Text as="h4" variant="headingSm">
                                Preview Results
                              </Text>
                              <Text as="p" tone="subdued">
                                Top {previewData.length} products based on your criteria:
                              </Text>
                              <Text as="p" tone="subdued">
                                Include discounts: {includeDiscounts ? "Yes (net revenue)" : "No (gross revenue)"}
                              </Text>
                              
                              {previewData.map((product, index) => (
                                <Card key={product.id}>
                                  <InlineStack align="space-between">
                                    <InlineStack gap="200">
                                      <Badge>{String(index + 1)}</Badge>
                                      <BlockStack gap="100">
                                        <Text as="p" fontWeight="bold">{product.title}</Text>
                                        <Text as="p" tone="subdued">
                                          {sortCriteria === "revenue" && 
                                            (includeDiscounts ? 
                                              `Net Revenue: $${product.discountedRevenue?.toFixed(2) || product.totalRevenue?.toFixed(2) || "0.00"}` : 
                                              `Gross Revenue: $${product.totalRevenue?.toFixed(2) || "0.00"}`
                                            )}
                                          {sortCriteria === "sales" && `Sales: ${product.totalSales} units`}
                                          {sortCriteria === "price" && `Price: $${product.price}`}
                                          {sortCriteria === "inventory" && `Inventory: ${product.inventory}`}
                                          {sortCriteria === "creation" && `Created: ${new Date(product.createdAt).toLocaleDateString()}`}
                                          {sortCriteria === "publish" && `Published: ${new Date(product.publishedAt).toLocaleDateString()}`}
                                        </Text>
                                        {sortCriteria === "revenue" && includeDiscounts && product.totalRevenue !== product.discountedRevenue && (
                                          <Text as="p" tone="subdued" variant="bodySm">
                                            Original: ${product.totalRevenue?.toFixed(2) || "0.00"} | 
                                            Discounted: ${product.discountedRevenue?.toFixed(2) || product.totalRevenue?.toFixed(2) || "0.00"}
                                          </Text>
                                        )}
                                      </BlockStack>
                                    </InlineStack>
                                    {(sortCriteria === "revenue" || sortCriteria === "sales") && (
                                      <BlockStack gap="100" align="end">
                                        {sortCriteria === "revenue" && (
                                          <Badge tone="success">
                                            {includeDiscounts ? 
                                              `$${(product.discountedRevenue || product.totalRevenue || 0).toFixed(2)}` : 
                                              `$${(product.totalRevenue || 0).toFixed(2)}`}
                                          </Badge>
                                        )}
                                        {sortCriteria === "sales" && (
                                          <Badge tone="attention">{`${product.totalSales} sales`}</Badge>
                                        )}
                                      </BlockStack>
                                    )}
                                  </InlineStack>
                                </Card>
                              ))}
                            </BlockStack>
                          </Card>
                        )}
                      </BlockStack>
                    </Card>
                  </BlockStack>
                )}
              </LegacyCard.Section>
            </Tabs>
          </LegacyCard>
        </Layout.Section>
      </Layout>

      {/* Resort Modal */}
      <Modal
        open={resortModalActive}
        onClose={() => setResortModalActive(false)}
        title="Re-Sort Collection?"
        primaryAction={{
          content: "Yes, Re-Sort",
          onAction: handleResortCollection,
          loading: isSaving,
        }}
        secondaryActions={[{
          content: "Cancel",
          onAction: () => setResortModalActive(false),
        }]}
      >
        <Modal.Section>
          <Text as="p">
            This will apply your current sorting rules to the collection. The product order will be updated in both Shopify Admin and your online store.
          </Text>
          {resortMessage && (
            <Banner tone="info">
              <Text as="p">{resortMessage}</Text>
            </Banner>
          )}
        </Modal.Section>
      </Modal>

      {toastMarkup}
    </Page>
  );
};

export default CollectionSettings;