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
  EditIcon,
  ArrowDownIcon,
  ArrowUpIcon,
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
  tags?: string[];
  totalInventory?: number;
  createdAt?: string;
  publishedAt?: string;
  variants?: {
    edges: Array<{
      node: {
        price: string;
        compareAtPrice?: string;
      };
    }>;
  };
}

interface CollectionDetails {
  id: string;
  title: string;
  handle: string;
  productsCount: {
    count: number;
  };
  sortOrder?: string;
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
            tags
            totalInventory
            createdAt
            publishedAt
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
    
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    try {
      const jobResponse = await admin.graphql(GET_JOB_STATUS, { 
        variables: { id: jobId } 
      });
      
      const jobData = await jobResponse.json() as any;
      
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
    const gid = constructGid(collectionId);
    
    const url = new URL(request.url);
    const productsPage = parseInt(url.searchParams.get("productsPage") || "1");
    const productsCount = parseInt(url.searchParams.get("productsCount") || "250");
    const searchQuery = url.searchParams.get("search") || "";
    const after = url.searchParams.get("after") || null;

    console.log("🔄 LOADER STARTED - Fetching collection data...");
    console.log("🔍 Collection ID:", collectionId);
    console.log("🔍 GID:", gid);
    console.log("🏪 Shop:", session.shop);

    // Get collection details
    const collectionResponse = await admin.graphql(GET_COLLECTION, {
      variables: { id: gid }
    });
    
    const collectionData = await collectionResponse.json() as any;
    
    if (!collectionData.data?.collection) {
      throw new Response("Collection not found", { status: 404 });
    }

    console.log("✅ Collection found:", collectionData.data.collection.title);

    // Get collection products
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

    console.log(`📦 Found ${products.length} products in collection`);

    // Get saved data from database
    console.log("🗃️ Fetching featured products from database...");
    const featuredProductsFromDb = await prisma.featuredProduct.findMany({
      where: {
        shopifyDomain: session.shop,
        collectionId: gid
      },
      orderBy: { position: 'asc' }
    });

    console.log(`⭐ Found ${featuredProductsFromDb.length} featured products in DB`);

    const collectionSettingsFromDb = await prisma.collectionSetting.findUnique({
      where: {
        shopifyDomain_collectionId: {
          shopifyDomain: session.shop,
          collectionId: gid
        }
      }
    });

    const featuredSettingsFromDb = await prisma.featuredSettings.findUnique({
      where: {
        shopifyDomain_collectionId: {
          shopifyDomain: session.shop,
          collectionId: gid
        }
      }
    });

    const productBehaviorRulesFromDb = await prisma.productBehaviorRule.findUnique({
      where: {
        shopifyDomain_collectionId: {
          shopifyDomain: session.shop,
          collectionId: gid
        }
      }
    });

    // Get tag rules
    console.log("🏷️ Fetching tag rules from database...");
    const tagRulesFromDb = await prisma.tagSortingRule.findMany({
      where: {
        shopifyDomain: session.shop,
        collectionId: gid
      }
    });

    console.log(`🏷️ Found ${tagRulesFromDb.length} tag rules in DB for this collection`);

    // Transform featured products
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
        productsCount,
        searchQuery,
        hasNextPage: productsData.data?.collection?.products?.pageInfo?.hasNextPage || false,
        hasPreviousPage: productsData.data?.collection?.products?.pageInfo?.hasPreviousPage || false,
        endCursor: productsData.data?.collection?.products?.pageInfo?.endCursor,
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
        const defaultSortOrder = formData.get("defaultSortOrder") as string || "BEST_SELLING";
        
        try {
          const response = await admin.graphql(UPDATE_COLLECTION_SORT_ORDER, {
            variables: {
              input: {
                id: gid,
                sortOrder: manualSortOrder ? "MANUAL" : defaultSortOrder
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
              `Collection sort order updated to ${defaultSortOrder.replace('_', ' ').toLowerCase()}.` 
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
        const updateShopifySortOrder = formData.get("updateShopifySortOrder") === "true";
        
        await prisma.featuredProduct.deleteMany({
          where: {
            shopifyDomain: session.shop,
            collectionId: gid
          }
        });

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

        if (updateShopifySortOrder) {
          const shouldBeManual = featuredProducts.length > 0;
          const response = await admin.graphql(UPDATE_COLLECTION_SORT_ORDER, {
            variables: {
              input: {
                id: gid,
                sortOrder: shouldBeManual ? "MANUAL" : "BEST_SELLING"
              }
            }
          });
          
          const data = await response.json() as any;
          if (data.errors || data.data?.collectionUpdate?.userErrors?.length > 0) {
            console.error("Failed to update Shopify sort order:", data.errors || data.data?.collectionUpdate?.userErrors);
          }
        }

        return { success: true, message: "Featured products saved successfully!" };
      }

      case "clear-all-featured-products": {
        // Delete all featured products
        await prisma.featuredProduct.deleteMany({
          where: {
            shopifyDomain: session.shop,
            collectionId: gid
          }
        });

        // Check if we have tag rules
        const tagRules = await prisma.tagSortingRule.findMany({
          where: {
            shopifyDomain: session.shop,
            collectionId: gid
          }
        });

        // Only update Shopify sort order if we have tag rules to apply
        if (tagRules.length > 0) {
          try {
            // Apply tag-based sorting
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
            const collection = collectionDetails.data?.collection;

            if (collection) {
              // Get all products from collection
              const productsResponse = await admin.graphql(`
                query GetCollectionProductsWithDetails($id: ID!, $first: Int!) {
                  collection(id: $id) {
                    products(first: $first) {
                      edges {
                        node {
                          id
                          title
                          tags
                          totalInventory
                        }
                      }
                    }
                  }
                }
              `, { variables: { id: gid, first: 250 } });
              
              const productsData = await productsResponse.json() as any;
              const allProducts = productsData.data?.collection?.products?.edges?.map((edge: any) => edge.node) || [];

              if (allProducts.length > 0) {
                // Apply tag-based sorting logic
                const topTagProducts: any[] = [];
                const afterNewTagProducts: any[] = [];
                const beforeOutOfStockTagProducts: any[] = [];
                const bottomTagProducts: any[] = [];
                const untaggedProducts: any[] = [];

                // Categorize products by tag rules
                allProducts.forEach((product: any) => {
                  let matchedPosition: string | null = null;
                  
                  for (const tagRule of tagRules) {
                    if (product.tags && product.tags.includes(tagRule.tagName)) {
                      matchedPosition = tagRule.position;
                      break;
                    }
                  }

                  switch (matchedPosition) {
                    case 'top':
                      topTagProducts.push(product);
                      break;
                    case 'after-new':
                      afterNewTagProducts.push(product);
                      break;
                    case 'before-out-of-stock':
                      beforeOutOfStockTagProducts.push(product);
                      break;
                    case 'bottom':
                      bottomTagProducts.push(product);
                      break;
                    default:
                      untaggedProducts.push(product);
                  }
                });

                // Create final order
                const productIds: string[] = [
                  ...topTagProducts,
                  ...afterNewTagProducts,
                  ...untaggedProducts,
                  ...beforeOutOfStockTagProducts,
                  ...bottomTagProducts
                ].map(p => p.id);

                // Apply new order to Shopify
                const moves = productIds.map((productId, index) => ({
                  id: productId,
                  newPosition: index.toString()
                }));

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
                `, { variables: { id: gid, moves: moves } });

                const reorderData = await reorderResponse.json() as any;

                if (reorderData.data?.collectionReorderProducts?.job?.id) {
                  await pollJobStatus(admin, reorderData.data.collectionReorderProducts.job.id);
                }

                return { 
                  success: true, 
                  message: `All featured products removed and collection reordered based on ${tagRules.length} tag rule(s).` 
                };
              }
            }
          } catch (error) {
            console.error("Error applying tag sorting after clearing featured products:", error);
            // Continue with manual sort order update even if tag sorting fails
          }
        }

        // If no tag rules or tag sorting failed, set to default sort order
        const response = await admin.graphql(UPDATE_COLLECTION_SORT_ORDER, {
          variables: {
            input: {
              id: gid,
              sortOrder: "BEST_SELLING"
            }
          }
        });

        return { 
          success: true, 
          message: tagRules.length > 0 
            ? "All featured products removed. Collection will use tag-based sorting."
            : "All featured products removed. Collection reverted to default sorting." 
        };
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
        
        console.log("💾 SAVING TAG RULES TO DATABASE");
        console.log("🔍 Tag rules to save:", tagRules);

        // Delete ALL existing tag rules for this collection
        await prisma.tagSortingRule.deleteMany({
          where: {
            shopifyDomain: session.shop,
            collectionId: gid
          }
        });

        console.log(`🗑️ Deleted all existing tag rules for collection ${gid}`);

        // Create new tag rules from the submitted data
        if (tagRules && tagRules.length > 0) {
          for (const rule of tagRules) {
            console.log(`➕ Creating tag rule: ${rule.name} -> ${rule.position}`);
            await prisma.tagSortingRule.create({
              data: {
                shopifyDomain: session.shop,
                collectionId: gid,
                tagName: rule.name.trim(),
                position: rule.position
              }
            });
          }
          console.log(`✅ Created ${tagRules.length} tag rules in database`);
        } else {
          console.log("ℹ️ No tag rules to save - collection will use default sorting");
        }

        // Verify the save by reading back from database
        const savedRules = await prisma.tagSortingRule.findMany({
          where: {
            shopifyDomain: session.shop,
            collectionId: gid
          }
        });

        console.log("🔍 VERIFICATION - Tag rules in database after save:", savedRules);

        return { 
          success: true, 
          message: tagRules.length > 0 
            ? `Tag rules saved successfully! ${tagRules.length} rule(s) active.` 
            : "All tag rules removed. Collection will use default sorting."
        };
      }

      case "resort-collection": {
        console.log("🚀 STARTING RESORT COLLECTION");
        
        try {
          // Check collection details
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
          
          if (!collectionDetails.data?.collection) {
            return { success: false, error: "Collection not found" };
          }

          const collection = collectionDetails.data.collection;

          // Check if collection is manual
          const featuredProducts = await prisma.featuredProduct.findMany({
            where: {
              shopifyDomain: session.shop,
              collectionId: gid
            },
            orderBy: { position: 'asc' }
          });

          if (featuredProducts.length > 0 && collection.sortOrder !== "MANUAL") {
            return { 
              success: false, 
              error: `This is an ${collection.sortOrder?.toLowerCase()} collection. Only manual collections can have featured products. Please change it to a manual collection in Shopify admin.` 
            };
          }

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

          // Get featured settings
          const featuredSettings = await prisma.featuredSettings.findUnique({
            where: {
              shopifyDomain_collectionId: {
                shopifyDomain: session.shop,
                collectionId: gid
              }
            }
          });

          // Get CURRENT tag rules from database
          const tagRules = await prisma.tagSortingRule.findMany({
            where: {
              shopifyDomain: session.shop,
              collectionId: gid
            }
          });

          console.log(`🏷️ RESORT: Processing ${tagRules.length} CURRENT tag rules from database`);
          console.log("🏷️ RESORT: Tag rules details:", tagRules);

          // Get all products from collection
          const productsResponse = await admin.graphql(`
            query GetCollectionProductsWithDetails($id: ID!, $first: Int!) {
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
                      tags
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
          `, { variables: { id: gid, first: 250 } });
          
          const productsData = await productsResponse.json() as any;
          const allProducts = productsData.data?.collection?.products?.edges?.map((edge: any) => edge.node) || [];
          
          if (allProducts.length === 0) {
            return { success: false, error: "No products found in this collection" };
          }

          console.log(`📦 RESORT: Processing ${allProducts.length} total products`);

          // Apply primary sort order
          let sortedProducts = [...allProducts];

          if (collectionSettings?.useCustomSorting && collectionSettings?.primarySortOrder) {
            console.log(`🔄 Applying primary sort order: ${collectionSettings.primarySortOrder}`);
            switch (collectionSettings.primarySortOrder) {
              case "creation-new-old":
                sortedProducts.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
                break;
              case "creation-old-new":
                sortedProducts.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
                break;
              case "publish-new-old":
                sortedProducts.sort((a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime());
                break;
              case "publish-old-new":
                sortedProducts.sort((a, b) => new Date(a.publishedAt).getTime() - new Date(b.publishedAt).getTime());
                break;
              case "price-high-low":
                sortedProducts.sort((a, b) => {
                  const priceA = parseFloat(a.variants?.edges[0]?.node?.price || "0");
                  const priceB = parseFloat(b.variants?.edges[0]?.node?.price || "0");
                  return priceB - priceA;
                });
                break;
              case "price-low-high":
                sortedProducts.sort((a, b) => {
                  const priceA = parseFloat(a.variants?.edges[0]?.node?.price || "0");
                  const priceB = parseFloat(b.variants?.edges[0]?.node?.price || "0");
                  return priceA - priceB;
                });
                break;
              case "inventory-high-low":
                sortedProducts.sort((a, b) => (b.totalInventory || 0) - (a.totalInventory || 0));
                break;
              case "inventory-low-high":
                sortedProducts.sort((a, b) => (a.totalInventory || 0) - (b.totalInventory || 0));
                break;
              case "random-high-low":
              case "random-low-high":
                sortedProducts = sortedProducts.sort(() => Math.random() - 0.5);
                break;
            }
          }

          // Apply out-of-stock logic
          let inStockProducts: any[] = [];
          let outOfStockProducts: any[] = [];

          sortedProducts.forEach((product: any) => {
            if (product.totalInventory > 0) {
              inStockProducts.push(product);
            } else {
              outOfStockProducts.push(product);
            }
          });

          console.log(`📊 RESORT: ${inStockProducts.length} in-stock, ${outOfStockProducts.length} out-of-stock`);

          // Apply new products logic
          let newProducts: any[] = [];
          let regularProducts: any[] = [];

          if (behaviorRules?.pushNewProductsUp) {
            const newProductDays = behaviorRules.newProductDays || 7;
            const cutoffDate = new Date();
            cutoffDate.setDate(cutoffDate.getDate() - newProductDays);
            
            inStockProducts.forEach((product: any) => {
              const productDate = new Date(product.createdAt);
              if (productDate > cutoffDate) {
                newProducts.push(product);
              } else {
                regularProducts.push(product);
              }
            });
          } else {
            regularProducts = inStockProducts;
          }

          console.log(`🆕 RESORT: ${newProducts.length} new products, ${regularProducts.length} regular products`);

          // FIXED: Apply CURRENT tag rules from database to ALL products
          const topTagProducts: any[] = [];
          const afterNewTagProducts: any[] = [];
          const beforeOutOfStockTagProducts: any[] = [];
          const bottomTagProducts: any[] = [];
          const untaggedProducts: any[] = [];

          console.log(`🔍 RESORT: Processing ${allProducts.length} total products for ${tagRules.length} tag rules`);

          // Create a function to check if product matches any CURRENT tag rule
          const getProductTagPosition = (product: any): string | null => {
            if (!product.tags || product.tags.length === 0) return null;
            
            for (const tagRule of tagRules) {
              if (product.tags.includes(tagRule.tagName)) {
                console.log(`✅ RESORT: Product "${product.title}" matches CURRENT tag rule: ${tagRule.tagName} -> ${tagRule.position}`);
                return tagRule.position;
              }
            }
            return null;
          };

          // Process ALL products for CURRENT tag rules
          allProducts.forEach((product: any) => {
            const tagPosition = getProductTagPosition(product);
            
            switch (tagPosition) {
              case 'top':
                topTagProducts.push(product);
                break;
              case 'after-new':
                afterNewTagProducts.push(product);
                break;
              case 'before-out-of-stock':
                beforeOutOfStockTagProducts.push(product);
                break;
              case 'bottom':
                bottomTagProducts.push(product);
                break;
              default:
                untaggedProducts.push(product);
            }
          });

          console.log(`📊 RESORT: Tag-based categorization:`);
          console.log(`   Top: ${topTagProducts.length} products`);
          console.log(`   After New: ${afterNewTagProducts.length} products`);
          console.log(`   Before Out-of-Stock: ${beforeOutOfStockTagProducts.length} products`);
          console.log(`   Bottom: ${bottomTagProducts.length} products`);
          console.log(`   No Tag Rules: ${untaggedProducts.length} products`);

          // Create final product order - FIXED LOGIC
          const productIds: string[] = [];
          const processedProducts = new Set();

          const addProductsToFinalList = (products: any[]) => {
            products.forEach((product: any) => {
              if (!processedProducts.has(product.id)) {
                productIds.push(product.id);
                processedProducts.add(product.id);
              }
            });
          };

          // Apply featured products limit
          const featuredLimit = featuredSettings?.limitFeatured || 0;
          const effectiveFeaturedProducts = featuredLimit > 0 ? 
            featuredProducts.slice(0, featuredLimit) : 
            featuredProducts;

          console.log(`⭐ RESORT: ${effectiveFeaturedProducts.length} featured products to display`);

          // Step 1: Add featured products that should stay at top
          effectiveFeaturedProducts.forEach((fp: any) => {
            const product = allProducts.find((p: any) => p.id === fp.productId);
            if (product) {
              const isOutOfStock = product.totalInventory <= 0;
              
              const shouldKeepFeaturedAtTop = 
                !behaviorRules?.pushDownOutOfStock ||
                !isOutOfStock ||
                (isOutOfStock && behaviorRules.outOfStockVsFeaturedPriority === "push-featured");
              
              if (shouldKeepFeaturedAtTop) {
                productIds.push(fp.productId);
                processedProducts.add(fp.productId);
                console.log(`⭐ RESORT: Featured product "${product.title}" added to top`);
              }
            }
          });

          // Step 2: Add top-tagged products (after featured)
          console.log(`⬆️ RESORT: Adding ${topTagProducts.length} top-tagged products`);
          addProductsToFinalList(topTagProducts);

          // Step 3: Add new products (if enabled)
          if (behaviorRules?.pushNewProductsUp) {
            console.log(`🆕 RESORT: Adding ${newProducts.length} new products`);
            addProductsToFinalList(newProducts);
          }

          // Step 4: Add after-new tagged products
          console.log(`🔤 RESORT: Adding ${afterNewTagProducts.length} after-new tagged products`);
          addProductsToFinalList(afterNewTagProducts);

          // Step 5: Add regular in-stock products (not new, not tagged)
          const regularInStockProducts = untaggedProducts.filter(product => 
            !processedProducts.has(product.id) && 
            product.totalInventory > 0 &&
            !newProducts.find(np => np.id === product.id)
          );
          console.log(`📦 RESORT: Adding ${regularInStockProducts.length} regular in-stock products`);
          addProductsToFinalList(regularInStockProducts);

          // Step 6: Add before-out-of-stock tagged products
          // FIXED: These should come BEFORE the out-of-stock section
          console.log(`🔽 RESORT: Adding ${beforeOutOfStockTagProducts.length} before-out-of-stock tagged products`);
          addProductsToFinalList(beforeOutOfStockTagProducts);

          // Step 7: Handle out-of-stock products
          if (behaviorRules?.pushDownOutOfStock) {
            console.log(`📭 RESORT: Processing ${outOfStockProducts.length} out-of-stock products with push down`);
            
            // Separate out-of-stock products by their tag positions
            const outOfStockTop: any[] = [];
            const outOfStockAfterNew: any[] = [];
            const outOfStockBeforeOutOfStock: any[] = [];
            const outOfStockBottom: any[] = [];
            const outOfStockUntagged: any[] = [];

            outOfStockProducts.forEach((product: any) => {
              if (processedProducts.has(product.id)) return;
              
              const tagPosition = getProductTagPosition(product);
              
              switch (tagPosition) {
                case 'top':
                  outOfStockTop.push(product);
                  break;
                case 'after-new':
                  outOfStockAfterNew.push(product);
                  break;
                case 'before-out-of-stock':
                  outOfStockBeforeOutOfStock.push(product);
                  break;
                case 'bottom':
                  outOfStockBottom.push(product);
                  break;
                default:
                  outOfStockUntagged.push(product);
              }
            });

            console.log(`📭 RESORT: Out-of-stock breakdown - Top: ${outOfStockTop.length}, After New: ${outOfStockAfterNew.length}, Before OOS: ${outOfStockBeforeOutOfStock.length}, Bottom: ${outOfStockBottom.length}, Untagged: ${outOfStockUntagged.length}`);

            // Apply out-of-stock priority rules
            if (behaviorRules.outOfStockVsTagsPriority === "position-defined") {
              // Keep position defined by tag even for out-of-stock
              console.log(`📭 RESORT: Keeping tag-defined positions for out-of-stock products`);
              addProductsToFinalList(outOfStockTop);
              addProductsToFinalList(outOfStockAfterNew);
              addProductsToFinalList(outOfStockBeforeOutOfStock);
              addProductsToFinalList(outOfStockBottom);
              addProductsToFinalList(outOfStockUntagged);
            } else {
              // Push down all out-of-stock regardless of tags
              console.log(`📭 RESORT: Pushing down ALL out-of-stock products regardless of tags`);
              addProductsToFinalList(outOfStockUntagged);
              addProductsToFinalList(outOfStockTop);
              addProductsToFinalList(outOfStockAfterNew);
              addProductsToFinalList(outOfStockBeforeOutOfStock);
              addProductsToFinalList(outOfStockBottom);
            }
          } else {
            // If push down is disabled, add out-of-stock in their natural positions
            console.log(`📭 RESORT: Adding ${outOfStockProducts.length} out-of-stock products without push down`);
            addProductsToFinalList(outOfStockProducts);
          }

          // Step 8: Add bottom-tagged products
          // FIXED: These should come AFTER the out-of-stock section
          console.log(`⬇️ RESORT: Adding ${bottomTagProducts.length} bottom-tagged products`);
          addProductsToFinalList(bottomTagProducts);

          // Step 9: Add any remaining products that weren't processed
          const remainingProducts = allProducts.filter((product: any) => !processedProducts.has(product.id));
          console.log(`🔍 RESORT: Adding ${remainingProducts.length} remaining unprocessed products`);
          addProductsToFinalList(remainingProducts);

          console.log(`📋 RESORT: Final product order has ${productIds.length} products`);

          // Apply new order to Shopify
          const moves = productIds.map((productId, index) => ({
            id: productId,
            newPosition: index.toString()
          }));

          console.log("🔄 RESORT: Sending reorder request to Shopify...");

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
          `, { variables: { id: gid, moves: moves } });

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

          // Wait for job completion
          const jobId = reorderData.data?.collectionReorderProducts?.job?.id;
          if (jobId) {
            console.log(`⏳ RESORT: Waiting for job ${jobId} to complete...`);
            const jobCompleted = await pollJobStatus(admin, jobId);
            
            if (jobCompleted) {
              console.log("✅ RESORT: Job completed successfully");
              await new Promise(resolve => setTimeout(resolve, 2000));
            } else {
              console.log("⚠️ RESORT: Job may not have completed fully");
            }
          }

          return { 
            success: true,
            message: tagRules.length > 0 
              ? `✅ Collection successfully reordered with ${tagRules.length} tag rule(s) applied!` 
              : "✅ Collection successfully reordered with featured products!",
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
  const [featuredProducts, setFeaturedProducts] = useState<Product[]>([]);
  const [isSaving, setIsSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [resortModalActive, setResortModalActive] = useState(false);
  const [showDateDetails, setShowDateDetails] = useState<{ [key: string]: boolean }>({});
  const [draggedProduct, setDraggedProduct] = useState<string | null>(null);
  const [importLoading, setImportLoading] = useState(false);
  const [resortMessage, setResortMessage] = useState<string>("");
  const [actionMessage, setActionMessage] = useState<string>("");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [featuredSearchQuery, setFeaturedSearchQuery] = useState("");
  const [currentPage, setCurrentPage] = useState(pagination.productsPage || 1);
  const [productsPerPage, setProductsPerPage] = useState(pagination.productsCount || 250);
  const [showPositionModal, setShowPositionModal] = useState(false);
  const [importedProducts, setImportedProducts] = useState<Product[]>([]);
  const [productPositions, setProductPositions] = useState<{[key: string]: number}>({});
  const [sortOrder, setSortOrder] = useState("manual");
  const [limitFeatured, setLimitFeatured] = useState("0");
  const [manualSortOrder, setManualSortOrder] = useState(false);
  const [loadFromCollection, setLoadFromCollection] = useState("");
  const [useCustomSorting, setUseCustomSorting] = useState(true);
  const [primarySortOrder, setPrimarySortOrder] = useState("random-high-low");
  const [lookbackPeriod, setLookbackPeriod] = useState("180");
  const [ordersRange, setOrdersRange] = useState("all-orders");
  const [productGrouping, setProductGrouping] = useState(true);
  const [pushNewProducts, setPushNewProducts] = useState(true);
  const [pushNewProductsDays, setPushNewProductsDays] = useState("7");
  const [pushDownOutOfStock, setPushDownOutOfStock] = useState(true);
  const [outOfStockNew, setOutOfStockNew] = useState("push-down");
  const [outOfStockFeatured, setOutOfStockFeatured] = useState("push-down");
  const [outOfStockTags, setOutOfStockTags] = useState("position-defined");
  const [sortByTags, setSortByTags] = useState(false);
  const [tagName, setTagName] = useState("");
  const [tagPosition, setTagPosition] = useState("top");
  const [tagRules, setTagRules] = useState<TagRule[]>([]);
  const [clearFeaturedModalActive, setClearFeaturedModalActive] = useState(false);

  // Sync all states with loader data
  useEffect(() => {
    console.log("🔄 DEBUG: Syncing component state with loader data...");
    console.log("🏷️ DEBUG: Saved tag rules from loader:", savedData.tagRules);
    
    setFeaturedProducts(savedData.featuredProducts || []);
    setTagRules(savedData.tagRules || []);
    setManualSortOrder(collection.sortOrder === "MANUAL");
    setSortOrder(savedData.featuredSettings?.sortOrder || "manual");
    setLimitFeatured(savedData.featuredSettings?.limitFeatured?.toString() || "0");
    setUseCustomSorting(savedData.collectionSettings?.useCustomSorting ?? true);
    setPrimarySortOrder(savedData.collectionSettings?.primarySortOrder || "random-high-low");
    setLookbackPeriod(savedData.collectionSettings?.lookbackPeriod?.toString() || "180");
    setOrdersRange(savedData.collectionSettings?.ordersRange || "all-orders");
    setProductGrouping(savedData.collectionSettings?.includeDiscounts ?? true);
    setPushNewProducts(savedData.productBehaviorRules?.pushNewProductsUp ?? true);
    setPushNewProductsDays(savedData.productBehaviorRules?.newProductDays?.toString() || "7");
    setPushDownOutOfStock(savedData.productBehaviorRules?.pushDownOutOfStock ?? true);
    setOutOfStockNew(savedData.productBehaviorRules?.outOfStockVsNewPriority || "push-down");
    setOutOfStockFeatured(savedData.productBehaviorRules?.outOfStockVsFeaturedPriority || "push-down");
    setOutOfStockTags(savedData.productBehaviorRules?.outOfStockVsTagsPriority || "position-defined");
    setSortByTags((savedData.tagRules?.length || 0) > 0);
    
  }, [savedData, collection]);

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

  // Filter products
  const filteredProducts = products.filter((p: Product) => 
    p.title.toLowerCase().includes(searchQuery.toLowerCase()) &&
    !featuredProducts.find((fp: Product) => fp.id === p.id)
  );

  const filteredFeaturedProducts = featuredProducts.filter((p: Product) => 
    p.title.toLowerCase().includes(featuredSearchQuery.toLowerCase())
  );

  const startIndex = (currentPage - 1) * productsPerPage;
  const endIndex = startIndex + productsPerPage;
  const paginatedProducts = filteredProducts.slice(startIndex, endIndex);

  // Options
  const sortOrderOptions = [
    { label: "Revenue Generated - High to Low", value: "random-high-low" },
    { label: "Revenue Generated - Low to High", value: "random-low-high" },
    { label: "Number of Sales - High to Low", value: "number-sales-high" },
    { label: "Number of Sales - Low to High", value: "number-sales-low" },
    { label: "Creation Date - New to Old", value: "creation-new-old" },
    { label: "Creation Date - Old to New", value: "creation-old-new" },
    { label: "Publish Date - New to Old", value: "publish-new-old" },
    { label: "Publish Date - Old to New", value: "publish-old-new" },
    { label: "Price - High to Low", value: "price-high-low" },
    { label: "Price - Low to High", value: "price-low-high" },
    { label: "Inventory - High to Low", value: "inventory-high-low" },
    { label: "Inventory - Low to High", value: "inventory-low-high" },
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

  // Handlers
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

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setSelectedFile(file);
    }
  };

  const handleRemoveFile = () => {
    setSelectedFile(null);
    if (featuredProductsFileInputRef.current) {
      featuredProductsFileInputRef.current.value = '';
    }
  };

  const handleSortOrderChange = async (value: boolean) => {
    setManualSortOrder(value);
    setActionMessage(value ? 
      "Updating collection to Manual sort order in Shopify..." : 
      "Updating collection to default sort order in Shopify...");
    
    const formData = new FormData();
    formData.append("intent", "update-collection-sort-order");
    formData.append("manualSortOrder", value.toString());
    formData.append("defaultSortOrder", "BEST_SELLING");
    
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

  const handleAddProduct = (product: Product) => {
    const newFeaturedProducts = [...featuredProducts, {
      ...product,
      featuredType: "manual",
      scheduleApplied: false,
      position: featuredProducts.length
    }];
    setFeaturedProducts(newFeaturedProducts);
    setSearchQuery("");
    setShowDropdown(false);
  };

  const handleRemoveProduct = (id: string) => {
    const newFeaturedProducts = featuredProducts.filter(p => p.id !== id);
    setFeaturedProducts(newFeaturedProducts);
    
    // Don't automatically disable manual sort order when removing featured products
    // Manual sort order should only be disabled when user manually disables it
  };

  const updateProduct = (id: string, updates: Partial<Product>) => {
    setFeaturedProducts(featuredProducts.map(p => 
      p.id === id ? { ...p, ...updates } : p
    ));
  };

  const toggleDateDetails = (id: string) => {
    setShowDateDetails(prev => ({ ...prev, [id]: !prev[id] }));
  };

  const applySchedule = (id: string) => {
    updateProduct(id, { scheduleApplied: true });
    setShowDateDetails(prev => ({ ...prev, [id]: false }));
  };

  const editSchedule = (id: string) => {
    updateProduct(id, { scheduleApplied: false });
    setShowDateDetails(prev => ({ ...prev, [id]: true }));
  };

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

  const handleImportProductsClick = () => {
    productsFileInputRef.current?.click();
  };

  const handleImportTagsClick = () => {
    tagsFileInputRef.current?.click();
  };

  const handleImportFeaturedProductsClick = () => {
    featuredProductsFileInputRef.current?.click();
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>, type: 'products' | 'tags' | 'featured-products') => {
    const file = e.target.files?.[0];
    if (!file) return;

    setImportLoading(true);
    setActionMessage(`Importing ${type}...`);

    const formData = new FormData();
    formData.append("intent", 
      type === 'products' ? "import-products" : 
      type === 'tags' ? "import-tags" : "import-featured-products"
    );
    formData.append(
      type === 'products' ? "productsFile" : 
      type === 'tags' ? "tagsFile" : "featuredProductsFile", 
      file
    );

    try {
      submit(formData, { 
        method: "POST",
        replace: true 
      });
      
      setSaveSuccess(true);
      setActionMessage(`${type === 'products' ? 'Products' : type === 'tags' ? 'Tags' : 'Featured products'} imported successfully!`);
      
      setTimeout(() => {
        window.location.reload();
      }, 2000);
    } catch (error) {
      console.error("Import failed:", error);
      setActionMessage(`Failed to import ${type}`);
    } finally {
      setImportLoading(false);
      if (e.target) e.target.value = '';
    }
  };

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

  const handleSaveFeaturedProducts = async () => {
    setIsSaving(true);
    setActionMessage("Saving featured products...");
    
    const featuredSettings = {
      sortOrder,
      limitFeatured: parseInt(limitFeatured) || 0,
      manualSortOrder
    };
    
    const formData = new FormData();
    formData.append("intent", "save-featured-products");
    formData.append("featuredProducts", JSON.stringify(featuredProducts));
    formData.append("featuredSettings", JSON.stringify(featuredSettings));
    formData.append("updateShopifySortOrder", "true");
    
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

  const handleClearAllFeaturedProducts = async () => {
    setIsSaving(true);
    setActionMessage("Clearing all featured products...");
    
    const formData = new FormData();
    formData.append("intent", "clear-all-featured-products");
    
    try {
      submit(formData, { 
        method: "POST",
        replace: true 
      });
      
      setSaveSuccess(true);
      setActionMessage("All featured products cleared successfully!");
      setClearFeaturedModalActive(false);
      setFeaturedProducts([]);
      
      setTimeout(() => {
        setSaveSuccess(false);
        setActionMessage("");
      }, 3000);
    } catch (error) {
      console.error("Clear failed:", error);
      setActionMessage("Failed to clear featured products");
    } finally {
      setIsSaving(false);
    }
  };

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

  const handleSaveTagRules = async () => {
    setIsSaving(true);
    setActionMessage("Saving tag rules...");
    
    console.log("💾 UI DEBUG: Saving tag rules to database:", tagRules);
    
    const formData = new FormData();
    formData.append("intent", "save-tag-rules");
    formData.append("tagRules", JSON.stringify(tagRules));
    
    try {
      const result = await submit(formData, { 
        method: "POST",
        replace: true 
      });
      
      setSaveSuccess(true);
      setActionMessage(tagRules.length > 0 
        ? `Tag rules saved successfully! ${tagRules.length} rule(s) active.` 
        : "All tag rules removed. Collection will use default sorting."
      );
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

  const handleAddTag = () => {
    if (tagName.trim()) {
      const newTagRule = {
        id: `temp-${Date.now()}`,
        name: tagName.trim(),
        position: tagPosition,
      };
      
      console.log("➕ UI DEBUG: Adding new tag rule:", newTagRule);
      
      setTagRules([
        ...tagRules,
        newTagRule
      ]);
      setTagName("");
      setTagPosition("top");
      setSortByTags(true);
    }
  };

  const handleRemoveTag = (id: string) => {
    console.log("🗑️ UI DEBUG: Removing tag rule with ID:", id);
    const newTagRules = tagRules.filter(rule => rule.id !== id);
    setTagRules(newTagRules);
    setSortByTags(newTagRules.length > 0);
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
                    ✅ This collection is set to Manual sort order in Shopify. You can now organize products manually using all sections below.
                  </Text>
                </Banner>
              )}
              {!manualSortOrder && (
                <Banner tone="warning">
                  <Text as="p">
                    ⚠️ This collection is not set to Manual sort order. Enable "Manual Sort Order" to use featured products and manual organization. Current Shopify sort order: <strong>{collection.sortOrder?.replace('_', ' ').toLowerCase()}</strong>
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
                      <InlineStack gap="200">
                        <Button 
                          onClick={() => setClearFeaturedModalActive(true)}
                          variant="secondary"
                          tone="critical"
                          disabled={featuredProducts.length === 0 || !manualSortOrder}
                        >
                          Clear All Featured
                        </Button>
                        <Button 
                          onClick={handleSaveFeaturedProducts}
                          variant="primary"
                          loading={isSaving}
                          disabled={!manualSortOrder}
                        >
                          Save Featured Products
                        </Button>
                      </InlineStack>
                    </InlineStack>

                    {!manualSortOrder && (
                      <Banner tone="critical">
                        <Text as="p">
                          ⚠️ You cannot manage featured products because this collection is not set to Manual sort order in Shopify. Please enable "Manual Sort Order" in the section above first.
                        </Text>
                      </Banner>
                    )}

                    {/* Import/Export Section */}
                    <Card>
                      <BlockStack gap="200">
                        <Text as="h3" variant="headingSm">
                          Import/Export Featured Products
                        </Text>
                        <Text as="p" tone="subdued">
                          Export your current featured products to a CSV file, or import featured products from a CSV file.
                        </Text>
                        <InlineStack gap="200">
                          <Button 
                            onClick={exportFeaturedProductsCSV}
                            icon={ArrowDownIcon}
                            disabled={!manualSortOrder}
                          >
                            Export Featured Products
                          </Button>
                          <Text as="span">or</Text>
                          <Button 
                            onClick={handleImportFeaturedProductsClick}
                            icon={ArrowUpIcon}
                            disabled={!manualSortOrder}
                          >
                            Select CSV File
                          </Button>
                          <input
                            type="file"
                            ref={featuredProductsFileInputRef}
                            style={{ display: 'none' }}
                            accept=".csv"
                            onChange={(e) => handleFileUpload(e, 'featured-products')}
                          />
                        </InlineStack>

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
                                  onClick={() => handleFileUpload({ target: { files: [selectedFile] } } as any, 'featured-products')}
                                  variant="primary"
                                  loading={importLoading}
                                  disabled={!manualSortOrder}
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

                        <Button variant="plain" disabled={!manualSortOrder}>
                          How to create a correct .CSV file for import?
                        </Button>
                      </BlockStack>
                    </Card>

                    {/* Search and Pagination */}
                    <Card>
                      <BlockStack gap="400">
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
                              disabled={!manualSortOrder}
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
                    {showDropdown && manualSortOrder && (
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

                    {/* Featured Products Search */}
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
                          disabled={!manualSortOrder}
                        />
                        {featuredSearchQuery && (
                          <Text as="span" variant="bodySm" tone="subdued">
                            Found {filteredFeaturedProducts.length} featured products matching "{featuredSearchQuery}"
                          </Text>
                        )}
                      </BlockStack>
                    </Card>

                    {/* Featured Products List */}
                    <BlockStack gap="400">
                      <Text as="h3" variant="headingSm">
                        Featured Products ({featuredProducts.length})
                        {parseInt(limitFeatured) > 0 && ` • Showing first ${Math.min(featuredProducts.length, parseInt(limitFeatured))} in collection`}
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
                            const actualIndex = featuredProducts.findIndex(p => p.id === product.id);
                            const isBeyondLimit = parseInt(limitFeatured) > 0 && actualIndex >= parseInt(limitFeatured);
                            
                            return (
                              <div
                                key={product.id}
                                draggable={!isBeyondLimit}
                                onDragStart={(e) => !isBeyondLimit && handleDragStart(e, product.id)}
                                onDragOver={!isBeyondLimit ? handleDragOver : undefined}
                                onDrop={!isBeyondLimit ? (e) => handleDrop(e, product.id) : undefined}
                                style={{
                                  cursor: isBeyondLimit ? 'not-allowed' : 'grab',
                                  padding: '12px',
                                  border: '1px solid var(--p-color-border)',
                                  borderRadius: '8px',
                                  backgroundColor: draggedProduct === product.id ? 'var(--p-color-bg-surface-hover)' : 
                                                 isBeyondLimit ? 'var(--p-color-bg-surface-secondary)' : 'var(--p-color-bg)',
                                  opacity: isBeyondLimit ? 0.6 : 1,
                                  transition: 'background-color 0.2s ease',
                                }}
                              >
                                <Card padding="200">
                                  <InlineStack align="space-between" blockAlign="center">
                                    <InlineStack gap="400" blockAlign="center">
                                      {!isBeyondLimit && <Icon source={DragHandleIcon} />}
                                      {isBeyondLimit && <div style={{ width: '20px' }} />}
                                      <Thumbnail
                                        source={product.featuredImage?.url || "https://cdn.shopify.com/s/files/1/0533/2089/files/placeholder-images-product_small.png"}
                                        alt={product.featuredImage?.altText || product.title}
                                        size="small"
                                      />
                                      <BlockStack gap="100">
                                        <Text as="span" variant="bodyMd" fontWeight="medium">
                                          {product.title}
                                          {isBeyondLimit && <Badge tone="attention">Beyond limit</Badge>}
                                        </Text>
                                        <Text as="span" variant="bodySm" tone="subdued">
                                          {product.handle}
                                        </Text>
                                      </BlockStack>
                                    </InlineStack>
                                    
                                    <InlineStack gap="200" blockAlign="center">
                                      {product.featuredType === "scheduled" && (
                                        <Badge tone="info">
                                          Scheduled
                                        </Badge>
                                      )}
                                     
                                      <Badge tone={isBeyondLimit ? "attention" : "success"}>
                                        {`Position: ${actualIndex + 1}`}
                                      </Badge>
                                      
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
                                        disabled={!manualSortOrder}
                                      />
                                      
                                      {product.featuredType === "scheduled" && (
                                        <InlineStack gap="200">
                                          {!product.scheduleApplied ? (
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
                                                  disabled={!manualSortOrder}
                                                />
                                                <TextField
                                                  label="Start date"
                                                  type="date"
                                                  value={product.startDate || ""}
                                                  onChange={(value) => updateProduct(product.id, { 
                                                    startDate: value 
                                                  })}
                                                  autoComplete="off"
                                                  disabled={!manualSortOrder}
                                                />
                                                <Button 
                                                  size="slim"
                                                  variant="primary" 
                                                  onClick={() => applySchedule(product.id)}
                                                  disabled={!manualSortOrder}
                                                >
                                                  Apply
                                                </Button>
                                              </InlineStack>
                                            </Collapsible>
                                          ) : (
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
                                                disabled={!manualSortOrder}
                                              />
                                            </InlineStack>
                                          )}
                                          
                                          {!product.scheduleApplied && (
                                            <Button
                                              size="slim"
                                              variant="plain"
                                              onClick={() => toggleDateDetails(product.id)}
                                              disabled={!manualSortOrder}
                                            >
                                              {showDateDetails[product.id] ? "Hide" : "Show"} dates
                                            </Button>
                                          )}
                                        </InlineStack>
                                      )}
                                      
                                      <Button
                                        size="slim"
                                        icon={DeleteIcon}
                                        variant="plain"
                                        tone="critical"
                                        onClick={() => handleRemoveProduct(product.id)}
                                        disabled={!manualSortOrder}
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
                              Limit Featured Products
                            </Text>
                            <Text as="p" tone="subdued">
                              Max # of products to feature each time. If you have 5 featured products but set limit to 2, only the first 2 products will appear as featured in the collection. The remaining 3 will follow the default sort order. Set "0" to show all featured products.
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
                                disabled={!manualSortOrder}
                                helpText={parseInt(limitFeatured) > 0 ? 
                                  `Only first ${limitFeatured} featured products will be displayed` : 
                                  "All featured products will be displayed"}
                              />
                            </Box>
                          </Box>
                        </BlockStack>
                      </Box>
                    </BlockStack>
                  </BlockStack>
                )}

                {/* Collection Settings Tab */}
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

                      <div style={useCustomSorting ? {} : disabledSectionStyle}>
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
                              label="Include discounts in revenue"
                              checked={productGrouping}
                              onChange={setProductGrouping}
                              disabled={!useCustomSorting}
                            />
                          </InlineStack>
                        </Card>

                        <Card>
                          <BlockStack gap="200">
                            <InlineStack align="space-between">
                              <BlockStack gap="200">
                                <Text as="h3" variant="headingSm">
                                  Push New Products Up
                                </Text>
                                <Text as="p" tone="subdued">
                                  Automatically push newly added products to the top of the collection for a specified period.
                                </Text>
                              </BlockStack>
                              <Checkbox
                                label="Enable push new products"
                                checked={pushNewProducts}
                                onChange={setPushNewProducts}
                                disabled={!useCustomSorting}
                              />
                            </InlineStack>
                            
                            {pushNewProducts && (
                              <BlockStack gap="200">
                                <Text as="p" tone="subdued">
                                  Number of days to consider a product as "new":
                                </Text>
                                <InlineStack gap="200">
                                  <TextField
                                    label="Days"
                                    type="number"
                                    value={pushNewProductsDays}
                                    onChange={setPushNewProductsDays}
                                    disabled={!useCustomSorting || !pushNewProducts}
                                    placeholder="7"
                                    autoComplete="off"
                                    min="1"
                                    max="365"
                                  />
                                  <Text as="span">days</Text>
                                </InlineStack>
                              </BlockStack>
                            )}
                          </BlockStack>
                        </Card>

                        <Card>
                          <InlineStack align="space-between">
                            <BlockStack gap="200">
                              <Text as="h3" variant="headingSm">
                                Push Down Out of Stock
                              </Text>
                              <Text as="p" tone="subdued">
                                Automatically push out-of-stock products to the bottom of the collection.
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
                                disabled={!useCustomSorting}
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
                                disabled={!useCustomSorting}
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
                                disabled={!useCustomSorting}
                              />
                            </BlockStack>
                          </Card>
                        )}
                      </div>
                    </BlockStack>
                  </BlockStack>
                )}

                {/* Manage Tags Tab */}
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
                                placeholder="Enter tag name (e.g., 'sale', 'new')"
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
                                  Add Tag Rule
                                </Button>
                              </div>
                            </Grid.Cell>
                          </Grid>
                        </BlockStack>
                      </Card>

                      <Card>
                        <BlockStack gap="300">
                          <Text as="h3" variant="headingSm">
                            Active Tag Rules ({tagRules.length})
                          </Text>
                          
                          {tagRules.length === 0 ? (
                            <Box padding="400" background="bg-surface-secondary">
                              <Text as="p" tone="subdued" alignment="center">
                                No tag rules yet. Add tag rules above to organize products by tags.
                              </Text>
                            </Box>
                          ) : (
                            <BlockStack gap="200">
                              {tagRules.map((rule) => (
                                <Card key={rule.id} padding="300">
                                  <InlineStack align="space-between" blockAlign="center">
                                    <BlockStack gap="100">
                                      <Text as="span" variant="bodyMd" fontWeight="medium">
                                        Tag: {rule.name}
                                      </Text>
                                      <Text as="span" variant="bodySm" tone="subdued">
                                        Position: {positions.find(p => p.value === rule.position)?.label}
                                      </Text>
                                    </BlockStack>
                                    <Button
                                      variant="plain"
                                      tone="critical"
                                      icon={DeleteIcon}
                                      onClick={() => handleRemoveTag(rule.id)}
                                      disabled={!sortByTags}
                                    >
                                      Remove
                                    </Button>
                                  </InlineStack>
                                </Card>
                              ))}
                            </BlockStack>
                          )}
                        </BlockStack>
                      </Card>

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

                      <Card>
                        <BlockStack gap="200">
                          <Text as="h3" variant="headingSm">
                            How Tag Rules Work
                          </Text>
                          <Text as="p" tone="subdued">
                            When you re-sort the collection, products with tags matching your rules will be positioned as follows:
                          </Text>
                          <List type="bullet">
                            <List.Item>Top: Products appear after featured products</List.Item>
                            <List.Item>After New: Products appear after new products section</List.Item>
                            <List.Item>Before Out-of-Stock: Products appear before out-of-stock section</List.Item>
                            <List.Item>Bottom: Products appear at the very end of collection</List.Item>
                          </List>
                          <Banner tone="info">
                            <Text as="p">
                              <strong>Tip:</strong> Make sure your products have the specified tags in Shopify. The app will only apply rules to products that actually have these tags.
                            </Text>
                          </Banner>
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

      {/* Clear All Featured Products Modal */}
      <Modal
        open={clearFeaturedModalActive}
        onClose={() => setClearFeaturedModalActive(false)}
        title="Clear All Featured Products?"
        primaryAction={{
          content: "Yes, Clear All",
          onAction: handleClearAllFeaturedProducts,
          loading: isSaving,
          tone: "critical" as any,
        }}
        secondaryActions={[{
          content: "Cancel",
          onAction: () => setClearFeaturedModalActive(false),
        }]}
      >
        <Modal.Section>
          <Text as="p">
            This will remove all featured products from this collection. 
            {tagRules.length > 0 
              ? ` The collection will be reordered based on your ${tagRules.length} tag rule(s).` 
              : " The collection will revert to the default sort order."}
          </Text>
          <Banner tone="warning">
            <Text as="p">
              <strong>Note:</strong> Manual sort order will not be automatically disabled. You can manually disable it in the "Collection Sort Order Control" section above if needed.
            </Text>
          </Banner>
        </Modal.Section>
      </Modal>

      {toastMarkup}
    </Page>
  );
};

export default CollectionSort;