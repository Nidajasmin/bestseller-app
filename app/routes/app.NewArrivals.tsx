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
  createdAt: string;
  salesLast60Days: number;
  totalSales: number;
  revenue: number;
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
  endCursor?: string;
  startCursor?: string;
  totalRevenue: number;
  totalSalesCount: number;
  hasMoreProducts: boolean;
}

// GraphQL query to fetch orders for sales data
const GET_ALL_ORDERS = `#graphql
  query GetAllOrders($first: Int!, $after: String) {
    orders(first: $first, after: $after, query: "financial_status:paid", sortKey: PROCESSED_AT, reverse: true) {
      pageInfo {
        hasNextPage
        endCursor
      }
      edges {
        node {
          id
          processedAt
          lineItems(first: 100) {
            edges {
              node {
                product {
                  id
                }
                quantity
                originalTotalSet {
                  shopMoney {
                    amount
                    currencyCode
                  }
                }
              }
            }
          }
        }
      }
    }
  }
`;

// Function to fetch ALL products with pagination
async function fetchAllProducts(admin: any, query: string) {
  try {
    console.log(`📦 Fetching ALL products with query: ${query}`);
    
    const allProducts: any[] = [];
    let after: string | null = null;
    let hasNextPage = true;
    let pageCount = 0;
    const MAX_PAGES = 50; // Increased limit for "All" option

    while (hasNextPage && pageCount < MAX_PAGES) {
      pageCount++;
      
      const productsQuery = `
        query GetNewArrivals($first: Int!, $query: String, $after: String) {
          products(first: $first, query: $query, after: $after, sortKey: CREATED_AT, reverse: true) {
            pageInfo {
              hasNextPage
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

      const response = await admin.graphql(productsQuery, {
        variables: {
          first: 250, // Fetch in chunks of 250
          query: query,
          after: after
        }
      });
      
      const data = await response.json();
      
      if (data.errors || !data.data?.products?.edges) {
        console.error('❌ Error fetching products data:', data.errors);
        break;
      }

      const products = data.data.products.edges.map((edge: any) => edge.node);
      allProducts.push(...products);

      console.log(`📦 Fetched ${products.length} products (page ${pageCount}, total: ${allProducts.length})`);

      hasNextPage = data.data.products.pageInfo?.hasNextPage || false;
      after = data.data.products.pageInfo?.endCursor;
      
      if (!hasNextPage) break;
      
      // Small delay to avoid rate limiting
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    console.log(`✅ Total products fetched: ${allProducts.length}`);
    return {
      products: allProducts,
      hasMore: hasNextPage
    };
    
  } catch (error) {
    console.error('💥 Error fetching products:', error);
    return {
      products: [],
      hasMore: false
    };
  }
}

// Function to fetch sales data
async function fetchSalesData(admin: any): Promise<Map<string, { salesLast60Days: number; totalSales: number; revenue: number }>> {
  try {
    const salesMap = new Map();
    const sixtyDaysAgo = new Date();
    sixtyDaysAgo.setDate(sixtyDaysAgo.getDate() - 60);
    
    let after: string | null = null;
    let hasNextPage = true;
    let pageCount = 0;

    while (hasNextPage && pageCount < 20) {
      pageCount++;
      const response = await admin.graphql(GET_ALL_ORDERS, {
        variables: { first: 100, after }
      });
      
      const data = await response.json();
      
      if (data.errors || !data.data?.orders?.edges) break;

      const orders = data.data.orders.edges;

      orders.forEach((order: any) => {
        const orderDate = new Date(order.node.processedAt);
        const isRecentSale = orderDate >= sixtyDaysAgo;
        
        if (order.node.lineItems?.edges) {
          order.node.lineItems.edges.forEach((lineItem: any) => {
            if (lineItem.node.product && lineItem.node.product.id) {
              const productId = lineItem.node.product.id.replace(/^gid:\/\/shopify\/Product\//, '');
              const quantity = lineItem.node.quantity || 0;
              const revenue = parseFloat(lineItem.node.originalTotalSet?.shopMoney?.amount || '0');
              
              if (salesMap.has(productId)) {
                const existing = salesMap.get(productId);
                salesMap.set(productId, {
                  salesLast60Days: isRecentSale ? existing.salesLast60Days + quantity : existing.salesLast60Days,
                  totalSales: existing.totalSales + quantity,
                  revenue: existing.revenue + revenue,
                });
              } else {
                salesMap.set(productId, {
                  salesLast60Days: isRecentSale ? quantity : 0,
                  totalSales: quantity,
                  revenue: revenue,
                });
              }
            }
          });
        }
      });

      hasNextPage = data.data.orders.pageInfo?.hasNextPage || false;
      after = data.data.orders.pageInfo?.endCursor;
    }

    console.log(`✅ Fetched sales data for ${salesMap.size} products`);
    return salesMap;
  } catch (error) {
    console.error('Error fetching sales data:', error);
    return new Map();
  }
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin } = await authenticate.admin(request);
  const url = new URL(request.url);
  
  const selectedPeriod = url.searchParams.get("period") || "60";
  const searchQuery = url.searchParams.get("search") || "";

  console.log("🚀 Loading New Arrivals:", {
    selectedPeriod,
    searchQuery
  });

  try {
    // Fetch sales data first
    const salesData = await fetchSalesData(admin);

    // Calculate date filter based on selected period
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - parseInt(selectedPeriod));
    const dateFilter = `created_at:>='${cutoffDate.toISOString()}'`;
    
    // Build search query
    let finalQuery = dateFilter;
    if (searchQuery) {
      finalQuery = `${dateFilter} AND (title:*${searchQuery}* OR vendor:*${searchQuery}*)`;
    }

    // Fetch ALL products for the selected period
    const productsResult = await fetchAllProducts(admin, finalQuery);

    const products = productsResult.products;
    const hasMoreProducts = productsResult.hasMore;

    // Transform products with sales data
    const transformedData = products.map((product: any, index: number) => {
      const mainVariant = product.variants?.edges[0]?.node;
      const price = mainVariant?.price || '0.00';
      const basePrice = parseFloat(price);
      const inventory = product.totalInventory || 0;
      
      // Get sales data for this product
      const productId = product.id.replace(/^gid:\/\/shopify\/Product\//, '');
      const productSalesData = salesData.get(productId) || { 
        salesLast60Days: 0, 
        totalSales: 0, 
        revenue: 0 
      };

      return {
        id: product.id,
        position: index + 1,
        image: product.featuredImage?.url || '',
        title: product.title,
        price: `$${basePrice.toFixed(2)}`,
        inStock: inventory,
        created: new Date(product.createdAt).toLocaleDateString('en-US', {
          year: 'numeric', 
          month: '2-digit', 
          day: '2-digit'
        }),
        vendor: product.vendor || 'Unknown',
        status: product.status || 'ACTIVE',
        createdAt: product.createdAt,
        salesLast60Days: productSalesData.salesLast60Days,
        totalSales: productSalesData.totalSales,
        revenue: productSalesData.revenue,
      };
    });

    // Sort products: search matches first, then by creation date (newest first), then by sales
    let sortedData = [...transformedData];
    
    if (searchQuery) {
      // Boost products that match search in title
      sortedData.sort((a, b) => {
        const aTitleMatch = a.title.toLowerCase().includes(searchQuery.toLowerCase());
        const bTitleMatch = b.title.toLowerCase().includes(searchQuery.toLowerCase());
        const aVendorMatch = a.vendor.toLowerCase().includes(searchQuery.toLowerCase());
        const bVendorMatch = b.vendor.toLowerCase().includes(searchQuery.toLowerCase());
        
        // Exact title matches first
        if (aTitleMatch && !bTitleMatch) return -1;
        if (!aTitleMatch && bTitleMatch) return 1;
        
        // Vendor matches next
        if (aVendorMatch && !bVendorMatch) return -1;
        if (!aVendorMatch && bVendorMatch) return 1;
        
        // Then by creation date (newest first)
        return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      });
    } else {
      // Normal sort: newest first, then by sales (highest sales first)
      sortedData.sort((a, b) => {
        // First by creation date (newest first)
        const dateDiff = new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
        if (Math.abs(dateDiff) > 24 * 60 * 60 * 1000) {
          return dateDiff;
        }
        // Then by sales (highest sales first)
        return b.salesLast60Days - a.salesLast60Days;
      });
    }

    // Calculate totals
    const totalRevenue = sortedData.reduce((sum, p) => sum + p.revenue, 0);
    const totalSalesCount = sortedData.reduce((sum, p) => sum + p.totalSales, 0);

    return {
      newArrivals: sortedData,
      totalProducts: sortedData.length,
      currentPage: 1,
      hasNextPage: false, // Always fetch all products
      hasPreviousPage: false, // Always fetch all products
      selectedPeriod,
      productsCount: sortedData.length,
      searchQuery,
      totalRevenue,
      totalSalesCount,
      hasMoreProducts,
    };

  } catch (error) {
    console.error('Error in loader:', error);
    return { 
      newArrivals: [], 
      totalProducts: 0,
      currentPage: 1,
      hasNextPage: false,
      hasPreviousPage: false,
      selectedPeriod, 
      productsCount: 0,
      searchQuery,
      totalRevenue: 0,
      totalSalesCount: 0,
      hasMoreProducts: false,
    };
  }
};

export default function NewArrivalsPage() {
  const { 
    newArrivals = [], 
    totalProducts,
    currentPage,
    hasNextPage,
    hasPreviousPage,
    selectedPeriod: initialPeriod = "60", 
    productsCount,
    searchQuery: initialSearch,
    totalRevenue,
    totalSalesCount,
    hasMoreProducts
  } = useLoaderData<LoaderData>();
  
  const submit = useSubmit();
  const navigate = useNavigate();

  const [selectedPeriod, setSelectedPeriod] = useState(initialPeriod);
  const [searchQuery, setSearchQuery] = useState(initialSearch);
  const [loading, setLoading] = useState(false);

  const periodOptions = [
    { label: 'Last 7 days', value: '7' },
    { label: 'Last 14 days', value: '14' },
    { label: 'Last 30 days', value: '30' },
    { label: 'Last 60 days', value: '60' },
    { label: 'Last 90 days', value: '90' },
  ];

  // Reset loading when data changes
  useEffect(() => {
    setLoading(false);
  }, [newArrivals]);

  // Handle search with debounce
  useEffect(() => {
    const timer = setTimeout(() => {
      if (searchQuery !== initialSearch) {
        setLoading(true);
        const params = new URLSearchParams();
        if (searchQuery) {
          params.set("search", searchQuery);
        }
        params.set("period", selectedPeriod);
        
        submit(params, { replace: true });
      }
    }, 500);

    return () => clearTimeout(timer);
  }, [searchQuery, submit, initialSearch, selectedPeriod]);

  const handlePeriodChange = (value: string) => {
    setSelectedPeriod(value);
    setLoading(true);
    
    const params = new URLSearchParams();
    params.set("period", value);
    if (searchQuery) {
      params.set("search", searchQuery);
    }
    
    submit(params, { replace: true });
  };

  const refreshData = () => {
    setLoading(true);
    const params = new URLSearchParams();
    params.set("period", selectedPeriod);
    if (searchQuery) {
      params.set("search", searchQuery);
    }
    submit(params, { replace: true });
  };

  const clearSearch = () => {
    setSearchQuery('');
    setLoading(true);
    
    const params = new URLSearchParams();
    params.set("period", selectedPeriod);
    
    submit(params, { replace: true });
  };

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
    <div key="title">
      <Text as="span" fontWeight="medium">{product.title}</Text>
      {product.salesLast60Days > 0 && (
        <Text as="p" variant="bodySm" tone="success">
          {product.salesLast60Days} sales (60 days)
        </Text>
      )}
    </div>,
    <Text as="span" key="price">{product.price}</Text>,
    <Text as="span" key="vendor">{product.vendor}</Text>,
    <Badge 
      tone={
        product.status === 'ACTIVE' ? 'success' : 
        product.status === 'DRAFT' ? 'warning' : 'critical'
      } 
      key="status"
    >
      {product.status}
    </Badge>,
    <Text 
      as="span" 
      key="stock" 
      tone={product.inStock > 0 ? "success" : "critical"}
      fontWeight={product.inStock > 0 ? "medium" : "bold"}
    >
      {product.inStock}
    </Text>,
    <Text as="span" key="created">{product.created}</Text>,
    <Text 
      as="span" 
      key="revenue" 
      tone={product.revenue > 0 ? "success" : "subdued"}
      fontWeight="medium"
    >
      ${product.revenue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
    </Text>,
  ]);

  // Calculate statistics
  const totalWithSales = newArrivals.filter(p => p.salesLast60Days > 0).length;
  const totalOutOfStock = newArrivals.filter(p => p.inStock === 0).length;

  const getCurrentDateTime = (): string => {
    const now = new Date();
    return now.toLocaleDateString('en-GB', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric'
    }) + ' (' + now.toLocaleTimeString('en-GB', {
      hour: '2-digit',
      minute: '2-digit'
    }) + ')';
  };

  return (
    <Page
      title="New Arrivals"
      subtitle={`Products added in the last ${selectedPeriod} days`}
    >
      <Layout>
        <Layout.Section>
          <Card>
            {/* Search and Controls Section */}
            <Box padding="400" borderBlockEndWidth="025" borderColor="border">
              <BlockStack gap="400">
                {/* Top Row: Search and Period */}
                <InlineStack align="space-between" blockAlign="center">
                  <div style={{ width: '320px' }}>
                    <TextField
                      label="Search products"
                      labelHidden
                      placeholder="Search by product title or vendor..."
                      value={searchQuery}
                      onChange={setSearchQuery}
                      autoComplete="off"
                      prefix={<Icon source={SearchIcon} />}
                      clearButton
                      onClearButtonClick={clearSearch}
                    />
                  </div>
                  
                  <InlineStack gap="400" blockAlign="center">
                    {/* Period selector */}
                    <InlineStack gap="200" blockAlign="center">
                      <Text as="span" variant="bodyMd">
                        Period:
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
                    </InlineStack>
                    
                    <Button onClick={refreshData} disabled={loading}>
                      {loading ? 'Refreshing...' : 'Refresh'}
                    </Button>
                  </InlineStack>
                </InlineStack>

                {/* Middle Row: Information */}
                <InlineStack align="space-between" blockAlign="center">
                  <Text as="p" tone="subdued" variant="bodySm">
                    {searchQuery 
                      ? `Searching for: "${searchQuery}" • ${newArrivals.length} products found`
                      : `Showing ALL ${newArrivals.length} products from the last ${selectedPeriod} days`
                    }
                    {hasMoreProducts && (
                      <Text as="span" tone="warning" variant="bodySm"> • Some products may be truncated due to API limits</Text>
                    )}
                  </Text>
                  
                  {newArrivals.length > 0 && (
                    <InlineStack gap="300">
                      <Text as="span" variant="bodySm" tone="success">
                        {totalWithSales} with sales
                      </Text>
                      <Text as="span" variant="bodySm" tone="critical">
                        {totalOutOfStock} out of stock
                      </Text>
                      <Text as="span" variant="bodySm" tone="success">
                        ${totalRevenue.toLocaleString()} revenue
                      </Text>
                      <Text as="span" variant="bodySm" tone="success">
                        {totalSalesCount} total sales
                      </Text>
                    </InlineStack>
                  )}
                </InlineStack>
              </BlockStack>
            </Box>

            {/* Data Table */}
            {loading ? (
              <Box padding="800">
                <div style={{ textAlign: 'center' }}>
                  <Spinner size="large" />
                  <Box paddingBlockStart="200">
                    <Text as="p" tone="subdued" variant="bodyMd">
                      Loading products from the last {selectedPeriod} days...
                    </Text>
                    <Text as="p" tone="subdued" variant="bodySm">
                      This may take a moment for large catalogs
                    </Text>
                  </Box>
                </div>
              </Box>
            ) : newArrivals.length > 0 ? (
              <>
                <DataTable
                  columnContentTypes={[
                    'numeric',
                    'text',
                    'text',
                    'numeric',
                    'text',
                    'text',
                    'numeric',
                    'text',
                    'numeric'
                  ]}
                  headings={[
                    '#',
                    'Image',
                    'Title',
                    'Price',
                    'Vendor',
                    'Status',
                    'Stock',
                    'Created',
                    'Revenue'
                  ]}
                  rows={rows}
                  footerContent={`Showing ALL ${newArrivals.length} products from the last ${selectedPeriod} days`}
                />
              </>
            ) : (
              <Box padding="800">
                <div style={{ textAlign: 'center' }}>
                  <Text as="p" variant="bodyMd" fontWeight="medium">
                    No products found
                  </Text>
                  <Box paddingBlockStart="200">
                    <Text as="p" variant="bodySm" tone="subdued">
                      {searchQuery 
                        ? `No products found matching "${searchQuery}" in the last ${selectedPeriod} days.` 
                        : `No products found in the last ${selectedPeriod} days.`
                      }
                    </Text>
                  </Box>
                  {searchQuery && (
                    <Box paddingBlockStart="200">
                      <Button onClick={clearSearch}>
                        Clear search
                      </Button>
                    </Box>
                  )}
                  <Box paddingBlockStart="200">
                    <Button onClick={() => handlePeriodChange("90")}>
                      Try last 90 days
                    </Button>
                  </Box>
                </div>
              </Box>
            )}
          </Card>

          {/* Statistics Footer */}
          <Box padding="400">
            <InlineStack align="space-between" blockAlign="center">
              <Text as="p" tone="subdued" variant="bodySm">
                <strong>Last updated:</strong> {getCurrentDateTime()}
              </Text>
              <Text as="p" tone="subdued" variant="bodySm">
                All products • {selectedPeriod}-day period
              </Text>
            </InlineStack>
          </Box>
        </Layout.Section>
      </Layout>
    </Page>
  );
}