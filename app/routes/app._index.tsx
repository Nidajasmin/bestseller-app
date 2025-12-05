// app/routes/app.collections_list.tsx
import type { LoaderFunctionArgs, ActionFunctionArgs } from "react-router";
import { useLoaderData, useNavigate, useSubmit, useFetcher, useNavigation } from "react-router";
import { useState, useEffect, useMemo, useCallback, useRef } from "react";
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
  Spinner,
  Popover,
  ActionList,
  EmptySearchResult,
  Filters,
} from "@shopify/polaris";
import {
  ViewIcon,
  EditIcon,
  RefreshIcon,
  SettingsIcon,
  SearchIcon,
  ChevronDownIcon,
  SortIcon,
  FilterIcon,
} from "@shopify/polaris-icons";
import { authenticate } from "../shopify.server";
import { AppLogger } from "../utils/logging";

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

// --- OPTIMIZED: Helper function to fetch up to 2500 collections ---
async function fetchAllCollections(admin: any, searchQuery: string = '') {
  AppLogger.info('[COLLECTIONS_LIST] Fetching collections from Shopify', { searchQuery });
  
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

      AppLogger.debug('[COLLECTIONS_LIST] Fetching collections batch', {
        batch: batchCount,
        afterCursor: afterCursor ? 'yes' : 'no'
      });

      const response = await admin.graphql(graphqlQuery, { variables });
      const shopifyData: ShopifyCollectionResponse = await response.json();
      
      if (shopifyData.errors) {
        AppLogger.error('[COLLECTIONS_LIST] GraphQL errors in collections query', { errors: shopifyData.errors });
        throw new Error(`GraphQL Error: ${shopifyData.errors[0]?.message || 'Unknown error'}`);
      }
      
      if (!shopifyData.data?.collections?.edges) {
        AppLogger.error('[COLLECTIONS_LIST] Invalid response from Shopify API');
        break;
      }

      const collectionsData = shopifyData.data.collections;
      const collections = collectionsData.edges.map((edge: any) => ({
        ...edge.node,
      }));

      allCollections = [...allCollections, ...collections];
      hasNextPage = collectionsData.pageInfo?.hasNextPage || false;
      afterCursor = collectionsData.pageInfo?.endCursor || null;

      AppLogger.debug('[COLLECTIONS_LIST] Collections batch processed', {
        batch: batchCount,
        collectionsInBatch: collections.length,
        totalCollections: allCollections.length
      });
      
      // Stop when we reach 2500 collections for optimal performance
      if (allCollections.length >= MAX_COLLECTIONS) {
        AppLogger.info('[COLLECTIONS_LIST] Reached maximum collections limit', { maxCollections: MAX_COLLECTIONS });
        break;
      }

      if (!hasNextPage) {
        break;
      }
    }

    AppLogger.info('[COLLECTIONS_LIST] Collections fetch completed', { totalCollections: allCollections.length });
    return allCollections;
    
  } catch (error) {
    AppLogger.error('[COLLECTIONS_LIST] GraphQL request failed for collections', error, { searchQuery });
    throw error;
  }
}

// --- OPTIMIZED LOADER: Fetch up to 2500 collections ---
export async function loader({ request }: LoaderFunctionArgs) {
  try {
    AppLogger.info("[COLLECTIONS_LIST] Collections loader started");
    const { admin, session } = await authenticate.admin(request);
    const { shop: shopifyDomain, accessToken } = session;

    // Get URL parameters
    const url = new URL(request.url);
    const searchQuery = url.searchParams.get('search') || '';
    const statusFilter = url.searchParams.get('status') || 'all';

    AppLogger.info("[COLLECTIONS_LIST] Loader parameters", {
      search: searchQuery,
      status: statusFilter,
      shopifyDomain
    });

    // Ensure Shop record exists in loader
    try {
      // FIX: Check if accessToken exists before using it
      if (!accessToken) {
        throw new Error("Access token is required but not available");
      }
      
      await prisma.shop.upsert({
        where: { shopifyDomain },
        update: { 
          accessToken: accessToken, // Now guaranteed to be a string
          updatedAt: new Date()
        },
        create: { 
          shopifyDomain,
          accessToken: accessToken, // Now guaranteed to be a string
        }
      });
      AppLogger.info('[COLLECTIONS_LIST] Shop record ensured', { shopifyDomain });
    } catch (shopError) {
      AppLogger.error('[COLLECTIONS_LIST] Failed to ensure shop record', shopError, { shopifyDomain });
      throw new Error(`Shop record creation failed: ${shopError instanceof Error ? shopError.message : 'Unknown error'}`);
    }

    // Fetch collections from Shopify (up to 2500)
    const shopifyCollections = await fetchAllCollections(admin, searchQuery);
    AppLogger.info(`[COLLECTIONS_LIST] Raw Shopify collections loaded`, { count: shopifyCollections.length });

    // Fetch enabled collections from our database - OPTIMIZED with chunking
    let enabledCollections: AppCollection[] = [];
    if (shopifyCollections.length > 0) {
      // Process in chunks to avoid SQL parameter limits
      const chunkSize = 1000;
      const collectionIdChunks = [];
      
      for (let i = 0; i < shopifyCollections.length; i += chunkSize) {
        collectionIdChunks.push(shopifyCollections.slice(i, i + chunkSize).map((col: any) => col.id));
      }

      AppLogger.info('[COLLECTIONS_LIST] Fetching enabled collections from database in chunks', {
        chunks: collectionIdChunks.length,
        chunkSize
      });

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
      
      AppLogger.info(`[COLLECTIONS_LIST] Enabled collections found in database`, { count: enabledCollections.length });
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

    AppLogger.info(`[COLLECTIONS_LIST] Applied enabled status to collections`, { count: collectionsWithStatus.length });

    // Apply status filter if provided
    if (statusFilter !== "all") {
      const filterEnabled = statusFilter === "enabled";
      const beforeFilterCount = collectionsWithStatus.length;
      collectionsWithStatus = collectionsWithStatus.filter((collection: Collection) => collection.enabled === filterEnabled);
      AppLogger.info(`[COLLECTIONS_LIST] Status filter applied`, {
        statusFilter,
        beforeFilter: beforeFilterCount,
        afterFilter: collectionsWithStatus.length
      });
    }

    AppLogger.info("[COLLECTIONS_LIST] Loader completed successfully", {
      collectionsCount: collectionsWithStatus.length,
      searchQuery,
      statusFilter
    });
    
    return { 
      collections: collectionsWithStatus, 
      shopifyDomain,
      totalCollections: collectionsWithStatus.length,
      searchQuery: searchQuery || undefined,
      statusFilter: statusFilter !== 'all' ? statusFilter : undefined,
    };
  } catch (error) {
    AppLogger.error("[COLLECTIONS_LIST] Collections loader failed", error);
    
    return { 
      collections: [], 
      shopifyDomain: '',
      totalCollections: 0,
    };
  }
}

// --- ACTION: Server-side data mutation - FIXED for Shop relation ---
export async function action({ request }: ActionFunctionArgs) {
  AppLogger.info("[COLLECTIONS_LIST] Collections action function called");
  
  try {
    const { admin, session } = await authenticate.admin(request);
    const { shop: shopifyDomain, accessToken } = session;

    const formData = await request.formData();
    const collectionId = formData.get("id") as string;
    const enabled = formData.get("enabled") === "true";

    AppLogger.info("[COLLECTIONS_LIST] Action received data", {
      shopifyDomain, 
      collectionId, 
      enabled
    });

    if (!collectionId) {
      AppLogger.error("[COLLECTIONS_LIST] Collection ID is required in action");
      return new Response(JSON.stringify({ 
        success: false, 
        error: "Collection ID is required" 
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // FIX: Ensure Shop record exists with accessToken
    try {
      // Check if accessToken exists before using it
      if (!accessToken) {
        return new Response(JSON.stringify({ 
          success: false, 
          error: "Access token is required but not available" 
        }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      
      await prisma.shop.upsert({
        where: { shopifyDomain },
        update: { 
          accessToken: accessToken, // Now guaranteed to be a string
          updatedAt: new Date()
        },
        create: { 
          shopifyDomain,
          accessToken: accessToken, // Now guaranteed to be a string
        }
      });

      AppLogger.info('[COLLECTIONS_LIST] Shop record ensured', { shopifyDomain });
    } catch (shopError) {
      AppLogger.error('[COLLECTIONS_LIST] Failed to ensure shop record', shopError, { shopifyDomain });
      return new Response(JSON.stringify({ 
        success: false, 
        error: `Shop record creation failed: ${shopError instanceof Error ? shopError.message : 'Unknown error'}`
      }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Now upsert the AppCollection
    try {
      const result = await prisma.appCollection.upsert({
        where: {
          shopifyDomain_collectionId: { shopifyDomain, collectionId }
        },
        update: { enabled },
        create: { 
          shopifyDomain, 
          collectionId, 
          enabled,
        }
      });
      
      AppLogger.info('[COLLECTIONS_LIST] Database operation successful', {
        appCollectionId: result.id,
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
      AppLogger.error('[COLLECTIONS_LIST] Database operation failed in action', error, { collectionId, enabled });
      return new Response(JSON.stringify({ 
        success: false, 
        error: 'Failed to update collection in database: ' + (error instanceof Error ? error.message : 'Unknown error')
      }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }

  } catch (error) {
    AppLogger.error("[COLLECTIONS_LIST] Collections action failed", error);
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
      AppLogger.error('[COLLECTIONS_LIST] Global error caught in Collections error boundary', {
        error: error.error?.message,
        filename: error.filename,
        lineno: error.lineno,
        colno: error.colno
      });
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

// Loading Overlay Component
function LoadingOverlay({ isLoading }: { isLoading: boolean }) {
  if (!isLoading) return null;

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: 'rgba(255, 255, 255, 0.9)',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        alignItems: 'center',
        zIndex: 1000,
      }}
    >
      <div style={{ textAlign: 'center', marginBottom: '16px' }}>
        <Spinner size="large" />
      </div>
      <Text as="p" variant="bodyMd" alignment="center">
        Refreshing collections...
      </Text>
    </div>
  );
}

// Elegant Status Badge Component
function StatusBadge({ enabled }: { enabled: boolean }) {
  return (
    <Badge 
      tone={enabled ? "success" : "critical"} 
      size="small"
      progress={enabled ? "complete" : "incomplete"}
    >
      {enabled ? 'Active' : 'Inactive'}
    </Badge>
  );
}

// Enhanced Toggle Switch Component
function ToggleSwitch({ 
  enabled, 
  onToggle,
  loading = false
}: { 
  enabled: boolean; 
  onToggle: () => void;
  loading?: boolean;
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
      <button
        onClick={onToggle}
        disabled={loading}
        style={{
          width: '44px',
          height: '24px',
          backgroundColor: enabled ? '#008060' : '#e1e3e5',
          borderRadius: '12px',
          position: 'relative',
          cursor: loading ? 'not-allowed' : 'pointer',
          border: 'none',
          padding: 0,
          transition: 'all 0.2s ease',
          opacity: loading ? 0.6 : 1,
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
            left: enabled ? '22px' : '2px',
            transition: 'left 0.2s ease, transform 0.2s ease',
            boxShadow: '0 1px 3px rgba(0, 0, 0, 0.2)',
            transform: loading ? 'scale(0.9)' : 'scale(1)',
          }}
        />
      </button>
      {loading && <Spinner size="small" />}
    </div>
  );
}

// CollectionRow Component - ENHANCED DESIGN
function CollectionRow({ 
  collection, 
  shopifyDomain, 
  position,
  serialNumber
}: { 
  collection: Collection; 
  shopifyDomain: string;
  position: number;
  serialNumber: number;
}) {
  const fetcher = useFetcher();
  const navigate = useNavigate();
  const { id, title, handle, image, productsCount, enabled } = collection;
  const numericId = id.split('/').pop();
  
  const [optimisticEnabled, setOptimisticEnabled] = useState(enabled);
  const [showError, setShowError] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [popoverActive, setPopoverActive] = useState(false);
  
  // Reset optimistic state when collection prop changes
  useEffect(() => {
    setOptimisticEnabled(enabled);
    setShowError(false);
  }, [enabled]);

  // Handle fetcher state changes
  useEffect(() => {
    if (fetcher.data) {
      if (fetcher.data.success) {
        AppLogger.info('[COLLECTIONS_LIST] Toggle action successful', {
          collectionId: id,
          enabled: optimisticEnabled
        });
        setShowError(false);
      } else {
        // Server returned an error - revert optimistic update
        AppLogger.error('[COLLECTIONS_LIST] Toggle action failed', {
          collectionId: id,
          error: fetcher.data.error
        });
        setOptimisticEnabled(enabled); // Revert to original state
        setErrorMessage(fetcher.data.error || "Failed to update collection");
        setShowError(true);
        
        // Hide error after 5 seconds
        const timer = setTimeout(() => setShowError(false), 5000);
        return () => clearTimeout(timer);
      }
    }
  }, [fetcher.data, id, enabled, optimisticEnabled]);

  const handleToggle = (id: string, newValue: boolean) => {
    AppLogger.info('[COLLECTIONS_LIST] Collection toggle triggered', {
      collectionId: id,
      collectionTitle: title,
      from: optimisticEnabled,
      to: newValue
    });

    // INSTANT UI update
    setOptimisticEnabled(newValue);
    setShowError(false);
    
    const formData = new FormData();
    formData.append("id", id);
    formData.append("enabled", newValue.toString());
    
    // Submit in background - no loading state
    // FIX: Removed the action parameter to submit to the current route
    fetcher.submit(formData, {
      method: "POST",
    });
  };

  const handleEditInShopify = () => {
    AppLogger.info('[COLLECTIONS_LIST] Edit collection in Shopify clicked', { collectionId: id, title });
    window.open(`https://admin.shopify.com/store/${shopifyDomain.replace('.myshopify.com', '')}/collections/${numericId}`, '_blank');
  };

  const handleViewInStore = () => {
    AppLogger.info('[COLLECTIONS_LIST] View collection in store clicked', { collectionId: id, title });
    // ENHANCED: Use proper online store URL with parameters like the example
    const storeUrl = `https://${shopifyDomain}/collections/${handle}?_pos=1&_psq=${encodeURIComponent(title)}&_ss=e&_v=1.0`;
    window.open(storeUrl, '_blank');
  };

  const togglePopoverActive = useCallback(() => {
    setPopoverActive(!popoverActive);
  }, [popoverActive]);

  const handleMenuAction = useCallback((action: string) => {
    // Close popover immediately
    setPopoverActive(false);
    
    // Use setTimeout to ensure popover closes before navigation
    setTimeout(() => {
      switch(action) {
        case 'featured-products':
          AppLogger.info('[COLLECTIONS_LIST] Navigate to Featured Products', { collectionId: id, title });
          navigate(`/app/featured-products/${numericId}`);
          break;
        case 'collection-sorting':
          AppLogger.info('[COLLECTIONS_LIST] Navigate to Collection Sorting', { collectionId: id, title });
          navigate(`/app/collection-sorting/${numericId}`);
          break;
        case 'manage-tag':
          AppLogger.info('[COLLECTIONS_LIST] Navigate to Manage Tag', { collectionId: id, title });
          navigate(`/app/manage-tags/${numericId}`);
          break;
        default:
          console.warn('Unknown menu action:', action);
          break;
      }
    }, 10);
  }, [id, title, numericId, navigate]);

  const activator = (
    <Button
      size="slim"
      variant="primary"
      tone="success"
      icon={SettingsIcon}
      onClick={togglePopoverActive}
      disabled={!optimisticEnabled}
    >
      Configure
    </Button>
  );

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
          size="medium"
        />
      </IndexTable.Cell>
      <IndexTable.Cell>
        <BlockStack gap="100">
          <Text as="span" variant="bodyMd" fontWeight="semibold">{title}</Text>
        </BlockStack>
      </IndexTable.Cell>
      <IndexTable.Cell>
        <Badge tone="info" size="small">
          {`${productsCount.count} ${productsCount.count === 1 ? 'product' : 'products'}`}
        </Badge>
      </IndexTable.Cell>
      <IndexTable.Cell>
        <BlockStack gap="100">
          <StatusBadge enabled={optimisticEnabled} />
          <ToggleSwitch 
            enabled={optimisticEnabled}
            onToggle={() => handleToggle(id, !optimisticEnabled)}
            loading={fetcher.state !== 'idle'}
          />
          {showError && (
            <Text as="span" variant="bodySm" tone="critical">
              {errorMessage}
            </Text>
          )}
        </BlockStack>
      </IndexTable.Cell>
      <IndexTable.Cell>
        <InlineStack gap="100">
          <Tooltip content="Edit in Shopify Admin">
            <Button
              size="slim" 
              variant="plain" 
              icon={EditIcon}
              onClick={handleEditInShopify}
            />
          </Tooltip>
          <Tooltip content="View in Online Store">
            <Button
              size="slim" 
              variant="plain" 
              icon={ViewIcon}
              onClick={handleViewInStore}
            />
          </Tooltip>
        </InlineStack>
      </IndexTable.Cell>
      <IndexTable.Cell>
        <Popover
          active={popoverActive}
          activator={activator}
          onClose={togglePopoverActive}
          preferredAlignment="right"
          preferredPosition="below"
        >
          <ActionList
            actionRole="menuitem"
            items={[
              {
                content: 'Featured Products',
                onAction: () => handleMenuAction('featured-products'),
              },
              {
                content: 'Collection Sorting',
                onAction: () => handleMenuAction('collection-sorting'),
              },
              {
                content: 'Manage Tag',
                onAction: () => handleMenuAction('manage-tag'),
              },
            ]}
          />
        </Popover>
      </IndexTable.Cell>
    </IndexTable.Row>
  );
}

// Enhanced Search and Filter Component
function EnhancedSearchFilters({ 
  searchQuery, 
  setSearchQuery, 
  statusFilter,
  onStatusChange,
  onSearchSubmit,
  onClearFilters,
  collectionsCount,
  totalCollections
}: { 
  searchQuery: string;
  setSearchQuery: (value: string) => void;
  statusFilter: string;
  onStatusChange: (value: string) => void;
  onSearchSubmit: (query: string) => void;
  onClearFilters: () => void;
  collectionsCount: number;
  totalCollections: number;
}) {
  const [queryValue, setQueryValue] = useState(searchQuery);

  const handleQueryChange = useCallback((value: string) => {
    setQueryValue(value);
    setSearchQuery(value);
  }, [setSearchQuery]);

  const handleQueryClear = useCallback(() => {
    setQueryValue('');
    setSearchQuery('');
    onSearchSubmit('');
  }, [setSearchQuery, onSearchSubmit]);

  const handleStatusChange = useCallback((value: string) => {
    onStatusChange(value);
  }, [onStatusChange]);

  const filters = [
    {
      key: 'status',
      label: 'Status',
      filter: (
        <Select
          label="Collection status"
          labelHidden
          options={[
            { label: 'All statuses', value: 'all' },
            { label: 'Active', value: 'enabled' },
            { label: 'Inactive', value: 'disabled' },
          ]}
          value={statusFilter}
          onChange={handleStatusChange}
        />
      ),
      shortcut: true,
    },
  ];

  const appliedFilters = [];
  if (statusFilter !== 'all') {
    appliedFilters.push({
      key: 'status',
      label: `Status: ${statusFilter === 'enabled' ? 'Active' : 'Inactive'}`,
      onRemove: () => onStatusChange('all'),
    });
  }
  if (searchQuery) {
    appliedFilters.push({
      key: 'search',
      label: `Search: "${searchQuery}"`,
      onRemove: handleQueryClear,
    });
  }

  return (
    <div style={{ width: '100%' }}>
      <Filters
        queryValue={queryValue}
        queryPlaceholder="Search collections by title or handle..."
        filters={filters}
        appliedFilters={appliedFilters}
        onQueryChange={handleQueryChange}
        onQueryClear={handleQueryClear}
        onClearAll={onClearFilters}
      >
        <div style={{ padding: '16px 0' }}>
          <InlineStack align="space-between" blockAlign="center">
            <Button variant="primary" onClick={() => onSearchSubmit(queryValue)}>
              Apply Search
            </Button>
            <InlineStack gap="200" blockAlign="center">
              <Badge tone="info">
                {`${collectionsCount} of ${totalCollections} collections`}
              </Badge>
            </InlineStack>
          </InlineStack>
        </div>
      </Filters>
    </div>
  );
}

// Enhanced Empty State Component - FIXED TypeScript errors
function EnhancedEmptyState({ 
  searchQuery, 
  statusFilter, 
  onClearFilters 
}: { 
  searchQuery: string; 
  statusFilter: string; 
  onClearFilters: () => void;
}) {
  const hasFilters = searchQuery || statusFilter !== 'all';

  if (hasFilters) {
    return (
      <div style={{ padding: '40px', textAlign: 'center' }}>
        <EmptySearchResult
          title="No collections found"
          description="No collections match your current filters. Try changing your search or filters."
          withIllustration
        />
        <Box paddingBlockStart="400">
          <Button onClick={onClearFilters}>
            Clear all filters
          </Button>
        </Box>
      </div>
    );
  }

  return (
    <div style={{ padding: '40px', textAlign: 'center' }}>
      <div style={{ marginBottom: '16px' }}>
        <Text as="p" variant="bodyMd" tone="subdued">
          No collections found in your store.
        </Text>
      </div>
      <Text as="p" variant="bodySm" tone="subdued">
        Collections from your Shopify store will appear here once they are synced.
      </Text>
    </div>
  );
}

// Main Component - ENHANCED DESIGN for 2500+ collections
function CollectionListPageContent() {
  const { 
    collections: initialCollections, 
    shopifyDomain, 
    totalCollections,
    searchQuery: initialSearchQuery,
    statusFilter: initialStatusFilter,
  } = useLoaderData<LoaderData>();
  const navigate = useNavigate();
  const navigation = useNavigation();
  const submit = useSubmit();

  const [toastActive, setToastActive] = useState(false);
  const [toastMessage, setToastMessage] = useState("");
  const [resortModalActive, setResortModalActive] = useState(false);
  const [selectedCollection, setSelectedCollection] = useState<string | null>(null);
  
  // State for search and filter
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [isHydrated, setIsHydrated] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);

  // ADD COMPONENT MOUNT LOGGING
  useEffect(() => {
    AppLogger.info('[COLLECTIONS_LIST] CollectionsListPageContent component mounted', {
      initialCollectionsCount: initialCollections.length,
      initialSearchQuery,
      initialStatusFilter
    });
  }, []);

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

    AppLogger.debug('[COLLECTIONS_LIST] Client-side filtering applied', {
      searchQuery,
      statusFilter,
      beforeFilter: initialCollections.length,
      afterFilter: filtered.length
    });

    return filtered;
  }, [initialCollections, searchQuery, statusFilter]);

  // Handle refresh WITHOUT full page reload
  const handleRefresh = useCallback(() => {
    AppLogger.info('[COLLECTIONS_LIST] Manual refresh triggered');
    setIsRefreshing(true);
    
    // Use React Router's navigation to refresh the data without full page reload
    navigate('.', { 
      replace: true,
      preventScrollReset: true 
    });
    
    // Reset refreshing state after a short delay
    const timer = setTimeout(() => {
      setIsRefreshing(false);
      AppLogger.info('[COLLECTIONS_LIST] Refresh completed');
    }, 1500);

    return () => clearTimeout(timer);
  }, [navigate]);

  // Handle search submission
  const handleSearchSubmit = useCallback((query: string = searchQuery) => {
    AppLogger.info('[COLLECTIONS_LIST] Collections search submitted', { query, statusFilter });
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
    AppLogger.info('[COLLECTIONS_LIST] Collections status filter changed', { from: statusFilter, to: value });
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
    
    AppLogger.info('[COLLECTIONS_LIST] Collection resort confirmed', { collectionId: selectedCollection });
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
        AppLogger.info('[COLLECTIONS_LIST] Collection resort successful', { collectionId: selectedCollection });
        setToastMessage("Collection re-sorted successfully!");
        setToastActive(true);
      } else {
        AppLogger.error('[COLLECTIONS_LIST] Collection resort failed', { collectionId: selectedCollection, status: response.status });
        setToastMessage("Failed to re-sort collection");
        setToastActive(true);
      }
    } catch (error) {
      AppLogger.error('[COLLECTIONS_LIST] Collection resort error', error, { collectionId: selectedCollection });
      setToastMessage("Error re-sorting collection");
      setToastActive(true);
    }
  };

  const handleClearFilters = () => {
    AppLogger.info('[COLLECTIONS_LIST] Clear filters clicked');
    setSearchQuery('');
    setStatusFilter('all');
    handleSearchSubmit('');
  };

  // Calculate serial numbers
  const rows = filteredCollections.map((collection, index) => (
    <CollectionRow
      key={collection.id}
      collection={collection}
      shopifyDomain={shopifyDomain}
      position={index}
      serialNumber={index + 1}
    />
  ));

  const toastMarkup = toastActive ? (
    <Toast content={toastMessage} onDismiss={() => setToastActive(false)} duration={3000} />
  ) : null;

  // Show loading only during manual refresh
  const showLoading = isRefreshing;

  if (!isHydrated) {
    return (
      <Frame>
        <Page title="Collections">
          <Layout>
            <Layout.Section>
              <Card>
                <div style={{ padding: '40px', textAlign: 'center' }}>
                  <Spinner size="large" />
                  <Box padding="400">
                    <Text as="p" variant="bodyMd">Loading collections...</Text>
                  </Box>
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
      <LoadingOverlay isLoading={showLoading} />
      <Page 
        title="Collections" 
        subtitle="Manage and configure your store collections"
        primaryAction={{
          content: 'Refresh Collections',
          icon: RefreshIcon,
          onAction: handleRefresh,
          disabled: isRefreshing,
        }}
        secondaryActions={[
            {
              content: 'View Documentation',
              onAction: () => window.open(`https://help.shopify.com/en?shop=${shopifyDomain}`, '_blank'),
            },
          ]}
      >
        <Layout>
          <Layout.Section>
            <Card>
              {/* Enhanced Search and Filters Section */}
              <Box padding="400" borderBlockEndWidth="025" borderColor="border">
                <EnhancedSearchFilters
                  searchQuery={searchQuery}
                  setSearchQuery={setSearchQuery}
                  statusFilter={statusFilter}
                  onStatusChange={handleStatusChange}
                  onSearchSubmit={handleSearchSubmit}
                  onClearFilters={handleClearFilters}
                  collectionsCount={filteredCollections.length}
                  totalCollections={initialCollections.length}
                />
              </Box>

              {/* Enhanced Table */}
              <IndexTable
                resourceName={{ singular: "collection", plural: "collections" }}
                itemCount={filteredCollections.length}
                selectable={false}
                headings={[
                  { title: "#", hidden: false },
                  { title: "Image", hidden: false },
                  { title: "Collection", hidden: false },
                  { title: "Products", hidden: false },
                  { title: "Status", hidden: false },
                  { title: "Quick Actions", hidden: false },
                  { title: "Configuration", hidden: false },
                ]}
                emptyState={
                  <EnhancedEmptyState
                    searchQuery={searchQuery}
                    statusFilter={statusFilter}
                    onClearFilters={handleClearFilters}
                  />
                }
                condensed={false}
              >
                {rows}
              </IndexTable>

              {/* Enhanced Statistics Footer - FIXED TypeScript errors */}
              {filteredCollections.length > 0 && (
                <Box padding="400" borderBlockStartWidth="025" borderColor="border">
                  <InlineStack align="space-between" blockAlign="center">
                    <Text as="p" tone="subdued" variant="bodySm">
                      <strong>Last updated:</strong> {new Date().toLocaleString()}
                    </Text>
                    <InlineStack gap="400" blockAlign="center">
                      <Badge tone="info">
                        {`${filteredCollections.length} collections`}
                      </Badge>
                      <Badge tone="success">
                        {`${initialCollections.filter(c => c.enabled).length} active`}
                      </Badge>
                      <Badge tone="critical">
                        {`${initialCollections.filter(c => !c.enabled).length} inactive`}
                      </Badge>
                    </InlineStack>
                  </InlineStack>
                </Box>
              )}
            </Card>
          </Layout.Section>
        </Layout>

        <Modal
          open={resortModalActive}
          onClose={() => {
            AppLogger.info('[COLLECTIONS_LIST] Resort modal closed');
            setResortModalActive(false);
          }}
          title="Re-Sort products?"
          primaryAction={{ 
            content: "Yes, re-Sort", 
            onAction: handleResortConfirm,
          }}
          secondaryActions={[{ 
            content: "Cancel", 
            onAction: () => {
              AppLogger.info('[COLLECTIONS_LIST] Resort modal cancelled');
              setResortModalActive(false);
            } 
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