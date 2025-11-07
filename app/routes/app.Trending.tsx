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
  Button,
  Spinner,
  Box,
  InlineStack,
  BlockStack,
  TextField,
  Pagination,
  Icon,
} from '@shopify/polaris';
import { useLoaderData, useSubmit, useNavigate, type LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { fetchAllProducts, fetchProductSalesData } from "../lib/shopify";
import { SearchIcon } from '@shopify/polaris-icons';

interface TrendingProduct {
  id: string;
  position: number;
  previousPosition: number;
  trend: string;
  image: string;
  title: string;
  price: string;
  orders: number;
  sales: number;
  revenue: string;
  isNew: boolean;
  inStock: number;
  created: string;
}

interface SalesData {
  sales: number;
  revenue: number;
}

interface LoaderData {
  products: any[];
  trendingData: {
    currentPeriod: Map<string, SalesData>;
    previousPeriod: Map<string, SalesData>;
  } | null;
  productsCount: number;
  currentPage: number;
  hasNextPage: boolean;
  hasPreviousPage: boolean;
  searchQuery: string;
}

// Loader function to fetch real data with pagination
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin } = await authenticate.admin(request);
  const url = new URL(request.url);
  
  const selectedPeriod = 7; // Fixed to 7 days
  const productsCount = parseInt(url.searchParams.get("count") || "250");
  const page = parseInt(url.searchParams.get("page") || "1");
  const searchQuery = url.searchParams.get("search") || "";
  const after = url.searchParams.get("after") || null;

  try {
    // Fetch products with pagination and sales data for current period (last 7 days)
    const [productsData, currentSalesData] = await Promise.all([
      fetchAllProducts(admin, productsCount, after),
      fetchProductSalesData(admin, selectedPeriod)
    ]);

    // Fetch sales data for previous period (7-14 days ago) for trend comparison
    const previousSalesData = await fetchProductSalesData(admin, selectedPeriod * 2);

    if (productsData?.data?.products && productsData.data.products.edges.length > 0) {
      const products = productsData.data.products.edges.map((edge: any) => edge.node);

      return {
        products,
        trendingData: {
          currentPeriod: currentSalesData,
          previousPeriod: previousSalesData
        },
        productsCount,
        currentPage: page,
        hasNextPage: productsData.data.products.pageInfo?.hasNextPage || false,
        hasPreviousPage: productsData.data.products.pageInfo?.hasPreviousPage || false,
        searchQuery,
        endCursor: productsData.data.products.pageInfo?.endCursor,
      };
    }
    
    return { 
      products: [], 
      trendingData: null, 
      productsCount,
      currentPage: page,
      hasNextPage: false,
      hasPreviousPage: false,
      searchQuery,
    };

  } catch (error) {
    console.error('Error in Trending loader:', error);
    return { 
      products: [], 
      trendingData: null, 
      productsCount,
      currentPage: page,
      hasNextPage: false,
      hasPreviousPage: false,
      searchQuery,
    };
  }
};

export default function TrendingPage() {
  const { 
    products = [], 
    trendingData, 
    productsCount: initialCount = 250,
    currentPage: initialPage,
    hasNextPage,
    hasPreviousPage,
    searchQuery: initialSearch
  } = useLoaderData<LoaderData>();
  
  const submit = useSubmit();
  const navigate = useNavigate();
  
  const [trendingProducts, setTrendingProducts] = useState<TrendingProduct[]>([]);
  const [loading, setLoading] = useState(false);
  const [productsCount, setProductsCount] = useState(initialCount);
  const [currentPage, setCurrentPage] = useState(initialPage);
  const [searchQuery, setSearchQuery] = useState(initialSearch);

  useEffect(() => {
    processTrendingData();
  }, [products, trendingData, productsCount, currentPage, searchQuery]);

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
        
        submit(params, { replace: true });
      }
    }, 500);

    return () => clearTimeout(timer);
  }, [searchQuery, submit]);

  const processTrendingData = () => {
    if (!trendingData || products.length === 0) {
      setTrendingProducts([]);
      return;
    }

    const trendingProductsData: TrendingProduct[] = [];

    products.forEach((product: any) => {
      const mainVariant = product.variants?.edges[0]?.node;
      const price = mainVariant?.price || '0.00';
      const basePrice = parseFloat(price);
      const inventory = product.totalInventory || 0;
      
      // Get current period sales data
      const currentData = trendingData.currentPeriod.get(product.id) || { sales: 0, revenue: 0 };
      const previousData = trendingData.previousPeriod.get(product.id) || { sales: 0, revenue: 0 };

      // Skip products with no sales in current period
      if (currentData.sales === 0) {
        return;
      }

      // Filter by search query if provided
      if (searchQuery && !product.title.toLowerCase().includes(searchQuery.toLowerCase())) {
        return;
      }

      // Calculate orders (estimate orders from sales)
      const orders = Math.ceil(currentData.sales / 2); // Assuming average 2 items per order

      const isNew = isProductNew(product.createdAt, 7);
      
      // Calculate trend based on sales comparison with previous period
      let trend = '→'; // neutral
      let previousPosition = 0;

      if (currentData.sales > previousData.sales * 1.2) {
        trend = '↑'; // trending up
      } else if (currentData.sales < previousData.sales * 0.8) {
        trend = '↓'; // trending down
      }

      trendingProductsData.push({
        id: product.id,
        position: 0, // Will be set after sorting
        previousPosition: 0, // Will be calculated based on previous period ranking
        trend,
        image: product.featuredImage?.url || '',
        title: product.title,
        price: `$${basePrice.toFixed(2)}`,
        orders,
        sales: currentData.sales,
        revenue: `$${currentData.revenue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
        isNew,
        inStock: inventory,
        created: new Date(product.createdAt).toLocaleDateString('en-US', {
          year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
        }).replace(',', ''),
      });
    });

    // Sort by sales in descending order and assign positions
    const sortedProducts = trendingProductsData.sort((a, b) => b.sales - a.sales);

    // FIXED: Proper position calculation without NaN
    const finalProducts = sortedProducts.map((product, index) => {
      // Calculate position starting from 1 for the current page
      const position = index + 1;
      
      // Calculate previous position
      const previousPosition = calculatePreviousPosition(product.id, sortedProducts, trendingData.previousPeriod);
      
      return {
        ...product,
        position: position,
        previousPosition: previousPosition
      };
    });

    console.log('Processed trending products:', finalProducts); // Debug log
    setTrendingProducts(finalProducts);
    setLoading(false);
  };

  const calculatePreviousPosition = (productId: string, allProducts: TrendingProduct[], previousSalesData: Map<string, SalesData>): number => {
    if (!previousSalesData) return 0;
    
    // Create array of all products with their previous period sales
    const productsWithPreviousSales = allProducts.map(product => ({
      id: product.id,
      sales: previousSalesData.get(product.id)?.sales || 0
    }));

    // Filter out products with no previous sales
    const productsWithSales = productsWithPreviousSales.filter(product => product.sales > 0);
    
    if (productsWithSales.length === 0) return 0;

    // Sort by previous period sales in descending order
    const sortedByPreviousSales = productsWithSales.sort((a, b) => b.sales - a.sales);
    
    // Find position in previous period (1-based index)
    const previousIndex = sortedByPreviousSales.findIndex(product => product.id === productId);
    
    return previousIndex >= 0 ? previousIndex + 1 : 0;
  };

  const isProductNew = (createdAt: string, period: number): boolean => {
    const createdDate = new Date(createdAt);
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - period);
    return createdDate > cutoffDate;
  };

  const handleCountChange = (value: string) => {
    const newCount = parseInt(value);
    setProductsCount(newCount);
    setLoading(true);
    
    const params = new URLSearchParams(window.location.search);
    params.set("count", value);
    params.set("page", "1"); // Reset to first page when count changes
    
    submit(params, { replace: true });
  };

  const handlePageChange = (page: number) => {
    setCurrentPage(page);
    setLoading(true);
    
    const params = new URLSearchParams(window.location.search);
    params.set("page", page.toString());
    
    navigate(`?${params.toString()}`, { replace: true });
  };

  const refreshData = () => {
    setLoading(true);
    // Force reload by submitting current parameters
    const params = new URLSearchParams(window.location.search);
    params.set("count", productsCount.toString());
    params.set("page", currentPage.toString());
    submit(params, { replace: true });
  };

  const downloadCSV = () => {
    const headers = ['Trend', 'Position', 'Previous Position', 'Image', 'Title', 'Price', '# of Orders', '# of Sales', 'Revenue', 'New', 'In Stock', 'Created'];
    const csvData = trendingProducts.map(product => [
      product.trend,
      product.position,
      product.previousPosition > 0 ? product.previousPosition.toString() : '--',
      '',
      product.title,
      product.price.replace('$', ''),
      product.orders,
      product.sales,
      product.revenue.replace('$', '').replace(',', ''),
      product.isNew ? 'yes' : 'no',
      product.inStock,
      product.created
    ]);

    const csvContent = [
      headers.join(','),
      ...csvData.map(row => row.join(','))
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `trending-products-7days.csv`;
    a.click();
    window.URL.revokeObjectURL(url);
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

  const rows = trendingProducts.map((product) => [
    <Text as="span" fontWeight="bold" key="trend">{product.trend}</Text>,
    <Text as="span" key="position">{product.position}</Text>,
    <Text as="span" key="previous">{product.previousPosition > 0 ? product.previousPosition.toString() : '--'}</Text>,
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
    <Text as="span" key="orders">{product.orders}</Text>,
    <Text as="span" key="sales">{product.sales}</Text>,
    <Text as="span" fontWeight="bold" key="revenue">{product.revenue}</Text>,
    <Badge tone={product.isNew ? 'success' : 'info'} key="new">{product.isNew ? 'yes' : 'no'}</Badge>,
    <Text as="span" key="stock">{product.inStock}</Text>,
    <Text as="span" key="created">{product.created}</Text>,
  ]);

  // Always show pagination when there are products
  const showPagination = trendingProducts.length > 0;

  return (
    <Page
      title="Trending within 7 days"
      subtitle="Store-wide statistics for products identified as 'trending.' Trending products are those with the highest order frequency over a short period."
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

                {/* Middle Row: Information and Actions */}
                <InlineStack align="space-between" blockAlign="center">
                  <BlockStack gap="100">
                    <Text as="p" variant="bodyMd" fontWeight="medium">
                      Lookback period: 7 days
                    </Text>
                    <Text as="p" tone="subdued" variant="bodySm">
                      Showing trending products based on sales in the last 7 days.
                    </Text>
                    {searchQuery && (
                      <Text as="p" variant="bodySm" tone="subdued">
                        Searching for: "{searchQuery}" • Found {trendingProducts.length} matching products
                      </Text>
                    )}
                  </BlockStack>
                  
                  <InlineStack gap="200">
                    <Button onClick={refreshData} disabled={loading}>
                      Refresh
                    </Button>
                    <Button onClick={downloadCSV} disabled={trendingProducts.length === 0}>
                      Download (CSV)
                    </Button>
                  </InlineStack>
                </InlineStack>
              </BlockStack>
            </Box>

            {loading ? (
              <Box padding="800">
                <div style={{ textAlign: 'center' }}>
                  <Spinner size="large" />
                  <Text as="p" tone="subdued" variant="bodyMd">
                    Loading trending products...
                  </Text>
                </div>
              </Box>
            ) : trendingProducts.length > 0 ? (
              <>
                <DataTable
                  columnContentTypes={[
                    'text',
                    'numeric',
                    'numeric',
                    'text',
                    'text',
                    'numeric',
                    'numeric',
                    'numeric',
                    'numeric',
                    'text',
                    'numeric',
                    'text',
                  ]}
                  headings={[
                    'Trend',
                    'Position',
                    '7 days ago',
                    'Image',
                    'Title',
                    'Price',
                    '# of Orders',
                    '# of Sales',
                    'Revenue',
                    'New',
                    'In Stock',
                    'Created'
                  ]}
                  rows={rows}
                  footerContent={`Showing ${trendingProducts.length} trending products with sales in the last 7 days${searchQuery ? ' matching search' : ''}`}
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
                      ? `No trending products found matching "${searchQuery}".` 
                      : 'No products with sales found in the last 7 days.'
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
                <strong>Statistics as of:</strong> {new Date().toLocaleDateString('en-GB')} ({new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })} GMT - 05:00)
              </Text>
              <Text as="p" tone="subdued" variant="bodySm">
                Page {currentPage} • {productsCount} products per page • 7-day period
              </Text>
            </InlineStack>
          </Box>
        </Layout.Section>
      </Layout>
    </Page>
  );
}