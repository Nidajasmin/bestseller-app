// app/routes/app.collection-sort.$collectionId.tsx
import type { LoaderFunctionArgs, ActionFunctionArgs } from "react-router";
import { useLoaderData, useParams, useNavigate, useSubmit } from "react-router";
import { useState, useEffect, useRef } from "react";
import {
  Page,
  Layout,
  Card,
  TextField,
  ChoiceList,
  Select,
  Button,
  Banner,
  Thumbnail,
  InlineStack,
  BlockStack,
  Text,
  Box,
  Icon,
  List,
  Badge,
  Collapsible,
  Grid,
  Checkbox,
  Divider,
  TextContainer,
  Tabs,
  LegacyCard,
  Modal,
  Toast,
  Pagination,
} from "@shopify/polaris";
import {
  SearchIcon,
  DeleteIcon,
  CheckIcon,
  DragHandleIcon,
  CalendarIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  EditIcon,
  ArrowDownIcon,
  ArrowUpIcon,
  ArrowLeftIcon,
} from "@shopify/polaris-icons";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

// Types
interface Product {
  id: string;
  title: string;
  featuredImage?: {
    url: string;
    altText: string | null;
  };
  handle: string;
  featuredType: "manual" | "scheduled";
  daysToFeature?: number;
  startDate?: string;
  scheduleApplied?: boolean;
  position?: number;
}

interface CollectionDetails {
  id: string;
  title: string;
  handle: string;
  productsCount: {
    count: number;
  };
  sortOrder?: string; // Add sortOrder to track collection's current sort order
}

interface TagRule {
  id: string;
  name: string;
  position: string;
}

interface LoaderData {
  collection: CollectionDetails;
  products: Product[];
  shopDomain: string;
  savedData: {
    featuredProducts: Product[];
    collectionSettings: any;
    featuredSettings: any;
    productBehaviorRules: any;
    tagRules: TagRule[];
  };
}

// GraphQL Queries
const GET_COLLECTION_PRODUCTS = `#graphql
  query GetCollectionProducts($id: ID!, $first: Int!, $after: String) {
    collection(id: $id) {
      products(first: $first, after: $after) {
        pageInfo {
          hasNextPage
          hasPreviousPage
          endCursor
        }
        edges {
          node {
            id
            title
            handle
            featuredImage {
              url
              altText
            }
          }
        }
      }
    }
  }
`;

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

const GET_JOB_STATUS = `#graphql
  query GetJobStatus($id: ID!) {
    job(id: $id) {
      id
      done
    }
  }
`;

// Helper function to construct GID from numeric ID
const constructGid = (id: string) => {
  return `gid://shopify/Collection/${id}`;
};

// Helper function to poll job status
const pollJobStatus = async (admin: any, jobId: string, maxAttempts = 30): Promise<boolean> => {
  console.log(`⏳ Starting job polling for: ${jobId}`);
  
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    console.log(`🔄 Checking job status (attempt ${attempt}/${maxAttempts})...`);
    
    // Wait 2 seconds between attempts
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    try {
      const jobResponse = await admin.graphql(GET_JOB_STATUS, { 
        variables: { id: jobId } 
      });
      
      const jobData = await jobResponse.json() as any;
      console.log(`📊 Job status response:`, JSON.stringify(jobData, null, 2));
      
      if (jobData.data?.job?.done) {
        console.log("✅ Job completed successfully!");
        return true;
      }
      
      if (jobData.errors) {
        console.error("❌ Job status check errors:", jobData.errors);
      }
    } catch (error) {
      console.error(`❌ Error polling job status (attempt ${attempt}):`, error);
    }
  }
  
  console.log("⚠️ Job polling timed out after maximum attempts");
  return false;
};

// Loader function
export async function loader({ request, params }: LoaderFunctionArgs) {
  const { admin, session } = await authenticate.admin(request);
  const { collectionId } = params;

  if (!collectionId) {
    throw new Response("Collection ID is required", { status: 400 });
  }

  try {
    // Construct the full GID from the numeric ID
    const gid = constructGid(collectionId);
    
    // Get URL parameters for pagination
    const url = new URL(request.url);
    const productsPage = parseInt(url.searchParams.get("productsPage") || "1");
    const featuredPage = parseInt(url.searchParams.get("featuredPage") || "1");
    const productsCount = parseInt(url.searchParams.get("productsCount") || "250");
    const searchQuery = url.searchParams.get("search") || "";
    const after = url.searchParams.get("after") || null;

    // Get collection details
    const collectionResponse = await admin.graphql(GET_COLLECTION, {
      variables: { id: gid }
    });
    
    const collectionData = await collectionResponse.json() as any;
    
    if (!collectionData.data?.collection) {
      throw new Response("Collection not found", { status: 404 });
    }

    // Build search query if provided
    let finalQuery = '';
    if (searchQuery) {
      finalQuery = `title:*${searchQuery}*`;
    }

    // Get collection products with pagination
    const productsResponse = await admin.graphql(GET_COLLECTION_PRODUCTS, {
      variables: { 
        id: gid, 
        first: productsCount,
        after: after
      }
    });
    
    const productsData = await productsResponse.json() as any;
    
    const products = productsData.data?.collection?.products?.edges?.map((edge: any) => ({
      ...edge.node,
      featuredType: "manual" as const,
      scheduleApplied: false
    })) || [];

    // Get saved data from database - using correct Prisma model names (PascalCase)
    const featuredProductsFromDb = await prisma.featuredProduct.findMany({
      where: {
        shopifyDomain: session.shop,
        collectionId: gid
      },
      orderBy: { position: 'asc' }
    });

    // Get collection settings
    const collectionSettingsFromDb = await prisma.collectionSetting.findUnique({
      where: {
        shopifyDomain_collectionId: {
          shopifyDomain: session.shop,
          collectionId: gid
        }
      }
    });

    // Get featured settings
    const featuredSettingsFromDb = await prisma.featuredSettings.findUnique({
      where: {
        shopifyDomain_collectionId: {
          shopifyDomain: session.shop,
          collectionId: gid
        }
      }
    });

    // Get product behavior rules
    const productBehaviorRulesFromDb = await prisma.productBehaviorRule.findUnique({
      where: {
        shopifyDomain_collectionId: {
          shopifyDomain: session.shop,
          collectionId: gid
        }
      }
    });

    // Get tag rules
    const tagRulesFromDb = await prisma.tagSortingRule.findMany({
      where: {
        shopifyDomain: session.shop,
        collectionId: gid
      }
    });

    // Transform featured products to match our Product type
    const featuredProducts: Product[] = featuredProductsFromDb.map((fp: any) => {
      const shopifyProduct = products.find((p: Product) => p.id === fp.productId);
      return {
        id: fp.productId,
        title: shopifyProduct?.title || 'Product not found',
        handle: shopifyProduct?.handle || '',
        featuredImage: shopifyProduct?.featuredImage,
        featuredType: fp.featuredType as "manual" | "scheduled",
        daysToFeature: fp.daysToFeature || undefined,
        startDate: fp.startDate ? new Date(fp.startDate).toISOString().split('T')[0] : undefined,
        scheduleApplied: fp.scheduleApplied,
        position: fp.position
      };
    });

    // Transform tag rules
    const tagRules: TagRule[] = tagRulesFromDb.map((rule: any) => ({
      id: rule.id.toString(),
      name: rule.tagName,
      position: rule.position
    }));

    return {
      collection: collectionData.data.collection,
      products,
      shopDomain: session.shop,
      savedData: {
        featuredProducts,
        collectionSettings: collectionSettingsFromDb || {},
        featuredSettings: featuredSettingsFromDb || {},
        productBehaviorRules: productBehaviorRulesFromDb || {},
        tagRules
      },
      pagination: {
        productsPage,
        featuredPage,
        productsCount,
        searchQuery,
        hasNextPage: productsData.data?.collection?.products?.pageInfo?.hasNextPage || false,
        hasPreviousPage: productsData.data?.collection?.products?.pageInfo?.hasPreviousPage || false,
        endCursor: productsData.data?.collection?.products?.pageInfo?.endCursor,
      }
    };
  } catch (error) {
    console.error("Error loading collection data:", error);
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
                sortOrder: manualSortOrder ? "MANUAL" : "AUTOMATIC"
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
          
          // Update the database
          await prisma.featuredSettings.upsert({
            where: {
              shopifyDomain_collectionId: {
                shopifyDomain: session.shop,
                collectionId: gid
              }
            },
            update: { manualSortOrder },
            create: {
              shopifyDomain: session.shop,
              collectionId: gid,
              sortOrder: "manual",
              limitFeatured: 0,
              manualSortOrder
            }
          });
          
          return { 
            success: true, 
            message: manualSortOrder ? 
              "Collection sort order updated to Manual. You can now organize products manually." : 
              "Collection sort order updated to Automatic." 
          };
        } catch (error) {
          console.error("Failed to update collection sort order:", error);
          return { 
            success: false, 
            error: error instanceof Error ? error.message : "Failed to update collection sort order" 
          };
        }
      }

      case "save-featured-products": {
        const featuredProducts = JSON.parse(formData.get("featuredProducts") as string);
        const featuredSettings = JSON.parse(formData.get("featuredSettings") as string);
        
        // Delete existing featured products
        await prisma.featuredProduct.deleteMany({
          where: {
            shopifyDomain: session.shop,
            collectionId: gid
          }
        });

        // Create new featured products with positions
        for (let i = 0; i < featuredProducts.length; i++) {
          const product = featuredProducts[i];
          await prisma.featuredProduct.create({
            data: {
              shopifyDomain: session.shop,
              collectionId: gid,
              productId: product.id,
              position: i,
              featuredType: product.featuredType,
              daysToFeature: product.daysToFeature,
              startDate: product.startDate ? new Date(product.startDate) : null,
              scheduleApplied: product.scheduleApplied || false
            }
          });
        }

        // Save featured settings
        await prisma.featuredSettings.upsert({
          where: {
            shopifyDomain_collectionId: {
              shopifyDomain: session.shop,
              collectionId: gid
            }
          },
          update: featuredSettings,
          create: {
            shopifyDomain: session.shop,
            collectionId: gid,
            ...featuredSettings
          }
        });

        return { success: true, message: "Featured products saved successfully!" };
      }

      case "save-collection-settings": {
        const settings = JSON.parse(formData.get("settings") as string);
        const behaviorRules = JSON.parse(formData.get("behaviorRules") as string);
        
        await prisma.collectionSetting.upsert({
          where: {
            shopifyDomain_collectionId: {
              shopifyDomain: session.shop,
              collectionId: gid
            }
          },
          update: settings,
          create: {
            shopifyDomain: session.shop,
            collectionId: gid,
            ...settings
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

        return { success: true, message: "Collection settings saved successfully!" };
      }

      case "save-tag-rules": {
        const tagRules = JSON.parse(formData.get("tagRules") as string);
        
        // Delete existing tag rules
        await prisma.tagSortingRule.deleteMany({
          where: {
            shopifyDomain: session.shop,
            collectionId: gid
          }
        });

        // Create new tag rules
        for (const rule of tagRules) {
          await prisma.tagSortingRule.create({
            data: {
              shopifyDomain: session.shop,
              collectionId: gid,
              tagName: rule.name,
              position: rule.position
            }
          });
        }

        return { success: true, message: "Tag rules saved successfully!" };
      }

      case "resort-collection": {
        console.log("🚀 STARTING RESORT COLLECTION");
        console.log("Collection ID:", gid);
        console.log("Shop:", session.shop);
        
        try {
          // 1. First, check collection type and details
          console.log("📋 Step 1: Checking collection details...");
          const collectionCheckResponse = await admin.graphql(`
            query GetCollectionDetails($id: ID!) {
              collection(id: $id) {
                id
                title
                sortOrder
                productsCount {
                  count
                }
              }
            }
          `, { variables: { id: gid } });

          const collectionDetails = await collectionCheckResponse.json() as any;
          console.log("📊 Collection Details:", JSON.stringify(collectionDetails, null, 2));

          if (!collectionDetails.data?.collection) {
            console.log("❌ Collection not found!");
            return { success: false, error: "Collection not found" };
          }

          const collection = collectionDetails.data.collection;
          console.log(`🏷️ Collection: ${collection.title}`);
          console.log(`🔀 Sort Order: ${collection.sortOrder}`);
          console.log(`📦 Products Count: ${collection.productsCount.count}`);

          // Check if collection is manual
          if (collection.sortOrder !== "MANUAL") {
            console.log("❌ Collection is not manual - cannot reorder!");
            return { 
              success: false, 
              error: `This is an ${collection.sortOrder?.toLowerCase()} collection. Only manual collections can be reordered. Please change it to a manual collection in Shopify admin.` 
            };
          }

          // 2. Get behavior rules from database
          console.log("📋 Step 2: Getting behavior rules from database...");
          const behaviorRules = await prisma.productBehaviorRule.findUnique({
            where: {
              shopifyDomain_collectionId: {
                shopifyDomain: session.shop,
                collectionId: gid
              }
            }
          });

          console.log("📋 Behavior Rules:", behaviorRules);

          // 3. Get featured products from database
          console.log("📋 Step 3: Getting featured products from database...");
          const featuredProducts = await prisma.featuredProduct.findMany({
            where: {
              shopifyDomain: session.shop,
              collectionId: gid
            },
            orderBy: { position: 'asc' }
          });
          
          console.log(`⭐ Featured products in DB: ${featuredProducts.length}`);

          // 4. Get all products from collection with inventory data
          console.log("📋 Step 4: Getting products from Shopify collection with inventory...");
          const productsResponse = await admin.graphql(`
            query GetCollectionProductsWithInventory($id: ID!, $first: Int!) {
              collection(id: $id) {
                products(first: $first) {
                  edges {
                    node {
                      id
                      title
                      handle
                      featuredImage {
                        url
                        altText
                      }
                      totalInventory
                      createdAt
                      publishedAt
                    }
                  }
                }
              }
            }
          `, {
            variables: { id: gid, first: 250 }
          });
          
          const productsData = await productsResponse.json() as any;
          const allProducts = productsData.data?.collection?.products?.edges?.map((edge: any) => edge.node) || [];
          
          console.log(`🛍️ Products in Shopify collection: ${allProducts.length}`);

          if (allProducts.length === 0) {
            console.log("❌ No products found in collection!");
            return { success: false, error: "No products found in this collection" };
          }

          // 5. Apply out-of-stock logic based on behavior rules
          console.log("📋 Step 5: Applying out-of-stock logic...");
          
          let inStockProducts: any[] = [];
          let outOfStockProducts: any[] = [];

          // Separate products based on inventory
          allProducts.forEach((product: any) => {
            if (product.totalInventory > 0) {
              inStockProducts.push(product);
            } else {
              outOfStockProducts.push(product);
            }
          });

          console.log(`✅ In-stock products: ${inStockProducts.length}`);
          console.log(`❌ Out-of-stock products: ${outOfStockProducts.length}`);

          // 6. Create product order based on behavior rules - FIXED VERSION
          console.log("📋 Step 6: Creating product order with proper out-of-stock logic...");
          const productIds: string[] = [];

          // Track which featured products we've processed
          const processedFeaturedProducts = new Set();

          // Step 1: Add featured products that should stay at top
          featuredProducts.forEach((fp: any) => {
            const product = allProducts.find((p: any) => p.id === fp.productId);
            if (product) {
              const isOutOfStock = product.totalInventory <= 0;
              
              // Check if we should keep this featured product at top despite being out-of-stock
              const shouldKeepFeaturedAtTop = 
                !behaviorRules?.pushDownOutOfStock || // If push down is disabled, keep all featured
                !isOutOfStock || // If product is in stock, keep it
                (isOutOfStock && behaviorRules.outOfStockVsFeaturedPriority === "push-featured"); // Explicitly keep out-of-stock featured
              
              if (shouldKeepFeaturedAtTop) {
                productIds.push(fp.productId);
                processedFeaturedProducts.add(fp.productId);
                console.log(`⭐ ${isOutOfStock ? 'Out-of-stock ' : ''}Featured product at top: ${product.title}`);
              } else {
                console.log(`📥 Featured product pushed down (out-of-stock): ${product.title}`);
                // Don't add to productIds here - it will be added later with out-of-stock products
              }
            }
          });

          // Step 2: Add remaining in-stock products (non-featured)
          inStockProducts.forEach((product: any) => {
            if (!processedFeaturedProducts.has(product.id) && !productIds.includes(product.id)) {
              productIds.push(product.id);
            }
          });

          // Step 3: Add out-of-stock products at the end
          if (behaviorRules?.pushDownOutOfStock) {
            outOfStockProducts.forEach((product: any) => {
              if (!productIds.includes(product.id)) {
                productIds.push(product.id);
                console.log(`📥 Adding out-of-stock product to bottom: ${product.title}`);
              }
            });
          } else {
            // If push down out-of-stock is disabled, mix out-of-stock products normally
            outOfStockProducts.forEach((product: any) => {
              if (!productIds.includes(product.id)) {
                productIds.push(product.id);
              }
            });
          }

          console.log(`📋 Final product order: ${productIds.length} products`);
          console.log("First 10 products in order:");
          productIds.slice(0, 10).forEach((id, index) => {
            const product = allProducts.find((p: any) => p.id === id);
            const isOutOfStock = product?.totalInventory <= 0;
            console.log(`   ${index + 1}. ${product?.title} ${isOutOfStock ? '(OUT OF STOCK)' : ''}`);
          });

          // 7. Apply new order to Shopify
          console.log("📋 Step 7: Calling Shopify API to reorder...");
          
          const moves = productIds.map((productId, index) => ({
            id: productId,
            newPosition: index.toString()
          }));

          console.log("🔄 Sending moves to Shopify...");

          const reorderResponse = await admin.graphql(`
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
          `, {
            variables: {
              id: gid,
              moves: moves
            }
          });

          const reorderData = await reorderResponse.json() as any;
          console.log("📨 Shopify API Response:", JSON.stringify(reorderData, null, 2));

          // Check for errors
          if (reorderData.errors) {
            console.error("❌ GraphQL Errors:", reorderData.errors);
            const errorMessage = reorderData.errors.map((err: any) => err.message).join(', ');
            return { success: false, error: "GraphQL error: " + errorMessage };
          }

          if (reorderData.data?.collectionReorderProducts?.userErrors?.length > 0) {
            console.error("❌ Shopify User Errors:", reorderData.data.collectionReorderProducts.userErrors);
            const errorMessage = reorderData.data.collectionReorderProducts.userErrors[0].message;
            return { success: false, error: "Shopify error: " + errorMessage };
          }

          // Wait for job completion
          const jobId = reorderData.data?.collectionReorderProducts?.job?.id;
          if (jobId) {
            console.log("⏳ Reorder job started with ID:", jobId);
            const jobCompleted = await pollJobStatus(admin, jobId);
            
            if (jobCompleted) {
              console.log("✅ Job completed successfully!");
              await new Promise(resolve => setTimeout(resolve, 2000));
            } else {
              console.log("⚠️ Job polling timed out");
            }
          }

          console.log("🎉 COLLECTION REORDER PROCESS COMPLETED!");
          return { 
            success: true,
            message: "✅ Collection successfully reordered with out-of-stock rules applied!",
            jobId: jobId || null
          };
          
        } catch (error) {
          console.error("💥 Resort collection error:", error);
          return { 
            success: false, 
            error: error instanceof Error ? error.message : "Failed to resort collection" 
          };
        }
      }

      case "import-featured-products": {
        const file = formData.get("featuredProductsFile") as File;
        if (!file) {
          return { success: false, error: "No file uploaded" };
        }

        console.log("📥 Starting featured products import...");
        
        // Get current products for validation
        const productsResponse = await admin.graphql(GET_COLLECTION_PRODUCTS, {
          variables: { id: gid, first: 250 }
        });
        const productsData = await productsResponse.json() as any;
        const allProducts = productsData.data?.collection?.products?.edges?.map((edge: any) => edge.node) || [];

        const content = await file.text();
        const lines = content.split('\n').filter(line => line.trim());
        
        if (lines.length < 2) {
          return { success: false, error: "CSV file is empty or invalid" };
        }

        const headers = lines[0].split(',').map(h => h.replace(/"/g, '').trim().toLowerCase());
        console.log("📋 CSV Headers:", headers);
        
        const importedProducts: any[] = [];
        
        for (let i = 1; i < lines.length; i++) {
          const values = lines[i].split(',').map(v => v.replace(/"/g, '').trim());
          const product: any = {};
          
          headers.forEach((header, index) => {
            const cleanHeader = header.toLowerCase().replace(/\s+/g, '');
            product[cleanHeader] = values[index];
          });
          
          console.log(`📦 Processing product ${i}:`, product);
          
          // Validate required fields
          if (!product.productid) {
            console.log("❌ Missing product ID, skipping row:", product);
            continue;
          }

          // Find the product in the available products
          const existingProduct = allProducts.find((p: any) => p.id === product.productid);
          if (existingProduct) {
            const importedProduct = {
              id: product.productid,
              title: existingProduct.title,
              handle: existingProduct.handle,
              featuredImage: existingProduct.featuredImage,
              position: parseInt(product.position) || importedProducts.length,
              featuredType: (product.featuretype || "manual") as "manual" | "scheduled",
              daysToFeature: product.daystofeature ? parseInt(product.daystofeature) : undefined,
              startDate: product.startdate || undefined,
              scheduleApplied: product.scheduleapplied?.toLowerCase() === "true"
            };
            
            console.log("✅ Valid product found:", importedProduct);
            importedProducts.push(importedProduct);
          } else {
            console.log("❌ Product not found in collection:", product.productid);
          }
        }

        console.log(`📊 Total products to import: ${importedProducts.length}`);

        if (importedProducts.length === 0) {
          return { success: false, error: "No valid products found in CSV file" };
        }

        // Delete existing featured products
        console.log("🗑️ Deleting existing featured products...");
        await prisma.featuredProduct.deleteMany({
          where: {
            shopifyDomain: session.shop,
            collectionId: gid
          }
        });

        // Create new featured products with positions from CSV
        console.log("💾 Saving imported products to database...");
        for (let i = 0; i < importedProducts.length; i++) {
          const product = importedProducts[i];
          await prisma.featuredProduct.create({
            data: {
              shopifyDomain: session.shop,
              collectionId: gid,
              productId: product.id,
              position: product.position,
              featuredType: product.featuredType,
              daysToFeature: product.daysToFeature,
              startDate: product.startDate ? new Date(product.startDate) : null,
              scheduleApplied: product.scheduleApplied || false
            }
          });
          console.log(`✅ Saved product: ${product.title} at position ${product.position}`);
        }

        console.log("🎉 Featured products import completed!");

        // Auto re-sort collection after import
        console.log("🔄 Auto re-sorting collection after import...");
        try {
          const resortResult = await action({ 
            request: new Request(request.url, { 
              method: 'POST',
              body: new URLSearchParams({ intent: 'resort-collection' })
            }), 
            params 
          } as ActionFunctionArgs);
          
          if (resortResult.success) {
            console.log("✅ Auto re-sort completed after import!");
          } else {
            console.log("⚠️ Auto re-sort failed:", resortResult.error);
          }
        } catch (resortError) {
          console.log("⚠️ Auto re-sort error:", resortError);
        }

        return { 
          success: true, 
          importedCount: importedProducts.length, 
          message: `Successfully imported ${importedProducts.length} featured products and re-sorted collection!` 
        };
      }

      case "import-products": {
        const file = formData.get("productsFile") as File;
        if (!file) {
          return { success: false, error: "No file uploaded" };
        }

        // Get current products for validation
        const productsResponse = await admin.graphql(GET_COLLECTION_PRODUCTS, {
          variables: { id: gid, first: 250 }
        });
        const productsData = await productsResponse.json() as any;
        const products = productsData.data?.collection?.products?.edges?.map((edge: any) => edge.node) || [];

        const content = await file.text();
        const lines = content.split('\n').filter(line => line.trim());
        if (lines.length < 2) {
          return { success: false, error: "CSV file is empty or invalid" };
        }

        const headers = lines[0].split(',').map(h => h.replace(/"/g, '').trim());
        
        const importedProducts: Product[] = [];
        
        for (let i = 1; i < lines.length; i++) {
          const values = lines[i].split(',').map(v => v.replace(/"/g, '').trim());
          const product: any = {};
          
          headers.forEach((header, index) => {
            product[header.toLowerCase().replace(/\s+/g, '')] = values[index];
          });
          
          // Find the product in the available products
          const existingProduct = products.find((p: any) => p.id === product.productid);
          if (existingProduct) {
            importedProducts.push({
              ...existingProduct,
              position: parseInt(product.position) || importedProducts.length,
              featuredType: "manual",
              scheduleApplied: false
            });
          }
        }

        // Update featured products with imported data
        await prisma.featuredProduct.deleteMany({
          where: {
            shopifyDomain: session.shop,
            collectionId: gid
          }
        });

        for (let i = 0; i < importedProducts.length; i++) {
          const product = importedProducts[i];
          await prisma.featuredProduct.create({
            data: {
              shopifyDomain: session.shop,
              collectionId: gid,
              productId: product.id,
              position: i,
              featuredType: product.featuredType,
              daysToFeature: product.daysToFeature,
              startDate: product.startDate ? new Date(product.startDate) : null,
              scheduleApplied: product.scheduleApplied || false
            }
          });
        }

        return { success: true, importedCount: importedProducts.length, message: `Successfully imported ${importedProducts.length} products` };
      }

      case "import-tags": {
        const file = formData.get("tagsFile") as File;
        if (!file) {
          return { success: false, error: "No file uploaded" };
        }

        const content = await file.text();
        const lines = content.split('\n').filter(line => line.trim());
        if (lines.length < 2) {
          return { success: false, error: "CSV file is empty or invalid" };
        }

        const headers = lines[0].split(',').map(h => h.replace(/"/g, '').trim());
        
        const importedTags: TagRule[] = [];
        
        for (let i = 1; i < lines.length; i++) {
          const values = lines[i].split(',').map(v => v.replace(/"/g, '').trim());
          const tag: any = {};
          
          headers.forEach((header, index) => {
            tag[header.toLowerCase().replace(/\s+/g, '')] = values[index];
          });
          
          importedTags.push({
            id: Date.now().toString() + i,
            name: tag.tagname || tag.name,
            position: tag.position || 'top'
          });
        }

        // Update tag rules with imported data
        await prisma.tagSortingRule.deleteMany({
          where: {
            shopifyDomain: session.shop,
            collectionId: gid
          }
        });

        for (const tag of importedTags) {
          await prisma.tagSortingRule.create({
            data: {
              shopifyDomain: session.shop,
              collectionId: gid,
              tagName: tag.name,
              position: tag.position
            }
          });
        }

        return { success: true, importedCount: importedTags.length, message: `Successfully imported ${importedTags.length} tag rules` };
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

// Drag and drop utilities
const reorder = (list: Product[], startIndex: number, endIndex: number): Product[] => {
  const result = Array.from(list);
  const [removed] = result.splice(startIndex, 1);
  result.splice(endIndex, 0, removed);
  
  // Update positions
  return result.map((product, index) => ({
    ...product,
    position: index
  }));
};

const CollectionSort = () => {
  const { collection, products, shopDomain, savedData, pagination } = useLoaderData() as LoaderData & { pagination: any };
  const { collectionId } = useParams();
  const navigate = useNavigate();
  const submit = useSubmit();
  
  // Refs for file inputs
  const productsFileInputRef = useRef<HTMLInputElement>(null);
  const tagsFileInputRef = useRef<HTMLInputElement>(null);
  const featuredProductsFileInputRef = useRef<HTMLInputElement>(null);
  
  // State
  const [selectedTab, setSelectedTab] = useState(0);
  const [searchQuery, setSearchQuery] = useState(pagination.searchQuery || "");
  const [showDropdown, setShowDropdown] = useState(false);
  const [featuredProducts, setFeaturedProducts] = useState<Product[]>(savedData.featuredProducts);
  const [isSaving, setIsSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [resortModalActive, setResortModalActive] = useState(false);
  const [showDateDetails, setShowDateDetails] = useState<{ [key: string]: boolean }>({});
  const [draggedProduct, setDraggedProduct] = useState<string | null>(null);
  const [importLoading, setImportLoading] = useState(false);
  const [resortMessage, setResortMessage] = useState<string>("");
  const [actionMessage, setActionMessage] = useState<string>("");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  
  // NEW: Featured products search state
  const [featuredSearchQuery, setFeaturedSearchQuery] = useState("");
  
  // Pagination state
  const [currentPage, setCurrentPage] = useState(pagination.productsPage || 1);
  const [productsPerPage, setProductsPerPage] = useState(pagination.productsCount || 250);
  const [hasNextPage, setHasNextPage] = useState(pagination.hasNextPage || false);
  const [hasPreviousPage, setHasPreviousPage] = useState(pagination.hasPreviousPage || false);
  
  // NEW STATE: For manual position selection after import
  const [showPositionModal, setShowPositionModal] = useState(false);
  const [importedProducts, setImportedProducts] = useState<Product[]>([]);
  const [productPositions, setProductPositions] = useState<{[key: string]: number}>({});
  
  // Featured Products Settings
  const [sortOrder, setSortOrder] = useState(savedData.featuredSettings?.sortOrder || "manual");
  const [limitFeatured, setLimitFeatured] = useState(
    savedData.featuredSettings?.limitFeatured ? savedData.featuredSettings.limitFeatured.toString() : "0"
  );
  
  // NEW: Manual sort order state
  const [manualSortOrder, setManualSortOrder] = useState(
    savedData.featuredSettings?.manualSortOrder || 
    collection.sortOrder === "MANUAL"
  );
  
  // Collection Settings State
  const [loadFromCollection, setLoadFromCollection] = useState("");
  const [useCustomSorting, setUseCustomSorting] = useState(savedData.collectionSettings?.useCustomSorting || true);
  const [primarySortOrder, setPrimarySortOrder] = useState(savedData.collectionSettings?.primarySortOrder || "random-high-low");
  const [lookbackPeriod, setLookbackPeriod] = useState(savedData.collectionSettings?.lookbackPeriod?.toString() || "180");
  const [ordersRange, setOrdersRange] = useState(savedData.collectionSettings?.ordersRange || "all-orders");
  const [productGrouping, setProductGrouping] = useState(savedData.collectionSettings?.includeDiscounts || true);
  
  // Product Behavior Rules
  const [pushNewProducts, setPushNewProducts] = useState(savedData.productBehaviorRules?.pushNewProductsUp || true);
  const [pushNewProductsDays, setPushNewProductsDays] = useState(savedData.productBehaviorRules?.newProductDays?.toString() || "7");
  const [pushDownOutOfStock, setPushDownOutOfStock] = useState(savedData.productBehaviorRules?.pushDownOutOfStock || true);
  const [outOfStockNew, setOutOfStockNew] = useState(savedData.productBehaviorRules?.outOfStockVsNewPriority || "push-down");
  const [outOfStockFeatured, setOutOfStockFeatured] = useState(savedData.productBehaviorRules?.outOfStockVsFeaturedPriority || "push-down");
  const [outOfStockTags, setOutOfStockTags] = useState(savedData.productBehaviorRules?.outOfStockVsTagsPriority || "position-defined");  
  // Manage Tags State
  const [sortByTags, setSortByTags] = useState(savedData.tagRules.length > 0);
  const [tagName, setTagName] = useState("");
  const [tagPosition, setTagPosition] = useState("top");
  const [tagRules, setTagRules] = useState<TagRule[]>(savedData.tagRules);

  // Handle search with debounce
  useEffect(() => {
    const timer = setTimeout(() => {
      if (searchQuery !== pagination.searchQuery) {
        const params = new URLSearchParams(window.location.search);
        if (searchQuery) {
          params.set("search", searchQuery);
        } else {
          params.delete("search");
        }
        params.set("productsPage", "1");
        params.set("productsCount", productsPerPage.toString());
        
        navigate(`?${params.toString()}`, { replace: true });
      }
    }, 500);

    return () => clearTimeout(timer);
  }, [searchQuery, navigate]);

  // Handle page change
  const handlePageChange = (page: number) => {
    setCurrentPage(page);
    
    const params = new URLSearchParams(window.location.search);
    params.set("productsPage", page.toString());
    params.set("productsCount", productsPerPage.toString());
    if (searchQuery) {
      params.set("search", searchQuery);
    }
    
    navigate(`?${params.toString()}`, { replace: true });
  };

  // Handle products per page change
  const handleProductsPerPageChange = (value: string) => {
    const newCount = parseInt(value);
    setProductsPerPage(newCount);
    
    const params = new URLSearchParams(window.location.search);
    params.set("productsCount", value);
    params.set("productsPage", "1");
    if (searchQuery) {
      params.set("search", searchQuery);
    }
    
    navigate(`?${params.toString()}`, { replace: true });
  };

  // Generate products per page options
  const generateProductsPerPageOptions = () => {
    const options = [];
    
    const commonIncrements = [50, 100, 250, 500];
    
    commonIncrements.forEach(count => {
      options.push({
        label: `${count} products`,
        value: count.toString()
      });
    });
    
    if (!commonIncrements.includes(productsPerPage)) {
      options.push({
        label: `${productsPerPage} products`,
        value: productsPerPage.toString()
      });
    }
    
    return options.sort((a, b) => parseInt(a.value) - parseInt(b.value));
  };

  // Filter available products based on search and pagination
  const filteredProducts = products.filter((p: Product) => 
    p.title.toLowerCase().includes(searchQuery.toLowerCase()) &&
    !featuredProducts.find((fp: Product) => fp.id === p.id)
  );

  // NEW: Filter featured products based on search
  const filteredFeaturedProducts = featuredProducts.filter((p: Product) => 
    p.title.toLowerCase().includes(featuredSearchQuery.toLowerCase())
  );

  // Calculate paginated products
  const startIndex = (currentPage - 1) * productsPerPage;
  const endIndex = startIndex + productsPerPage;
  const paginatedProducts = filteredProducts.slice(startIndex, endIndex);

  // Options
  const collectionOptions = [
    { label: "Collection 1", value: "collection-1" },
    { label: "Collection 2", value: "collection-2" },
    { label: "Collection 3", value: "collection-3" },
  ];

  const sortOrderOptions = [
    { label: "Revenue Generated - High to Low", value: "random-high-low" },
    { label: "Revenue Generated - Low to High", value: "random-low-high" },
    { label: "Number of Sales - High to Low", value: "number-sales-high" },
    { label: "Number of Sales - Low to High", value: "number-sales-low" },
    { label: "Creation Date - New to Old", value: "creation-new-old" },
    { label: "Creation Date - Old to New", value: "creation-old-new" },
    { label: "Publish Date - New to Old", value: "publish-new-old" },
    { label: "Publish Date - Old to New", value: "publish-old-new" },
  ];

  const lookbackPeriodOptions = [
    { label: "180", value: "180" },
    { label: "90", value: "90" },
    { label: "60", value: "60" },
    { label: "30", value: "30" },
  ];

  const ordersRangeOptions = [
    { label: "All Orders", value: "all-orders" },
    { label: "Paid Orders Only", value: "paid-orders" },
  ];

  const outOfStockNewOptions = [
    { label: "Push down out-of-stock even if new", value: "push-down" },
    { label: "Push down later of stock even if new", value: "push-down-later" },
    { label: "Push up new even if out-of-stock", value: "push-new" },
  ];

  const outOfStockFeaturedOptions = [
    { label: "Push down out-of-stock even if featured", value: "push-down" },
    { label: "Push down later of stock even if featured", value: "push-down-later" },
    { label: "Push up featured even if out-of-stock", value: "push-featured" },
  ];

  const outOfStockTagsOptions = [
    { label: "Keep position defined by a tag", value: "position-defined" },
    { label: "Push down out-of-stock", value: "push-down" },
    { label: "Keep position defined by a tag", value: "position-defined-tag" },
  ];

  const positions = [
    { value: "top", label: "Top of collection / After featured products" },
    { value: "after-new", label: "After new products" },
    { value: "before-out-of-stock", label: "Before out of stock products" },
    { value: "bottom", label: "Bottom of collection / After out of stock products" },
  ];

  const positionOptions = positions.map((pos) => ({
    label: pos.label,
    value: pos.value,
  }));

  // NEW: Generate position options for dropdown
  const generatePositionOptions = (count: number) => {
    return Array.from({ length: count }, (_, i) => ({
      label: `Position ${i + 1}`,
      value: (i + 1).toString(),
    }));
  };

  const disabledSectionStyle = {
    opacity: 0.5,
    pointerEvents: "none" as const,
  };

  // Handle file selection
  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setSelectedFile(file);
    }
  };

  // Handle remove file
  const handleRemoveFile = () => {
    setSelectedFile(null);
    if (featuredProductsFileInputRef.current) {
      featuredProductsFileInputRef.current.value = '';
    }
  };

  // NEW: Handle sort order change
  const handleSortOrderChange = async (value: boolean) => {
    setManualSortOrder(value);
    setActionMessage(value ? 
      "Updating collection to Manual sort order..." : 
      "Updating collection to Automatic sort order...");
    
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

  // NEW: Process imported products and show position modal
  const processImportedProducts = (products: Product[]) => {
    setImportedProducts(products);
    
    // Initialize positions with current order
    const initialPositions: {[key: string]: number} = {};
    products.forEach((product, index) => {
      initialPositions[product.id] = index + 1;
    });
    setProductPositions(initialPositions);
    
    setShowPositionModal(true);
  };

  // NEW: Handle position change for individual product
  const handlePositionChange = (productId: string, newPosition: string) => {
    setProductPositions(prev => ({
      ...prev,
      [productId]: parseInt(newPosition)
    }));
  };

  // NEW: Apply positions and save imported products
  const handleApplyPositions = async () => {
    setImportLoading(true);
    
    try {
      // Sort imported products by selected positions
      const sortedProducts = [...importedProducts].sort((a, b) => {
        return productPositions[a.id] - productPositions[b.id];
      });

      // Update positions in sorted products
      const productsWithUpdatedPositions = sortedProducts.map((product, index) => ({
        ...product,
        position: index
      }));

      // Save to database
      const formData = new FormData();
      formData.append("intent", "save-featured-products");
      formData.append("featuredProducts", JSON.stringify(productsWithUpdatedPositions));
      formData.append("featuredSettings", JSON.stringify({
        sortOrder,
        limitFeatured: parseInt(limitFeatured) || 0,
        manualSortOrder
      }));

      submit(formData, { 
        method: "POST",
        replace: true 
      });

      setFeaturedProducts(productsWithUpdatedPositions);
      setShowPositionModal(false);
      setSaveSuccess(true);
      setActionMessage(`Successfully imported ${importedProducts.length} products with custom positions!`);
      
      // Auto re-sort collection
      setTimeout(() => {
        const resortFormData = new FormData();
        resortFormData.append("intent", "resort-collection");
        submit(resortFormData, { 
          method: "POST",
          replace: true 
        });
      }, 1000);

    } catch (error) {
      console.error("Failed to apply positions:", error);
      setActionMessage("Failed to apply positions");
    } finally {
      setImportLoading(false);
    }
  };

  // Handle import featured products
  const handleImportFeaturedProducts = async () => {
    if (!selectedFile) {
      setActionMessage("Please select a file first");
      return;
    }

    setImportLoading(true);
    setActionMessage("Importing featured products...");

    try {
      const content = await selectedFile.text();
      const lines = content.split('\n').filter(line => line.trim());
      
      if (lines.length < 2) {
        setActionMessage("CSV file is empty or invalid");
        return;
      }

      const headers = lines[0].split(',').map(h => h.replace(/"/g, '').trim().toLowerCase());
      
      const importedProducts: Product[] = [];
      
      for (let i = 1; i < lines.length; i++) {
        const values = lines[i].split(',').map(v => v.replace(/"/g, '').trim());
        const product: any = {};
        
        headers.forEach((header, index) => {
          const cleanHeader = header.toLowerCase().replace(/\s+/g, '');
          product[cleanHeader] = values[index];
        });
        
        if (!product.productid) continue;

        // Find the product in the available products
        const existingProduct = products.find((p: Product) => p.id === product.productid);
        if (existingProduct) {
          const importedProduct: Product = {
            id: product.productid,
            title: existingProduct.title,
            handle: existingProduct.handle,
            featuredImage: existingProduct.featuredImage,
            position: parseInt(product.position) || 0,
            featuredType: (product.featuretype || "manual") as "manual" | "scheduled",
            daysToFeature: product.daystofeature ? parseInt(product.daystofeature) : undefined,
            startDate: product.startdate || undefined,
            scheduleApplied: product.scheduleapplied?.toLowerCase() === "true"
          };
          
          importedProducts.push(importedProduct);
        }
      }

      if (importedProducts.length === 0) {
        setActionMessage("No valid products found in CSV file");
        return;
      }

      // Process imported products and show position modal
      processImportedProducts(importedProducts);
      
      // Clear file after import
      setSelectedFile(null);
      if (featuredProductsFileInputRef.current) {
        featuredProductsFileInputRef.current.value = '';
      }
      
    } catch (error) {
      console.error("Import failed:", error);
      setActionMessage("Failed to import featured products");
    } finally {
      setImportLoading(false);
    }
  };

  // Handle adding product to featured
  const handleAddProduct = (product: Product) => {
    setFeaturedProducts([...featuredProducts, {
      ...product,
      featuredType: "manual",
      scheduleApplied: false,
      position: featuredProducts.length
    }]);
    setSearchQuery("");
    setShowDropdown(false);
  };

  // Handle removing product from featured
  const handleRemoveProduct = (id: string) => {
    setFeaturedProducts(featuredProducts.filter(p => p.id !== id));
  };

  // Update product settings
  const updateProduct = (id: string, updates: Partial<Product>) => {
    setFeaturedProducts(featuredProducts.map(p => 
      p.id === id ? { ...p, ...updates } : p
    ));
  };

  // Toggle date details visibility
  const toggleDateDetails = (id: string) => {
    setShowDateDetails(prev => ({ ...prev, [id]: !prev[id] }));
  };

  // Apply schedule and hide date details
  const applySchedule = (id: string) => {
    updateProduct(id, { scheduleApplied: true });
    setShowDateDetails(prev => ({ ...prev, [id]: false }));
  };

  // Edit schedule
  const editSchedule = (id: string) => {
    updateProduct(id, { scheduleApplied: false });
    setShowDateDetails(prev => ({ ...prev, [id]: true }));
  };

  // Drag and drop handlers
  const handleDragStart = (e: React.DragEvent, productId: string) => {
    setDraggedProduct(productId);
    e.dataTransfer.effectAllowed = "move";
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
  };

  const handleDrop = (e: React.DragEvent, targetProductId: string) => {
    e.preventDefault();
    if (!draggedProduct) return;

    const draggedIndex = featuredProducts.findIndex(p => p.id === draggedProduct);
    const targetIndex = featuredProducts.findIndex(p => p.id === targetProductId);

    if (draggedIndex !== -1 && targetIndex !== -1 && draggedIndex !== targetIndex) {
      const reorderedProducts = reorder(featuredProducts, draggedIndex, targetIndex);
      setFeaturedProducts(reorderedProducts);
    }

    setDraggedProduct(null);
  };

  // File import handlers for other types
  const handleImportProductsClick = () => {
    productsFileInputRef.current?.click();
  };

  const handleImportTagsClick = () => {
    tagsFileInputRef.current?.click();
  };

  const handleImportFeaturedProductsClick = () => {
    featuredProductsFileInputRef.current?.click();
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>, type: 'products' | 'tags') => {
    const file = e.target.files?.[0];
    if (!file) return;

    setImportLoading(true);
    setActionMessage(`Importing ${type}...`);

    const formData = new FormData();
    formData.append("intent", 
      type === 'products' ? "import-products" : "import-tags"
    );
    formData.append(
      type === 'products' ? "productsFile" : "tagsFile", 
      file
    );

    try {
      submit(formData, { 
        method: "POST",
        replace: true 
      });
      
      // Show immediate feedback
      setSaveSuccess(true);
      setActionMessage(`${type === 'products' ? 'Products' : 'Tags'} imported successfully!`);
      
      // Reload the page to get updated data after a short delay
      setTimeout(() => {
        window.location.reload();
      }, 2000);
    } catch (error) {
      console.error("Import failed:", error);
      setActionMessage(`Failed to import ${type}`);
    } finally {
      setImportLoading(false);
      // Reset file input
      if (e.target) e.target.value = '';
    }
  };

  // Export CSV functions
  const exportFeaturedProductsCSV = () => {
    const headers = ['Product ID', 'Title', 'Handle', 'Position', 'Featured Type', 'Days to Feature', 'Start Date', 'Schedule Applied'];
    const csvData = featuredProducts.map(p => [
      p.id,
      p.title,
      p.handle,
      p.position?.toString() || '0',
      p.featuredType,
      p.daysToFeature?.toString() || '',
      p.startDate || '',
      p.scheduleApplied ? 'true' : 'false'
    ]);
    
    const csvContent = [headers, ...csvData]
      .map(row => row.map(field => `"${field}"`).join(','))
      .join('\n');
    
    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `collection-${collectionId}-featured-products.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const exportProductsCSV = () => {
    const headers = ['Product ID', 'Title', 'Handle', 'Position'];
    const csvData = featuredProducts.map(p => [
      p.id,
      p.title,
      p.handle,
      p.position?.toString() || '0'
    ]);
    
    const csvContent = [headers, ...csvData]
      .map(row => row.map(field => `"${field}"`).join(','))
      .join('\n');
    
    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `collection-${collectionId}-products.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const exportTagsCSV = () => {
    const headers = ['Tag Name', 'Position'];
    const csvData = tagRules.map(rule => [rule.name, rule.position]);
    
    const csvContent = [headers, ...csvData]
      .map(row => row.map(field => `"${field}"`).join(','))
      .join('\n');
    
    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `collection-${collectionId}-tags.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Save featured products
  const handleSaveFeaturedProducts = async () => {
    setIsSaving(true);
    setActionMessage("Saving featured products...");
    
    const featuredSettings = {
      sortOrder,
      limitFeatured: parseInt(limitFeatured) || 0,
      manualSortOrder // Add this new field
    };
    
    const formData = new FormData();
    formData.append("intent", "save-featured-products");
    formData.append("featuredProducts", JSON.stringify(featuredProducts));
    formData.append("featuredSettings", JSON.stringify(featuredSettings));
    
    try {
      submit(formData, { 
        method: "POST",
        replace: true 
      });
      
      setSaveSuccess(true);
      setActionMessage("Featured products saved successfully!");
      setTimeout(() => {
        setSaveSuccess(false);
        setActionMessage("");
      }, 3000);
    } catch (error) {
      console.error("Save failed:", error);
      setActionMessage("Failed to save featured products");
    } finally {
      setIsSaving(false);
    }
  };

  // Save collection settings
  const handleSaveCollectionSettings = async () => {
    setIsSaving(true);
    setActionMessage("Saving collection settings...");
    
    const settings = {
      useCustomSorting,
      primarySortOrder,
      lookbackPeriod: parseInt(lookbackPeriod),
      ordersRange,
      includeDiscounts: productGrouping
    };
    
    const behaviorRules = {
      pushNewProductsUp: pushNewProducts,
      newProductDays: parseInt(pushNewProductsDays) || 7,
      pushDownOutOfStock: pushDownOutOfStock,
      outOfStockVsNewPriority: outOfStockNew,
      outOfStockVsFeaturedPriority: outOfStockFeatured,
      outOfStockVsTagsPriority: outOfStockTags
    };
    
    const formData = new FormData();
    formData.append("intent", "save-collection-settings");
    formData.append("settings", JSON.stringify(settings));
    formData.append("behaviorRules", JSON.stringify(behaviorRules));
    
    try {
      submit(formData, { 
        method: "POST",
        replace: true 
      });
      
      setSaveSuccess(true);
      setActionMessage("Collection settings saved successfully!");
      setTimeout(() => {
        setSaveSuccess(false);
        setActionMessage("");
      }, 3000);
    } catch (error) {
      console.error("Save failed:", error);
      setActionMessage("Failed to save collection settings");
    } finally {
      setIsSaving(false);
    }
  };

  // Save tag rules
  const handleSaveTagRules = async () => {
    setIsSaving(true);
    setActionMessage("Saving tag rules...");
    
    const formData = new FormData();
    formData.append("intent", "save-tag-rules");
    formData.append("tagRules", JSON.stringify(tagRules));
    
    try {
      submit(formData, { 
        method: "POST",
        replace: true 
      });
      
      setSaveSuccess(true);
      setActionMessage("Tag rules saved successfully!");
      setTimeout(() => {
        setSaveSuccess(false);
        setActionMessage("");
      }, 3000);
    } catch (error) {
      console.error("Save failed:", error);
      setActionMessage("Failed to save tag rules");
    } finally {
      setIsSaving(false);
    }
  };

  // Handle resort collection
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
      
      // Show immediate feedback
      setResortMessage("Collection reordering started... This may take a few moments.");
      setTimeout(() => {
        setResortModalActive(false);
        setSaveSuccess(true);
        setActionMessage("Collection successfully reordered! Changes should now be visible in Shopify.");
      }, 2000);
      
      // Clear messages after delay
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

  // Add tag rule
  const handleAddTag = () => {
    if (tagName.trim()) {
      setTagRules([
        ...tagRules,
        {
          id: Date.now().toString(),
          name: tagName,
          position: tagPosition,
        },
      ]);
      setTagName("");
    }
  };

  // Handle clear position
  const handleClearPosition = (position: string) => {
    setTagRules(tagRules.filter((rule) => rule.position !== position));
  };

  const tabs = [
    {
      id: 'featured-products',
      content: 'Featured Products',
      accessibilityLabel: 'Featured Products',
      panelID: 'featured-products-panel',
    },
    {
      id: 'collection-settings',
      content: 'Collection Settings',
      accessibilityLabel: 'Collection Settings',
      panelID: 'collection-settings-panel',
    },
    {
      id: 'manage-tags',
      content: 'Manage Tags',
      accessibilityLabel: 'Manage Tags',
      panelID: 'manage-tags-panel',
    },
  ];

  const toastMarkup = saveSuccess ? (
    <Toast content={actionMessage || resortMessage || "Settings saved successfully!"} onDismiss={() => setSaveSuccess(false)} />
  ) : null;

  return (
    <Page
      title={`Sort Collection: ${collection.title}`}
      primaryAction={{
        content: "re-Sort Collection",
        onAction: () => setResortModalActive(true),
        loading: isSaving,
      }}
      secondaryActions={[
        {
          content: "Back to collections",
          onAction: () => navigate("/app/collections_list"),
        },
      ]}
      backAction={{ 
        content: "Collections", 
        onAction: () => navigate("/app/collections_list"),
      }}
    >
      <Layout>
        {/* Info Banner */}
        <Layout.Section>
          <Banner>
            <Text as="p">
              Customize sorting rules for this collection specifically. Select products to be featured in this collection and specify order for these products.
              These products will always stay at the top of this collection irrespective of the other rules configured globally.
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
                {/* Featured Products Tab */}
                {selectedTab === 0 && (
                  <BlockStack gap="400">
                    <InlineStack align="space-between">
                      <Text as="h2" variant="headingMd">
                        Featured Products
                      </Text>
                      <Button 
                        onClick={handleSaveFeaturedProducts}
                        variant="primary"
                        loading={isSaving}
                      >
                        Save Featured Products
                      </Button>
                    </InlineStack>

                    {/* NEW: Sort Order Section */}
                    <Card>
                      <BlockStack gap="300">
                        <Text as="h3" variant="headingSm">
                          Sort Order
                        </Text>
                        <Text as="p" tone="subdued">
                          Set this collection to Manual sort order to organize products manually. This is required for the app to properly organize products in your collection.
                        </Text>
                        <InlineStack align="space-between">
                          <Checkbox
                            label="Manual"
                            checked={manualSortOrder}
                            onChange={handleSortOrderChange}
                          />
                          <Button
                            variant="plain"
                            onClick={() => window.open(`https://${shopDomain}/admin/collections/${collectionId}`, '_blank')}
                          >
                            View in Shopify Admin
                          </Button>
                        </InlineStack>
                        {manualSortOrder && (
                          <Banner status="info">
                            <Text as="p">
                              This collection is set to Manual sort order. You can now organize products using this app.
                            </Text>
                          </Banner>
                        )}
                        {!manualSortOrder && (
                          <Banner status="warning">
                            <Text as="p">
                              This collection is not set to Manual sort order. Check the "Manual" box above to enable manual organization of products.
                            </Text>
                          </Banner>
                        )}
                      </BlockStack>
                    </Card>

                    {/* Import/Export Section for Featured Products */}
                    <Card>
                      <BlockStack gap="200">
                        <Text as="h3" variant="headingSm">
                          Import/Export Featured Products
                        </Text>
                        <Text as="p" tone="subdued">
                          Export your current featured products to a CSV file, or import featured products from a CSV file. The CSV should include Product ID, Title, Handle, Position, Featured Type, Days to Feature, Start Date, and Schedule Applied.
                        </Text>
                        
                        {/* Export Section */}
                        <InlineStack gap="200">
                          <Button 
                            onClick={exportFeaturedProductsCSV}
                            icon={ArrowDownIcon}
                          >
                            Export Featured Products
                          </Button>
                          <Text as="span">or</Text>
                          <Button 
                            onClick={handleImportFeaturedProductsClick}
                            icon={ArrowUpIcon}
                          >
                            Select CSV File
                          </Button>
                          {/* Hidden file input for featured products */}
                          <input
                            type="file"
                            ref={featuredProductsFileInputRef}
                            style={{ display: 'none' }}
                            accept=".csv"
                            onChange={handleFileSelect}
                          />
                        </InlineStack>

                        {/* Selected File Display */}
                        {selectedFile && (
                          <Card>
                            <InlineStack align="space-between" blockAlign="center">
                              <InlineStack gap="200" blockAlign="center">
                                <Icon source={CheckIcon} tone="success" />
                                <Text as="span" variant="bodyMd" fontWeight="medium">
                                  Selected file: {selectedFile.name}
                                </Text>
                              </InlineStack>
                              <InlineStack gap="200">
                                <Button 
                                  onClick={handleImportFeaturedProducts}
                                  variant="primary"
                                  loading={importLoading}
                                >
                                  Import Now
                                </Button>
                                <Button 
                                  onClick={handleRemoveFile}
                                  variant="plain"
                                  tone="critical"
                                  icon={DeleteIcon}
                                >
                                  Remove
                                </Button>
                              </InlineStack>
                            </InlineStack>
                          </Card>
                        )}

                        <Button variant="plain">
                          How to create a correct .CSV file for import?
                        </Button>
                      </BlockStack>
                    </Card>

                    {/* Search and Pagination Controls */}
                    <Card>
                      <BlockStack gap="400">
                        {/* Search and Products Per Page */}
                        <InlineStack align="space-between" blockAlign="center">
                          <div style={{ width: '320px' }}>
                            <TextField
                              label="Search products"
                              labelHidden
                              placeholder="Search and select products"
                              value={searchQuery}
                              onChange={setSearchQuery}
                              onFocus={() => setShowDropdown(true)}
                              prefix={<Icon source={SearchIcon} />}
                              autoComplete="off"
                            />
                          </div>
                          
                          <InlineStack gap="200" blockAlign="center">
                            <Text as="span" variant="bodyMd" tone="subdued">
                              Show:
                            </Text>
                            <div style={{ width: '180px' }}>
                              <Select
                                label="Products per page"
                                labelHidden
                                options={generateProductsPerPageOptions()}
                                onChange={handleProductsPerPageChange}
                                value={productsPerPage.toString()}
                              />
                            </div>
                          </InlineStack>
                        </InlineStack>

                        {/* Pagination */}
                        {filteredProducts.length > productsPerPage && (
                          <InlineStack align="center">
                            <Pagination
                              hasPrevious={currentPage > 1}
                              onPrevious={() => handlePageChange(currentPage - 1)}
                              hasNext={endIndex < filteredProducts.length}
                              onNext={() => handlePageChange(currentPage + 1)}
                              label={`Page ${currentPage} of ${Math.ceil(filteredProducts.length / productsPerPage)}`}
                            />
                          </InlineStack>
                        )}

                        {/* Search Results Info */}
                        <InlineStack align="space-between">
                          <Text as="span" variant="bodySm" tone="subdued">
                            {searchQuery ? (
                              `Found ${filteredProducts.length} products matching "${searchQuery}"`
                            ) : (
                              `Showing ${Math.min(paginatedProducts.length, productsPerPage)} of ${filteredProducts.length} available products`
                            )}
                          </Text>
                          <Text as="span" variant="bodySm" tone="subdued">
                            Page {currentPage} • {productsPerPage} per page
                          </Text>
                        </InlineStack>
                      </BlockStack>
                    </Card>

                    {/* Search Dropdown */}
                    {showDropdown && (
                      <div style={{
                        position: 'relative',
                        zIndex: 1000,
                        maxHeight: '300px',
                        overflowY: 'auto',
                        border: '1px solid var(--p-color-border)',
                        borderRadius: 'var(--p-border-radius-200)',
                        backgroundColor: 'var(--p-color-bg)',
                        boxShadow: 'var(--p-shadow-200)'
                      }}>
                        {paginatedProducts.length > 0 ? (
                          <List>
                            {paginatedProducts.map((product: Product) => (
                              <List.Item key={product.id}>
                                <div
                                  onClick={() => handleAddProduct(product)}
                                  style={{ 
                                    width: '100%', 
                                    cursor: 'pointer', 
                                    padding: 'var(--p-space-300)',
                                    borderBottom: '1px solid var(--p-color-border-subdued)'
                                  }}
                                >
                                  <InlineStack gap="300" align="start">
                                    <Thumbnail
                                      source={product.featuredImage?.url || "https://cdn.shopify.com/s/files/1/0533/2089/files/placeholder-images-product_small.png"}
                                      alt={product.featuredImage?.altText || product.title}
                                      size="small"
                                    />
                                    <BlockStack gap="100">
                                      <Text as="span" variant="bodyMd">
                                        {product.title}
                                      </Text>
                                      <Text as="span" variant="bodySm" tone="subdued">
                                        {product.handle}
                                      </Text>
                                    </BlockStack>
                                  </InlineStack>
                                </div>
                              </List.Item>
                            ))}
                          </List>
                        ) : (
                          <Box padding="400">
                            <Text as="p" tone="subdued" alignment="center">
                              {searchQuery ? "No products found" : "Type to search products"}
                            </Text>
                          </Box>
                        )}
                      </div>
                    )}

                    <Text as="p" tone="subdued">
                      Move products up/down in the list by dragging them. Schedule products by choosing a start date and the number of days when the product will be featured.
                      At the end of this period a product will be removed from featured automatically.
                    </Text>

                    {/* NEW: Featured Products Search Bar */}
                    <Card>
                      <BlockStack gap="200">
                        <Text as="h3" variant="headingSm">
                          Search Featured Products
                        </Text>
                        <TextField
                          label="Search featured products"
                          labelHidden
                          placeholder="Search featured products by title"
                          value={featuredSearchQuery}
                          onChange={setFeaturedSearchQuery}
                          prefix={<Icon source={SearchIcon} />}
                          autoComplete="off"
                          clearButton
                          onClearButtonClick={() => setFeaturedSearchQuery("")}
                        />
                        {featuredSearchQuery && (
                          <Text as="span" variant="bodySm" tone="subdued">
                            Found {filteredFeaturedProducts.length} featured products matching "{featuredSearchQuery}"
                          </Text>
                        )}
                      </BlockStack>
                    </Card>

                    {/* Featured Products List with Drag & Drop */}
                    <BlockStack gap="400">
                      <Text as="h3" variant="headingSm">
                        Featured Products ({featuredProducts.length})
                      </Text>
                      
                      {featuredProducts.length === 0 ? (
                        <Box padding="400" background="bg-surface-secondary">
                          <Text as="p" tone="subdued" alignment="center">
                            No featured products yet. Search and add products above.
                          </Text>
                        </Box>
                      ) : (
                        <BlockStack gap="200">
                          {filteredFeaturedProducts.map((product, index) => {
                            // Find the actual index in the full array for position display
                            const actualIndex = featuredProducts.findIndex(p => p.id === product.id);
                            
                            return (
                              <div
                                key={product.id}
                                draggable
                                onDragStart={(e) => handleDragStart(e, product.id)}
                                onDragOver={handleDragOver}
                                onDrop={(e) => handleDrop(e, product.id)}
                                style={{
                                  cursor: 'grab',
                                  padding: '12px',
                                  border: '1px solid var(--p-color-border)',
                                  borderRadius: '8px',
                                  backgroundColor: draggedProduct === product.id ? 'var(--p-color-bg-surface-hover)' : 'var(--p-color-bg)',
                                  transition: 'background-color 0.2s ease',
                                }}
                              >
                                <Card padding="200">
                                  <InlineStack align="space-between" blockAlign="center">
                                    <InlineStack gap="400" blockAlign="center">
                                      <Icon source={DragHandleIcon} />
                                      <Thumbnail
                                        source={product.featuredImage?.url || "https://cdn.shopify.com/s/files/1/0533/2089/files/placeholder-images-product_small.png"}
                                        alt={product.featuredImage?.altText || product.title}
                                        size="small"
                                      />
                                      <BlockStack gap="100">
                                        <Text as="span" variant="bodyMd" fontWeight="medium">
                                          {product.title}
                                        </Text>
                                        <Text as="span" variant="bodySm" tone="subdued">
                                          {product.handle}
                                        </Text>
                                      </BlockStack>
                                    </InlineStack>
                                    
                                    <InlineStack gap="200" blockAlign="center">
                                      {/* Badge for scheduled products */}
                                      {product.featuredType === "scheduled" && (
                                        <Badge tone="info">
                                          Scheduled
                                        </Badge>
                                      )}
                                     
                                      {/* Position indicator */}
                                      <Badge>
                                        {`Position: ${actualIndex + 1}`}
                                      </Badge>
                                      
                                      {/* Radio Options */}
                                      <ChoiceList
                                        title="Feature type"
                                        titleHidden
                                        choices={[
                                          {
                                            label: "Manual",
                                            value: "manual",
                                          },
                                          {
                                            label: "Schedule",
                                            value: "scheduled",
                                          },
                                        ]}
                                        selected={[product.featuredType]}
                                        onChange={(value) => 
                                          updateProduct(product.id, { 
                                            featuredType: value[0] as "manual" | "scheduled",
                                            ...(value[0] === "manual" && { 
                                              daysToFeature: undefined, 
                                              startDate: undefined,
                                              scheduleApplied: false
                                            })
                                          })
                                        }
                                      />
                                      
                                      {/* Schedule Section */}
                                      {product.featuredType === "scheduled" && (
                                        <InlineStack gap="200">
                                          {!product.scheduleApplied ? (
                                            // Show date details form
                                            <Collapsible
                                              open={showDateDetails[product.id]}
                                              id={`date-details-${product.id}`}
                                            >
                                              <InlineStack gap="200">
                                                <TextField
                                                  label="Days"
                                                  type="number"
                                                  value={product.daysToFeature?.toString() || ""}
                                                  onChange={(value) => updateProduct(product.id, { 
                                                    daysToFeature: parseInt(value) || 0 
                                                  })}
                                                  autoComplete="off"
                                                  min={1}
                                                  placeholder="# of days"
                                                />
                                                <TextField
                                                  label="Start date"
                                                  type="date"
                                                  value={product.startDate || ""}
                                                  onChange={(value) => updateProduct(product.id, { 
                                                    startDate: value 
                                                  })}
                                                  autoComplete="off"
                                                />
                                                <Button 
                                                  size="slim"
                                                  variant="primary" 
                                                  onClick={() => applySchedule(product.id)}
                                                >
                                                  Apply
                                                </Button>
                                              </InlineStack>
                                            </Collapsible>
                                          ) : (
                                            // Show applied schedule with edit button
                                            <InlineStack gap="100" blockAlign="center">
                                              <Icon source={CalendarIcon} />
                                              <Text as="span" variant="bodyXs">
                                                {product.daysToFeature} days from {product.startDate}
                                              </Text>
                                              <Button
                                                size="slim"
                                                variant="plain"
                                                icon={EditIcon}
                                                onClick={() => editSchedule(product.id)}
                                              />
                                            </InlineStack>
                                          )}
                                          
                                          {/* Toggle button for date details */}
                                          {!product.scheduleApplied && (
                                            <Button
                                              size="slim"
                                              variant="plain"
                                              onClick={() => toggleDateDetails(product.id)}
                                            >
                                              {showDateDetails[product.id] ? "Hide" : "Show"} dates
                                            </Button>
                                          )}
                                        </InlineStack>
                                      )}
                                      
                                      {/* Remove Button */}
                                      <Button
                                        size="slim"
                                        icon={DeleteIcon}
                                        variant="plain"
                                        tone="critical"
                                        onClick={() => handleRemoveProduct(product.id)}
                                      >
                                        Remove
                                      </Button>
                                    </InlineStack>
                                  </InlineStack>
                                </Card>
                              </div>
                            );
                          })}
                        </BlockStack>
                      )}
                    </BlockStack>

                    {/* Featured Sort Order Settings */}
                    <BlockStack gap="600">
                      <Box paddingBlockStart="600">
                        <BlockStack gap="400">

                          <Box>
                            <Text as="h3" variant="headingSm">
                              Limit Featured
                            </Text>
                            <Text as="p" tone="subdued">
                              Max # of products to feature each time. If Random Order for Featured products is enabled, the app will choose this amount of products from the setlist above and pin them at the top of the collection. Each reSort (Automated or Manual) will alternate those products randomly. Set "0" to show all.
                            </Text>
                            <Box maxWidth="320px">
                              <TextField
                                label="Limit featured products"
                                labelHidden
                                type="number"
                                value={limitFeatured}
                                onChange={setLimitFeatured}
                                autoComplete="off"
                                min={0}
                              />
                            </Box>
                          </Box>
                        </BlockStack>
                      </Box>
                    </BlockStack>
                  </BlockStack>
                )}

                {/* Collection Settings Tab - Remains the same */}
                {selectedTab === 1 && (
                  <BlockStack gap="400">
                    <InlineStack align="space-between">
                      <Text as="h2" variant="headingMd">
                        Collection Settings
                      </Text>
                      <Button 
                        onClick={handleSaveCollectionSettings}
                        variant="primary"
                        loading={isSaving}
                      >
                        Save Settings
                      </Button>
                    </InlineStack>

                    <BlockStack gap="400">
                      {/* Use Custom Sorting */}
                      <Card>
                        <InlineStack align="space-between">
                          <BlockStack gap="200">
                            <Text as="h3" variant="headingSm">
                              Use Custom Sorting Rules
                            </Text>
                            <Text as="p" tone="subdued">
                              Enable to override global sorting rules and specify custom options for this collection.
                            </Text>
                          </BlockStack>
                          <Checkbox
                            label="Use custom sorting"
                            checked={useCustomSorting}
                            onChange={setUseCustomSorting}
                          />
                        </InlineStack>
                      </Card>

                      {/* Content that should be disabled when useCustomSorting is false */}
                      <div style={useCustomSorting ? {} : disabledSectionStyle}>
                        {/* Primary Sort Order */}
                        <Card>
                          <BlockStack gap="200">
                            <Text as="h3" variant="headingSm">
                              Primary Sort Order
                            </Text>
                            <Text as="p" tone="subdued">
                              Default sorting rule for ordering products in a collection. Applied to automated and manual sorting.
                            </Text>
                            <Select
                              label="Select sort order"
                              options={sortOrderOptions}
                              value={primarySortOrder}
                              onChange={setPrimarySortOrder}
                              disabled={!useCustomSorting}
                            />
                          </BlockStack>
                        </Card>

                        {/* Import/Export Products Order */}
                        <Card>
                          <BlockStack gap="200">
                            <Text as="h3" variant="headingSm">
                              Import/Export Products Order
                            </Text>
                            <Text as="p" tone="subdued">
                              You can import rearranged products. Click 'Export' to download your current collection products. Rearrange products in external software and import back.
                            </Text>
                            <InlineStack gap="200">
                              <Button 
                                onClick={exportProductsCSV}
                                disabled={!useCustomSorting}
                                icon={ArrowDownIcon}
                              >
                                Export Products
                              </Button>
                              <Text as="span">or</Text>
                              <Button 
                                onClick={handleImportProductsClick}
                                disabled={!useCustomSorting}
                                icon={ArrowUpIcon}
                                loading={importLoading}
                              >
                                Import Rearranged
                              </Button>
                              {/* Hidden file input for products */}
                              <input
                                type="file"
                                ref={productsFileInputRef}
                                style={{ display: 'none' }}
                                accept=".csv"
                                onChange={(e) => handleFileUpload(e, 'products')}
                              />
                            </InlineStack>
                            <Button variant="plain" disabled={!useCustomSorting}>
                              How to create a correct .CSV file for import?
                            </Button>
                          </BlockStack>
                        </Card>

                        {/* Lookback Period */}
                        <Card>
                          <BlockStack gap="200">
                            <Text as="h3" variant="headingSm">
                              Lookback Period
                            </Text>
                            <Text as="p" tone="subdued">
                              How many days to look back to analyze. Used for sorting by revenue, by the number of sales. 365 days maximum
                            </Text>
                            <InlineStack gap="200">
                              <Select
                                label="Lookback period"
                                options={lookbackPeriodOptions}
                                value={lookbackPeriod}
                                onChange={setLookbackPeriod}
                                disabled={!useCustomSorting}
                              />
                              <Text as="span">days</Text>
                            </InlineStack>
                          </BlockStack>
                        </Card>

                        {/* Orders Status */}
                        <Card>
                          <BlockStack gap="200">
                            <Text as="h3" variant="headingSm">
                              Orders Status
                            </Text>
                            <Text as="p" tone="subdued">
                              Orders to be used for revenue and sales calculations.
                            </Text>
                            <Select
                              label="Orders range"
                              options={ordersRangeOptions}
                              value={ordersRange}
                              onChange={setOrdersRange}
                              disabled={!useCustomSorting}
                            />
                          </BlockStack>
                        </Card>

                        {/* Product Grouping */}
                        <Card>
                          <InlineStack align="space-between">
                            <BlockStack gap="200">
                              <Text as="h3" variant="headingSm">
                                Product Grouping
                              </Text>
                              <Text as="p" tone="subdued">
                                Ignore or include discounts in revenue calculation. When disabled, discounts are ignored and revenue is calculated as {"{price x number of items}"}. When enabled, discounts are included in the calculation and revenue is equal to {"{(price - discount) x number of items}"}.
                              </Text>
                            </BlockStack>
                            <Checkbox
                              label="Enable product grouping"
                              checked={productGrouping}
                              onChange={setProductGrouping}
                              disabled={!useCustomSorting}
                            />
                          </InlineStack>
                        </Card>

                        {/* Push New Products Up */}
                        <Card>
                          <BlockStack gap="200">
                            <InlineStack align="space-between">
                              <BlockStack gap="200">
                                <Text as="h3" variant="headingSm">
                                  Push New Products Up
                                </Text>
                                <Text as="p" tone="subdued">
                                  Automatically push newly added products to the collection for the product to be completed area.
                                </Text>
                              </BlockStack>
                              <Checkbox
                                label="Enable push new products"
                                checked={pushNewProducts}
                                onChange={setPushNewProducts}
                                disabled={!useCustomSorting}
                              />
                            </InlineStack>
                            <Text as="p" tone="subdued">
                              Allow priority to latest from the global website?
                            </Text>
                            {/* Days field - only enabled when pushNewProducts is true */}
                            <InlineStack gap="200">
                              <TextField
                                label="Days"
                                type="number"
                                value={pushNewProductsDays}
                                onChange={setPushNewProductsDays}
                                disabled={!useCustomSorting || !pushNewProducts}
                                placeholder="7"
                                autoComplete="off"
                              />
                              <Text as="span">days</Text>
                            </InlineStack>
                          </BlockStack>
                        </Card>

                        {/* Push Down Out of Stock */}
                        <Card>
                          <InlineStack align="space-between">
                            <BlockStack gap="200">
                              <Text as="h3" variant="headingSm">
                                Push Down Out of Stock
                              </Text>
                              <Text as="p" tone="subdued">
                                Automatically push out-of-stock goods to the bottom or hide out-of-stock, push products.
                              </Text>
                            </BlockStack>
                            <Checkbox
                              label="Enable push down out of stock"
                              checked={pushDownOutOfStock}
                              onChange={setPushDownOutOfStock}
                              disabled={!useCustomSorting}
                            />
                          </InlineStack>
                        </Card>

                        {/* Out-of-Stock in New - FIXED: Only show when both pushNewProducts AND pushDownOutOfStock are enabled */}
                        {pushNewProducts && pushDownOutOfStock && (
                          <Card>
                            <BlockStack gap="200">
                              <Text as="h3" variant="headingSm">
                                Out-of-Stock in New
                              </Text>
                              <Text as="p" tone="subdued">
                                Available when 'Push New Products Up' and 'Push Out-of-Stock' are both enabled.
                              </Text>
                              <Select
                                label="Out of stock in new"
                                options={outOfStockNewOptions}
                                value={outOfStockNew}
                                onChange={setOutOfStockNew}
                                disabled={!useCustomSorting}
                              />
                            </BlockStack>
                          </Card>
                        )}

                        {/* Out-of-Stock in Featured - FIXED: Only show when pushDownOutOfStock is enabled */}
                        {pushDownOutOfStock && (
                          <Card>
                            <BlockStack gap="200">
                              <Text as="h3" variant="headingSm">
                                Out-of-Stock vs Featured
                              </Text>
                              <Text as="p" tone="subdued">
                                Available for any primary sorting order except "Manual". Featured products are set per collection. Choose your preference.
                              </Text>
                              <Select
                                label="Out of stock in featured"
                                options={outOfStockFeaturedOptions}
                                value={outOfStockFeatured}
                                onChange={setOutOfStockFeatured}
                                disabled={!useCustomSorting}
                              />
                            </BlockStack>
                          </Card>
                        )}

                        {/* Out-of-Stock in Tags - FIXED: Only show when pushDownOutOfStock is enabled */}
                        {pushDownOutOfStock && (
                          <Card>
                            <BlockStack gap="200">
                              <Text as="h3" variant="headingSm">
                                Out-of-Stock vs Tags
                              </Text>
                              <Text as="p" tone="subdued">
                                Applies if you use tags to place products in specific positions. Choose your preference when a product with this tag is out-of-stock.
                              </Text>
                              <Select
                                label="Out of stock in tags"
                                options={outOfStockTagsOptions}
                                value={outOfStockTags}
                                onChange={setOutOfStockTags}
                                disabled={!useCustomSorting}
                              />
                            </BlockStack>
                          </Card>
                        )}
                      </div>
                    </BlockStack>
                  </BlockStack>
                )}

                {/* Manage Tags Tab - Remains the same */}
                {selectedTab === 2 && (
                  <BlockStack gap="400">
                    <InlineStack align="space-between">
                      <Text as="h2" variant="headingMd">
                        Manage Tags
                      </Text>
                      <Button 
                        onClick={handleSaveTagRules}
                        variant="primary"
                        loading={isSaving}
                      >
                        Save Tag Rules
                      </Button>
                    </InlineStack>

                    <BlockStack gap="400">
                      {/* Sort by Tags Toggle */}
                      <Card>
                        <InlineStack align="space-between">
                          <BlockStack gap="200">
                            <Text as="h3" variant="headingSm">
                              Sort by Tags
                            </Text>
                            <Text as="p" tone="subdued">
                              Available for any primary sorting order except "Manual". Define sorting rules for products with specific tags.
                            </Text>
                          </BlockStack>
                          <Checkbox
                            label="Sort by tags"
                            checked={sortByTags}
                            onChange={setSortByTags}
                          />
                        </InlineStack>
                      </Card>

                      {/* Specify Tags */}
                      <Card>
                        <BlockStack gap="300">
                          <Text as="h3" variant="headingSm">
                            Specify Tags
                          </Text>
                          <Text as="p" tone="subdued">
                            Type the tag name that you want to apply sorting rules to. This must be an existing tag. Then specify a position for products with this tag.
                          </Text>
                          
                          <Grid>
                            <Grid.Cell columnSpan={{ xs: 6, sm: 6, md: 6, lg: 6, xl: 6 }}>
                              <TextField
                                label="Tag name"
                                value={tagName}
                                onChange={setTagName}
                                placeholder="Tag name"
                                disabled={!sortByTags}
                                autoComplete="off"
                              />
                            </Grid.Cell>
                            <Grid.Cell columnSpan={{ xs: 6, sm: 6, md: 6, lg: 6, xl: 6 }}>
                              <Select
                                label="Position"
                                options={positionOptions}
                                value={tagPosition}
                                onChange={setTagPosition}
                                disabled={!sortByTags}
                              />
                            </Grid.Cell>
                            <Grid.Cell columnSpan={{ xs: 6, sm: 6, md: 6, lg: 6, xl: 6 }}>
                              <div style={{ paddingTop: '20px' }}>
                                <Button
                                  onClick={handleAddTag}
                                  disabled={!sortByTags || !tagName.trim()}
                                  fullWidth
                                >
                                  Add a Tag
                                </Button>
                              </div>
                            </Grid.Cell>
                          </Grid>
                        </BlockStack>
                      </Card>

                      {/* Tag Rules List */}
                      <Card>
                        <BlockStack gap="200">
                          {positions.map((pos) => {
                            const rulesAtPosition = tagRules.filter((rule) => rule.position === pos.value);
                            return (
                              <div key={pos.value}>
                                <InlineStack align="space-between">
                                  <TextContainer>
                                    <span style={{ fontWeight: '500' }}>{pos.label}</span>
                                    {rulesAtPosition.length > 0 && (
                                      <span style={{ color: "#6d7175", fontSize: "14px" }}>
                                        (if they are set)
                                      </span>
                                    )}
                                  </TextContainer>
                                  {rulesAtPosition.length > 0 && (
                                    <Button
                                      variant="plain"
                                      onClick={() => handleClearPosition(pos.value)}
                                      disabled={!sortByTags}
                                    >
                                      clear
                                    </Button>
                                  )}
                                </InlineStack>
                              </div>
                            );
                          })}
                        </BlockStack>
                      </Card>

                      {/* Import/Export Tags List */}
                      <Card>
                        <BlockStack gap="200">
                          <Text as="h3" variant="headingSm">
                            Import/Export Tags List
                          </Text>
                          <Text as="p" tone="subdued">
                            You can import tags instead of adding them manually above. Click "Export" to download your tags sample file. Edit this file to suit your needs and import back.
                          </Text>
                          <InlineStack gap="200">
                            <Button variant="secondary" onClick={exportTagsCSV} disabled={!sortByTags}>
                              Export Tags
                            </Button>
                            <span style={{ color: "#6d7175", fontSize: "14px" }}>or</span>
                            <Button 
                              variant="secondary" 
                              onClick={handleImportTagsClick}
                              disabled={!sortByTags}
                              loading={importLoading}
                            >
                              Import Tags
                            </Button>
                            {/* Hidden file input for tags */}
                            <input
                              type="file"
                              ref={tagsFileInputRef}
                              style={{ display: 'none' }}
                              accept=".csv"
                              onChange={(e) => handleFileUpload(e, 'tags')}
                            />
                          </InlineStack>
                          <Button variant="plain" disabled={!sortByTags}>
                            How to create a correct .CSV file?
                          </Button>
                        </BlockStack>
                      </Card>
                    </BlockStack>
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

      {/* NEW: Position Selection Modal */}
      <Modal
        open={showPositionModal}
        onClose={() => setShowPositionModal(false)}
        title="Set Product Positions"
        primaryAction={{
          content: "Apply Positions",
          onAction: handleApplyPositions,
          loading: importLoading,
        }}
        secondaryActions={[{
          content: "Cancel",
          onAction: () => setShowPositionModal(false),
        }]}
        size="large"
      >
        <Modal.Section>
          <BlockStack gap="400">
            <Text as="p">
              Set the positions for your imported products. Products will be displayed in the order you specify below.
            </Text>
            
            <BlockStack gap="300">
              {importedProducts.map((product, index) => (
                <Card key={product.id} padding="300">
                  <InlineStack align="space-between" blockAlign="center">
                    <InlineStack gap="300" blockAlign="center">
                      <Thumbnail
                        source={product.featuredImage?.url || "https://cdn.shopify.com/s/files/1/0533/2089/files/placeholder-images-product_small.png"}
                        alt={product.featuredImage?.altText || product.title}
                        size="small"
                      />
                      <BlockStack gap="100">
                        <Text as="span" variant="bodyMd" fontWeight="medium">
                          {product.title}
                        </Text>
                        <Text as="span" variant="bodySm" tone="subdued">
                          {product.handle}
                        </Text>
                      </BlockStack>
                    </InlineStack>
                    
                    <Select
                      label="Position"
                      labelHidden
                      options={generatePositionOptions(importedProducts.length)}
                      value={productPositions[product.id]?.toString() || (index + 1).toString()}
                      onChange={(value) => handlePositionChange(product.id, value)}
                    />
                  </InlineStack>
                </Card>
              ))}
            </BlockStack>
            
            <Banner tone="info">
              <Text as="p">
                Products will be sorted by the positions you set above. Lower numbers appear first.
              </Text>
            </Banner>
          </BlockStack>
        </Modal.Section>
      </Modal>

      {toastMarkup}
    </Page>
  );
};

export default CollectionSort;