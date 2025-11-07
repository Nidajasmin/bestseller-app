// app/routes/app.NewArrivals.tsx
import React, { useState, useEffect } from 'react';
import {
  Card,
  DataTable,
  Page,
  Layout,
  Text,
  Badge,
  Thumbnail,
  Select,
  Box,
  InlineStack,
  BlockStack,
  TextField,
  Pagination,
  Button,
  Icon,
  Spinner,
} from '@shopify/polaris';
import { useLoaderData, useSubmit, useNavigate, type LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { SearchIcon } from '@shopify/polaris-icons';

interface NewArrivalProduct {
  id: string;
  position: number;
  image: string;
  title: string;
  price: string;
  inStock: number;
  created: string;
  vendor: string;
  status: string;
}

interface LoaderData {
  newArrivals: NewArrivalProduct[];
  totalProducts: number;
  currentPage: number;
  hasNextPage: boolean;
  hasPreviousPage: boolean;
  selectedPeriod: string;
  productsCount: number;
  searchQuery: string;
}

// The loader now returns the data object directly
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin } = await authenticate.admin(request);
  const url = new URL(request.url);
  
  const selectedPeriod = url.searchParams.get("period") || "7";
  const productsCount = parseInt(url.searchParams.get("count") || "250");
  const page = parseInt(url.searchParams.get("page") || "1");
  const searchQuery = url.searchParams.get("search") || "";
  const after = url.searchParams.get("after") || null;

  try {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - parseInt(selectedPeriod));
    const dateFilter = `created_at:>='${cutoffDate.toISOString()}'`;
    
    // Build search query if provided
    let finalQuery = dateFilter;
    if (searchQuery) {
      finalQuery = `${dateFilter} AND title:*${searchQuery}*`;
    }

    const query = `
      query GetNewArrivals($first: Int!, $query: String, $after: String) {
        products(first: $first, query: $query, after: $after, sortKey: CREATED_AT, reverse: true) {
          pageInfo {
            hasNextPage
            hasPreviousPage
            startCursor
            endCursor
          }
          edges {
            cursor
            node {
              id
              title
              handle
              featuredImage { url altText }
              variants(first: 1) { edges { node { price inventoryQuantity } } }
              totalInventory
              createdAt
              publishedAt
              status
              vendor
            }
          }
        }
      }
    `;

    const response = await admin.graphql(query, { 
      variables: { 
        first: productsCount, 
        query: finalQuery,
        after: after 
      } 
    });
    const data = await response.json();

    if (data?.data?.products) {
      const transformedData = data.data.products.edges.map((edge: any, index: number) => {
        const product = edge.node;
        const mainVariant = product.variants?.edges[0]?.node;
        const price = mainVariant?.price || '0.00';
        const basePrice = parseFloat(price);
        const inventory = product.totalInventory || 0;
        
        return {
          id: product.id,
          position: index + 1 + ((page - 1) * productsCount),
          image: product.featuredImage?.url || '',
          title: product.title,
          price: `$${basePrice.toFixed(2)}`,
          inStock: inventory,
          created: new Date(product.createdAt).toLocaleDateString('en-US', {
            year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
          }).replace(',', ''),
          vendor: product.vendor || 'Unknown',
          status: product.status || 'ACTIVE',
        };
      });

      // CORRECTED: Return the object directly, no json() wrapper
      return {
        newArrivals: transformedData,
        totalProducts: transformedData.length,
        currentPage: page,
        hasNextPage: data.data.products.pageInfo?.hasNextPage || false,
        hasPreviousPage: data.data.products.pageInfo?.hasPreviousPage || false,
        selectedPeriod,
        productsCount,
        searchQuery,
        endCursor: data.data.products.pageInfo?.endCursor,
      };
    }
    
    return { 
      newArrivals: [], 
      totalProducts: 0,
      currentPage: page,
      hasNextPage: false,
      hasPreviousPage: false,
      selectedPeriod, 
      productsCount,
      searchQuery,
    };

  } catch (error) {
    console.error('Error in loader:', error);
    return { 
      newArrivals: [], 
      totalProducts: 0,
      currentPage: page,
      hasNextPage: false,
      hasPreviousPage: false,
      selectedPeriod, 
      productsCount,
      searchQuery,
    };
  }
};

export default function NewArrivalsPage() {
  // CORRECTED: Destructure with default values to handle undefined
  const { 
    newArrivals = [], 
    totalProducts,
    currentPage: initialPage,
    hasNextPage,
    hasPreviousPage,
    selectedPeriod: initialPeriod = "7", 
    productsCount: initialCount = 250,
    searchQuery: initialSearch
  } = useLoaderData<LoaderData>();
  
  const submit = useSubmit();
  const navigate = useNavigate();

  const [selectedPeriod, setSelectedPeriod] = useState(initialPeriod);
  const [productsCount, setProductsCount] = useState(initialCount);
  const [searchQuery, setSearchQuery] = useState(initialSearch);
  const [currentPage, setCurrentPage] = useState(initialPage);
  const [loading, setLoading] = useState(false);

  const periodOptions = [
    { label: 'Last 7 days', value: '7' },
    { label: 'Last 14 days', value: '14' },
    { label: 'Last 30 days', value: '30' },
    { label: 'Last 60 days', value: '60' },
    { label: 'Last 90 days', value: '90' },
  ];

  // Handle search with debounce
  useEffect(() => {
    const timer = setTimeout(() => {
      if (searchQuery !== initialSearch) {
        const params = new URLSearchParams(window.location.search);
        if (searchQuery) {
          params.set("search", searchQuery);
        } else {
          params.delete("search");
        }
        params.set("page", "1"); // Reset to first page when searching
        params.set("count", productsCount.toString());
        params.set("period", selectedPeriod);
        
        submit(params, { replace: true });
      }
    }, 500);

    return () => clearTimeout(timer);
  }, [searchQuery, submit]);

  const handlePeriodChange = (value: string) => {
    setSelectedPeriod(value);
    setLoading(true);
    
    const params = new URLSearchParams(window.location.search);
    params.set("period", value);
    params.set("page", "1"); // Reset to first page when period changes
    params.set("count", productsCount.toString());
    
    submit(params, { replace: true });
  };

  const handleCountChange = (value: string) => {
    const newCount = parseInt(value);
    setProductsCount(newCount);
    setLoading(true);
    
    const params = new URLSearchParams(window.location.search);
    params.set("count", value);
    params.set("page", "1"); // Reset to first page when count changes
    params.set("period", selectedPeriod);
    
    submit(params, { replace: true });
  };

  const handlePageChange = (page: number) => {
    setCurrentPage(page);
    setLoading(true);
    
    const params = new URLSearchParams(window.location.search);
    params.set("page", page.toString());
    params.set("count", productsCount.toString());
    params.set("period", selectedPeriod);
    
    navigate(`?${params.toString()}`, { replace: true });
  };

  const refreshData = () => {
    setLoading(true);
    // Force reload by submitting current parameters
    const params = new URLSearchParams(window.location.search);
    params.set("count", productsCount.toString());
    params.set("page", currentPage.toString());
    params.set("period", selectedPeriod);
    if (searchQuery) {
      params.set("search", searchQuery);
    }
    submit(params, { replace: true });
  };

  // Generate count options dynamically
  const generateCountOptions = () => {
    const options = [];
    
    // Add common increments
    const commonIncrements = [25, 50, 100, 250, 500];
    
    commonIncrements.forEach(count => {
      options.push({
        label: `${count} products`,
        value: count.toString()
      });
    });
    
    // Add current count if it's not in common increments
    if (!commonIncrements.includes(productsCount)) {
      options.push({
        label: `${productsCount} products`,
        value: productsCount.toString()
      });
    }
    
    // Sort by value
    return options.sort((a, b) => parseInt(a.value) - parseInt(b.value));
  };

  // CORRECTED: Explicitly type the 'product' parameter in the map function
  const rows = newArrivals.map((product: NewArrivalProduct) => [
    <Text as="span" key="position">{product.position.toString()}</Text>,
    product.image ? (
      <Thumbnail source={product.image} alt={product.title} size="small" key="image" />
    ) : (
      <Thumbnail
        source="https://cdn.shopify.com/s/files/1/0533/2089/files/placeholder-images-image_medium.png?format=webp&v=1530129081"
        alt="No image"
        size="small"
        key="image"
      />
    ),
    <Text as="span" fontWeight="medium" key="title">{product.title}</Text>,
    <Text as="span" key="price">{product.price}</Text>,
    <Text as="span" key="vendor">{product.vendor}</Text>,
    <Badge tone={product.status === 'ACTIVE' ? 'success' : 'warning'} key="status">{product.status}</Badge>,
    <Text as="span" key="stock">{product.inStock}</Text>,
    <Text as="span" key="created">{product.created}</Text>,
  ]);

  // Always show pagination when there are products
  const showPagination = newArrivals.length > 0;

  const getCurrentDateTime = (): string => {
    const now = new Date();
    return now.toLocaleDateString('en-GB', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric'
    }) + ' (' + now.toLocaleTimeString('en-GB', {
      hour: '2-digit',
      minute: '2-digit'
    }) + ' GMT - 05:00)';
  };

  return (
    <Page
      title="New Arrivals"
      subtitle={`Store products added in the last ${selectedPeriod} days`}
    >
      <Layout>
        <Layout.Section>
          <Card>
            {/* Search and Controls Section */}
            <Box padding="400" borderBlockEndWidth="025" borderColor="border">
              <BlockStack gap="400">
                {/* Top Row: Search and Count */}
                <InlineStack align="space-between" blockAlign="center">
                  <div style={{ width: '320px' }}>
                    <TextField
                      label="Search products"
                      labelHidden
                      placeholder="Search by product title..."
                      value={searchQuery}
                      onChange={setSearchQuery}
                      autoComplete="off"
                      prefix={<Icon source={SearchIcon} />}
                      clearButton
                      onClearButtonClick={() => setSearchQuery('')}
                    />
                  </div>
                  
                  <InlineStack gap="400" blockAlign="center">
                    {/* Products per page selector */}
                    <InlineStack gap="200" blockAlign="center">
                      <Text as="span" variant="bodyMd" tone="subdued">
                        Show:
                      </Text>
                      <div style={{ width: '180px' }}>
                        <Select
                          label="Products per page"
                          labelHidden
                          options={generateCountOptions()}
                          onChange={handleCountChange}
                          value={productsCount.toString()}
                        />
                      </div>
                    </InlineStack>

                    {/* Pagination - ALWAYS SHOW IN TOP RIGHT */}
                    {showPagination && (
                      <div style={{
                        backgroundColor: '#f6f6f7',
                        padding: '6px 12px',
                        borderRadius: '6px',
                        border: '1px solid #e1e3e5',
                        minWidth: '200px'
                      }}>
                        <Pagination
                          hasPrevious={hasPreviousPage}
                          onPrevious={() => handlePageChange(currentPage - 1)}
                          hasNext={hasNextPage}
                          onNext={() => handlePageChange(currentPage + 1)}
                          label={`Page ${currentPage}`}
                        />
                      </div>
                    )}
                  </InlineStack>
                </InlineStack>

                {/* Middle Row: Period and Information */}
                <InlineStack align="space-between" blockAlign="center">
                  <BlockStack gap="100">
                    <InlineStack gap="200" blockAlign="center">
                      <Text as="span" variant="bodyMd">
                        Lookback period:
                      </Text>
                      <div style={{ width: '150px' }}>
                        <Select
                          label="Period"
                          labelHidden
                          options={periodOptions}
                          onChange={handlePeriodChange}
                          value={selectedPeriod}
                        />
                      </div>
                      <Text as="span" tone="subdued" variant="bodySm">
                        {selectedPeriod} days from today
                      </Text>
                    </InlineStack>
                    
                    {searchQuery && (
                      <Text as="p" variant="bodySm" tone="subdued">
                        Searching for: "{searchQuery}" • Found {newArrivals.length} matching products
                      </Text>
                    )}
                  </BlockStack>
                  
                  <Button onClick={refreshData} disabled={loading}>
                    Refresh
                  </Button>
                </InlineStack>
              </BlockStack>
            </Box>

            {loading ? (
              <Box padding="800">
                <div style={{ textAlign: 'center' }}>
                  <Spinner size="large" />
                  <Text as="p" tone="subdued" variant="bodyMd">
                    Loading new arrivals...
                  </Text>
                </div>
              </Box>
            ) : newArrivals.length > 0 ? (
              <>
                <DataTable
                  columnContentTypes={['numeric', 'text', 'text', 'numeric', 'text', 'text', 'numeric', 'text']}
                  headings={['Position', 'Image', 'Title', 'Price', 'Vendor', 'Status', 'In Stock', 'Created']}
                  rows={rows}
                  footerContent={`Showing ${newArrivals.length} of ${totalProducts} new arrival products${searchQuery ? ' matching search' : ''}`}
                />

                {/* Bottom Pagination */}
                {showPagination && (
                  <Box padding="400">
                    <InlineStack align="center">
                      <div style={{
                        backgroundColor: '#f6f6f7',
                        padding: '8px 16px',
                        borderRadius: '8px',
                        border: '1px solid #e1e3e5'
                      }}>
                        <Pagination
                          hasPrevious={hasPreviousPage}
                          onPrevious={() => handlePageChange(currentPage - 1)}
                          hasNext={hasNextPage}
                          onNext={() => handlePageChange(currentPage + 1)}
                          label={`Page ${currentPage}`}
                        />
                      </div>
                    </InlineStack>
                  </Box>
                )}
              </>
            ) : (
              <Box padding="800">
                <div style={{ textAlign: 'center' }}>
                  <Text as="p" variant="bodyMd">
                    {searchQuery 
                      ? `No new arrivals found matching "${searchQuery}".` 
                      : 'No new products found in the selected period.'
                    }
                  </Text>
                  {searchQuery && (
                    <Box paddingBlockStart="200">
                      <Button onClick={() => setSearchQuery('')}>
                        Clear search
                      </Button>
                    </Box>
                  )}
                </div>
              </Box>
            )}
          </Card>

          {/* Statistics Footer */}
          <Box padding="400">
            <InlineStack align="space-between" blockAlign="center">
              <Text as="p" tone="subdued" variant="bodySm">
                <strong>Statistics as of:</strong> {getCurrentDateTime()}
              </Text>
              <Text as="p" tone="subdued" variant="bodySm">
                Page {currentPage} • {productsCount} products per page • {selectedPeriod}-day period
              </Text>
            </InlineStack>
          </Box>
        </Layout.Section>
      </Layout>
    </Page>
  );
}