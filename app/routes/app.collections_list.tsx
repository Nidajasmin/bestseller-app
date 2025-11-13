// app/routes/app.collections_list.tsx
import type { LoaderFunctionArgs, ActionFunctionArgs } from "react-router";
import { useLoaderData, useNavigate, useSubmit, useFetcher } from "react-router";
import { useState, useEffect, useMemo, useCallback } from "react";
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
  Badge,
  Listbox,
  AutoSelection,
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
  totalCollections: number;
  searchQuery?: string;
  statusFilter?: string;
}

interface ShopifyCollectionResponse {
  data?: {
    collections?: {
      edges: Array<{
        node: {
          id: string;
          title: string;
          handle: string;
          image?: { url: string };
          productsCount: { count: number };
        };
        cursor: string;
      }>;
      pageInfo: {
        hasNextPage: boolean;
        hasPreviousPage: boolean;
        startCursor?: string;
        endCursor?: string;
      };
    };
  };
  errors?: Array<{ message: string }>;
}

interface AppCollection {
  collectionId: string;
  enabled: boolean;
}

// --- Optimized Custom Toggle Component - INSTANT TOGGLE ---
const CustomToggle = ({ checked, onChange, id }: { 
  checked: boolean; 
  onChange: (id: string, value: boolean) => void; 
  id: string;
}) => {
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
          transition: 'background-color 0.1s ease',
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
            transition: 'left 0.1s ease',
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

// --- OPTIMIZED: Helper function to fetch up to 2500 collections ---
async function fetchAllCollections(admin: any, searchQuery: string = '') {
  console.log(`🔄 Fetching collections with search: "${searchQuery}"`);
  
  let allCollections: any[] = [];
  let hasNextPage = true;
  let afterCursor: string | null = null;
  const BATCH_SIZE = 250;
  const MAX_COLLECTIONS = 2500;

  const graphqlQuery = `#graphql
    query getCollections($first: Int!, $after: String, $query: String) {
      collections(first: $first, after: $after, query: $query, sortKey: TITLE) {
        pageInfo {
          hasNextPage
          endCursor
        }
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
    }`;

  try {
    let batchCount = 0;
    
    while (hasNextPage && allCollections.length < MAX_COLLECTIONS) {
      batchCount++;
      const variables: any = { first: BATCH_SIZE };
      
      if (afterCursor) {
        variables.after = afterCursor;
      }
      
      if (searchQuery && searchQuery.trim() !== '') {
        variables.query = `title:${searchQuery}*`;
      }

      const response = await admin.graphql(graphqlQuery, { variables });
      const shopifyData: ShopifyCollectionResponse = await response.json();
      
      if (shopifyData.errors) {
        console.error("🚨 GraphQL Errors:", shopifyData.errors);
        throw new Error(`GraphQL Error: ${shopifyData.errors[0]?.message || 'Unknown error'}`);
      }
      
      if (!shopifyData.data?.collections?.edges) {
        console.error("❌ Invalid response from Shopify API");
        break;
      }

      const collectionsData = shopifyData.data.collections;
      const collections = collectionsData.edges.map((edge: any) => ({
        ...edge.node,
      }));

      allCollections = [...allCollections, ...collections];
      hasNextPage = collectionsData.pageInfo?.hasNextPage || false;
      afterCursor = collectionsData.pageInfo?.endCursor || null;

      console.log(`📦 Batch ${batchCount}: Fetched ${collections.length} collections. Total: ${allCollections.length}`);
      
      // Stop when we reach 2500 collections for optimal performance
      if (allCollections.length >= MAX_COLLECTIONS) {
        console.log(`✅ Reached ${MAX_COLLECTIONS} collections limit for optimal performance`);
        break;
      }

      if (!hasNextPage) {
        break;
      }
    }

    console.log(`✅ Successfully fetched ${allCollections.length} total collections`);
    return allCollections;
    
  } catch (error) {
    console.error("❌ GraphQL request failed:", error);
    throw error;
  }
}

// --- OPTIMIZED LOADER: Fetch up to 2500 collections ---
export async function loader({ request }: LoaderFunctionArgs) {
  try {
    console.log("🚀 === COLLECTIONS LOADER STARTED ===");
    const { admin, session } = await authenticate.admin(request);
    const shopifyDomain = session.shop;

    // Get URL parameters
    const url = new URL(request.url);
    const searchQuery = url.searchParams.get('search') || '';
    const statusFilter = url.searchParams.get('status') || 'all';

    console.log("📋 LOADER PARAMETERS:", {
      search: searchQuery,
      status: statusFilter,
    });

    // Fetch collections from Shopify (up to 2500)
    const shopifyCollections = await fetchAllCollections(admin, searchQuery);
    console.log(`📦 Raw Shopify collections: ${shopifyCollections.length}`);

    // Fetch enabled collections from our database - OPTIMIZED with chunking
    let enabledCollections: AppCollection[] = [];
    if (shopifyCollections.length > 0) {
      // Process in chunks to avoid SQL parameter limits
      const chunkSize = 1000;
      const collectionIdChunks = [];
      
      for (let i = 0; i < shopifyCollections.length; i += chunkSize) {
        collectionIdChunks.push(shopifyCollections.slice(i, i + chunkSize).map((col: any) => col.id));
      }

      for (const chunk of collectionIdChunks) {
        const chunkResults = await prisma.appCollection.findMany({
          where: { 
            shopifyDomain,
            collectionId: { in: chunk }
          },
          select: { collectionId: true, enabled: true },
        });
        enabledCollections = [...enabledCollections, ...chunkResults];
      }
      
      console.log(`🔧 Found ${enabledCollections.length} enabled collections in database`);
    }

    // Create a map of collectionId -> enabled status
    const collectionStatusMap = new Map();
    enabledCollections.forEach((col: AppCollection) => {
      collectionStatusMap.set(col.collectionId, col.enabled);
    });

    // Merge the data
    let collectionsWithStatus = shopifyCollections.map((collection: any) => ({
      ...collection,
      enabled: collectionStatusMap.get(collection.id) || false,
    }));

    console.log(`🎯 Applied enabled status to ${collectionsWithStatus.length} collections`);

    // Apply status filter if provided
    if (statusFilter !== "all") {
      const filterEnabled = statusFilter === "enabled";
      const beforeFilterCount = collectionsWithStatus.length;
      collectionsWithStatus = collectionsWithStatus.filter((collection: Collection) => collection.enabled === filterEnabled);
      console.log(`🔍 Status filter "${statusFilter}": ${beforeFilterCount} -> ${collectionsWithStatus.length} collections`);
    }

    console.log("📊 FINAL LOADER RESULTS:", {
      collectionsCount: collectionsWithStatus.length,
      searchQuery,
      statusFilter
    });
    
    console.log("✅ === LOADER COMPLETED ===\n");
    
    return { 
      collections: collectionsWithStatus, 
      shopifyDomain,
      totalCollections: collectionsWithStatus.length,
      searchQuery: searchQuery || undefined,
      statusFilter: statusFilter !== 'all' ? statusFilter : undefined,
    };
  } catch (error) {
    console.error("💥 LOADER FAILED:", error);
    
    return { 
      collections: [], 
      shopifyDomain: '',
      totalCollections: 0,
    };
  }
}

// --- ACTION: Server-side data mutation - OPTIMIZED for speed ---
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

    // OPTIMIZED: Direct database operation
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
          Something went wrong. Please refresh page.
        </Text>
        <Button onClick={() => window.location.reload()}>Refresh Page</Button>
      </div>
    );
  }

  return <>{children}</>;
}

// Collection Row Component - INSTANT TOGGLE with optimistic updates
function CollectionRow({ 
  collection, 
  shopifyDomain, 
  onToggleChange, 
  position,
  serialNumber
}: { 
  collection: Collection; 
  shopifyDomain: string;
  onToggleChange: (id: string, value: boolean) => void;
  position: number;
  serialNumber: number;
}) {
  const fetcher = useFetcher();
  const navigate = useNavigate();
  const { id, title, handle, image, productsCount, enabled } = collection;
  const numericId = id.split('/').pop();
  
  // Use optimistic UI - immediately show the new state when toggling
  const [optimisticEnabled, setOptimisticEnabled] = useState(enabled);

  // Reset optimistic state when collection prop changes
  useEffect(() => {
    setOptimisticEnabled(enabled);
  }, [enabled]);

  const handleToggle = (id: string, newValue: boolean) => {
    // INSTANT UI update
    setOptimisticEnabled(newValue);
    
    const formData = new FormData();
    formData.append("id", id);
    formData.append("enabled", newValue.toString());
    
    // Submit in background - no loading state
    fetcher.submit(formData, {
      method: "POST",
      action: "/app/collections_list",
    });
  };

  return (
    <IndexTable.Row id={id} key={id} position={position}>
      <IndexTable.Cell>
        <Text as="span" variant="bodySm" fontWeight="medium" tone="subdued">
          {serialNumber}
        </Text>
      </IndexTable.Cell>
      <IndexTable.Cell>
        <Thumbnail
          source={image?.url || "https://cdn.shopify.com/s/files/1/0533/2089/files/placeholder-images-collection_small.png"}
          alt={title}
          size="small"
        />
      </IndexTable.Cell>
      <IndexTable.Cell>
        <CustomToggle 
          checked={optimisticEnabled} 
          onChange={handleToggle} 
          id={id}
        />
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
          {optimisticEnabled && (
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
          disabled={!optimisticEnabled}
          onClick={() => navigate(`/app/collection-sort/${numericId}`)}
        />
      </IndexTable.Cell>
    </IndexTable.Row>
  );
}

// Search with Suggestions Component - OPTIMIZED for 2500+ collections
function SearchWithSuggestions({ 
  searchQuery, 
  setSearchQuery, 
  collections, 
  onSearchSubmit 
}: { 
  searchQuery: string;
  setSearchQuery: (value: string) => void;
  collections: Collection[];
  onSearchSubmit: (query: string) => void;
}) {
  const [suggestions, setSuggestions] = useState<Collection[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [selectedSuggestionIndex, setSelectedSuggestionIndex] = useState(-1);

  // OPTIMIZED search suggestions with debouncing
  useEffect(() => {
    if (searchQuery.trim().length > 1) {
      const timer = setTimeout(() => {
        // Use efficient filtering for large datasets
        const query = searchQuery.toLowerCase();
        const filtered: Collection[] = [];
        
        // Early termination after 8 matches for performance
        for (let i = 0; i < collections.length && filtered.length < 8; i++) {
          const collection = collections[i];
          if (
            collection.title.toLowerCase().includes(query) ||
            collection.handle.toLowerCase().includes(query)
          ) {
            filtered.push(collection);
          }
        }
        
        setSuggestions(filtered);
        setShowSuggestions(true);
      }, 30); // Minimal debounce for instant feel
      
      return () => clearTimeout(timer);
    } else {
      setSuggestions([]);
      setShowSuggestions(false);
    }
  }, [searchQuery, collections]);

  const handleInputChange = useCallback((value: string) => {
    setSearchQuery(value);
    setSelectedSuggestionIndex(-1);
  }, [setSearchQuery]);

  const handleSuggestionSelect = useCallback((collection: Collection) => {
    setSearchQuery(collection.title);
    setShowSuggestions(false);
    onSearchSubmit(collection.title);
  }, [setSearchQuery, onSearchSubmit]);

  const handleKeyDown = useCallback((event: React.KeyboardEvent) => {
    if (event.key === 'Enter') {
      if (selectedSuggestionIndex >= 0 && suggestions[selectedSuggestionIndex]) {
        handleSuggestionSelect(suggestions[selectedSuggestionIndex]);
      } else {
        onSearchSubmit(searchQuery);
      }
      setShowSuggestions(false);
    } else if (event.key === 'ArrowDown') {
      event.preventDefault();
      setSelectedSuggestionIndex(prev => 
        prev < suggestions.length - 1 ? prev + 1 : prev
      );
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setSelectedSuggestionIndex(prev => prev > 0 ? prev - 1 : -1);
    } else if (event.key === 'Escape') {
      setShowSuggestions(false);
      setSelectedSuggestionIndex(-1);
    }
  }, [selectedSuggestionIndex, suggestions, handleSuggestionSelect, onSearchSubmit, searchQuery]);

  const handleBlur = useCallback(() => {
    setTimeout(() => setShowSuggestions(false), 200);
  }, []);

  const handleFocus = useCallback(() => {
    if (searchQuery.length > 1) {
      setShowSuggestions(true);
    }
  }, [searchQuery.length]);

  const handleClear = useCallback(() => {
    setSearchQuery('');
    setShowSuggestions(false);
    onSearchSubmit('');
  }, [setSearchQuery, onSearchSubmit]);

  return (
    <div style={{ position: 'relative', width: '400px' }}>
      <div onKeyDown={handleKeyDown}>
        <TextField
          label="Search collections"
          labelHidden={true}
          placeholder="Search by collection title or handle..."
          value={searchQuery}
          onChange={handleInputChange}
          onBlur={handleBlur}
          onFocus={handleFocus}
          autoComplete="off"
          prefix={<Icon source={SearchIcon} />}
          clearButton={true}
          onClearButtonClick={handleClear}
        />
      </div>
      
      {showSuggestions && suggestions.length > 0 && (
        <div style={{
          position: 'absolute',
          top: '100%',
          left: 0,
          right: 0,
          backgroundColor: 'white',
          border: '1px solid #e1e3e5',
          borderRadius: '8px',
          boxShadow: '0 4px 12px rgba(0, 0, 0, 0.1)',
          zIndex: 1000,
          maxHeight: '300px',
          overflowY: 'auto',
          marginTop: '4px'
        }}>
          <Listbox autoSelection={AutoSelection.None}>
            {suggestions.map((collection, index) => (
              <Listbox.Option
                key={collection.id}
                value={collection.id}
                selected={index === selectedSuggestionIndex}
              >
                <div
                  onMouseEnter={() => setSelectedSuggestionIndex(index)}
                  onMouseLeave={() => setSelectedSuggestionIndex(-1)}
                  onClick={() => handleSuggestionSelect(collection)}
                  style={{ 
                    padding: '12px', 
                    cursor: 'pointer',
                    backgroundColor: index === selectedSuggestionIndex ? '#f6f6f7' : 'transparent',
                    borderBottom: index < suggestions.length - 1 ? '1px solid #f1f1f1' : 'none'
                  }}
                >
                  <InlineStack align="space-between" blockAlign="center">
                    <Text as="span" variant="bodyMd" fontWeight="medium">
                      {collection.title}
                    </Text>
                   <Badge tone="info">
                    {collection.productsCount.count.toString()} products
                  </Badge>
                  </InlineStack>
                  <Text as="p" variant="bodySm" tone="subdued">
                    {collection.handle}
                  </Text>
                </div>
              </Listbox.Option>
            ))}
          </Listbox>
        </div>
      )}
    </div>
  );
}

// Main Component - OPTIMIZED for 2500+ collections
function CollectionListPageContent() {
  const { 
    collections: initialCollections, 
    shopifyDomain, 
    totalCollections,
    searchQuery: initialSearchQuery,
    statusFilter: initialStatusFilter,
  } = useLoaderData<LoaderData>();
  const navigate = useNavigate();

  const [toastActive, setToastActive] = useState(false);
  const [toastMessage, setToastMessage] = useState("");
  const [resortModalActive, setResortModalActive] = useState(false);
  const [selectedCollection, setSelectedCollection] = useState<string | null>(null);
  
  // State for search and filter
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [isHydrated, setIsHydrated] = useState(false);

  // Fix hydration issues
  useEffect(() => {
    setIsHydrated(true);
    setSearchQuery(initialSearchQuery || "");
    setStatusFilter(initialStatusFilter || "all");
  }, [initialSearchQuery, initialStatusFilter]);

  // OPTIMIZED Client-side filtering with useMemo for 2500+ collections
  const filteredCollections = useMemo(() => {
    if (!initialCollections.length) return [];

    let filtered = initialCollections;

    // Apply search filter - optimized for large datasets
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter(collection => 
        collection.title.toLowerCase().includes(query) ||
        collection.handle.toLowerCase().includes(query)
      );
    }

    // Apply status filter
    if (statusFilter !== "all") {
      const filterEnabled = statusFilter === "enabled";
      filtered = filtered.filter(collection => collection.enabled === filterEnabled);
    }

    return filtered;
  }, [initialCollections, searchQuery, statusFilter]);

  // Handle search submission
  const handleSearchSubmit = useCallback((query: string = searchQuery) => {
    const params = new URLSearchParams();
    
    if (query.trim()) {
      params.set("search", query.trim());
    } else {
      params.delete("search");
    }
    
    if (statusFilter !== "all") {
      params.set("status", statusFilter);
    } else {
      params.delete("status");
    }
    
    navigate(`?${params.toString()}`, { replace: true });
  }, [searchQuery, statusFilter, navigate]);

  // Handle status filter change
  const handleStatusChange = useCallback((value: string) => {
    setStatusFilter(value);
    
    const params = new URLSearchParams();
    
    if (value !== "all") {
      params.set("status", value);
    } else {
      params.delete("status");
    }
    
    if (searchQuery) params.set("search", searchQuery);
    
    navigate(`?${params.toString()}`, { replace: true });
  }, [searchQuery, navigate]);

  const handleResortConfirm = async () => {
    if (!selectedCollection) return;
    
    setResortModalActive(false);
    
    try {
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
        setToastMessage("Collection re-sorted successfully!");
        setToastActive(true);
      } else {
        setToastMessage("Failed to re-sort collection");
        setToastActive(true);
      }
    } catch (error) {
      setToastMessage("Error re-sorting collection");
      setToastActive(true);
    }
  };

  // Calculate serial numbers
  const rows = filteredCollections.map((collection, index) => (
    <CollectionRow
      key={collection.id}
      collection={collection}
      shopifyDomain={shopifyDomain}
      onToggleChange={() => {}} // Empty function since handled in CollectionRow
      position={index}
      serialNumber={index + 1}
    />
  ));

  const toastMarkup = toastActive ? (
    <Toast content={toastMessage} onDismiss={() => setToastActive(false)} duration={3000} />
  ) : null;

  if (!isHydrated) {
    return (
      <Frame>
        <Page title="Collections">
          <Layout>
            <Layout.Section>
              <Card>
                <div style={{ padding: '40px', textAlign: 'center' }}>
                  <Text as="p" variant="bodyMd">Loading collections...</Text>
                </div>
              </Card>
            </Layout.Section>
          </Layout>
        </Page>
      </Frame>
    );
  }

  return (
    <Frame>
      <Page 
        title="Collections" 
        subtitle="Manage which collections are sorted by app."
        primaryAction={{
          content: 'Refresh',
          icon: RefreshIcon,
          onAction: () => {
            window.location.reload();
          },
        }}
      >
        <Layout>
          <Layout.Section>
            <Card>
              {/* Search and Controls Section */}
              <Box padding="400" borderBlockEndWidth="025" borderColor="border">
                <BlockStack gap="300">
                  {/* Top Row: Search and Controls */}
                  <InlineStack align="space-between" blockAlign="center" gap="400">
                    {/* Search with Suggestions */}
                    <InlineStack gap="200" blockAlign="center">
                      <SearchWithSuggestions
                        searchQuery={searchQuery}
                        setSearchQuery={setSearchQuery}
                        collections={initialCollections}
                        onSearchSubmit={handleSearchSubmit}
                      />
                      <Button onClick={() => handleSearchSubmit()}>
                        Search
                      </Button>
                    </InlineStack>
                    
                    {/* Controls Group */}
                    <InlineStack gap="300" blockAlign="center">
                      {/* Status filter */}
                      <InlineStack gap="100" blockAlign="center">
                        <Text as="span" variant="bodySm" tone="subdued">
                          Status:
                        </Text>
                        <div style={{ width: '130px' }}>
                          <Select
                            label="Filter by status"
                            labelHidden
                            options={[
                              { label: 'All statuses', value: 'all' },
                              { label: 'Enabled', value: 'enabled' },
                              { label: 'Disabled', value: 'disabled' },
                            ]}
                            onChange={handleStatusChange}
                            value={statusFilter}
                          />
                        </div>
                      </InlineStack>

                      {/* Collection count badge */}
                      <InlineStack gap="200" blockAlign="center">
                        <Badge tone="info">
                          {filteredCollections.length.toString()} of {initialCollections.length.toString()} collections
                        </Badge>
                      </InlineStack>
                    </InlineStack>
                  </InlineStack>

                  {/* Information Row */}
                  <InlineStack align="space-between" blockAlign="center">
                    <Text as="p" variant="bodySm" tone="subdued">
                      {searchQuery && `Search: "${searchQuery}" • `}
                      {statusFilter !== "all" && `Filter: ${statusFilter} • `}
                      Showing {filteredCollections.length} collections
                      {filteredCollections.length !== initialCollections.length && 
                        ` (filtered from ${initialCollections.length} total)`
                      }
                    </Text>
                    
                    {/* Performance info */}
                    <Text as="span" variant="bodySm" tone="subdued">
                      {initialCollections.length} collections loaded • Instant search
                    </Text>
                  </InlineStack>
                </BlockStack>
              </Box>

              <IndexTable
                resourceName={{ singular: "collection", plural: "collections" }}
                itemCount={filteredCollections.length}
                selectable={false}
                headings={[
                  { title: "S.No" },
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
                      {searchQuery || statusFilter !== "all" 
                        ? "No collections match your current filters." 
                        : "No collections found in your store."}
                    </Text>
                    {(searchQuery || statusFilter !== "all") && (
                      <Box paddingBlockStart="400">
                        <Button onClick={() => {
                          setSearchQuery('');
                          setStatusFilter('all');
                          handleSearchSubmit('');
                        }}>
                          Clear filters
                        </Button>
                      </Box>
                    )}
                  </div>
                }
              >
                {rows}
              </IndexTable>

              {/* Statistics Footer */}
              {filteredCollections.length > 0 && (
                <Box padding="400" borderBlockStartWidth="025" borderColor="border">
                  <InlineStack align="space-between" blockAlign="center">
                    <Text as="p" tone="subdued" variant="bodySm">
                      <strong>Last updated:</strong> {new Date().toLocaleString()}
                    </Text>
                    <Text as="p" tone="subdued" variant="bodySm">
                      {filteredCollections.length} collections • {initialCollections.length} total loaded • Instant filtering
                    </Text>
                  </InlineStack>
                </Box>
              )}
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