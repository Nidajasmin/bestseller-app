// app/routes/app.manage-tags.$collectionId.tsx
import type { LoaderFunctionArgs, ActionFunctionArgs } from "react-router";
import { useLoaderData, useParams, useNavigate, useSubmit } from "react-router";
import { useState, useEffect, useRef } from "react";
import {
  Page,
  Layout,
  Card,
  TextField,
  Select,
  Button,
  Banner,
  InlineStack,
  BlockStack,
  Text,
  Box,
  Icon,
  List,
  Grid,
  Checkbox,
  LegacyCard,
  Modal,
  Toast,
} from "@shopify/polaris";
import { DeleteIcon, ArrowDownIcon, ArrowUpIcon, CheckIcon, RefreshIcon } from "@shopify/polaris-icons";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

// Types
interface TagRule {
  id: string;
  name: string;
  position: string;
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

interface LoaderData {
  collection: CollectionDetails;
  shopDomain: string;
  tagRules: TagRule[];
  manualSortOrder: boolean;
  featuredProductsCount: number;
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
    
    console.log("🔄 LOADER STARTED - Fetching collection data for manage tags...");
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

    // Get featured products count
    const featuredProductsCount = await prisma.featuredProduct.count({
      where: {
        shopifyDomain: session.shop,
        collectionId: gid
      }
    });

    // Get tag rules from database
    console.log("🏷️ Fetching tag rules from database...");
    const tagRulesFromDb = await prisma.tagSortingRule.findMany({
      where: {
        shopifyDomain: session.shop,
        collectionId: gid
      }
    });

    console.log(`🏷️ Found ${tagRulesFromDb.length} tag rules in DB for this collection`);

    // Transform tag rules
    const tagRules: TagRule[] = tagRulesFromDb.map((rule: any) => ({
      id: rule.id.toString(),
      name: rule.tagName,
      position: rule.position
    }));

    return {
      collection: collectionData.data.collection,
      shopDomain: session.shop,
      tagRules,
      manualSortOrder: collectionData.data.collection.sortOrder === "MANUAL",
      featuredProductsCount
    };
  } catch (error) {
    console.error("❌ Error loading collection data for manage tags:", error);
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

      case "save-tag-rules": {
        const tagRules = JSON.parse(formData.get("tagRules") as string);
        const autoResort = formData.get("autoResort") === "true";
        
        console.log("💾 SAVING TAG RULES TO DATABASE");
        console.log("🔍 Tag rules to save:", tagRules);
        console.log("🔄 Auto resort:", autoResort);

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

        // Auto-resort collection if requested
        if (autoResort && tagRules.length > 0) {
          console.log("🔄 AUTO-RESORT: Starting automatic collection resort after tag rules update");
          try {
            const resortResult = await resortCollectionWithTags(admin, session, gid);
            if (resortResult.success) {
              console.log("✅ AUTO-RESORT: Collection successfully reordered with tag rules");
              return { 
                success: true, 
                message: `Tag rules saved and collection reordered successfully! ${tagRules.length} rule(s) applied.` 
              };
            } else {
              console.error("❌ AUTO-RESORT: Failed to resort collection:", resortResult.error);
              return { 
                success: true, 
                message: `Tag rules saved but failed to reorder collection: ${resortResult.error}` 
              };
            }
          } catch (resortError) {
            console.error("❌ AUTO-RESORT: Error during resort:", resortError);
            return { 
              success: true, 
              message: `Tag rules saved but error during reordering: ${resortError}` 
            };
          }
        }

        return { 
          success: true, 
          message: tagRules.length > 0 
            ? `Tag rules saved successfully! ${tagRules.length} rule(s) active. Remember to re-sort the collection to apply changes.` 
            : "All tag rules removed. Collection will use default sorting."
        };
      }

      case "resort-collection-with-tags": {
        console.log("🔄 MANUAL RESORT: Starting collection resort from manage-tags page");
        try {
          const result = await resortCollectionWithTags(admin, session, gid);
          return result;
        } catch (error) {
          console.error("❌ MANUAL RESORT: Failed to resort collection:", error);
          return { 
            success: false, 
            error: error instanceof Error ? error.message : "Failed to re-sort collection" 
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

// Define the interface for the product data from Shopify
interface ProductNode {
  id: string;
  title: string;
  tags: string[];
  totalInventory: number;
  createdAt: string;
}

// Helper function to resort collection with tag rules
async function resortCollectionWithTags(admin: any, session: any, gid: string) {
  console.log("🏷️ RESORT: Starting collection resort with COMPREHENSIVE logic");
  
  try {
    // Get CURRENT tag rules from database
    const tagRules = await prisma.tagSortingRule.findMany({
      where: {
        shopifyDomain: session.shop,
        collectionId: gid
      }
    });

    // Get collection settings to check for 'push new' and 'push down oos' rules
    const collectionSettings = await prisma.collectionSetting.findUnique({
      where: {
        shopifyDomain_collectionId: {
          shopifyDomain: session.shop,
          collectionId: gid
        }
      }
    });

    const behaviorRules = await prisma.productBehaviorRule.findUnique({
      where: {
        shopifyDomain_collectionId: {
          shopifyDomain: session.shop,
          collectionId: gid
        }
      }
    });

    // Get featured products
    const featuredProductsFromDb = await prisma.featuredProduct.findMany({
      where: {
        shopifyDomain: session.shop,
        collectionId: gid
      },
      orderBy: { position: 'asc' }
    });

    // Get all products from collection
    const productsResponse = await admin.graphql(`
      query GetCollectionProductsWithTags($id: ID!, $first: Int!) {
        collection(id: $id) {
          products(first: $first) {
            edges {
              node {
                id
                title
                tags
                totalInventory
                createdAt
              }
            }
          }
        }
      }
    `, { variables: { id: gid, first: 250 } });
    
    const productsData = await productsResponse.json() as any;
    
    // --- FIX IS HERE ---
    // Type the array using the new interface
    const allProducts: ProductNode[] = productsData.data?.collection?.products?.edges?.map((edge: any) => edge.node) || [];
    
    if (allProducts.length === 0) {
      return { success: false, error: "No products found in this collection" };
    }

    console.log(`📦 RESORT: Processing ${allProducts.length} total products.`);
    console.log(`⭐ RESORT: ${featuredProductsFromDb.length} featured products found.`);
    console.log(`🏷️ RESORT: ${tagRules.length} tag rules found.`);

    // --- DEFINE PRODUCT CATEGORIES using the ProductNode type ---
    const newProducts: ProductNode[] = [];
    const outOfStockProducts: ProductNode[] = [];
    const taggedProducts: { [key: string]: ProductNode[] } = {
      'after-featured': [],
      'before-out-of-stock': [],
      'bottom': []
    };
    const untaggedProducts: ProductNode[] = [];

    const newProductDays = behaviorRules?.newProductDays || 7;
    const now = new Date();
    const newProductDate = new Date();
    newProductDate.setDate(now.getDate() - newProductDays);

    // --- CATEGORIZE EACH PRODUCT ---
    allProducts.forEach((product: ProductNode) => {
      const isOutOfStock = product.totalInventory <= 0;
      const isNew = new Date(product.createdAt) > newProductDate;

      // PRIORITY 1: Check for tag rules
      let hasBeenTagged = false;
      if (product.tags && product.tags.length > 0) {
        for (const tagRule of tagRules) {
          if (product.tags.includes(tagRule.tagName)) {
            if (taggedProducts[tagRule.position]) {
              taggedProducts[tagRule.position].push(product);
              hasBeenTagged = true;
            }
            break; // A product can only be in one tag rule category
          }
        }
      }
      if (hasBeenTagged) return;

      // PRIORITY 2: Check for New/Out-of-Stock if not tagged
      if (isNew) {
        newProducts.push(product);
      } else if (isOutOfStock) {
        outOfStockProducts.push(product);
      } else {
        untaggedProducts.push(product);
      }
    });

    // --- CONSTRUCT FINAL PRODUCT ORDER ---
    const productIds: string[] = [];
    const processedProducts = new Set<string>();

    const addProductsToFinalList = (products: ProductNode[]) => {
      products.forEach((product: ProductNode) => {
        if (!processedProducts.has(product.id)) {
          productIds.push(product.id);
          processedProducts.add(product.id);
        }
      });
    };

    // This is the final, definitive order of products
    // 1. Featured Products
    // 2. Products tagged 'after-featured'
    // 3. New Products (if rule is enabled)
    // 4. Untagged Products
    // 5. Products tagged 'before-out-of-stock'
    // 6. Out-of-Stock Products (that are not already handled by a tag)
    // 7. Products tagged 'bottom'

    // Step 1: Add Featured Products
    const effectiveFeaturedProducts = featuredProductsFromDb;
    effectiveFeaturedProducts.forEach((fp: any) => {
      // The 'p' here is now correctly typed as ProductNode because of our fix
      if (allProducts.some((p: ProductNode) => p.id === fp.productId) && !processedProducts.has(fp.productId)) {
        productIds.push(fp.productId);
        processedProducts.add(fp.productId);
      }
    });

    // Step 2: Add 'after-featured' tagged products
    addProductsToFinalList(taggedProducts['after-featured']);

    // Step 3: Add 'new' products (if rule is enabled)
    if (behaviorRules?.pushNewProductsUp) {
      addProductsToFinalList(newProducts);
    }

    // Step 4: Add untagged products
    addProductsToFinalList(untaggedProducts);

    // Step 5: Add 'before-out-of-stock' tagged products
    addProductsToFinalList(taggedProducts['before-out-of-stock']);
    
    // Step 6: Add general out-of-stock products (if rule is enabled)
    if (behaviorRules?.pushDownOutOfStock) {
      addProductsToFinalList(outOfStockProducts);
    }

    // Step 7: Add 'bottom' tagged products
    addProductsToFinalList(taggedProducts['bottom']);

    // Step 8: Add any remaining products (failsafe)
    const remainingProducts = allProducts.filter((product: ProductNode) => !processedProducts.has(product.id));
    addProductsToFinalList(remainingProducts);

    console.log(`📋 RESORT: Final product order has ${productIds.length} products.`);
    
    // --- APPLY NEW ORDER TO SHOPIFY ---
    const moves = productIds.map((productId, index) => ({
      id: productId,
      newPosition: index.toString()
    }));

    const reorderResponse = await admin.graphql(SET_COLLECTION_PRODUCTS_ORDER, {
      variables: { id: gid, moves: moves }
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
      message: `✅ Collection successfully reordered with ${tagRules.length} tag rule(s) and behavior rules applied!`
    };
    
  } catch (error) {
    console.error("💥 Resort collection with tags error:", error);
    return { 
      success: false, 
      error: error instanceof Error ? error.message : "Failed to resort collection with tags" 
    };
  }
}

const ManageTagsPage = () => {
  const { collection, shopDomain, tagRules: initialTagRules, manualSortOrder, featuredProductsCount } = useLoaderData() as LoaderData;
  const { collectionId } = useParams();
  const navigate = useNavigate();
  const submit = useSubmit();
  
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  // State
  const [tagRules, setTagRules] = useState<TagRule[]>(initialTagRules || []);
  const [tagName, setTagName] = useState("");
  const [tagPosition, setTagPosition] = useState("after-featured");
  const [isSaving, setIsSaving] = useState(false);
  const [importLoading, setImportLoading] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [actionMessage, setActionMessage] = useState<string>("");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [manualSortOrderState, setManualSortOrderState] = useState(manualSortOrder);
  const [resortModalActive, setResortModalActive] = useState(false);
  const [autoResort, setAutoResort] = useState(true);

  // NEW STATE VARIABLES FOR DUPLICATE TAG WARNING
  const [duplicateModalActive, setDuplicateModalActive] = useState(false);
  const [duplicateTagInfo, setDuplicateTagInfo] = useState<{name: string, existingPosition: string} | null>(null);
  const [pendingTagRule, setPendingTagRule] = useState<TagRule | null>(null);

  // Sync with loader data
  useEffect(() => {
    console.log("🔄 DEBUG: Syncing component state with loader data...");
    console.log("🏷️ DEBUG: Saved tag rules from loader:", initialTagRules);
    
    setTagRules(initialTagRules || []);
    setManualSortOrderState(manualSortOrder);
  }, [initialTagRules, manualSortOrder]);

  // Update the positions array with only the 3 options the user wants
  const positions = [
    { value: "after-featured", label: "After Featured Products" },
    { value: "before-out-of-stock", label: "Before Out of Stock Products" },
    { value: "bottom", label: "Bottom of Collection" },
  ];

  const positionOptions = positions.map((pos) => ({
    label: pos.label,
    value: pos.value,
  }));

  // Check if position requires featured products
  const requiresFeaturedProducts = (position: string) => {
    return position === "after-featured";
  };

  // NEW FUNCTION: Handle duplicate tag confirmation
  const handleConfirmDuplicateTag = () => {
    if (pendingTagRule) {
      console.log("➕ UI DEBUG: Adding duplicate tag rule after confirmation:", pendingTagRule);
      
      setTagRules([
        ...tagRules,
        pendingTagRule
      ]);
      setTagName("");
      setTagPosition("after-featured");
    }
    
    setDuplicateModalActive(false);
    setPendingTagRule(null);
    setDuplicateTagInfo(null);
  };

  // NEW FUNCTION: Handle duplicate tag cancellation
  const handleCancelDuplicateTag = () => {
    setDuplicateModalActive(false);
    setPendingTagRule(null);
    setDuplicateTagInfo(null);
  };

  // UPDATED FUNCTION: Handle add tag with duplicate check
  const handleAddTag = () => {
    if (tagName.trim()) {
      const newTagRule = {
        id: `temp-${Date.now()}`,
        name: tagName.trim(),
        position: tagPosition,
      };

      // Check for duplicate tag name
      const existingRule = tagRules.find(rule => 
        rule.name.toLowerCase() === tagName.trim().toLowerCase()
      );

      if (existingRule) {
        // Show duplicate warning modal
        setDuplicateTagInfo({
          name: tagName.trim(),
          existingPosition: positions.find(p => p.value === existingRule.position)?.label || existingRule.position
        });
        setPendingTagRule(newTagRule);
        setDuplicateModalActive(true);
        return;
      }

      console.log("➕ UI DEBUG: Adding new tag rule:", newTagRule);
      
      setTagRules([
        ...tagRules,
        newTagRule
      ]);
      setTagName("");
      setTagPosition("after-featured");
    }
  };

  const handleSaveTagRules = async (withResort: boolean = autoResort) => {
    if (!manualSortOrderState && tagRules.length > 0) {
      // Auto-enable manual sort order when saving tag rules
      await enableManualSortOrder();
    }
    
    setIsSaving(true);
    setActionMessage("Saving tag rules...");
    
    console.log("💾 UI DEBUG: Saving tag rules to database:", tagRules);
    
    const formData = new FormData();
    formData.append("intent", "save-tag-rules");
    formData.append("tagRules", JSON.stringify(tagRules));
    formData.append("autoResort", withResort.toString());
    
    try {
      submit(formData, { 
        method: "POST",
        replace: true 
      });
      
      setSaveSuccess(true);
      setActionMessage(withResort 
        ? `Tag rules saved and collection reordered successfully! ${tagRules.length} rule(s) applied.`
        : `Tag rules saved successfully! ${tagRules.length} rule(s) active. Remember to re-sort the collection to apply changes.`
      );
      setTimeout(() => {
        setSaveSuccess(false);
        setActionMessage("");
      }, 5000);
    } catch (error) {
      console.error("Save failed:", error);
      setActionMessage("Failed to save tag rules");
    } finally {
      setIsSaving(false);
    }
  };

  const handleResortCollection = async () => {
    setIsSaving(true);
    setActionMessage("Re-sorting collection with tag rules...");
    
    const formData = new FormData();
    formData.append("intent", "resort-collection-with-tags");
    
    try {
      submit(formData, { 
        method: "POST",
        replace: true 
      });
      
      setSaveSuccess(true);
      setActionMessage("Collection successfully reordered with tag rules!");
      setResortModalActive(false);
      setTimeout(() => {
        setSaveSuccess(false);
        setActionMessage("");
      }, 5000);
    } catch (error) {
      console.error("Resort failed:", error);
      setActionMessage("Failed to re-sort collection");
    } finally {
      setIsSaving(false);
    }
  };

  const enableManualSortOrder = async () => {
    setActionMessage("Enabling manual sort order...");
    
    const formData = new FormData();
    formData.append("intent", "update-collection-sort-order");
    formData.append("manualSortOrder", "true");
    formData.append("defaultSortOrder", "BEST_SELLING");
    
    try {
      submit(formData, { 
        method: "POST",
        replace: true 
      });
      
      setManualSortOrderState(true);
      setActionMessage("Manual sort order enabled successfully!");
      setTimeout(() => setActionMessage(""), 3000);
    } catch (error) {
      console.error("Failed to enable manual sort order:", error);
      setActionMessage("Failed to enable manual sort order");
    }
  };

  const handleManualSortOrderChange = async (value: boolean) => {
    setManualSortOrderState(value);
    setActionMessage(value ? 
      "Updating collection to Manual sort order..." : 
      "Updating collection to default sort order...");
    
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

  const handleRemoveTag = (id: string) => {
    console.log("🗑️ UI DEBUG: Removing tag rule with ID:", id);
    const newTagRules = tagRules.filter(rule => rule.id !== id);
    setTagRules(newTagRules);
  };

  const handlePositionChange = (value: string) => {
    setTagPosition(value);
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setSelectedFile(file);
    }
  };

  const handleRemoveFile = () => {
    setSelectedFile(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setImportLoading(true);
    setActionMessage("Importing tags...");

    // Read CSV file and parse tag rules
    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const csvText = event.target?.result as string;
        const lines = csvText.split('\n');
        const newTagRules: TagRule[] = [];

        // Skip header row and process data
        for (let i = 1; i < lines.length; i++) {
          const line = lines[i].trim();
          if (!line) continue;

          const [name, position] = line.split(',').map(field => 
            field.replace(/^"|"$/g, '').trim()
          );

          if (name && position) {
            // Only allow the 3 positions the user wants
            if (position === "after-featured" || position === "before-out-of-stock" || position === "bottom") {
              newTagRules.push({
                id: `import-${Date.now()}-${i}`,
                name,
                position: position.toLowerCase()
              });
            }
          }
        }

        if (newTagRules.length > 0) {
          setTagRules(newTagRules);
          setSaveSuccess(true);
          setActionMessage(`✅ Successfully imported ${newTagRules.length} tag rules!`);
          
          // Auto-save imported tags with resort
          setTimeout(() => {
            handleSaveTagRules(true);
          }, 500);
        }
      } catch (error) {
        console.error("Error parsing CSV:", error);
        setActionMessage("Failed to import tags - invalid CSV format");
      } finally {
        setImportLoading(false);
        if (e.target) e.target.value = '';
        setSelectedFile(null);
      }
    };

    reader.readAsText(file);
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

  const handleImportTagsClick = () => {
    fileInputRef.current?.click();
  };

  const toastMarkup = saveSuccess ? (
    <Toast content={actionMessage || "Tag rules saved successfully!"} onDismiss={() => setSaveSuccess(false)} />
  ) : null;

  return (
    <Page
      title={`Manage Tags: ${collection.title}`}
      primaryAction={{
        content: "Save & Apply Tag Rules",
        onAction: () => handleSaveTagRules(true),
        loading: isSaving,
      }}
      secondaryActions={[
        {
          content: "Re-Sort Collection",
          onAction: () => setResortModalActive(true),
          icon: RefreshIcon,
        },
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
                  checked={manualSortOrderState}
                  onChange={handleManualSortOrderChange}
                  helpText={manualSortOrderState ? 
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
              {manualSortOrderState && (
                <Banner tone="success">
                  <Text as="p">
                    ✅ This collection is set to Manual sort order in Shopify. You can now organize products manually using tag rules.
                  </Text>
                </Banner>
              )}
              {!manualSortOrderState && (
                <Banner tone="warning">
                  <Text as="p">
                    ⚠️ This collection is not set to Manual sort order. Enable "Manual Sort Order" to use tag-based product organization. Current Shopify sort order: <strong>{collection.sortOrder?.replace('_', ' ').toLowerCase()}</strong>
                  </Text>
                </Banner>
              )}
            </BlockStack>
          </Card>
        </Layout.Section>

        {/* Auto-Resort Option */}
        <Layout.Section>
          <Card>
            <BlockStack gap="200">
              <Text as="h3" variant="headingSm">
                Automatic Collection Re-ordering
              </Text>
              <Checkbox
                label="Automatically re-sort collection when saving tag rules"
                checked={autoResort}
                onChange={setAutoResort}
                helpText="When enabled, the collection will be automatically reordered after saving tag rules. When disabled, you'll need to manually click 'Re-Sort Collection'."
              />
            </BlockStack>
          </Card>
        </Layout.Section>

        {/* Action Message Banner */}
        {actionMessage && !saveSuccess && (
          <Layout.Section>
            <Banner tone={actionMessage.includes("✅") ? "success" : "warning"}>
              <Text as="p">{actionMessage}</Text>
            </Banner>
          </Layout.Section>
        )}

        <Layout.Section>
          <BlockStack gap="400">
            <Text as="h2" variant="headingMd">
              Manage Tag Rules
            </Text>

            {!manualSortOrderState && tagRules.length > 0 && (
              <Banner tone="warning">
                <Text as="p">
                  ⚠️ Manual sort order is required for tag rules to work. It will be automatically enabled when you save tag rules.
                </Text>
              </Banner>
            )}

            {/* TAG RULES SECTION - ALWAYS VISIBLE */}
            <BlockStack gap="400">
              {/* Add Tag Rule Card - Always Visible */}
              <Card>
                <BlockStack gap="300">
                  <Text as="h3" variant="headingSm">
                    Add New Tag Rule
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
                        autoComplete="off"
                        helpText="Make sure this tag exists on your products in Shopify"
                      />
                    </Grid.Cell>
                    <Grid.Cell columnSpan={{ xs: 6, sm: 6, md: 6, lg: 6, xl: 6 }}>
                      <Select
                        label="Position"
                        options={positionOptions}
                        value={tagPosition}
                        onChange={handlePositionChange}
                      />
                    </Grid.Cell>
                  </Grid>
                  <Box paddingBlockStart="200">
                    <Button
                      onClick={handleAddTag}
                      disabled={!tagName.trim()}
                      fullWidth
                    >
                      Add Tag Rule
                    </Button>
                  </Box>
                </BlockStack>
              </Card>

              {/* Active Tag Rules Card - Always Visible */}
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
                      {tagRules.map((rule) => {
                        const requiresFeatured = requiresFeaturedProducts(rule.position);
                        const hasFeatured = featuredProductsCount > 0;
                        
                        return (
                          <LegacyCard key={rule.id}>
                            <Box padding="300">
                              <InlineStack align="space-between" blockAlign="center">
                                <BlockStack gap="100">
                                  <Text as="span" variant="bodyMd" fontWeight="medium">
                                    Tag: {rule.name}
                                  </Text>
                                  <Text as="span" variant="bodySm" tone="subdued">
                                    Position: {positions.find(p => p.value === rule.position)?.label}
                                  </Text>
                                  {requiresFeatured && !hasFeatured && (
                                    <Banner tone="warning">
                                      <Text as="span" variant="bodySm">
                                        ⚠️ Requires featured products
                                      </Text>
                                    </Banner>
                                  )}
                                </BlockStack>
                                <Button
                                  variant="plain"
                                  tone="critical"
                                  icon={DeleteIcon}
                                  onClick={() => handleRemoveTag(rule.id)}
                                >
                                  Remove
                                </Button>
                              </InlineStack>
                            </Box>
                          </LegacyCard>
                        );
                      })}
                    </BlockStack>
                  )}
                </BlockStack>
              </Card>

              {/* Import/Export Card - Always Visible */}
              <Card>
                <BlockStack gap="200">
                  <Text as="h3" variant="headingSm">
                    Import/Export Tags List
                  </Text>
                  <Text as="p" tone="subdued">
                    You can import tags instead of adding them manually above. Click "Export" to download your tags sample file. Edit this file to suit your needs and import back.
                  </Text>
                  <InlineStack gap="200">
                    <Button 
                      variant="secondary" 
                      onClick={exportTagsCSV} 
                      icon={ArrowDownIcon}
                    >
                      Export Tags
                    </Button>
                    <Text as="span">or</Text>
                    <Button 
                      variant="secondary" 
                      onClick={handleImportTagsClick}
                      loading={importLoading}
                      icon={ArrowUpIcon}
                    >
                      Import Tags
                    </Button>
                    <input
                      type="file"
                      ref={fileInputRef}
                      style={{ display: 'none' }}
                      accept=".csv"
                      onChange={handleFileSelect}
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
                            onClick={() => handleFileUpload({ target: { files: [selectedFile] } } as any)}
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

                  <Banner tone="info">
                    <Text as="p">
                      <strong>CSV Format:</strong> The file should have two columns: "Tag Name" and "Position". Position values: after-featured, before-out-of-stock, bottom.
                    </Text>
                  </Banner>
                </BlockStack>
              </Card>

              {/* How Tag Rules Work Card - Always Visible */}
              <Card>
                <BlockStack gap="200">
                  <Text as="h3" variant="headingSm">
                    How Tag Rules Work
                  </Text>
                  <Text as="p" tone="subdued">
                    When you re-sort the collection, products with tags matching your rules will be positioned as follows:
                  </Text>
                  <List type="bullet">
                    <List.Item>
                      <Text as="span" fontWeight="semibold">After Featured:</Text> Products appear RIGHT AFTER featured products
                    </List.Item>
                    <List.Item>
                      <Text as="span" fontWeight="semibold">Before Out-of-Stock:</Text> Products appear before out-of-stock section
                    </List.Item>
                    <List.Item>
                      <Text as="span" fontWeight="semibold">Bottom:</Text> Products appear at the very end of collection
                    </List.Item>
                  </List>
                  <Banner tone="info">
                    <Text as="p">
                      <strong>Order of operations:</strong> Featured Products → After Featured → Untagged → Before Out-of-Stock → Bottom
                    </Text>
                  </Banner>
                  <Banner tone="success">
                    <Text as="p">
                      <strong>Important:</strong> After adding tag rules, you must re-sort the collection to apply the changes. Use the "Save & Apply" button or manually click "Re-Sort Collection".
                    </Text>
                  </Banner>
                </BlockStack>
              </Card>
            </BlockStack>
          </BlockStack>
        </Layout.Section>
      </Layout>

      {/* Resort Modal */}
      <Modal
        open={resortModalActive}
        onClose={() => setResortModalActive(false)}
        title="Re-Sort Collection with Tag Rules?"
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
            This will apply your current tag rules to reorder the collection. The product order will be updated in both Shopify Admin and your online store based on {tagRules.length} active tag rule(s).
          </Text>
          <Banner tone="info">
            <Text as="p">
              <strong>Tag rules will be applied in this order:</strong> Featured Products → After Featured → Untagged → Before Out-of-Stock → Bottom
            </Text>
          </Banner>
        </Modal.Section>
      </Modal>

      {/* NEW: Duplicate Tag Warning Modal */}
      <Modal
        open={duplicateModalActive}
        onClose={handleCancelDuplicateTag}
        title="Tag Already Exists"
        primaryAction={{
          content: "Add Anyway",
          onAction: handleConfirmDuplicateTag,
        }}
        secondaryActions={[{
          content: "Cancel",
          onAction: handleCancelDuplicateTag,
        }]}
      >
        <Modal.Section>
          <BlockStack gap="200">
            <Text as="p" variant="bodyMd">
              The tag <Text as="span" fontWeight="semibold">"{duplicateTagInfo?.name}"</Text> already has a position rule:
            </Text>
            <Banner tone="warning">
              <Text as="p">
                Current position: <Text as="span" fontWeight="semibold">{duplicateTagInfo?.existingPosition}</Text>
              </Text>
            </Banner>
            <Text as="p" variant="bodyMd">
              Are you sure you want to add another rule for the same tag? 
              This will create duplicate rules which might cause unexpected sorting behavior.
            </Text>
            <Banner tone="info">
              <Text as="p">
                <strong>Recommendation:</strong> Consider editing the existing rule instead of creating a duplicate.
              </Text>
            </Banner>
          </BlockStack>
        </Modal.Section>
      </Modal>

      {toastMarkup}
    </Page>
  );
};

export default ManageTagsPage;