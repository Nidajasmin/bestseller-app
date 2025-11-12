// app/routes/app.collections_list.tsx
import type { LoaderFunctionArgs, ActionFunctionArgs } from "react-router";
import { useLoaderData, useNavigate, useSubmit, useFetcher } from "react-router";
import { useState, useEffect, useMemo } from "react";
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

// --- UPDATED: Helper function to fetch ALL collections ---
async function fetchAllCollections(admin: any, searchQuery: string = '') {
  console.log(`🔄 Fetching ALL collections with search: "${searchQuery}"`);
  
  let allCollections: any[] = [];
  let hasNextPage = true;
  let afterCursor: string | null = null;
  const BATCH_SIZE = 250;

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
    while (hasNextPage) {
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

      console.log(`📦 Fetched ${collections.length} collections in this batch. Total so far: ${allCollections.length}`);
      
      // Break if we have too many collections for performance
      if (allCollections.length > 1000) {
        console.log("⚠️ Stopping at 1000 collections for performance");
        break;
      }

      // Break if no more pages
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

// --- UPDATED LOADER: Fetch ALL collections without pagination ---
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

    // Fetch ALL collections from Shopify
    const shopifyCollections = await fetchAllCollections(admin, searchQuery);
    console.log(`📦 Raw Shopify collections: ${shopifyCollections.length}`);

    // Fetch enabled collections from our database
    let enabledCollections: AppCollection[] = [];
    if (shopifyCollections.length > 0) {
      const collectionIds = shopifyCollections.map((col: any) => col.id);
      
      enabledCollections = await prisma.appCollection.findMany({
        where: { 
          shopifyDomain,
          collectionId: { in: collectionIds }
        },
        select: { collectionId: true, enabled: true },
      });
      
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
          {serialNumber.toString()}
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

// Custom TextField with keydown handler
interface CustomTextFieldProps {
  label: string;
  labelHidden: boolean;
  placeholder: string;
  value: string;
  onChange: (value: string) => void;
  onKeyDown: (event: React.KeyboardEvent) => void;
  onBlur: () => void;
  onFocus: () => void;
  autoComplete: string;
  prefix: React.ReactElement;
  clearButton: boolean;
  onClearButtonClick: () => void;
}

const CustomTextField: React.FC<CustomTextFieldProps> = ({
  label,
  labelHidden,
  placeholder,
  value,
  onChange,
  onKeyDown,
  onBlur,
  onFocus,
  autoComplete,
  prefix,
  clearButton,
  onClearButtonClick,
}) => {
  return (
    <div onKeyDown={onKeyDown}>
      <TextField
        label={label}
        labelHidden={labelHidden}
        placeholder={placeholder}
        value={value}
        onChange={onChange}
        onBlur={onBlur}
        onFocus={onFocus}
        autoComplete={autoComplete}
        prefix={prefix}
        clearButton={clearButton}
        onClearButtonClick={onClearButtonClick}
      />
    </div>
  );
};

// Custom Listbox Option with mouse events
interface CustomOptionProps {
  children: React.ReactNode;
  key: string;
  selected: boolean;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
  onClick: () => void;
}

const CustomOption: React.FC<CustomOptionProps> = ({
  children,
  key,
  selected,
  onMouseEnter,
  onMouseLeave,
  onClick,
}) => {
  return (
    <div
      key={key}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      onClick={onClick}
      style={{
        backgroundColor: selected ? '#f6f6f7' : 'transparent',
        cursor: 'pointer',
      }}
    >
      {children}
    </div>
  );
};

// Search with Suggestions Component
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

  // Generate search suggestions
  useEffect(() => {
    if (searchQuery.trim().length > 1) {
      const filtered = collections
        .filter(collection => 
          collection.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
          collection.handle.toLowerCase().includes(searchQuery.toLowerCase())
        )
        .slice(0, 8); // Limit to 8 suggestions
      setSuggestions(filtered);
      setShowSuggestions(true);
    } else {
      setSuggestions([]);
      setShowSuggestions(false);
    }
  }, [searchQuery, collections]);

  const handleInputChange = (value: string) => {
    setSearchQuery(value);
    setSelectedSuggestionIndex(-1);
  };

  const handleSuggestionSelect = (collection: Collection) => {
    setSearchQuery(collection.title);
    setShowSuggestions(false);
    onSearchSubmit(collection.title);
  };

  const handleKeyDown = (event: React.KeyboardEvent) => {
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
  };

  const handleBlur = () => {
    // Delay hiding to allow for click events
    setTimeout(() => setShowSuggestions(false), 200);
  };

  return (
    <div style={{ position: 'relative', width: '400px' }}>
      <CustomTextField
        label="Search collections"
        labelHidden={true}
        placeholder="Search by collection title or handle..."
        value={searchQuery}
        onChange={handleInputChange}
        onKeyDown={handleKeyDown}
        onBlur={handleBlur}
        onFocus={() => searchQuery.length > 1 && setShowSuggestions(true)}
        autoComplete="off"
        prefix={<Icon source={SearchIcon} />}
        clearButton={true}
        onClearButtonClick={() => {
          setSearchQuery('');
          setShowSuggestions(false);
          onSearchSubmit('');
        }}
      />
      
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
              <CustomOption
                key={collection.id}
                selected={index === selectedSuggestionIndex}
                onMouseEnter={() => setSelectedSuggestionIndex(index)}
                onMouseLeave={() => setSelectedSuggestionIndex(-1)}
                onClick={() => handleSuggestionSelect(collection)}
              >
                <div style={{ 
                  padding: '12px', 
                  cursor: 'pointer',
                  backgroundColor: index === selectedSuggestionIndex ? '#f6f6f7' : 'transparent',
                  borderBottom: index < suggestions.length - 1 ? '1px solid #f1f1f1' : 'none'
                }}>
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
              </CustomOption>
            ))}
          </Listbox>
        </div>
      )}
    </div>
  );
}

// Main Component - UPDATED with fast search and no pagination
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

  // Client-side filtering for instant results
  const filteredCollections = useMemo(() => {
    let filtered = initialCollections;

    // Apply search filter
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
  const handleSearchSubmit = (query: string = searchQuery) => {
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
  };

  // Handle status filter change
  const handleStatusChange = (value: string) => {
    setStatusFilter(value);
    
    const params = new URLSearchParams();
    
    if (value !== "all") {
      params.set("status", value);
    } else {
      params.delete("status");
    }
    
    if (searchQuery) params.set("search", searchQuery);
    
    navigate(`?${params.toString()}`, { replace: true });
  };

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
                      All {initialCollections.length} collections loaded • Instant search
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
                      {filteredCollections.length.toString()} collections • {initialCollections.length.toString()} total loaded • Instant filtering
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