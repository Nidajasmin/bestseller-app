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
import { SearchIcon } from '@shopify/polaris-icons';
import { AppLogger } from "../utils/logging"; // ADD THIS IMPORT

interface TrendingProduct {
  id: string;
  position: number;
  trend: string;
  image: string;
  title: string;
  price: string;
  sales: number;
  revenue: string;
  isNew: boolean;
  inStock: number;
  created: string;
}

interface LoaderData {
  trendingProducts: TrendingProduct[];
  totalProducts: number;
  currentPage: number;
  hasNextPage: boolean;
  hasPreviousPage: boolean;
  productsCount: number;
  searchQuery: string;
  endCursor?: string;
  startCursor?: string;
}

// Interface for sales data
interface SalesData {
  sales: number;
  revenue: number;
}

// Interface for GraphQL response
interface GraphQLResponse<T = any> {
  data?: T;
  errors?: Array<{
    message: string;
    locations?: Array<{ line: number; column: number }>;
    path?: string[];
  }>;
}

// Interface for order data
interface OrderNode {
  node: {
    id: string;
    lineItems: {
      edges: Array<{
        node: {
          product: {
            id: string;
          };
          quantity: number;
          originalTotalSet: {
            shopMoney: {
              amount: string;
              currencyCode: string;
            };
          };
        };
      }>;
    };
  };
}

interface OrdersResponse {
  orders: {
    edges: OrderNode[];
    pageInfo: {
      hasNextPage: boolean;
      endCursor: string | null;
    };
  };
}

// Interface for product data
interface ProductNode {
  id: string;
  title: string;
  handle: string;
  featuredImage: {
    url: string;
    altText: string;
  } | null;
  variants: {
    edges: Array<{
      node: {
        price: string;
        inventoryQuantity: number;
      };
    }>;
  };
  totalInventory: number;
  createdAt: string;
  publishedAt: string;
  status: string;
  vendor: string;
}

// Fixed 7 days period - no other options
const SALES_PERIOD = 7;

// GraphQL query to fetch ALL products with pagination
const GET_ALL_PRODUCTS = `#graphql
  query GetAllProducts($first: Int!, $after: String) {
    products(first: $first, after: $after) {
      pageInfo {
        hasNextPage
        hasPreviousPage
        endCursor
        startCursor
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
          variants(first: 1) {
            edges {
              node {
                price
                inventoryQuantity
              }
            }
          }
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

// GraphQL query to fetch specific products by their IDs
const GET_PRODUCTS_BY_IDS = `#graphql
  query GetProductsByIds($ids: [ID!]!) {
    nodes(ids: $ids) {
      ... on Product {
        id
        title
        handle
        featuredImage {
          url
          altText
        }
        variants(first: 1) {
          edges {
            node {
              price
              inventoryQuantity
            }
          }
        }
        totalInventory
        createdAt
        publishedAt
        status
        vendor
      }
    }
  }
`;

// GraphQL query to fetch orders with line items for sales calculation
const GET_ORDERS_WITH_PRODUCTS = `#graphql
  query GetOrdersWithProducts($first: Int!, $query: String!, $after: String) {
    orders(first: $first, query: $query, after: $after) {
      edges {
        node {
          id
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
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }
`;

// Function to calculate date range for orders query
const getDateRangeQuery = (days: number): string => {
  const endDate = new Date();
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);
  
  const formatDate = (date: Date) => date.toISOString().split('T')[0];
  
  return `financial_status:paid processed_at:>=${formatDate(startDate)} processed_at:<=${formatDate(endDate)}`;
};

// Function to fetch ALL sales data from orders with pagination
async function fetchSalesData(admin: any, days: number): Promise<Map<string, SalesData>> {
  try {
    AppLogger.info('[TRENDING] Starting sales data fetch for trending products', { days });
    
    const salesMap = new Map<string, SalesData>();
    const dateQuery = getDateRangeQuery(days);
    let hasNextPage = true;
    let after: string | null = null;
    let totalOrders = 0;
    let pageCount = 0;

    // Fetch all orders with pagination
    while (hasNextPage) {
      pageCount++;
      AppLogger.debug('[TRENDING] Fetching trending orders batch', { page: pageCount });

      const response: Response = await admin.graphql(GET_ORDERS_WITH_PRODUCTS, {
        variables: {
          first: 100,
          query: dateQuery,
          after: after
        }
      });
      
      // Add proper type annotation for the response
      const data: GraphQLResponse<OrdersResponse> = await response.json();
      
      if (data.errors) {
        AppLogger.error('[TRENDING] GraphQL errors in trending orders query', { errors: data.errors });
        break;
      }

      if (!data.data?.orders?.edges) {
        AppLogger.warn('[TRENDING] No orders found for trending period', { days });
        break;
      }

      const orders = data.data.orders.edges;
      totalOrders += orders.length;
      
      AppLogger.debug('[TRENDING] Processing trending orders batch', {
        batchSize: orders.length,
        totalOrders
      });

      // Process each order and its line items
      orders.forEach((order: OrderNode) => {
        if (order.node.lineItems?.edges) {
          order.node.lineItems.edges.forEach((lineItem: any) => {
            if (lineItem.node.product && lineItem.node.product.id) {
              const productId = lineItem.node.product.id;
              const quantity = lineItem.node.quantity || 0;
              const revenue = parseFloat(lineItem.node.originalTotalSet.shopMoney.amount) || 0;
              
              // FIXED: Get existing data safely
              const existing = salesMap.get(productId);
              if (existing) {
                salesMap.set(productId, {
                  sales: existing.sales + quantity,
                  revenue: existing.revenue + revenue
                });
              } else {
                salesMap.set(productId, {
                  sales: quantity,
                  revenue: revenue
                });
              }
            }
          });
        }
      });

      // Check pagination
      hasNextPage = data.data.orders.pageInfo?.hasNextPage || false;
      after = data.data.orders.pageInfo?.endCursor || null;
      
      if (hasNextPage) {
        AppLogger.debug('[TRENDING] Fetching next page of trending orders');
      }
    }
    
    AppLogger.info('[TRENDING] Trending sales data fetch completed', {
      totalOrders,
      productsWithSales: salesMap.size,
      days
    });
    
    return salesMap;
    
  } catch (error) {
    AppLogger.error('[TRENDING] Error fetching trending sales data', error, { days });
    return new Map();
  }
}

// Function to fetch products with pagination
async function fetchProductsWithPagination(admin: any, first: number, after: string | null = null): Promise<{
  products: ProductNode[];
  hasNextPage: boolean;
  endCursor: string | null;
  startCursor: string | null;
}> {
  try {
    AppLogger.debug('[TRENDING] Fetching products with pagination for trending', { first, after: after ? 'yes' : 'no' });
    
    const response: Response = await admin.graphql(GET_ALL_PRODUCTS, {
      variables: {
        first,
        after
      }
    });
    
    // Add proper type annotation for the response
    const data: GraphQLResponse<{
      products: {
        edges: Array<{ node: ProductNode }>;
        pageInfo: {
          hasNextPage: boolean;
          hasPreviousPage: boolean;
          endCursor: string | null;
          startCursor: string | null;
        };
      };
    }> = await response.json();
    
    if (data.errors) {
      AppLogger.error('[TRENDING] GraphQL errors in trending products query', { errors: data.errors });
      return { products: [], hasNextPage: false, endCursor: null, startCursor: null };
    }

    if (!data.data?.products?.edges) {
      AppLogger.warn('[TRENDING] No products found in trending pagination query');
      return { products: [], hasNextPage: false, endCursor: null, startCursor: null };
    }

    const products = data.data.products.edges.map(edge => edge.node);
    const pageInfo = data.data.products.pageInfo;
    
    AppLogger.debug('[TRENDING] Trending products pagination result', {
      productsCount: products.length,
      hasNextPage: pageInfo.hasNextPage
    });
    
    return {
      products,
      hasNextPage: pageInfo.hasNextPage,
      endCursor: pageInfo.endCursor,
      startCursor: pageInfo.startCursor
    };
    
  } catch (error) {
    AppLogger.error('[TRENDING] Error fetching trending products with pagination', error, { first, after });
    return { products: [], hasNextPage: false, endCursor: null, startCursor: null };
  }
}

// Function to fetch products by their IDs
async function fetchProductsByIds(admin: any, productIds: string[]): Promise<Map<string, ProductNode>> {
  if (productIds.length === 0) {
    return new Map();
  }

  try {
    AppLogger.info('[TRENDING] Fetching trending products by IDs', { productIdsCount: productIds.length });
    
    const productDetails = new Map<string, ProductNode>();
    
    // Fetch products in batches to handle API limits
    for (let i = 0; i < productIds.length; i += 50) {
      const batchIds = productIds.slice(i, i + 50);
      
      const response: Response = await admin.graphql(GET_PRODUCTS_BY_IDS, {
        variables: {
          ids: batchIds
        }
      });
      
      const data: GraphQLResponse<{ nodes: (ProductNode | null)[] }> = await response.json();
      
      if (data.errors) {
        AppLogger.error('[TRENDING] GraphQL errors in trending products by IDs query', {
          errors: data.errors,
          batch: Math.floor(i / 50) + 1
        });
        continue;
      }
      
      if (data.data?.nodes) {
        data.data.nodes.forEach(node => {
          if (node) {
            productDetails.set(node.id, node);
          }
        });
      }
      
      AppLogger.debug('[TRENDING] Trending products batch fetched', {
        batch: Math.floor(i / 50) + 1,
        productsFetched: data.data?.nodes?.length || 0
      });
    }
    
    AppLogger.info('[TRENDING] Trending products by IDs fetch completed', {
      totalDetailsFetched: productDetails.size,
      expected: productIds.length
    });
    
    return productDetails;
    
  } catch (error) {
    AppLogger.error('[TRENDING] Error fetching trending products by IDs', error, { productIdsCount: productIds.length });
    return new Map();
  }
}

// Helper function to check if product is new (created in last 7 days)
const isProductNew = (createdAt: string): boolean => {
  const createdDate = new Date(createdAt);
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
  return createdDate > sevenDaysAgo;
};

// UPDATED loader function with PROPER server-side pagination for 10,000+ products
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin } = await authenticate.admin(request);
  const url = new URL(request.url);
  
  const productsCount = parseInt(url.searchParams.get("count") || "250");
  const page = parseInt(url.searchParams.get("page") || "1");
  const searchQuery = url.searchParams.get("search") || "";
  const after = url.searchParams.get("after") || null;

  AppLogger.info('[TRENDING] Trending loader started', {
    productsCount,
    page,
    searchQuery,
    after: after ? 'yes' : 'no',
    salesPeriod: SALES_PERIOD
  });

  try {
    // STEP 1: Fetch sales data from orders for the last 7 days
    AppLogger.info('[TRENDING] Fetching sales data for trending period', { days: SALES_PERIOD });
    const salesData = await fetchSalesData(admin, SALES_PERIOD);
    
    AppLogger.info('[TRENDING] Trending sales data loaded', { productsWithSales: salesData.size });

    // If no sales data found, return empty results
    if (salesData.size === 0) {
      AppLogger.warn('[TRENDING] No products with sales found for trending period', { days: SALES_PERIOD });
      return { 
        trendingProducts: [], 
        totalProducts: 0,
        currentPage: page,
        hasNextPage: false,
        hasPreviousPage: false,
        productsCount,
        searchQuery,
      };
    }

    // STEP 2: NEW APPROACH - Create a sorted list of product IDs based on sales
    AppLogger.info('[TRENDING] Creating sorted list of trending products by sales');
    
    // Create an array of products with sales data
    const productsWithSalesData: Array<{
      id: string;
      sales: number;
      revenue: number;
    }> = [];
    
    salesData.forEach((salesDataItem, productId) => {
      productsWithSalesData.push({
        id: productId,
        sales: salesDataItem.sales,
        revenue: salesDataItem.revenue
      });
    });
    
    // Sort by sales (highest first)
    productsWithSalesData.sort((a, b) => b.sales - a.sales);
    
    AppLogger.info('[TRENDING] Trending products sorted by sales', {
      totalProductsWithSales: productsWithSalesData.length,
      topSales: productsWithSalesData.slice(0, 3).map(p => ({ id: p.id, sales: p.sales }))
    });
    
    // Apply search filter if provided to the sorted list
    let filteredProductIds = productsWithSalesData;
    if (searchQuery) {
      // For search, we need to fetch product titles to match
      AppLogger.info('[TRENDING] Applying search filter to trending products', { searchQuery });
      
      // We'll need to fetch all products to check titles, but we'll do it in batches
      const matchedProductIds: Array<{
        id: string;
        sales: number;
        revenue: number;
      }> = [];
      
      let productsAfter: string | null = null;
      let hasMoreProducts = true;
      let totalProductsFetched = 0;
      let batchCount = 0;
      
      // Fetch all products in batches to find matches
      while (hasMoreProducts) {
        batchCount++;
        const { products, hasNextPage, endCursor } = await fetchProductsWithPagination(
          admin, 
          250, // Fetch in batches of 250
          productsAfter
        );
        
        totalProductsFetched += products.length;
        
        // Filter products that have sales and match the search query
        products.forEach(product => {
          const productSalesInfo = salesData.get(product.id);
          if (productSalesInfo && productSalesInfo.sales > 0) {
            if (product.title.toLowerCase().includes(searchQuery.toLowerCase())) {
              matchedProductIds.push({
                id: product.id,
                sales: productSalesInfo.sales,
                revenue: productSalesInfo.revenue
              });
            }
          }
        });
        
        hasMoreProducts = hasNextPage && endCursor !== null;
        productsAfter = endCursor;
        
        AppLogger.debug('[TRENDING] Trending search batch processed', {
          batch: batchCount,
          productsChecked: products.length,
          matchesFound: matchedProductIds.length,
          totalProductsFetched
        });
      }
      
      // Sort the matched products by sales
      matchedProductIds.sort((a, b) => b.sales - a.sales);
      filteredProductIds = matchedProductIds;
      
      AppLogger.info('[TRENDING] Trending search filter applied', {
        searchQuery,
        beforeSearch: productsWithSalesData.length,
        afterSearch: filteredProductIds.length
      });
    }
    
    // Calculate total products for pagination
    const totalProductsCount = filteredProductIds.length;
    
    // Apply pagination to the sorted list
    const startIndex = (page - 1) * productsCount;
    const endIndex = startIndex + productsCount;
    const paginatedProductIds = filteredProductIds.slice(startIndex, endIndex);
    
    AppLogger.info('[TRENDING] Applying trending pagination', {
      page,
      productsCount,
      startIndex,
      endIndex,
      paginatedProducts: paginatedProductIds.length
    });
    
    // STEP 3: Fetch the actual product details for the current page
    const productIds = paginatedProductIds.map(p => p.id);
    const productDetails = await fetchProductsByIds(admin, productIds);
    
    // STEP 4: Transform the products with sales data
    const trendingProducts: TrendingProduct[] = [];
    
    paginatedProductIds.forEach((productData, index) => {
      const productDetail = productDetails.get(productData.id);
      
      if (!productDetail) {
        AppLogger.warn('[TRENDING] Trending product details not found', { productId: productData.id });
        return;
      }
      
      const mainVariant = productDetail.variants?.edges[0]?.node;
      const price = mainVariant?.price || '0.00';
      const basePrice = parseFloat(price);
      const inventory = productDetail.totalInventory || 0;
      
      const sales = productData.sales;
      const revenue = productData.revenue;
      const isNew = isProductNew(productDetail.createdAt);
      
      // Trend calculation based on actual sales performance
      let trend = '↗'; // Default for some sales
      if (sales > 10) trend = '🚀'; // High sales
      else if (sales > 5) trend = '↑'; // Good sales

      const trendingProduct: TrendingProduct = {
        id: productDetail.id,
        position: startIndex + index + 1, // Correct position based on overall ranking
        trend,
        image: productDetail.featuredImage?.url || '',
        title: productDetail.title,
        price: `$${basePrice.toFixed(2)}`,
        sales,
        revenue: `$${revenue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
        isNew,
        inStock: inventory,
        created: new Date(productDetail.createdAt).toLocaleDateString('en-US', {
          year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
        }).replace(',', ''),
      };

      trendingProducts.push(trendingProduct);
    });

    AppLogger.info('[TRENDING] Trending products transformation completed', {
      trendingProductsCount: trendingProducts.length,
      page,
      totalProducts: totalProductsCount
    });
    
    // Calculate pagination info
    const hasPreviousPage = page > 1;
    const hasNextPage = endIndex < totalProductsCount;

    // Calculate cursors for next/prev navigation
    let nextCursor = null;
    let prevCursor = null;
    
    if (hasNextPage && trendingProducts.length > 0) {
      // For next page, we'll use the position-based approach
      nextCursor = (page + 1).toString();
    }
    
    if (hasPreviousPage) {
      // For previous page, we'll use the position-based approach
      prevCursor = (page - 1).toString();
    }

    AppLogger.info('[TRENDING] Trending loader completed successfully', {
      trendingProductsReturned: trendingProducts.length,
      totalProducts: totalProductsCount,
      currentPage: page,
      hasNextPage,
      hasPreviousPage
    });

    return {
      trendingProducts,
      totalProducts: totalProductsCount,
      currentPage: page,
      hasNextPage,
      hasPreviousPage,
      productsCount,
      searchQuery,
      endCursor: nextCursor,
      startCursor: prevCursor,
    };

  } catch (error: any) {
    AppLogger.error('[TRENDING] Error in Trending loader', error, {
      productsCount,
      page,
      searchQuery
    });
    return { 
      trendingProducts: [], 
      totalProducts: 0,
      currentPage: page,
      hasNextPage: false,
      hasPreviousPage: false,
      productsCount,
      searchQuery,
    };
  }
};

export default function TrendingPage() {
  const { 
    trendingProducts = [], 
    totalProducts,
    currentPage: initialPage,
    hasNextPage,
    hasPreviousPage,
    productsCount: initialCount = 250,
    searchQuery: initialSearch,
    endCursor,
    startCursor,
  } = useLoaderData<LoaderData>();
  
  const submit = useSubmit();
  const navigate = useNavigate();
  
  const [productsCount, setProductsCount] = useState(initialCount);
  const [currentPage, setCurrentPage] = useState(initialPage);
  const [searchQuery, setSearchQuery] = useState(initialSearch);
  const [loading, setLoading] = useState(false);

  // ADD COMPONENT MOUNT LOGGING
  useEffect(() => {
    AppLogger.info('[TRENDING] TrendingPage component mounted', {
      initialTrendingProducts: trendingProducts.length,
      initialPage,
      initialSearch
    });
  }, []);

  // Reset loading state when new data is loaded
  useEffect(() => {
    setLoading(false);
    AppLogger.debug('[TRENDING] Trending data loaded', {
      trendingProductsCount: trendingProducts.length,
      currentPage,
      searchQuery
    });
  }, [trendingProducts, currentPage, searchQuery]);

  // Handle search with debounce
  useEffect(() => {
    const timer = setTimeout(() => {
      if (searchQuery !== initialSearch) {
        AppLogger.info('[TRENDING] Trending search query executed', {
          searchQuery,
          previousSearch: initialSearch
        });
        setLoading(true);
        const params = new URLSearchParams(window.location.search);
        if (searchQuery) {
          params.set("search", searchQuery);
        } else {
          params.delete("search");
        }
        params.set("page", "1");
        params.set("count", productsCount.toString());
        
        submit(params, { replace: true });
      }
    }, 500);

    return () => clearTimeout(timer);
  }, [searchQuery, productsCount, submit, initialSearch]);

  const handleCountChange = (value: string) => {
    const newCount = parseInt(value);
    AppLogger.info('[TRENDING] Trending products per page changed', {
      from: productsCount,
      to: newCount
    });
    setProductsCount(newCount);
    setLoading(true);
    
    const params = new URLSearchParams(window.location.search);
    params.set("count", value);
    params.set("page", "1");
    
    submit(params, { replace: true });
  };

  const handlePageChange = (page: number) => {
    AppLogger.info('[TRENDING] Trending page changed', {
      from: currentPage,
      to: page
    });
    setCurrentPage(page);
    setLoading(true);
    
    const params = new URLSearchParams(window.location.search);
    params.set("page", page.toString());
    params.set("count", productsCount.toString());
    
    navigate(`?${params.toString()}`, { replace: true });
  };

  const refreshData = () => {
    AppLogger.info('[TRENDING] Trending manual refresh triggered');
    setLoading(true);
    const params = new URLSearchParams(window.location.search);
    submit(params, { replace: true });
  };

  const downloadCSV = () => {
    AppLogger.info('[TRENDING] Trending CSV download initiated', {
      productsCount: trendingProducts.length,
      currentPage
    });
    const headers = ['Position', 'Trend', 'Title', 'Price', '7-Day Sales', '7-Day Revenue', 'New', 'In Stock', 'Created'];
    const csvData = trendingProducts.map(product => [
      product.position,
      product.trend,
      `"${product.title}"`,
      product.price.replace('$', ''),
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
    a.download = `trending-products-7days-page-${currentPage}.csv`;
    a.click();
    window.URL.revokeObjectURL(url);
  };

  // Generate count options dynamically
  const generateCountOptions = () => {
    const options = [];
    const commonIncrements = [50, 100, 250, 500];
    
    commonIncrements.forEach(count => {
      options.push({
        label: `${count} products`,
        value: count.toString()
      });
    });
    
    if (!commonIncrements.includes(productsCount)) {
      options.push({
        label: `${productsCount} products`,
        value: productsCount.toString()
      });
    }
    
    return options.sort((a, b) => parseInt(a.value) - parseInt(b.value));
  };

  const rows = trendingProducts.map((product) => [
    <Text as="span" fontWeight="bold" key="trend">{product.trend}</Text>,
    <Text as="span" key="position">{product.position}</Text>,
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
    <Text as="span" fontWeight="bold" key="sales">{product.sales}</Text>,
    <Text as="span" fontWeight="bold" key="revenue">{product.revenue}</Text>,
    <Badge tone={product.isNew ? 'success' : 'info'} key="new">{product.isNew ? 'yes' : 'no'}</Badge>,
    <Text as="span" key="stock">{product.inStock}</Text>,
    <Text as="span" key="created">{product.created}</Text>,
  ]);

  // Calculate statistics for current page
  const totalSales = trendingProducts.reduce((sum, p) => sum + p.sales, 0);
  const totalRevenue = trendingProducts.reduce((sum, p) => sum + parseFloat(p.revenue.replace('$', '').replace(',', '')), 0);
  
  // Calculate position range for current page
  const startPosition = trendingProducts.length > 0 ? ((currentPage - 1) * productsCount) + 1 : 0;
  const endPosition = trendingProducts.length > 0 ? startPosition + trendingProducts.length - 1 : 0;

  // Calculate total pages
  const totalPages = Math.ceil(totalProducts / productsCount);

  return (
    <Page
      title="Trending Products (Last 7 Days)"
      subtitle="Products with actual sales in the last 7 days - ranked by sales performance"
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
                      placeholder="Search trending products..."
                      value={searchQuery}
                      onChange={setSearchQuery}
                      autoComplete="off"
                      prefix={<Icon source={SearchIcon} />}
                      clearButton
                      onClearButtonClick={() => {
                        AppLogger.info('[TRENDING] Trending search cleared');
                        setSearchQuery('');
                      }}
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

                    {/* Pagination */}
                    <div style={{
                      backgroundColor: '#f6f6f7',
                      padding: '6px 12px',
                      borderRadius: '6px',
                      border: '1px solid #e1e3e5',
                      minWidth: '220px'
                    }}>
                      <Pagination
                        hasPrevious={hasPreviousPage}
                        onPrevious={() => handlePageChange(currentPage - 1)}
                        hasNext={hasNextPage}
                        onNext={() => handlePageChange(currentPage + 1)}
                        label={`Page ${currentPage} of ${totalPages}`}
                      />
                    </div>
                  </InlineStack>
                </InlineStack>

                {/* Middle Row: Period and Information */}
                <InlineStack align="space-between" blockAlign="center">
                  <BlockStack gap="100">
                    <Text as="span" variant="bodyMd">
                      Sales Period: Fixed 7 Days
                    </Text>
                    <Text as="span" tone="subdued" variant="bodySm">
                      Only products with actual sales in the last 7 days are shown.
                      Products are ranked by number of units sold (highest first).
                    </Text>
                  </BlockStack>
                  
                  {searchQuery && (
                    <Text as="p" variant="bodySm" tone="subdued">
                      Searching for: "{searchQuery}"
                    </Text>
                  )}
                  
                  <BlockStack gap="100" align="end">
                    <Text as="span" variant="bodySm" tone="subdued">
                      Positions {startPosition} - {endPosition} displayed
                    </Text>
                    <Text as="span" variant="bodySm" tone="success">
                      {trendingProducts.length} products with sales on this page
                    </Text>
                    <Text as="span" variant="bodySm" tone="subdued">
                      Total: {totalProducts} products with sales
                    </Text>
                  </BlockStack>
                </InlineStack>
              </BlockStack>
            </Box>

            {/* Information Section */}
            <Box padding="400">
              <BlockStack gap="200">
                <Text as="h3" variant="headingSm">Trend Indicators</Text>
                <Text as="p" tone="subdued" variant="bodySm">
                  <strong>🚀</strong> High sales (10+ units) • <strong>↑</strong> Good sales (5-9 units) • <strong>↗</strong> Some sales (1-4 units)
                </Text>
                <InlineStack gap="400">
                  <Text as="p" variant="bodySm" fontWeight="medium">
                    Page Products: <Text as="span" tone="success">{trendingProducts.length}</Text>
                  </Text>
                  <Text as="p" variant="bodySm" fontWeight="medium">
                    Page Sales: <Text as="span" tone="success">{totalSales} units</Text>
                  </Text>
                  <Text as="p" variant="bodySm" fontWeight="medium">
                    Page Revenue: <Text as="span" tone="success">${totalRevenue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</Text>
                  </Text>
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
                    'text',
                    'text',
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
                    'Image',
                    'Title',
                    'Price',
                    '7-Day Sales',
                    '7-Day Revenue',
                    'New',
                    'In Stock',
                    'Created'
                  ]}
                  rows={rows}
                  footerContent={`Showing positions ${startPosition} - ${endPosition} • ${trendingProducts.length} products with sales • ${totalSales} units sold • $${totalRevenue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} revenue`}
                />

                {/* Bottom Pagination */}
                <Box padding="400">
                  <InlineStack align="center" gap="400">
                    <div style={{
                      backgroundColor: '#f6f6f7',
                      padding: '12px 20px',
                      borderRadius: '8px',
                      border: '1px solid #e1e3e5'
                    }}>
                      <Pagination
                        hasPrevious={hasPreviousPage}
                        onPrevious={() => handlePageChange(currentPage - 1)}
                        hasNext={hasNextPage}
                        onNext={() => handlePageChange(currentPage + 1)}
                        label={`Page ${currentPage} of ${totalPages}`}
                      />
                    </div>
                    
                    {/* Page Navigation */}
                    <InlineStack gap="200">
                      <Text as="span" variant="bodySm" tone="subdued">
                        Go to page:
                      </Text>
                      <div style={{ width: '80px' }}>
                        <TextField
                          label="Page number"
                          labelHidden
                          type="number"
                          min={1}
                          max={totalPages}
                          value={currentPage.toString()}
                          onChange={(value) => {
                            const pageNum = parseInt(value);
                            if (!isNaN(pageNum) && pageNum >= 1 && pageNum <= totalPages) {
                              handlePageChange(pageNum);
                            }
                          }}
                          autoComplete='off'
                        />
                      </div>
                    </InlineStack>
                    
                    <Button onClick={refreshData} disabled={loading}>
                      {loading ? 'Refreshing...' : 'Refresh'}
                    </Button>
                    
                    <Button onClick={downloadCSV} disabled={trendingProducts.length === 0 || loading}>
                      Download CSV
                    </Button>
                  </InlineStack>
                </Box>
              </>
            ) : (
              <Box padding="800">
                <div style={{ textAlign: 'center' }}>
                  <Text as="p" variant="bodyMd" fontWeight="medium">
                    No trending products found
                  </Text>
                  <Box paddingBlockStart="200">
                    <Text as="p" variant="bodySm" tone="subdued">
                      {searchQuery 
                        ? `No products with sales found matching "${searchQuery}" in the last 7 days.`
                        : `No products with sales found in the last 7 days.`
                      }
                    </Text>
                  </Box>
                  {searchQuery && (
                    <Box paddingBlockStart="200">
                      <Button onClick={() => {
                        AppLogger.info('[TRENDING] Clear search clicked from trending empty state');
                        setSearchQuery('');
                      }} disabled={loading}>
                        Clear search
                      </Button>
                    </Box>
                  )}
                  <Box paddingBlockStart="200">
                    <Button onClick={refreshData} disabled={loading}>
                      {loading ? 'Refreshing...' : 'Refresh'}
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
                <strong>Statistics as of:</strong> {new Date().toLocaleDateString('en-GB')} ({new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })})
              </Text>
              <Text as="p" tone="subdued" variant="bodySm">
                Page {currentPage} of {totalPages} • {productsCount} products per page • Fixed 7-day period
              </Text>
            </InlineStack>
          </Box>
        </Layout.Section>
      </Layout>
    </Page>
  );
}