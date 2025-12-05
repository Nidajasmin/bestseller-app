// app/routes/app.featured-products.$collectionId.tsx
import type { LoaderFunctionArgs, ActionFunctionArgs } from "react-router";
import { useLoaderData, useParams, useNavigate, useSubmit, useRevalidator, useActionData } from "react-router"; // Add useActionData
import { useState, useEffect, useRef } from "react";

import {
  Page,
  Layout,
  Card,
  TextField,
  ChoiceList,
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
  Pagination,
  Select,
  Modal,
  Toast,
  Checkbox,
} from "@shopify/polaris";
import {
  SearchIcon,
  DeleteIcon,
  CalendarIcon,
  EditIcon,
  ArrowDownIcon,
  ArrowUpIcon,
  DragHandleIcon,
} from "@shopify/polaris-icons";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

// Types remain the same
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
  sortOrder?: string;
}

interface LoaderData {
  collection: CollectionDetails;
  products: Product[];
  shopDomain: string;
  featuredProducts: Product[];
  featuredSettings: {
    limitFeatured: number;
    manualSortOrder: boolean;
  };
}

// GraphQL Queries remain the same
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

// Helper function to construct GID from numeric ID
const constructGid = (id: string) => {
  return `gid://shopify/Collection/${id}`;
};

// Updated Loader function with improved session handling
export async function loader({ request, params }: LoaderFunctionArgs) {
  try {
    const { admin, session } = await authenticate.admin(request);
    const { collectionId } = params;

    if (!collectionId) {
      throw new Response("Collection ID is required", { status: 400 });
    }

    const gid = constructGid(collectionId);
    
    const url = new URL(request.url);
    const productsPage = parseInt(url.searchParams.get("productsPage") || "1");
    const productsCount = parseInt(url.searchParams.get("productsCount") || "250");
    const searchQuery = url.searchParams.get("search") || "";

    console.log("🔄 LOADER STARTED - Fetching collection data...");

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
        first: productsCount
      }
    });
    
    const productsData = await productsResponse.json() as any;
    
    const products = productsData.data?.collection?.products?.edges?.map((edge: any) => ({
      ...edge.node,
      featuredType: "manual" as const,
      scheduleApplied: false
    })) || [];

    console.log(`📦 Found ${products.length} products in collection`);

    // Get featured products from database
    console.log("🗃️ Fetching featured products from database...");
    const featuredProductsFromDb = await prisma.featuredProduct.findMany({
      where: {
        shopifyDomain: session.shop,
        collectionId: gid
      },
      orderBy: { position: 'asc' }
    });

    console.log(`⭐ Found ${featuredProductsFromDb.length} featured products in DB`);

    // Get featured settings
    const featuredSettingsFromDb = await prisma.featuredSettings.findUnique({
      where: {
        shopifyDomain_collectionId: {
          shopifyDomain: session.shop,
          collectionId: gid
        }
      }
    });

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

    return {
      collection: collectionData.data.collection,
      products,
      shopDomain: session.shop,
      featuredProducts,
      featuredSettings: {
        limitFeatured: featuredSettingsFromDb?.limitFeatured || 0,
        manualSortOrder: featuredSettingsFromDb?.manualSortOrder || false
      },
      pagination: {
        productsPage,
        productsCount,
        searchQuery,
      }
    };
  } catch (error) {
    console.error("❌ Error in loader:", error);
    
    // Let Shopify handle authentication errors
    if (error instanceof Response) {
      throw error;
    }
    
    // For other errors, provide a user-friendly message
    throw new Response("Failed to load collection data. Please try again.", { 
      status: 500,
      headers: {
        'Cache-Control': 'no-cache'
      }
    });
  }
}

// Updated Action function with improved session handling
export async function action({ request, params }: ActionFunctionArgs) {
  try {
    const { admin, session } = await authenticate.admin(request);
    const { collectionId } = params;
    const formData = await request.formData();
    const intent = formData.get("intent");

    if (!collectionId) {
      throw new Response("Collection ID is required", { status: 400 });
    }

    const gid = constructGid(collectionId);

    switch (intent) {
      case "update-manual-sort-order": {
        const manualSortOrder = formData.get("manualSortOrder") === "true";
        
        try {
          // Update Shopify collection sort order
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
          
          // Update featured settings
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
              "Collection sort order updated to Best Selling." 
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
        const limitFeatured = parseInt(formData.get("limitFeatured") as string) || 0;
        
        console.log("💾 Saving featured products:", featuredProducts.length);

        // Get ALL products from collection
        const productsResponse = await admin.graphql(`
          query GetCollectionProducts($id: ID!, $first: Int!) {
            collection(id: $id) {
              products(first: $first) {
                edges {
                  node {
                    id
                    title
                  }
                }
              }
            }
          }
        `, { variables: { id: gid, first: 250 } });
        
        const productsData = await productsResponse.json() as any;
        const allProducts = productsData.data?.collection?.products?.edges?.map((edge: any) => edge.node) || [];
        
        console.log(`📦 Total products in collection: ${allProducts.length}`);

        // Delete all existing featured products from DB
        await prisma.featuredProduct.deleteMany({
          where: {
            shopifyDomain: session.shop,
            collectionId: gid
          }
        });

        // Create new featured products
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

        // Update featured settings
        await prisma.featuredSettings.upsert({
          where: {
            shopifyDomain_collectionId: {
              shopifyDomain: session.shop,
              collectionId: gid
            }
          },
          update: { 
            limitFeatured,
            manualSortOrder: featuredProducts.length > 0
          },
          create: {
            shopifyDomain: session.shop,
            collectionId: gid,
            sortOrder: "manual",
            limitFeatured,
            manualSortOrder: featuredProducts.length > 0
          }
        });

        // SIMPLE APPROACH: Build order from scratch
        const productIds: string[] = [];
        const processedIds = new Set();

        // Step 1: Add featured products within limit
        const featuredToShow = limitFeatured > 0 ? 
          featuredProducts.slice(0, limitFeatured) : 
          featuredProducts;
        
        featuredToShow.forEach((fp: Product) => {
          productIds.push(fp.id);
          processedIds.add(fp.id);
        });

        // Step 2: Add ALL other products in their current order
        allProducts.forEach((product: any) => {
          if (!processedIds.has(product.id)) {
            productIds.push(product.id);
          }
        });

        console.log(`📋 Final order: ${productIds.length} products, ${featuredToShow.length} featured at top`);

        // Apply new order
        const moves = productIds.map((productId, index) => ({
          id: productId,
          newPosition: index.toString()
        }));

        const reorderResponse = await admin.graphql(SET_COLLECTION_PRODUCTS_ORDER, {
          variables: { id: gid, moves: moves }
        });

        await admin.graphql(UPDATE_COLLECTION_SORT_ORDER, {
          variables: {
            input: {
              id: gid,
              sortOrder: "MANUAL"
            }
          }
        });

        return { 
          success: true, 
          message: `Featured products saved! ${featuredToShow.length} product(s) displayed as featured.`,
          redirectUrl: `/app` // Add redirect URL for navigation
        };
      }

      case "clear-all-featured-products": {
        // Delete all featured products
        await prisma.featuredProduct.deleteMany({
          where: {
            shopifyDomain: session.shop,
            collectionId: gid
          }
        });

        // Update featured settings
        await prisma.featuredSettings.upsert({
          where: {
            shopifyDomain_collectionId: {
              shopifyDomain: session.shop,
              collectionId: gid
            }
          },
          update: { 
            limitFeatured: 0,
            manualSortOrder: false
          },
          create: {
            shopifyDomain: session.shop,
            collectionId: gid,
            sortOrder: "manual",
            limitFeatured: 0,
            manualSortOrder: false
          }
        });

        // Set collection to best selling order
        await admin.graphql(UPDATE_COLLECTION_SORT_ORDER, {
          variables: {
            input: {
              id: gid,
              sortOrder: "BEST_SELLING"
            }
          }
        });

        return { 
          success: true, 
          message: "All featured products removed successfully!" 
        };
      }

      default:
        return { success: false, error: "Invalid intent" };
    }
  } catch (error) {
    console.error("Action failed:", error);
    
    // Let Shopify handle authentication errors
    if (error instanceof Response) {
      throw error;
    }
    
    return { 
      success: false, 
      error: error instanceof Error ? error.message : "Action failed" 
    };
  }
}

// Drag and drop utilities remain the same
const reorder = (list: Product[], startIndex: number, endIndex: number): Product[] => {
  const result = Array.from(list);
  const [removed] = result.splice(startIndex, 1);
  result.splice(endIndex, 0, removed);
  
  return result.map((product, index) => ({
    ...product,
    position: index
  }));
};

const FeaturedProductsPage = () => {
  const loaderData = useLoaderData() as LoaderData & { pagination: any };
  const actionData = useActionData() as { success?: boolean; message?: string; error?: string; redirectUrl?: string }; // Add useActionData
  const { collectionId } = useParams();
  const navigate = useNavigate();
  const submit = useSubmit();
  const { revalidate } = useRevalidator();
  
  // Refs for file inputs
  const featuredProductsFileInputRef = useRef<HTMLInputElement>(null);
  
  // State
  const [searchQuery, setSearchQuery] = useState(loaderData?.pagination?.searchQuery || "");
  const [showDropdown, setShowDropdown] = useState(false);
  const [featuredProducts, setFeaturedProducts] = useState<Product[]>(loaderData?.featuredProducts || []);
  const [isSaving, setIsSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [showDateDetails, setShowDateDetails] = useState<{ [key: string]: boolean }>({});
  const [draggedProduct, setDraggedProduct] = useState<string | null>(null);
  const [importLoading, setImportLoading] = useState(false);
  const [actionMessage, setActionMessage] = useState<string>("");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [featuredSearchQuery, setFeaturedSearchQuery] = useState("");
  const [currentPage, setCurrentPage] = useState(loaderData?.pagination?.productsPage || 1);
  const [productsPerPage, setProductsPerPage] = useState(loaderData?.pagination?.productsCount || 250);
  const [limitFeatured, setLimitFeatured] = useState(loaderData?.featuredSettings?.limitFeatured?.toString() || "0");
  const [manualSortOrder, setManualSortOrder] = useState(loaderData?.featuredSettings?.manualSortOrder || false);
  const [clearFeaturedModalActive, setClearFeaturedModalActive] = useState(false);

  // Handle action data to reset loading state
  useEffect(() => {
    if (actionData) {
      setIsSaving(false);
      setImportLoading(false);
      
      if (actionData.success) {
        setSaveSuccess(true);
        setActionMessage(actionData.message || "Operation completed successfully!");
        
        // Handle redirect if present
        if (actionData.redirectUrl) {
          setTimeout(() => {
            navigate(actionData.redirectUrl!);
          }, 1500);
        } else {
          // Revalidate data if no redirect
          setTimeout(() => {
            revalidate();
          }, 1500);
        }
      } else if (actionData.error) {
        setActionMessage(actionData.error);
      }
      
      // Clear success message after 3 seconds
      if (actionData.success || actionData.error) {
        setTimeout(() => {
          setSaveSuccess(false);
          setActionMessage("");
        }, 3000);
      }
    }
  }, [actionData, navigate, revalidate]);

  // Handle loader data safely
  useEffect(() => {
    if (loaderData) {
      console.log("🔄 DEBUG: Syncing component state with loader data...");
      console.log("🏷️ DEBUG: Saved featured products from loader:", loaderData.featuredProducts?.length || 0);
      
      setFeaturedProducts(loaderData.featuredProducts || []);
      setManualSortOrder(loaderData.featuredSettings?.manualSortOrder || false);
      setLimitFeatured(loaderData.featuredSettings?.limitFeatured?.toString() || "0");
      
      console.log("✅ DEBUG: State synced with loader data");
    }
  }, [loaderData]);

  // Filter products
  const filteredProducts = (loaderData?.products || []).filter((p: Product) => 
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

  const handleManualSortOrderChange = async (value: boolean) => {
    setManualSortOrder(value);
    setActionMessage(value ? 
      "Updating collection to Manual sort order..." : 
      "Updating collection to Best Selling order...");
    
    const formData = new FormData();
    formData.append("intent", "update-manual-sort-order");
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

  // Type-safe handleAddProduct function
  const handleAddProduct = (product: Product) => {
    const newProduct: Product = {
      ...product,
      featuredType: "manual" as const,
      scheduleApplied: false,
      position: featuredProducts.length
    };
    
    const newFeaturedProducts = [...featuredProducts, newProduct];
    setFeaturedProducts(newFeaturedProducts);
    setSearchQuery("");
    setShowDropdown(false);
  };

  const handleRemoveProduct = (id: string) => {
    const newFeaturedProducts = featuredProducts.filter(p => p.id !== id);
    setFeaturedProducts(newFeaturedProducts);
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

  const handleImportFeaturedProductsClick = () => {
    featuredProductsFileInputRef.current?.click();
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

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setImportLoading(true);
    setActionMessage("Importing featured products...");

    const formData = new FormData();
    formData.append("intent", "import-featured-products");
    formData.append("featuredProductsFile", file);

    try {
      submit(formData, { 
        method: "POST",
        replace: true 
      });
    } catch (error) {
      console.error("Import failed:", error);
      setActionMessage("Failed to import featured products");
      setImportLoading(false);
    } finally {
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

  // Fixed: Updated handleSaveFeaturedProducts to properly handle loading state
  const handleSaveFeaturedProducts = () => {
    setIsSaving(true);
    setActionMessage("Saving featured products...");
    
    const formData = new FormData();
    formData.append("intent", "save-featured-products");
    formData.append("featuredProducts", JSON.stringify(featuredProducts));
    formData.append("limitFeatured", limitFeatured);
    
    submit(formData, { 
      method: "POST",
      replace: true 
    });
  };

  const handleClearAllFeaturedProducts = () => {
    setIsSaving(true);
    setActionMessage("Clearing all featured products...");
    
    const formData = new FormData();
    formData.append("intent", "clear-all-featured-products");
    
    submit(formData, { 
      method: "POST",
      replace: true 
    });
  };

  const toastMarkup = saveSuccess ? (
    <Toast content={actionMessage || "Settings saved successfully!"} onDismiss={() => setSaveSuccess(false)} />
  ) : null;

  // Show loading state if no loaderData
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

  return (
    <Page
      title={`Featured Products: ${loaderData.collection.title}`}
      primaryAction={{
        content: "Save Featured Products",
        onAction: handleSaveFeaturedProducts,
        loading: isSaving
      }}
      secondaryActions={[
        {
          content: "Back to collections",
          onAction: () => navigate("/app/collections"),
        },
      ]}
      backAction={{ 
        content: "Collections", 
        onAction: () => navigate("/app/collections"),
      }}
    >
      <Layout>
        {/* Action Message Banner */}
        {actionMessage && (
          <Layout.Section>
            <Banner tone={saveSuccess ? "success" : actionData?.error ? "critical" : "info"}>
              <Text as="p">{actionMessage}</Text>
            </Banner>
          </Layout.Section>
        )}

        {/* Manual Sort Order Control */}
        <Layout.Section>
          <Card>
            <BlockStack gap="300">
              <Text as="h2" variant="headingMd">
                Collection Sort Order Control
              </Text>
              <Text as="p" tone="subdued">
                Enable manual sort order to feature products at the top of your collection. When disabled, the collection will use Best Selling order.
              </Text>
              <InlineStack align="space-between">
                <Checkbox
                  label="Manual Sort Order"
                  checked={manualSortOrder}
                  onChange={handleManualSortOrderChange}
                  helpText={manualSortOrder ? 
                    "✅ Collection is set to Manual sort order" : 
                    "⚠️ Collection is using Best Selling order"}
                />
                <Button
                  variant="plain"
                  onClick={() => window.open(`https://${loaderData.shopDomain}/admin/collections/${collectionId}`, '_blank')}
                >
                  View in Shopify Admin
                </Button>
              </InlineStack>
              {manualSortOrder && (
                <Banner tone="success">
                  <Text as="p">
                    ✅ This collection is set to Manual sort order. You can now organize featured products.
                  </Text>
                </Banner>
              )}
              {!manualSortOrder && (
                <Banner tone="warning">
                  <Text as="p">
                    ⚠️ This collection is not set to Manual sort order. Enable "Manual Sort Order" to use featured products.
                  </Text>
                </Banner>
              )}
            </BlockStack>
          </Card>
        </Layout.Section>

        {/* Import/Export Section */}
        <Layout.Section>
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
                  onChange={handleFileSelect}
                />
              </InlineStack>

              {selectedFile && (
                <Card>
                  <InlineStack align="space-between" blockAlign="center">
                    <InlineStack gap="200" blockAlign="center">
                      <Icon source={SearchIcon} tone="success" />
                      <Text as="span" variant="bodyMd" fontWeight="medium">
                        Selected file: {selectedFile.name}
                      </Text>
                    </InlineStack>
                    <InlineStack gap="200">
                      <Button 
                        onClick={() => handleFileUpload({ target: { files: [selectedFile] } } as any)}
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
            </BlockStack>
          </Card>
        </Layout.Section>

        {/* Search and Pagination */}
        <Layout.Section>
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
        </Layout.Section>

        {/* Search Dropdown */}
        {showDropdown && manualSortOrder && (
          <Layout.Section>
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
          </Layout.Section>
        )}

        {/* Featured Products Management */}
        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <InlineStack align="space-between">
                <Text as="h2" variant="headingMd">
                  Featured Products Management
                </Text>
                <InlineStack gap="200">
                  <Button 
                    onClick={() => setClearFeaturedModalActive(true)}
                    variant="secondary"
                    tone="critical"
                    disabled={featuredProducts.length === 0 || !manualSortOrder}
                  >
                    Remove All Featured
                  </Button>
                </InlineStack>
              </InlineStack>

              {!manualSortOrder && (
                <Banner tone="critical">
                  <Text as="p">
                    ⚠️ You cannot manage featured products because this collection is not set to Manual sort order. Please enable "Manual Sort Order" above first.
                  </Text>
                </Banner>
              )}

              <Text as="p" tone="subdued">
                Drag and drop to reorder featured products. Scheduled products will be automatically removed after the specified period.
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

              {/* Limit Featured Products */}
              <Card>
                <BlockStack gap="200">
                  <Text as="h3" variant="headingSm">
                    Limit Featured Products
                  </Text>
                  <Text as="p" tone="subdued">
                    Maximum number of featured products to display at the top of your collection. 
                    Products beyond this limit will appear in their regular position in the collection.
                    Set to 0 to show all featured products at the top.
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
                      helpText={
                        parseInt(limitFeatured) > 0 ? 
                          `Only first ${limitFeatured} featured products will be displayed at the top of collection` : 
                          "All featured products will be displayed at the top of collection"
                      }
                    />
                  </Box>
                </BlockStack>
              </Card>

              {/* Featured Products List */}
              <BlockStack gap="400">
                <Text as="h3" variant="headingSm">
                  Featured Products ({featuredProducts.length})
                  {parseInt(limitFeatured) > 0 && 
                    ` • First ${Math.min(featuredProducts.length, parseInt(limitFeatured))} displayed at top`}
                  {parseInt(limitFeatured) > 0 && featuredProducts.length > parseInt(limitFeatured) && 
                    ` • ${featuredProducts.length - parseInt(limitFeatured)} beyond limit in regular position`}
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
                          draggable={!isBeyondLimit && manualSortOrder}
                          onDragStart={(e) => !isBeyondLimit && manualSortOrder && handleDragStart(e, product.id)}
                          onDragOver={!isBeyondLimit && manualSortOrder ? handleDragOver : undefined}
                          onDrop={!isBeyondLimit && manualSortOrder ? (e) => handleDrop(e, product.id) : undefined}
                          style={{
                            cursor: (!isBeyondLimit && manualSortOrder) ? 'grab' : 'not-allowed',
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
                                {!isBeyondLimit && manualSortOrder && <Icon source={DragHandleIcon} />}
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
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>

      {/* Remove All Featured Products Modal */}
      <Modal
        open={clearFeaturedModalActive}
        onClose={() => setClearFeaturedModalActive(false)}
        title="Remove All Featured Products?"
        primaryAction={{
          content: "Yes, Remove All",
          onAction: handleClearAllFeaturedProducts,
          loading: isSaving,
          destructive: true,
        }}
        secondaryActions={[{
          content: "Cancel",
          onAction: () => setClearFeaturedModalActive(false),
        }]}
      >
        <Modal.Section>
          <Text as="p">
            This will remove all {featuredProducts.length} featured products from this collection. 
            The collection will revert to Best Selling sort order in Shopify.
          </Text>
          <Banner tone="warning">
            <Text as="p">
              <strong>Note:</strong> This action cannot be undone. All featured product data will be permanently deleted.
            </Text>
          </Banner>
        </Modal.Section>
      </Modal>

      {toastMarkup}
    </Page>
  );
};

export default FeaturedProductsPage;