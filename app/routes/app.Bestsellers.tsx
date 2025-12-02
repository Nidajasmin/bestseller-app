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
} from '@shopify/polaris';
import { useLoaderData, useSubmit, useNavigate, type LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { SearchIcon } from '@shopify/polaris-icons';
import { AppLogger } from "../utils/logging";

interface BestsellerProduct {
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
  bestsellers: BestsellerProduct[];
  totalProducts: number;
  currentPage: number;
  hasNextPage: boolean;
  hasPreviousPage: boolean;
  selectedMonth: string;
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
        inventoryItem: {
          tracked: boolean;
        };
      };
    }>;
  };
  totalInventory: number;
  createdAt: string;
  publishedAt: string;
  status: string;
  vendor: string;
}

interface ProductsResponse {
  nodes: (ProductNode | null)[];
}

// UPDATED: "New" is now fixed to last 10 days
const isProductNew = (createdAt: string): boolean => {
  const createdDate = new Date(createdAt);
  const tenDaysAgo = new Date();
  tenDaysAgo.setDate(tenDaysAgo.getDate() - 10);
  return createdDate > tenDaysAgo;
};

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
          variants(first: 50) {
            edges {
              node {
                price
                inventoryQuantity
                inventoryItem {
                  tracked
                }
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

// Function to calculate date range for orders query - FIXED to use consistent date field
const getDateRangeQuery = (months: number): string => {
  const endDate = new Date();
  const startDate = new Date();
  startDate.setMonth(startDate.getMonth() - months);
  
  // Use UTC dates to avoid timezone issues
  const formatDate = (date: Date) => {
    const utcDate = new Date(date.getTime() - (date.getTimezoneOffset() * 60000));
    return utcDate.toISOString().split('T')[0];
  };
  
  const startDateStr = formatDate(startDate);
  const endDateStr = formatDate(endDate);
  
  AppLogger.debug('Date range calculated', {
    months,
    startDate: startDateStr,
    endDate: endDateStr
  });
  
  // Use created_at consistently for all queries and properly format the query string
  return `financial_status:paid AND created_at:>=${startDateStr} AND created_at:<${endDateStr}`;
};

// Function to fetch ALL sales data from orders with pagination
async function fetchSalesData(admin: any, months: number): Promise<Map<string, SalesData>> {
  try {
    AppLogger.info('Starting sales data fetch', { months });
    
    const salesMap = new Map<string, SalesData>();
    const dateQuery = getDateRangeQuery(months);
    
    let hasNextPage = true;
    let after: string | null = null;
    let totalOrders = 0;
    let pageCount = 0;

    // Fetch all orders with pagination
    while (hasNextPage) {
      pageCount++;
      AppLogger.debug('Fetching orders batch', {
        page: pageCount,
        after: after ? 'yes' : 'no'
      });
      
      const response = await admin.graphql(GET_ORDERS_WITH_PRODUCTS, {
        variables: {
          first: 100,
          query: dateQuery,
          after: after
        }
      });
      
      // Add proper type annotation for response
      const data: GraphQLResponse<OrdersResponse> = await response.json();
      
      if (data.errors) {
        AppLogger.error('GraphQL errors in orders query', { errors: data.errors });
        break;
      }

      if (!data.data?.orders?.edges) {
        AppLogger.warn('No orders found for period', { months });
        break;
      }

      const orders = data.data.orders.edges;
      totalOrders += orders.length;
      
      AppLogger.debug('Processing orders batch', {
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
              // Use originalTotalSet as it's the correct field in the API
              const revenue = parseFloat(lineItem.node.originalTotalSet.shopMoney.amount) || 0;
              
              if (salesMap.has(productId)) {
                const existing = salesMap.get(productId)!;
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
        AppLogger.debug('Fetching next orders page');
      }
    }
    
    AppLogger.info('Sales data fetch completed', {
      totalOrders,
      productsWithSales: salesMap.size,
      months
    });
    
    return salesMap;
    
  } catch (error) {
    AppLogger.error('Error fetching sales data', error, { months });
    return new Map();
  }
}

// FIXED: Function to fetch today's orders specifically
async function fetchTodaysOrders(admin: any): Promise<Map<string, SalesData>> {
  try {
    AppLogger.info('Fetching today\'s orders');
    
    const salesMap = new Map<string, SalesData>();
    
    // Get today's date in UTC to avoid timezone issues
    const today = new Date();
    today.setHours(0, 0, 0, 0); // Start of today
    
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1); // Start of tomorrow
    
    // Format dates for Shopify GraphQL (YYYY-MM-DD format)
    const formatDate = (date: Date) => {
      const utcDate = new Date(date.getTime() - (date.getTimezoneOffset() * 60000));
      return utcDate.toISOString().split('T')[0];
    };
    const todayFormatted = formatDate(today);
    const tomorrowFormatted = formatDate(tomorrow);
    
    // Use created_at for consistency with historical data and properly format the query string
    const todaysOrdersQuery = `financial_status:paid AND created_at:>=${todayFormatted} AND created_at:<${tomorrowFormatted}`;
    
    AppLogger.debug('Today\'s date range', {
      today: todayFormatted,
      tomorrow: tomorrowFormatted
    });
    
    let hasNextPage = true;
    let after: string | null = null;
    let totalOrders = 0;
    let pageCount = 0;

    // Fetch all of today's orders with pagination
    while (hasNextPage) {
      pageCount++;
      AppLogger.debug('Fetching today\'s orders batch', { page: pageCount });

      const response = await admin.graphql(GET_ORDERS_WITH_PRODUCTS, {
        variables: {
          first: 100,
          query: todaysOrdersQuery,
          after: after
        }
      });
      
      // Add proper type annotation for response
      const data: GraphQLResponse<OrdersResponse> = await response.json();
      
      if (data.errors) {
        AppLogger.error('GraphQL errors in today\'s orders query', { errors: data.errors });
        break;
      }

      if (!data.data?.orders?.edges) {
        AppLogger.info('No orders found for today');
        break;
      }

      const orders = data.data.orders.edges;
      totalOrders += orders.length;
      
      AppLogger.debug('Processing today\'s orders batch', {
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
              // Use originalTotalSet as it's the correct field in the API
              const revenue = parseFloat(lineItem.node.originalTotalSet.shopMoney.amount) || 0;
              
              if (salesMap.has(productId)) {
                const existing = salesMap.get(productId)!;
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
        AppLogger.debug('Fetching next page of today\'s orders');
      }
    }
    
    AppLogger.info('Today\'s orders fetch completed', {
      totalOrders,
      productsWithSales: salesMap.size
    });
    
    return salesMap;
    
  } catch (error) {
    AppLogger.error('Error fetching today\'s orders', error);
    return new Map();
  }
}

// NEW: Function to fetch yesterday's orders
async function fetchYesterdaysOrders(admin: any): Promise<Map<string, SalesData>> {
  try {
    AppLogger.info('Fetching yesterday\'s orders');
    
    const salesMap = new Map<string, SalesData>();
    
    // Get yesterday's date in UTC
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    yesterday.setHours(0, 0, 0, 0); // Start of yesterday
    
    const today = new Date(yesterday);
    today.setDate(today.getDate() + 1); // Start of today
    
    // Format dates for Shopify GraphQL (YYYY-MM-DD format)
    const formatDate = (date: Date) => {
      const utcDate = new Date(date.getTime() - (date.getTimezoneOffset() * 60000));
      return utcDate.toISOString().split('T')[0];
    };
    const yesterdayFormatted = formatDate(yesterday);
    const todayFormatted = formatDate(today);
    
    // Use created_at for consistency with historical data and properly format the query string
    const yesterdaysOrdersQuery = `financial_status:paid AND created_at:>=${yesterdayFormatted} AND created_at:<${todayFormatted}`;
    
    AppLogger.debug('Yesterday\'s date range', {
      yesterday: yesterdayFormatted,
      today: todayFormatted
    });
    
    let hasNextPage = true;
    let after: string | null = null;
    let totalOrders = 0;
    let pageCount = 0;

    // Fetch all of yesterday's orders with pagination
    while (hasNextPage) {
      pageCount++;
      AppLogger.debug('Fetching yesterday\'s orders batch', { page: pageCount });

      const response = await admin.graphql(GET_ORDERS_WITH_PRODUCTS, {
        variables: {
          first: 100,
          query: yesterdaysOrdersQuery,
          after: after
        }
      });
      
      // Add proper type annotation for response
      const data: GraphQLResponse<OrdersResponse> = await response.json();
      
      if (data.errors) {
        AppLogger.error('GraphQL errors in yesterday\'s orders query', { errors: data.errors });
        break;
      }

      if (!data.data?.orders?.edges) {
        AppLogger.info('No orders found for yesterday');
        break;
      }

      const orders = data.data.orders.edges;
      totalOrders += orders.length;
      
      AppLogger.debug('Processing yesterday\'s orders batch', {
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
              // Use originalTotalSet as it's the correct field in the API
              const revenue = parseFloat(lineItem.node.originalTotalSet.shopMoney.amount) || 0;
              
              if (salesMap.has(productId)) {
                const existing = salesMap.get(productId)!;
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
        AppLogger.debug('Fetching next page of yesterday\'s orders');
      }
    }
    
    AppLogger.info('Yesterday\'s orders fetch completed', {
      totalOrders,
      productsWithSales: salesMap.size
    });
    
    return salesMap;
    
  } catch (error) {
    AppLogger.error('Error fetching yesterday\'s orders', error);
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
    AppLogger.debug('Fetching products with pagination', { first, after: after ? 'yes' : 'no' });
    
    const response = await admin.graphql(GET_ALL_PRODUCTS, {
      variables: {
        first,
        after
      }
    });
    
    // Add proper type annotation for response
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
      AppLogger.error('GraphQL errors in products query', { errors: data.errors });
      return { products: [], hasNextPage: false, endCursor: null, startCursor: null };
    }

    if (!data.data?.products?.edges) {
      AppLogger.warn('No products found in pagination query');
      return { products: [], hasNextPage: false, endCursor: null, startCursor: null };
    }

    const products = data.data.products.edges.map(edge => edge.node);
    const pageInfo = data.data.products.pageInfo;
    
    AppLogger.debug('Products pagination result', {
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
    AppLogger.error('Error fetching products with pagination', error, { first, after });
    return { products: [], hasNextPage: false, endCursor: null, startCursor: null };
  }
}

// UPDATED loader function with PROPER server-side pagination for 10,000+ products
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin } = await authenticate.admin(request);
  const url = new URL(request.url);
  
  const selectedMonth = parseInt(url.searchParams.get("month") || "6");
  const productsCount = parseInt(url.searchParams.get("count") || "250");
  const page = parseInt(url.searchParams.get("page") || "1");
  const searchQuery = url.searchParams.get("search") || "";
  const after = url.searchParams.get("after") || null;

  AppLogger.info('Bestsellers loader started', {
    selectedMonth,
    productsCount,
    page,
    searchQuery,
    after: after ? 'yes' : 'no'
  });

  try {
    // STEP 1: Fetch sales data based on selected period
    AppLogger.info('Fetching sales data for period', { selectedMonth });
    
    let salesData: Map<string, SalesData>;
    
    // Special handling for "Today only" and "Yesterday only" options
    if (selectedMonth === 0) { // Today only
      salesData = await fetchTodaysOrders(admin);
    } else if (selectedMonth === 0.1) { // Yesterday only
      salesData = await fetchYesterdaysOrders(admin);
    } else { // Historical data for selected period
      salesData = await fetchSalesData(admin, selectedMonth);
    }
    
    AppLogger.info('Sales data fetch completed', {
      productsWithSales: salesData.size,
      period: selectedMonth
    });
    
    // If no sales data, return early
    if (salesData.size === 0) {
      AppLogger.warn('No sales data found for period', { selectedMonth });
      return {
        bestsellers: [],
        totalProducts: 0,
        currentPage: page,
        hasNextPage: false,
        hasPreviousPage: false,
        selectedMonth: selectedMonth.toString(),
        productsCount,
        searchQuery,
      };
    }

    // STEP 2: Create a sorted list of product IDs based on sales
    AppLogger.info('Creating sorted product list by sales');
    
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
    
    AppLogger.info('Products sorted by sales', {
      totalProductsWithSales: productsWithSalesData.length,
      topSales: productsWithSalesData.slice(0, 3).map(p => ({ id: p.id, sales: p.sales }))
    });
    
    // Apply search filter if provided to sorted list
    let filteredProductIds = productsWithSalesData;
    if (searchQuery) {
      // For search, we need to fetch product titles to match
      AppLogger.info('Applying search filter', { searchQuery });
      
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
        
        // Filter products that have sales and match search query
        products.forEach(product => {
          // Fixed: Use a different variable name to avoid conflict with Map
          const productSalesData = salesData.get(product.id);
          if (productSalesData && productSalesData.sales > 0) {
            if (product.title.toLowerCase().includes(searchQuery.toLowerCase())) {
              matchedProductIds.push({
                id: product.id,
                sales: productSalesData.sales,
                revenue: productSalesData.revenue
              });
            }
          }
        });
        
        hasMoreProducts = hasNextPage && endCursor !== null;
        productsAfter = endCursor;
        
        AppLogger.debug('Search batch processed', {
          batch: batchCount,
          productsChecked: products.length,
          matchesFound: matchedProductIds.length,
          totalProductsFetched
        });
      }
      
      // Sort matched products by sales
      matchedProductIds.sort((a, b) => b.sales - a.sales);
      filteredProductIds = matchedProductIds;
      
      AppLogger.info('Search filter applied', {
        searchQuery,
        beforeSearch: productsWithSalesData.length,
        afterSearch: filteredProductIds.length
      });
    }
    
    // Calculate total products for pagination
    const totalProductsCount = filteredProductIds.length;
    
    // Apply pagination to sorted list
    const startIndex = (page - 1) * productsCount;
    const endIndex = startIndex + productsCount;
    const paginatedProductIds = filteredProductIds.slice(startIndex, endIndex);
    
    AppLogger.info('Applying pagination', {
      page,
      productsCount,
      startIndex,
      endIndex,
      paginatedProducts: paginatedProductIds.length
    });
    
    // STEP 3: Fetch actual product details for current page
    const productIds = paginatedProductIds.map(p => p.id);
    const productDetails = new Map<string, ProductNode>();
    
    AppLogger.info('Fetching product details', { productIdsCount: productIds.length });
    
    // Fetch products in batches to handle API limits
    for (let i = 0; i < productIds.length; i += 50) {
      const batchIds = productIds.slice(i, i + 50);
      
      // Create a query to fetch specific products by ID
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
              variants(first: 50) {
                edges {
                  node {
                    price
                    inventoryQuantity
                    inventoryItem {
                      tracked
                    }
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
      
      const response = await admin.graphql(GET_PRODUCTS_BY_IDS, {
        variables: {
          ids: batchIds
        }
      });
      
      const data: GraphQLResponse<{ nodes: (ProductNode | null)[] }> = await response.json();
      
      if (data.errors) {
        AppLogger.error('GraphQL errors in products by IDs query', {
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
      
      AppLogger.debug('Product details batch fetched', {
        batch: Math.floor(i / 50) + 1,
        productsFetched: data.data?.nodes?.length || 0
      });
    }
    
    AppLogger.info('Product details fetch completed', {
      totalDetailsFetched: productDetails.size,
      expected: productIds.length
    });
    
    // STEP 4: Transform products with sales data
    const bestsellers: BestsellerProduct[] = [];
    
    paginatedProductIds.forEach((productData, index) => {
      const productDetail = productDetails.get(productData.id);
      
      if (!productDetail) {
        AppLogger.warn('Product details not found', { productId: productData.id });
        return;
      }
      
      // Calculate accurate inventory by summing all variant inventory
      let totalInventory = 0;
      if (productDetail.variants?.edges) {
        productDetail.variants.edges.forEach(variantEdge => {
          const variant = variantEdge.node;
          // Only count inventory if it's tracked
          if (variant.inventoryItem?.tracked) {
            totalInventory += variant.inventoryQuantity || 0;
          }
        });
      }
      
      // Fall back to totalInventory if we couldn't calculate from variants
      if (totalInventory === 0) {
        totalInventory = productDetail.totalInventory || 0;
      }
      
      const mainVariant = productDetail.variants?.edges[0]?.node;
      const price = mainVariant?.price || '0.00';
      const basePrice = parseFloat(price);
      
      const sales = productData.sales;
      const revenue = productData.revenue;
      const isNew = isProductNew(productDetail.createdAt);
      
      // Trend calculation based on actual sales performance
      let trend = '↗'; // Default for some sales
      if (sales > 10) trend = '🚀'; // High sales
      else if (sales > 5) trend = '↑'; // Good sales

      const bestsellerProduct: BestsellerProduct = {
        id: productDetail.id,
        position: startIndex + index + 1, // Correct position based on overall ranking
        trend,
        image: productDetail.featuredImage?.url || '',
        title: productDetail.title,
        price: `$${basePrice.toFixed(2)}`,
        sales,
        revenue: `$${revenue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
        isNew,
        inStock: totalInventory,
        created: new Date(productDetail.createdAt).toLocaleDateString('en-US', {
          year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
        }).replace(',', ''),
      };

      bestsellers.push(bestsellerProduct);
    });

    AppLogger.info('Bestsellers transformation completed', {
      bestsellersCount: bestsellers.length,
      page,
      totalProducts: totalProductsCount
    });
    
    // Calculate pagination info
    const hasPreviousPage = page > 1;
    const hasNextPage = endIndex < totalProductsCount;

    // Calculate cursors for next/prev navigation
    let nextCursor = null;
    let prevCursor = null;
    
    if (hasNextPage && bestsellers.length > 0) {
      // For next page, we'll use position-based approach
      nextCursor = (page + 1).toString();
    }
    
    if (hasPreviousPage) {
      // For previous page, we'll use position-based approach
      prevCursor = (page - 1).toString();
    }

    AppLogger.info('Bestsellers loader completed successfully', {
      bestsellersReturned: bestsellers.length,
      totalProducts: totalProductsCount,
      currentPage: page,
      hasNextPage,
      hasPreviousPage
    });

    return {
      bestsellers,
      totalProducts: totalProductsCount,
      currentPage: page,
      hasNextPage,
      hasPreviousPage,
      selectedMonth: selectedMonth.toString(),
      productsCount,
      searchQuery,
      endCursor: nextCursor,
      startCursor: prevCursor,
    };

  } catch (error: any) {
    AppLogger.error('Error in Bestsellers loader', error, {
      selectedMonth,
      productsCount,
      page,
      searchQuery
    });
    return { 
      bestsellers: [], 
      totalProducts: 0,
      currentPage: page,
      hasNextPage: false,
      hasPreviousPage: false,
      selectedMonth: selectedMonth.toString(), 
      productsCount,
      searchQuery,
    };
  }
};

export default function BestsellersPage() {
  const { 
    bestsellers = [], 
    totalProducts,
    currentPage: initialPage,
    hasNextPage,
    hasPreviousPage,
    selectedMonth: initialMonth = "6", 
    productsCount: initialCount = 250,
    searchQuery: initialSearch,
    endCursor,
    startCursor,
  } = useLoaderData<LoaderData>();
  
  const submit = useSubmit();
  const navigate = useNavigate();
  
  const [selectedMonth, setSelectedMonth] = useState(initialMonth);
  const [productsCount, setProductsCount] = useState(initialCount);
  const [searchQuery, setSearchQuery] = useState(initialSearch);
  const [currentPage, setCurrentPage] = useState(initialPage);

  // ADD COMPONENT MOUNT LOGGING
  useEffect(() => {
    AppLogger.info('BestsellersPage component mounted', {
      initialBestsellers: bestsellers.length,
      initialMonth,
      initialPage,
      initialSearch
    });
  }, []);

  // UPDATED: Month options with shorter periods for testing
  const monthOptions = [
    { label: 'Today only', value: '0' },
    { label: 'Yesterday only', value: '0.1' }, // Special value for yesterday
    { label: '1 week', value: '0.25' },
    { label: '1 month', value: '1' },
    { label: '2 months', value: '2' },
    { label: '3 months', value: '3' },
    { label: '6 months', value: '6' },
  ];

  // Handle month period change
  const handleMonthChange = (value: string) => {
    AppLogger.info('Month period changed', {
      from: selectedMonth,
      to: value
    });
    setSelectedMonth(value);
    
    const params = new URLSearchParams(window.location.search);
    params.set("month", value);
    params.set("page", "1");
    
    submit(params, { replace: true });
  };

  // Handle count change
  const handleCountChange = (value: string) => {
    const newCount = parseInt(value);
    AppLogger.info('Products per page changed', {
      from: productsCount,
      to: newCount
    });
    setProductsCount(newCount);
    
    const params = new URLSearchParams(window.location.search);
    params.set("count", value);
    params.set("page", "1");
    
    submit(params, { replace: true });
  };

  // Handle page change
  const handlePageChange = (page: number) => {
    AppLogger.info('Page changed', {
      from: currentPage,
      to: page
    });
    setCurrentPage(page);
    
    const params = new URLSearchParams(window.location.search);
    params.set("page", page.toString());
    params.set("month", selectedMonth);
    
    navigate(`?${params.toString()}`, { replace: true });
  };

  // Handle search with debounce
  useEffect(() => {
    const timer = setTimeout(() => {
      if (searchQuery !== initialSearch) {
        AppLogger.info('Search query executed', {
          searchQuery,
          previousSearch: initialSearch
        });
        const params = new URLSearchParams(window.location.search);
        if (searchQuery) {
          params.set("search", searchQuery);
        } else {
          params.delete("search");
        }
        params.set("page", "1");
        params.set("month", selectedMonth);
        
        submit(params, { replace: true });
      }
    }, 500);

    return () => clearTimeout(timer);
  }, [searchQuery, submit, initialSearch, selectedMonth]);

  const rows = bestsellers.map((product: BestsellerProduct) => [
    <Text as="span" fontWeight="bold" key="trend">{product.trend}</Text>,
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
    <Text as="span" fontWeight="bold" key="sales">{product.sales}</Text>,
    <Text as="span" fontWeight="bold" key="revenue">{product.revenue}</Text>,
    <Badge tone={product.isNew ? 'success' : 'info'} key="new">{product.isNew ? 'yes' : 'no'}</Badge>,
    <Text as="span" key="stock">{product.inStock}</Text>,
    <Text as="span" key="created">{product.created}</Text>,
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
    }) + ' GMT - 05:00)';
  };

  // Calculate statistics for display
  const totalSales = bestsellers.reduce((sum, p) => sum + p.sales, 0);
  const totalRevenue = bestsellers.reduce((sum, p) => sum + parseFloat(p.revenue.replace('$', '').replace(',', '')), 0);
  const averageSales = bestsellers.length > 0 ? (totalSales / bestsellers.length).toFixed(1) : '0';

  // Calculate position range for current page
  const startPosition = bestsellers.length > 0 ? ((currentPage - 1) * productsCount) + 1 : 0;
  const endPosition = bestsellers.length > 0 ? startPosition + bestsellers.length - 1 : 0;

  // Calculate total pages
  const totalPages = Math.ceil(totalProducts / productsCount);

  return (
    <Page
      title={`Bestsellers (Last ${selectedMonth} Month${selectedMonth !== '1' ? 's' : ''})`}
      subtitle="Products with actual sales - ranked by sales performance"
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
                      placeholder="Search bestselling products..."
                      value={searchQuery}
                      onChange={setSearchQuery}
                      autoComplete="off"
                      prefix={<Icon source={SearchIcon} />}
                      clearButton
                      onClearButtonClick={() => {
                        AppLogger.info('Search cleared');
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
                          options={[
                            { label: '50 products', value: '50' },
                            { label: '100 products', value: '100' },
                            { label: '250 products', value: '250' },
                            { label: '500 products', value: '500' },
                          ]}
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
                      minWidth: '200px'
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
                    <InlineStack gap="200" blockAlign="center">
                      <Text as="span" variant="bodyMd">
                        Sales period:
                      </Text>
                      <div style={{ width: '150px' }}>
                        <Select
                          label="Month period"
                          labelHidden
                          options={monthOptions}
                          onChange={handleMonthChange}
                          value={selectedMonth}
                        />
                      </div>
                    </InlineStack>
                    <Text as="span" tone="subdued" variant="bodySm">
                      {selectedMonth === '0' ? 'Today only' : 
                       selectedMonth === '0.1' ? 'Yesterday only' : 
                       `Last ${selectedMonth} month${selectedMonth !== '1' ? 's' : ''} of sales data`}
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
                      {bestsellers.length} products with sales on this page
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
                <Text as="h3" variant="headingSm">Bestsellers Performance</Text>
                <Text as="p" tone="subdued" variant="bodySm">
                  <strong>🚀</strong> High sales (10+ units) • <strong>↑</strong> Good sales (5-9 units) • <strong>↗</strong> Some sales (1-4 units)
                </Text>
                <Text as="p" tone="subdued" variant="bodySm">
                  <strong>Note:</strong> Only products with actual sales in the selected period are shown.
                  Products are ranked by the number of units sold (highest first).
                </Text>
                <InlineStack gap="400">
                  <Text as="p" variant="bodySm" fontWeight="medium">
                    Page Products: <Text as="span" tone="success">{bestsellers.length}</Text>
                  </Text>
                  <Text as="p" variant="bodySm" fontWeight="medium">
                    Page Sales: <Text as="span" tone="success">{totalSales} units</Text>
                  </Text>
                  <Text as="p" variant="bodySm" fontWeight="medium">
                    Page Revenue: <Text as="span" tone="success">${totalRevenue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</Text>
                  </Text>
                  <Text as="p" variant="bodySm" fontWeight="medium">
                    Avg. Sales: <Text as="span" tone="success">{averageSales} units/product</Text>
                  </Text>
                </InlineStack>
              </BlockStack>
            </Box>

            {/* Data Table */}
            {bestsellers.length > 0 ? (
              <>
                <DataTable
                  columnContentTypes={['text', 'numeric', 'text', 'text', 'numeric', 'numeric', 'numeric', 'text', 'numeric', 'text']}
                  headings={['Trend', 'Position', 'Image', 'Title', 'Price', '# of Sales', 'Revenue', 'New', 'In Stock', 'Created']}
                  rows={rows}
                  footerContent={`Showing positions ${startPosition} - ${endPosition} • ${bestsellers.length} products with sales • ${totalSales} units sold • $${totalRevenue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} revenue`}
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
                  </InlineStack>
                </Box>
              </>
            ) : (
              <Box padding="800">
                <div style={{ textAlign: 'center' }}>
                  <Text as="p" variant="bodyMd" fontWeight="medium">
                    No bestselling products found
                  </Text>
                  <Box paddingBlockStart="200">
                    <Text as="p" variant="bodySm" tone="subdued">
                      {searchQuery 
                        ? `No products with sales found matching "${searchQuery}" in the last ${selectedMonth} month${selectedMonth !== '1' ? 's' : ''}.`
                        : `No products with sales found in the last ${selectedMonth} month${selectedMonth !== '1' ? 's' : ''}.`
                      }
                    </Text>
                  </Box>
                  {searchQuery && (
                    <Box paddingBlockStart="200">
                      <Button onClick={() => {
                        AppLogger.info('Clear search clicked from empty state');
                        setSearchQuery('');
                      }}>
                        Clear search
                      </Button>
                    </Box>
                  )}
                  {(hasNextPage || hasPreviousPage) && (
                    <Box paddingBlockStart="200">
                      <Text as="p" variant="bodySm" tone="subdued">
                        Try navigating to other pages or changing the sales period.
                      </Text>
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
                Page {currentPage} of {totalPages} • {productsCount} products per page • {selectedMonth === '0' ? 'Today only' : selectedMonth === '0.1' ? 'Yesterday only' : `Last ${selectedMonth} month${selectedMonth !== '1' ? 's' : ''}`} of sales data
              </Text>
            </InlineStack>
          </Box>
        </Layout.Section>
      </Layout>
    </Page>
  );
}