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

// BrowserLogger implementation
class BrowserLogger {
  private isDevelopment = process.env.NODE_ENV === 'development';
  private logEndpoint = '/api/logs';

  private formatTimestamp(): string {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    const seconds = String(now.getSeconds()).padStart(2, '0');
    
    return `[${year}-${month}-${day} ${hours}:${minutes}:${seconds}]`;
  }

  private formatLogMessage(level: string, message: string, meta?: any): string {
    const timestamp = this.formatTimestamp();
    const metaString = meta ? JSON.stringify(meta) : '';
    return `${timestamp} [${level}] ${message}${metaString}`;
  }

  private async sendToServer(level: string, message: string, meta?: any): Promise<void> {
    // TEMPORARILY ENABLE IN DEVELOPMENT FOR TESTING - COMMENT THIS OUT
    // if (this.isDevelopment) {
    //   console.log(`[LOGGER DEV] ${level}: ${message}`, meta);
    //   return;
    // }

    // Ensure all required fields are present
    const logPayload = {
      level: level || 'UNKNOWN',
      message: message || 'No message',
      meta: meta || {},
      timestamp: new Date().toISOString(),
      url: typeof window !== 'undefined' ? window.location.href : 'unknown',
      userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : 'unknown',
    };

    try {
      console.log('🚀 SENDING LOG TO SERVER:', { level, message }); // ADD THIS DEBUG LINE

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);

      const response = await fetch(this.logEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(logPayload),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        console.warn('Logger: Server responded with error', response.status);
      } else {
        console.log('✅ Log successfully sent to server');
        const result = await response.json();
        console.log('Server response:', result);
      }
    } catch (error) {
      console.error('❌ Logger: Failed to send log to server', error);
    }
  }

  debug(message: string, meta?: any): void {
    if (this.isDevelopment) {
      const formattedMessage = this.formatLogMessage('DEBUG', message, meta);
      console.debug(formattedMessage);
    }
  }

  info(message: string, meta?: any): void {
    const formattedMessage = this.formatLogMessage('INFO', message, meta);
    console.info(formattedMessage);
    this.sendToServer('INFO', message, meta).catch(() => {});
  }

  warn(message: string, meta?: any): void {
    const formattedMessage = this.formatLogMessage('WARN', message, meta);
    console.warn(formattedMessage);
    this.sendToServer('WARN', message, meta).catch(() => {});
  }

  error(message: string, error?: any, meta?: any): void {
    let errorInfo = '';
    if (error instanceof Error) {
      errorInfo = `Error: ${error.message} | Stack: ${error.stack}`;
    } else if (error) {
      errorInfo = `Error: ${JSON.stringify(error)}`;
    }
    
    const finalMeta = { 
      ...meta, 
      errorInfo,
      originalError: error 
    };
    
    const formattedMessage = this.formatLogMessage('ERROR', message, finalMeta);
    console.error(formattedMessage);
    this.sendToServer('ERROR', message, finalMeta).catch(() => {});
  }

  // ADD THE MISSING HTTP METHOD
  http(message: string, meta?: any): void {
    const formattedMessage = this.formatLogMessage('HTTP', message, meta);
    console.info(formattedMessage);
    this.sendToServer('HTTP', message, meta).catch(() => {});
  }
}

export const Logger = new BrowserLogger();

// AppLogger wrapper using the BrowserLogger
export class AppLogger {
  static info(message: string, meta?: any): void {
    Logger.info(message, meta);
  }

  static error(message: string, error?: any, meta?: any): void {
    Logger.error(message, error, meta);
  }

  static warn(message: string, meta?: any): void {
    Logger.warn(message, meta);
  }

  static http(message: string, meta?: any): void {
    Logger.http(message, meta);
  }

  static debug(message: string, meta?: any): void {
    Logger.debug(message, meta);
  }

  static db(operation: string, model: string, data?: any): void {
    Logger.info(`DB ${operation} on ${model}`, { model, operation, data });
  }

  static shopifyAPI(operation: string, resource: string, data?: any): void {
    Logger.info(`Shopify API ${operation} on ${resource}`, { 
      resource, 
      operation, 
      data 
    });
  }
}

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

// ADD INTERFACES FOR GRAPHQL RESPONSES
interface GraphQLResponse<T = any> {
  data?: T;
  errors?: Array<{
    message: string;
    locations?: Array<{ line: number; column: number }>;
    path?: string[];
  }>;
}

interface ProductsResponse {
  products: {
    edges: Array<{
      cursor: string;
      node: {
        id: string;
        title: string;
        handle: string;
        featuredImage: { url: string; altText: string } | null;
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
      };
    }>;
    pageInfo: {
      hasNextPage: boolean;
      endCursor: string | null;
    };
  };
}

interface OrdersResponse {
  orders: {
    edges: Array<{
      node: {
        id: string;
        processedAt: string;
        lineItems: {
          edges: Array<{
            node: {
              product: {
                id: string;
              };
              quantity: number;
              originalUnitPriceSet: {
                shopMoney: {
                  amount: string;
                  currencyCode: string;
                };
              };
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
    }>;
    pageInfo: {
      hasNextPage: boolean;
      endCursor: string | null;
    };
  };
}

// GraphQL query to fetch orders for sales data - UPDATED WITH originalUnitPriceSet
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
                originalUnitPriceSet {
                  shopMoney {
                    amount
                    currencyCode
                  }
                }
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
    AppLogger.info('[NEW_ARRIVALS] Fetching all products', { query });
    
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

      AppLogger.debug('[NEW_ARRIVALS] Fetching products batch', { page: pageCount, after: after ? 'yes' : 'no' });

      const response = await admin.graphql(productsQuery, {
        variables: {
          first: 250, // Fetch in batches of 250
          query: query,
          after: after
        }
      });
      
      // Add proper type annotation for response
      const data: GraphQLResponse<ProductsResponse> = await response.json();
      
      if (data.errors || !data.data?.products?.edges) {
        AppLogger.error('[NEW_ARRIVALS] Error fetching products data', { errors: data.errors });
        break;
      }

      const products = data.data.products.edges.map((edge: any) => edge.node);
      allProducts.push(...products);

      hasNextPage = data.data.products.pageInfo?.hasNextPage || false;
      after = data.data.products.pageInfo?.endCursor;
      
      AppLogger.debug('[NEW_ARRIVALS] Products batch fetched', {
        batch: pageCount,
        productsFetched: products.length,
        totalProducts: allProducts.length,
        hasNextPage
      });
    }

    AppLogger.info('[NEW_ARRIVALS] All products fetch completed', {
      totalProducts: allProducts.length,
      hasMore: hasNextPage
    });
    
    return {
      products: allProducts,
      hasMore: hasNextPage
    };
    
  } catch (error) {
    AppLogger.error('[NEW_ARRIVALS] Error fetching products', error, { query });
    return {
      products: [],
      hasMore: false
    };
  }
}

// Function to fetch sales data - FIXED DATE PROCESSING BUG
async function fetchSalesData(admin: any): Promise<Map<string, { salesLast60Days: number; totalSales: number; revenue: number }>> {
  try {
    AppLogger.info('[NEW_ARRIVALS] Starting sales data fetch for new arrivals');
    
    const salesMap = new Map<string, { salesLast60Days: number; totalSales: number; revenue: number }>();
    const sixtyDaysAgo = new Date();
    sixtyDaysAgo.setDate(sixtyDaysAgo.getDate() - 60);
    
    let after: string | null = null;
    let hasNextPage = true;
    let pageCount = 0;

    while (hasNextPage && pageCount < 20) { // Limit to 20 pages to avoid excessive API calls
      pageCount++;
      
      AppLogger.debug('[NEW_ARRIVALS] Fetching sales data batch', { page: pageCount, after: after ? 'yes' : 'no' });

      const response = await admin.graphql(GET_ALL_ORDERS, {
        variables: { 
          first: 100, // Fetch in batches of 100
          after: after
        }
      });
      
      // Add proper type annotation for response
      const data: GraphQLResponse<OrdersResponse> = await response.json();
      
      if (data.errors || !data.data?.orders?.edges) {
        AppLogger.error('[NEW_ARRIVALS] Error fetching orders data', { errors: data.errors });
        break;
      }

      const orders = data.data.orders.edges;
      
      orders.forEach((order: any) => {
        // FIXED: Use processedAt instead of processAt
        const orderDate = new Date(order.node.processedAt);
        const isRecentSale = orderDate >= sixtyDaysAgo;
        
        if (order.node.lineItems?.edges) {
          order.node.lineItems.edges.forEach((lineItem: any) => {
            if (lineItem.node.product && lineItem.node.product.id) {
              const productId = lineItem.node.product.id;
              const quantity = lineItem.node.quantity || 0;
              
              // FIXED: Use unit price * quantity for accurate revenue calculation
              const unitPrice = parseFloat(lineItem.node.originalUnitPriceSet?.shopMoney?.amount || '0');
              const revenue = unitPrice * quantity;
              
              // FIXED: Get the existing value first and check if it exists
              const existing = salesMap.get(productId);
              if (existing) {
                salesMap.set(productId, {
                  salesLast60Days: isRecentSale ? existing.salesLast60Days + quantity : existing.salesLast60Days,
                  totalSales: existing.totalSales + quantity,
                  revenue: existing.revenue + revenue
                });
              } else {
                salesMap.set(productId, {
                  salesLast60Days: isRecentSale ? quantity : 0,
                  totalSales: quantity,
                  revenue: revenue
                });
              }

              // DEBUG: Log sales data for analysis
              if (isRecentSale && quantity > 0) {
                AppLogger.debug('[NEW_ARRIVALS] Recent sale found', {
                  productId,
                  quantity,
                  unitPrice,
                  revenue,
                  orderDate: order.node.processedAt,
                  isRecentSale
                });
              }
            }
          });
        }
      });

      hasNextPage = data.data.orders.pageInfo?.hasNextPage || false;
      after = data.data.orders.pageInfo?.endCursor;
    }

    // DEBUG: Log summary of sales data
    AppLogger.info('[NEW_ARRIVALS] Sales data fetch completed', {
      productsWithSales: salesMap.size,
      totalRevenue: Array.from(salesMap.values()).reduce((sum, data) => sum + data.revenue, 0),
      totalSales: Array.from(salesMap.values()).reduce((sum, data) => sum + data.salesLast60Days, 0),
      sixtyDaysAgo: sixtyDaysAgo.toISOString()
    });

    // DEBUG: Log first few products with sales for verification
    let count = 0;
    for (const [productId, salesData] of salesMap.entries()) {
      if (salesData.salesLast60Days > 0 && count < 5) {
        AppLogger.debug('[NEW_ARRIVALS] Product with sales', {
          productId,
          salesLast60Days: salesData.salesLast60Days,
          revenue: salesData.revenue
        });
        count++;
      }
    }
    
    return salesMap;
    
  } catch (error) {
    AppLogger.error('[NEW_ARRIVALS] Error fetching sales data', error);
    return new Map();
  }
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin } = await authenticate.admin(request);
  const url = new URL(request.url);
  
  const selectedPeriod = url.searchParams.get("period") || "60";
  const searchQuery = url.searchParams.get("search") || "";

  AppLogger.info('[NEW_ARRIVALS] New Arrivals loader started', {
    selectedPeriod,
    searchQuery
  });

  try {
    // Fetch sales data first
    AppLogger.info('[NEW_ARRIVALS] Fetching sales data for new arrivals');
    const salesData = await fetchSalesData(admin);

    // Calculate date filter based on selected period
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - parseInt(selectedPeriod));
    const dateFilter = `created_at:>${cutoffDate.toISOString()}`;
    
    // Build search query
    let finalQuery = dateFilter;
    if (searchQuery) {
      finalQuery = `${dateFilter} AND (title:*${searchQuery}* OR vendor:*${searchQuery}*)`;
    }

    AppLogger.info('[NEW_ARRIVALS] Fetching products with query', { finalQuery });

    // Fetch products
    const productsResult = await fetchAllProducts(admin, finalQuery);
    const products = productsResult.products;

    AppLogger.info('[NEW_ARRIVALS] Transforming products with sales data', {
      productsCount: products.length,
      salesDataSize: salesData.size
    });

    // Transform products with sales data
    const transformedData = products.map((product: any, index: number) => {
      const mainVariant = product.variants?.edges[0]?.node;
      const price = mainVariant?.price || '0.00';
      const basePrice = parseFloat(price);
      
      // FIXED: Use the full product ID without stripping for sales data lookup
      const productSalesData = salesData.get(product.id) || { 
        salesLast60Days: 0, 
        totalSales: 0, 
        revenue: 0 
      };

      // Add debug logging for products with sales
      if (productSalesData.salesLast60Days > 0) {
        AppLogger.debug('[NEW_ARRIVALS] Product with sales found', {
          productId: product.id,
          title: product.title,
          salesLast60Days: productSalesData.salesLast60Days,
          revenue: productSalesData.revenue
        });
      }

      return {
        id: product.id,
        position: index + 1,
        image: product.featuredImage?.url || '',
        title: product.title,
        price: `$${basePrice.toFixed(2)}`,
        inStock: product.totalInventory || 0,
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

    // Sort products: search matches first, then by creation date (newest first), then by sales (highest first)
    let sortedData = [...transformedData];
    
    if (searchQuery) {
      // Boost products that match search in title
      sortedData.sort((a, b) => {
        const aTitleMatch = a.title.toLowerCase().includes(searchQuery.toLowerCase());
        const bTitleMatch = b.title.toLowerCase().includes(searchQuery.toLowerCase());
        const aVendorMatch = a.vendor.toLowerCase().includes(searchQuery.toLowerCase());
        const bVendorMatch = b.vendor.toLowerCase().includes(searchQuery.toLowerCase());
        
        // Exact title match first
        if (aTitleMatch && !bTitleMatch) return -1;
        if (!aTitleMatch && bTitleMatch) return 1;
        
        // Vendor match next
        if (aVendorMatch && !bVendorMatch) return -1;
        if (!aVendorMatch && bVendorMatch) return 1;
        
        // Then by creation date (newest first)
        return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      });
    } else {
      // Normal sort: newest first, then by sales (highest first)
      sortedData.sort((a, b) => {
        // First by creation date (newest first)
        const dateDiff = new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
        if (Math.abs(dateDiff) > 24 * 60 * 60 * 1000) { // If more than 24 days apart
          return dateDiff;
        }
        
        // Then by sales (highest first)
        return b.salesLast60Days - a.salesLast60Days;
      });
    }

    // Calculate totals
    const totalRevenue = sortedData.reduce((sum, p) => sum + p.revenue, 0);
    const totalSalesCount = sortedData.reduce((sum, p) => sum + p.salesLast60Days, 0);
    const totalWithSales = sortedData.filter(p => p.salesLast60Days > 0).length;

    AppLogger.info('[NEW_ARRIVALS] New Arrivals loader completed', {
      newArrivalsCount: sortedData.length,
      totalRevenue,
      totalSalesCount,
      totalWithSales,
      productsWithSales: sortedData.filter(p => p.salesLast60Days > 0).length,
      hasMoreProducts: productsResult.hasMore
    });

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
      totalWithSales,
      hasMoreProducts: productsResult.hasMore
    };

  } catch (error) {
    AppLogger.error('[NEW_ARRIVALS] Error in New Arrivals loader', error, {
      selectedPeriod,
      searchQuery
    });
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
      totalWithSales: 0,
      hasMoreProducts: false
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
    totalWithSales = 0,
    hasMoreProducts
  } = useLoaderData<LoaderData>();
  
  const submit = useSubmit();
  const navigate = useNavigate();

  const [selectedPeriod, setSelectedPeriod] = useState(initialPeriod);
  const [searchQuery, setSearchQuery] = useState(initialSearch);
  const [loading, setLoading] = useState(false);

  // ADD COMPONENT MOUNT LOGGING
  useEffect(() => {
    AppLogger.info('[NEW_ARRIVALS] NewArrivalsPage component mounted', {
      initialNewArrivals: newArrivals.length,
      initialPeriod,
      initialSearch,
      totalRevenue,
      totalSalesCount,
      totalWithSales
    });
  }, []);

  // Reset loading when data changes
  useEffect(() => {
    setLoading(false);
    AppLogger.debug('[NEW_ARRIVALS] New Arrivals data loaded', {
      newArrivalsCount: newArrivals.length,
      selectedPeriod,
      searchQuery,
      totalRevenue,
      totalSalesCount,
      totalWithSales
    });
  }, [newArrivals, selectedPeriod, searchQuery]);

  const periodOptions = [
    { label: 'Last 7 days', value: '7' },
    { label: 'Last 14 days', value: '14' },
    { label: 'Last 30 days', value: '30' },
    { label: 'Last 60 days', value: '60' },
    { label: 'Last 90 days', value: '90' },
  ];

  // Handle period change
  const handlePeriodChange = (value: string) => {
    AppLogger.info('[NEW_ARRIVALS] Period changed', {
      from: selectedPeriod,
      to: value
    });
    setSelectedPeriod(value);
    setLoading(true);
    
    const params = new URLSearchParams();
    params.set("period", value);
    
    navigate(`?${params.toString()}`, { replace: true });
  };

  // Handle search with debounce
  useEffect(() => {
    const timer = setTimeout(() => {
      if (searchQuery !== initialSearch) {
        AppLogger.info('[NEW_ARRIVALS] Search query executed', {
          searchQuery,
          previousSearch: initialSearch
        });
        setLoading(true);
        const params = new URLSearchParams();
        if (searchQuery) {
          params.set("search", searchQuery);
        }
        params.set("period", selectedPeriod);
        
        navigate(`?${params.toString()}`, { replace: true });
      }
    }, 500);

    return () => clearTimeout(timer);
  }, [searchQuery, submit, initialSearch, selectedPeriod]);

  const refreshData = () => {
    AppLogger.info('[NEW_ARRIVALS] Manual refresh triggered');
    setLoading(true);
    
    const params = new URLSearchParams();
    params.set("period", selectedPeriod);
    if (searchQuery) {
      params.set("search", searchQuery);
    }
    
    navigate(`?${params.toString()}`, { replace: true });
  };

  const clearSearch = () => {
    AppLogger.info('[NEW_ARRIVALS] Search cleared');
    setSearchQuery('');
    setLoading(true);
    
    const params = new URLSearchParams();
    params.set("period", selectedPeriod);
    
    navigate(`?${params.toString()}`, { replace: true });
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
        product.status === 'DRAFT' ? 'attention' : 'critical'
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

  // Calculate statistics - use the calculated totalWithSales from loader
  const totalOutOfStock = newArrivals.filter(p => p.inStock === 0).length;

  return (
    <Page
      title={`New Arrivals (Last ${selectedPeriod} Days)`}
      subtitle="Products added to your store - newest first"
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
                  <Text as="p" variant="bodySm" tone="subdued">
                    {searchQuery 
                      ? `Searching for: "${searchQuery}" • ${newArrivals.length} products found`
                      : `Showing ALL ${newArrivals.length} products from the last ${selectedPeriod} days`
                    }
                    {hasMoreProducts && (
                      <Text as="span" tone="caution" variant="bodySm"> • Some products may be truncated due to API limits</Text>
                    )}
                  </Text>
                  
                  {newArrivals.length > 0 && (
                    <InlineStack gap="300">
                      <Text as="span" variant="bodySm" tone={totalWithSales > 0 ? "success" : "subdued"}>
                        {totalWithSales} with sales
                      </Text>
                      <Text as="span" variant="bodySm" tone="critical">
                        {totalOutOfStock} out of stock
                      </Text>
                      <Text as="span" variant="bodySm" tone={totalRevenue > 0 ? "success" : "subdued"}>
                        ${totalRevenue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} revenue
                      </Text>
                      <Text as="span" variant="bodySm" tone={totalSalesCount > 0 ? "success" : "subdued"}>
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
                    <Text as="p" variant="bodyMd" tone="subdued">
                      Loading products from the last ${selectedPeriod} days...
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
                    'text',
                    'numeric',
                    'text',
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
                  footerContent={`Showing ALL ${newArrivals.length} products from the last ${selectedPeriod} days • ${totalRevenue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} total revenue`}
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
                    <Button onClick={() => {
                      AppLogger.info('[NEW_ARRIVALS] Try last 90 days clicked from empty state');
                      handlePeriodChange("90");
                    }}>
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