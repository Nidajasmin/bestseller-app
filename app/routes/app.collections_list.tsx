import type { LoaderFunctionArgs, ActionFunctionArgs } from "react-router";
import { useLoaderData, useNavigate, useSubmit, useFetcher } from "react-router";
import { useState, useEffect } from "react";
import prisma from "../db.server";
import {
  Page,
  Layout,
  Card,
  IndexTable,
  Text,
  Thumbnail,
  InlineStack,
  BlockStack,
  Button,
  Icon,
  Tooltip,
  Modal,
  Toast,
  Frame,
  TextField,
  Select,
  Box,
} from "@shopify/polaris";
import {
  ViewIcon,
  EditIcon,
  RefreshIcon,
  SettingsIcon,
  SearchIcon,
} from "@shopify/polaris-icons";
import { authenticate } from "../shopify.server";

// --- Types ---
interface Collection {
  id: string;
  title: string;
  handle: string;
  image?: { url: string };
  productsCount: { count: number };
  enabled: boolean;
}

interface LoaderData {
  collections: Collection[];
  shopifyDomain: string;
}

// Define types for Prisma models based on your schema
interface Shop {
  shopifyDomain: string;
  accessToken: string;
  createdAt: Date;
  updatedAt: Date;
}

interface AppCollection {
  id: number;
  shopifyDomain: string;
  collectionId: string;
  enabled: boolean;
  createdAt?: Date;
  updatedAt?: Date;
}

// --- Custom Toggle Component ---
const CustomToggle = ({ checked, onChange, id }: { checked: boolean; onChange: (id: string, value: boolean) => void; id: string }) => {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
      <button
        onClick={() => onChange(id, !checked)}
        style={{
          width: '44px',
          height: '24px',
          backgroundColor: checked ? '#008060' : '#d2d6dc',
          borderRadius: '12px',
          position: 'relative',
          cursor: 'pointer',
          border: 'none',
          padding: 0,
          transition: 'background-color 0.2s ease',
        }}
      >
        <div
          style={{
            width: '20px',
            height: '20px',
            backgroundColor: 'white',
            borderRadius: '50%',
            position: 'absolute',
            top: '2px',
            left: checked ? '22px' : '2px',
            transition: 'left 0.2s ease',
            boxShadow: '0 1px 3px rgba(0, 0, 0, 0.1)',
          }}
        />
      </button>
      <Text as="span" variant="bodySm">
        {checked ? 'Enabled' : 'Disabled'}
      </Text>
    </div>
  );
};

// --- LOADER: Server-side data fetching ---
export async function loader({ request }: LoaderFunctionArgs) {
  try {
    console.log("🔍 Loader started...");
    const { admin, session } = await authenticate.admin(request);
    const shopifyDomain = session.shop;

    console.log("🛍️ Fetching collections for shop:", shopifyDomain);

    // 1. Fetch all collections from Shopify
    const response = await admin.graphql(
      `#graphql
        query getCollections {
          collections(first: 50) {
            edges {
              node {
                id
                title
                handle
                image {
                  url
                }
                productsCount {
                  count
                }
              }
            }
          }
        }`
    );
    const shopifyData = await response.json();
    
    console.log("📦 Shopify API response:", shopifyData);
    
    if (!shopifyData.data?.collections?.edges) {
      console.error("❌ Invalid response from Shopify API");
      throw new Error('Invalid response from Shopify API');
    }
    
    const allCollections = shopifyData.data.collections.edges.map((edge: any) => edge.node);
    console.log(`📊 Found ${allCollections.length} collections from Shopify`);

    // 2. Fetch enabled collections from our database
    console.log("🗄️ Fetching enabled collections from database...");
    const enabledCollections = await prisma.appCollection.findMany({
      where: { shopifyDomain },
      select: { collectionId: true, enabled: true },
    });

    console.log(`✅ Found ${enabledCollections.length} enabled collections in database`);

    // 3. Create a map of collectionId -> enabled status
    const collectionStatusMap = new Map();
    enabledCollections.forEach((col: { collectionId: string; enabled: boolean }) => {
      collectionStatusMap.set(col.collectionId, col.enabled);
    });

    // 4. Merge the data
    const collectionsWithStatus = allCollections.map((collection: any) => ({
      ...collection,
      enabled: collectionStatusMap.get(collection.id) || false,
    }));

    console.log("🎉 Loader completed successfully");
    return { collections: collectionsWithStatus, shopifyDomain };
  } catch (error) {
    console.error("❌ Loader failed:", error);
    
    // Return empty collections if there's an error but don't crash the page
    return { 
      collections: [], 
      shopifyDomain: '' 
    };
  }
}

// --- ACTION: Server-side data mutation ---
export async function action({ request }: ActionFunctionArgs) {
  console.log("🔄 ACTION FUNCTION CALLED - Processing toggle request");
  
  try {
    const { session } = await authenticate.admin(request);
    const shopifyDomain = session.shop;
    const formData = await request.formData();
    const collectionId = formData.get("id") as string;
    const enabled = formData.get("enabled") === "true";

    console.log("📥 Action received data:", { 
      shopifyDomain, 
      collectionId, 
      enabled
    });

    if (!collectionId) {
      console.error("❌ Collection ID is required");
      return new Response(JSON.stringify({ 
        success: false, 
        error: "Collection ID is required" 
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    console.log("🔍 Checking if shop exists...");
    // Ensure the Shop exists
    let shopExists = await prisma.shop.findUnique({
      where: { shopifyDomain }
    });

    if (!shopExists) {
      console.log('🏪 Creating shop record first...');
      try {
        shopExists = await prisma.shop.create({
          data: {
            shopifyDomain,
            accessToken: session.accessToken || 'temp-access-token'
          }
        });
        console.log('✅ Shop created with domain:', shopExists?.shopifyDomain);
      } catch (shopError) {
        console.error('❌ Failed to create shop:', shopError);
        // Continue anyway - might already exist due to race condition
      }
    } else {
      console.log('✅ Shop already exists with domain:', shopExists?.shopifyDomain);
    }

    console.log("💾 Upserting collection data...");
    try {
      const result = await prisma.appCollection.upsert({
        where: {
          shopifyDomain_collectionId: { shopifyDomain, collectionId }
        },
        update: { enabled },
        create: { 
          shopifyDomain, 
          collectionId, 
          enabled 
        }
      });
      
      console.log('✅ Database operation successful. AppCollection ID:', result.id);
      console.log('💾 Updated collection:', { 
        collectionId: result.collectionId, 
        enabled: result.enabled 
      });

      return new Response(JSON.stringify({ 
        success: true,
        message: `Collection ${enabled ? 'enabled' : 'disabled'} successfully`,
        data: { 
          id: result.id,
          collectionId: result.collectionId,
          enabled: result.enabled
        }
      }), {
        status: 200,
        headers: { 
          'Content-Type': 'application/json',
          'Cache-Control': 'no-cache'
        },
      });

    } catch (error) {
      console.error('❌ Database operation failed:', error);
      return new Response(JSON.stringify({ 
        success: false, 
        error: 'Failed to update collection in database: ' + (error instanceof Error ? error.message : 'Unknown error')
      }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }

  } catch (error) {
    console.error("❌ Action failed:", error);
    return new Response(JSON.stringify({ 
      success: false, 
      error: error instanceof Error ? error.message : "Failed to update collection" 
    }), {
      status: 500,
      headers: { 
        'Content-Type': 'application/json',
        'Cache-Control': 'no-cache'
      },
    });
  }
}

// Error Boundary Component
function ErrorBoundary({ children }: { children: React.ReactNode }) {
  const [hasError, setHasError] = useState(false);

  useEffect(() => {
    const handleError = (error: ErrorEvent) => {
      console.error('🔴 Global error caught:', error);
      setHasError(true);
    };

    window.addEventListener('error', handleError);
    return () => window.removeEventListener('error', handleError);
  }, []);

  if (hasError) {
    return (
      <div style={{ padding: '20px', textAlign: 'center' }}>
        <Text as="p" variant="bodyMd">
          Something went wrong. Please refresh the page.
        </Text>
        <Button onClick={() => window.location.reload()}>Refresh Page</Button>
      </div>
    );
  }

  return <>{children}</>;
}

// Collection Row Component
function CollectionRow({ collection, shopifyDomain, onToggleChange }: { 
  collection: Collection; 
  shopifyDomain: string;
  onToggleChange: (id: string, value: boolean) => void;
}) {
  const fetcher = useFetcher();
  const navigate = useNavigate();
  const { id, title, handle, image, productsCount, enabled } = collection;
  const numericId = id.split('/').pop();
  const isSubmitting = fetcher.state === 'submitting';

  // Update the toggle state based on fetcher data
  const currentEnabled = fetcher.formData 
    ? fetcher.formData.get('enabled') === 'true'
    : enabled;

  return (
    <IndexTable.Row id={id} key={id}>
      <IndexTable.Cell>
        <Thumbnail
          source={image?.url || "https://cdn.shopify.com/s/files/1/0533/2089/files/placeholder-images-collection_small.png"}
          alt={title}
          size="small"
        />
      </IndexTable.Cell>
      <IndexTable.Cell>
        <div style={{ opacity: isSubmitting ? 0.6 : 1 }}>
          <CustomToggle 
            checked={currentEnabled} 
            onChange={onToggleChange} 
            id={id} 
          />
        </div>
      </IndexTable.Cell>
      <IndexTable.Cell>
        <BlockStack gap="200">
          <Text as="span" variant="bodyMd" fontWeight="semibold">{title}</Text>
          <Text as="span" tone="subdued" variant="bodySm">{handle}</Text>
        </BlockStack>
      </IndexTable.Cell>
      <IndexTable.Cell>
        <Text as="p">{productsCount.count} products</Text>
      </IndexTable.Cell>
      <IndexTable.Cell>
        <InlineStack gap="200">
          <Tooltip content="Edit in Shopify Admin">
            <Button
              size="slim" 
              variant="plain" 
              icon={EditIcon}
              onClick={() => window.open(`https://admin.shopify.com/store/${shopifyDomain.replace('.myshopify.com', '')}/collections/${numericId}`, '_blank')}
            />
          </Tooltip>
          <Tooltip content="View in Online Store">
            <Button
              size="slim" 
              variant="plain" 
              icon={ViewIcon}
              onClick={() => window.open(`https://${shopifyDomain}/collections/${handle}`, '_blank')}
            />
          </Tooltip>
          {currentEnabled && (
            <Tooltip content="Resort Products">
              <Button
                size="slim" 
                variant="plain" 
                icon={RefreshIcon}
                onClick={() => { /* setSelectedCollection(id); setResortModalActive(true); */ }}
              />
            </Tooltip>
          )}
        </InlineStack>
      </IndexTable.Cell>
      <IndexTable.Cell>
        <Button
          size="slim"
          variant="plain"
          icon={SettingsIcon}
          disabled={!currentEnabled}
          onClick={() => navigate(`/app/collection-sort/${numericId}`)}
        />
      </IndexTable.Cell>
    </IndexTable.Row>
  );
}

// Main Component
function CollectionListPageContent() {
  const { collections: initialCollections, shopifyDomain } = useLoaderData<LoaderData>();
  const navigate = useNavigate();
  const submit = useSubmit();

  console.log("🎬 Component rendered with:", {
    initialCollectionsCount: initialCollections.length,
    shopifyDomain
  });

  const [toastActive, setToastActive] = useState(false);
  const [toastMessage, setToastMessage] = useState("");
  const [resortModalActive, setResortModalActive] = useState(false);
  const [selectedCollection, setSelectedCollection] = useState<string | null>(null);
  
  // State for search and filter
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [itemsPerPage, setItemsPerPage] = useState<number>(10);
  const [displayedCollections, setDisplayedCollections] = useState<Collection[]>(initialCollections);
  const [currentPage, setCurrentPage] = useState<number>(1);

  // Calculate paginated collections
  const startIndex = (currentPage - 1) * itemsPerPage;
  const endIndex = startIndex + itemsPerPage;
  const paginatedCollections = displayedCollections.slice(startIndex, endIndex);

  // Update displayed collections when filters change
  useEffect(() => {
    console.log("🔄 Filtering collections...", {
      initialCount: initialCollections.length,
      searchQuery,
      statusFilter,
      itemsPerPage
    });

    let filtered = initialCollections;

    // Apply search filter
    if (searchQuery) {
      filtered = filtered.filter(collection =>
        collection.title.toLowerCase().includes(searchQuery.toLowerCase())
      );
    }

    // Apply status filter
    if (statusFilter !== "all") {
      const filterEnabled = statusFilter === "enabled";
      filtered = filtered.filter(collection => collection.enabled === filterEnabled);
    }

    console.log(`📊 Filtered to ${filtered.length} collections`);
    setDisplayedCollections(filtered);
    setCurrentPage(1); // Reset to first page when filters change
  }, [initialCollections, searchQuery, statusFilter]);

  const handleToggleChange = (id: string, value: boolean) => {
    console.log("🔄 Toggle change requested:", { id, value });
    
    // Use submit to trigger the action
    const formData = new FormData();
    formData.append("id", id);
    formData.append("enabled", value.toString());
    
    submit(formData, {
      method: "POST",
      action: "/app/collections_list",
    });

    // Show optimistic update message
    setToastMessage(`Collection ${value ? 'enabled' : 'disabled'} successfully!`);
    setToastActive(true);
  };

  const handleResortConfirm = async () => {
    if (!selectedCollection) return;
    
    setResortModalActive(false);
    
    try {
      console.log("🔄 Resorting collection:", selectedCollection);
      // Call your resort API endpoint
      const response = await fetch('/app/api/resort-collection', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          collectionId: selectedCollection,
          shopDomain: shopifyDomain
        })
      });

      if (response.ok) {
        console.log("✅ Collection re-sorted successfully");
        setToastMessage("Collection re-sorted successfully!");
        setToastActive(true);
      } else {
        console.error("❌ Failed to re-sort collection");
        setToastMessage("Failed to re-sort collection");
        setToastActive(true);
      }
    } catch (error) {
      console.error('🔴 Resort error:', error);
      setToastMessage("Error re-sorting collection");
      setToastActive(true);
    }
  };

  // Status filter options
  const statusOptions = [
    { label: 'All statuses', value: 'all' },
    { label: 'Enabled', value: 'enabled' },
    { label: 'Disabled', value: 'disabled' },
  ];

  // Items per page options
  const pageSizeOptions = [
    { label: '2 items', value: '2' },
    { label: '5 items', value: '5' },
    { label: '10 items', value: '10' },
    { label: '20 items', value: '20' },
    { label: '50 items', value: '50' },
  ];

  const rows = paginatedCollections.map((collection, index) => (
    <CollectionRow
      key={collection.id}
      collection={collection}
      shopifyDomain={shopifyDomain}
      onToggleChange={handleToggleChange}
    />
  ));

  const toastMarkup = toastActive ? (
    <Toast content={toastMessage} onDismiss={() => setToastActive(false)} />
  ) : null;

  return (
    <Frame>
      <Page 
        title="Collections" 
        subtitle="Manage which collections are sorted by the app."
        primaryAction={{
          content: 'Refresh',
          icon: RefreshIcon,
          onAction: () => {
            console.log("🔄 Manual refresh requested");
            window.location.reload();
          },
        }}
      >
        <Layout>
          <Layout.Section>
            <Card>
              {/* Search and Filter Section */}
              <Box padding="400">
                <InlineStack align="space-between" blockAlign="center">
                  <InlineStack gap="400" blockAlign="center">
                    <div style={{ width: '300px' }}>
                      <TextField
                        label="Search collections"
                        labelHidden
                        placeholder="Search by collection title..."
                        value={searchQuery}
                        onChange={setSearchQuery}
                        autoComplete="off"
                        prefix={<Icon source={SearchIcon} />}
                      />
                    </div>
                    <div style={{ width: '200px' }}>
                      <Select
                        label="Filter by status"
                        labelHidden
                        options={statusOptions}
                        value={statusFilter}
                        onChange={setStatusFilter}
                      />
                    </div>
                    <div style={{ width: '150px' }}>
                      <Select
                        label="Items per page"
                        labelHidden
                        options={pageSizeOptions}
                        value={itemsPerPage.toString()}
                        onChange={(value) => setItemsPerPage(parseInt(value))}
                      />
                    </div>
                  </InlineStack>
                </InlineStack>

                {/* Pagination Controls */}
                {displayedCollections.length > itemsPerPage && (
                  <Box paddingBlockStart="400">
                    <InlineStack align="center" gap="400">
                      <Button
                        size="slim"
                        disabled={currentPage === 1}
                        onClick={() => setCurrentPage(currentPage - 1)}
                      >
                        Previous
                      </Button>
                      <Text as="span" variant="bodyMd">
                        Page {currentPage} of {Math.ceil(displayedCollections.length / itemsPerPage)}
                      </Text>
                      <Button
                        size="slim"
                        disabled={currentPage >= Math.ceil(displayedCollections.length / itemsPerPage)}
                        onClick={() => setCurrentPage(currentPage + 1)}
                      >
                        Next
                      </Button>
                    </InlineStack>
                  </Box>
                )}
              </Box>

              <IndexTable
                resourceName={{ singular: "collection", plural: "collections" }}
                itemCount={paginatedCollections.length}
                selectable={false}
                headings={[
                  { title: "Image" },
                  { title: "Status" },
                  { title: "Collection" },
                  { title: "Products" },
                  { title: "Actions" },
                  { title: "Configure" },
                ]}
                emptyState={
                  <div style={{ padding: '40px', textAlign: 'center' }}>
                    <Text as="p" variant="bodyMd">
                      No collections found matching your search criteria.
                    </Text>
                  </div>
                }
              >
                {rows}
              </IndexTable>
            </Card>
          </Layout.Section>
        </Layout>

        <Modal
          open={resortModalActive}
          onClose={() => setResortModalActive(false)}
          title="Re-Sort products?"
          primaryAction={{ 
            content: "Yes, re-Sort", 
            onAction: handleResortConfirm,
          }}
          secondaryActions={[{ 
            content: "Cancel", 
            onAction: () => setResortModalActive(false) 
          }]}
        >
          <Modal.Section>
            <Text as="p">
              This will re-sort the products in this collection according to your current rules. 
              This action cannot be undone.
            </Text>
          </Modal.Section>
        </Modal>

        {toastMarkup}
      </Page>
    </Frame>
  );
}

// Main export with Error Boundary
export default function CollectionListPage() {
  return (
    <ErrorBoundary>
      <CollectionListPageContent />
    </ErrorBoundary>
  );
}