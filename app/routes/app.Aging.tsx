import React, { useState, useEffect, useCallback } from 'react';
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
  Modal,
  ChoiceList,
} from '@shopify/polaris';
import { useLoaderData, useSubmit, useNavigate, type LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { SearchIcon, SettingsIcon } from '@shopify/polaris-icons';
import { 
  AgingSettings, 
  DEFAULT_AGING_SETTINGS, 
  loadSettings, 
  saveSettings,
  getCachedData,
  setCachedData,
} from "../utils/agingSettings";

interface AgedProduct {
  id: string;
  position: number;
  image: string;
  title: string;
  price: string;
  salesLast60Days: number;
  totalSales: number;
  revenue: string;
  isNew: boolean;
  inStock: number;
  created: string;
  vendor: string;
  status: string;
  daysSinceCreation: number;
  daysSinceLastSale: number;
  isAged: boolean;
}

interface SalesData {
  salesLast60Days: number;
  totalSales: number;
  revenue: number;
  lastSaleDate: string | null;
}

interface LoaderData {
  agedProducts: AgedProduct[];
  totalProducts: number;
  currentPage: number;
  hasNextPage: boolean;
  hasPreviousPage: boolean;
  productsCount: number;
  searchQuery: string;
  agedProductsCount: number;
  filters: AgingSettings;
}

// GraphQL query to fetch orders with line items for sales calculation
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

// GraphQL query to fetch ALL products
const GET_ALL_PRODUCTS = `#graphql
  query GetAllProducts($first: Int!, $after: String) {
    products(first: $first, after: $after, sortKey: CREATED_AT, reverse: false) {
      pageInfo {
        hasNextPage
        hasPreviousPage
        endCursor
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
          variants(first: 10) {
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

// Function to calculate date for last 60 days
const getLast60DaysDate = (): string => {
  const date = new Date();
  date.setDate(date.getDate() - 60);
  return date.toISOString().split('T')[0];
};

// Function to normalize product IDs for matching
const normalizeProductId = (productId: string): string => {
  return productId.replace(/^gid:\/\/shopify\/Product\//, '');
};

// Optimized function to fetch sales data with time limit
async function fetchAllSalesData(admin: any): Promise<Map<string, SalesData>> {
  try {
    console.log(`🛒 Fetching sales data from orders (optimized)`);
    
    const salesMap = new Map<string, SalesData>();
    const last60DaysDate = getLast60DaysDate();
    let after: string | null = null;
    let hasNextPage = true;
    let totalOrdersProcessed = 0;
    const MAX_ORDERS = 500; // Limit to 500 orders for performance
    const startTime = Date.now();
    const MAX_TIME_MS = 30000; // 30 second timeout

    while (hasNextPage && totalOrdersProcessed < MAX_ORDERS && (Date.now() - startTime) < MAX_TIME_MS) {
      const response: any = await admin.graphql(GET_ALL_ORDERS, {
        variables: {
          first: 50, // Reduced from 100 to 50
          after: after
        }
      });
      
      const data: any = await response.json();
      
      if (data.errors || !data.data?.orders?.edges) {
        console.error('❌ Error fetching orders data');
        break;
      }

      const orders = data.data.orders.edges;
      totalOrdersProcessed += orders.length;

      // Process orders in batches for better performance
      orders.forEach((order: any) => {
        const orderDate = order.node.processedAt;
        const isRecentSale = orderDate >= last60DaysDate;
        
        if (order.node.lineItems?.edges) {
          order.node.lineItems.edges.forEach((lineItem: any) => {
            if (lineItem.node.product && lineItem.node.product.id) {
              const rawProductId = lineItem.node.product.id;
              const productId = normalizeProductId(rawProductId);
              const quantity = lineItem.node.quantity || 0;
              const revenue = parseFloat(lineItem.node.originalTotalSet?.shopMoney?.amount || '0');
              
              if (salesMap.has(productId)) {
                const existing = salesMap.get(productId)!;
                salesMap.set(productId, {
                  salesLast60Days: isRecentSale ? existing.salesLast60Days + quantity : existing.salesLast60Days,
                  totalSales: existing.totalSales + quantity,
                  revenue: existing.revenue + revenue,
                  lastSaleDate: orderDate > (existing.lastSaleDate || '') ? orderDate : existing.lastSaleDate
                });
              } else {
                salesMap.set(productId, {
                  salesLast60Days: isRecentSale ? quantity : 0,
                  totalSales: quantity,
                  revenue: revenue,
                  lastSaleDate: orderDate
                });
              }
            }
          });
        }
      });

      hasNextPage = data.data.orders.pageInfo?.hasNextPage || false;
      after = data.data.orders.pageInfo?.endCursor;
      
      // Break if taking too long
      if ((Date.now() - startTime) > MAX_TIME_MS) {
        console.log(`⏰ Time limit reached after ${totalOrdersProcessed} orders`);
        break;
      }
    }

    console.log(`✅ Found sales data for ${salesMap.size} products from ${totalOrdersProcessed} orders (in ${Date.now() - startTime}ms)`);
    
    return salesMap;
    
  } catch (error) {
    console.error('💥 Error fetching sales data:', error);
    return new Map();
  }
}

// Optimized function to fetch products with limits
async function fetchAllProducts(admin: any): Promise<any[]> {
  try {
    console.log(`📦 Fetching products from store (optimized)`);
    
    const allProducts: any[] = [];
    let after: string | null = null;
    let hasNextPage = true;
    let pageCount = 0;
    const MAX_PRODUCTS = 500; // Limit to 500 products for performance
    const MAX_PAGES = 5; // Reduced from 20 to 5
    const startTime = Date.now();

    while (hasNextPage && pageCount < MAX_PAGES && allProducts.length < MAX_PRODUCTS) {
      pageCount++;
      
      const response: any = await admin.graphql(GET_ALL_PRODUCTS, {
        variables: {
          first: 100,
          after: after
        }
      });
      
      const data: any = await response.json();
      
      if (data.errors || !data.data?.products?.edges) {
        console.error('❌ Error fetching products data:', data.errors);
        break;
      }

      const products = data.data.products.edges.map((edge: any) => edge.node);
      allProducts.push(...products);

      // Check if we've reached the limit
      if (allProducts.length >= MAX_PRODUCTS) {
        console.log(`📦 Reached product limit of ${MAX_PRODUCTS}`);
        break;
      }

      hasNextPage = data.data.products.pageInfo?.hasNextPage || false;
      after = data.data.products.pageInfo?.endCursor;
      
      if (!hasNextPage) break;
    }

    console.log(`✅ Total products fetched: ${allProducts.length} (in ${Date.now() - startTime}ms)`);
    
    return allProducts;
    
  } catch (error) {
    console.error('💥 Error fetching products:', error);
    return [];
  }
}

// FIXED: Calculate days since creation (proper date math)
const getDaysSinceCreation = (createdAt: string): number => {
  const createdDate = new Date(createdAt);
  const today = new Date();
  
  // Set both dates to midnight for accurate day calculation
  createdDate.setHours(0, 0, 0, 0);
  today.setHours(0, 0, 0, 0);
  
  const diffTime = today.getTime() - createdDate.getTime();
  const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
  
  return Math.max(0, diffDays); // Ensure no negative days
};

// Calculate days since last sale
const getDaysSinceLastSale = (lastSaleDate: string | null): number => {
  if (!lastSaleDate) return 9999; // Never sold
  const lastSale = new Date(lastSaleDate);
  const today = new Date();
  const diffTime = Math.abs(today.getTime() - lastSale.getTime());
  return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
};

// Helper function to check if a product is "new" (created in the last 30 days)
const isProductNew = (createdAt: string): boolean => {
  const createdDate = new Date(createdAt);
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  return createdDate > thirtyDaysAgo;
};

// FIXED: Check if product meets aged product criteria with better inventory handling
const isAgedProduct = (product: any, salesData: SalesData, settings: AgingSettings): boolean => {
  const daysSinceCreation = getDaysSinceCreation(product.createdAt);
  
  // FIXED: Better inventory check - handle null/undefined
  const hasInventory = (product.totalInventory ?? 0) > 0;
  const salesLast60Days = salesData.salesLast60Days;
  
  const meetsAgeCriteria = daysSinceCreation >= settings.minAgeDays; // Changed to >=
  const meetsSalesCriteria = salesLast60Days <= settings.maxSales; // Changed to <=
  const meetsInventoryCriteria = !settings.requireInventory || hasInventory;
  
  const meetsAllCriteria = meetsAgeCriteria && meetsSalesCriteria && meetsInventoryCriteria;

  return meetsAllCriteria;
};

// FIXED: Enhanced logging for better debugging
const logAgingAnalysisSummary = (allProducts: any[], salesDataMap: Map<string, SalesData>, settings: AgingSettings) => {
  console.log('📊 AGING ANALYSIS SUMMARY');
  console.log('========================');
  
  let totalProducts = allProducts.length;
  let productsWithAgeOverMin = 0;
  let productsWithLowSales = 0;
  let productsWithInventory = 0;
  let productsMeetingAllCriteria = 0;
  let productsWithSalesData = 0;
  let productsWithZeroSales = 0;
  
  allProducts.forEach((product: any) => {
    const normalizedId = normalizeProductId(product.id);
    const productSalesData = salesDataMap.get(normalizedId);
    
    const salesLast60Days = productSalesData?.salesLast60Days || 0;
    const daysSinceCreation = getDaysSinceCreation(product.createdAt);
    const hasInventory = (product.totalInventory ?? 0) > 0;
    
    if (productSalesData && salesLast60Days > 0) {
      productsWithSalesData++;
    }
    
    if (salesLast60Days === 0) {
      productsWithZeroSales++;
    }
    
    if (daysSinceCreation >= settings.minAgeDays) productsWithAgeOverMin++;
    if (salesLast60Days <= settings.maxSales) productsWithLowSales++;
    if (hasInventory) productsWithInventory++;
    
    if (daysSinceCreation >= settings.minAgeDays && 
        salesLast60Days <= settings.maxSales && 
        (!settings.requireInventory || hasInventory)) {
      productsMeetingAllCriteria++;
    }
  });
  
  console.log(`📦 Total Products: ${totalProducts}`);
  console.log(`💰 Products with sales (60d): ${productsWithSalesData}`);
  console.log(`❌ Products with zero sales: ${productsWithZeroSales}`);
  console.log(`📅 Products >= ${settings.minAgeDays} days: ${productsWithAgeOverMin}`);
  console.log(`📉 Products with <= ${settings.maxSales} sales: ${productsWithLowSales}`);
  console.log(`📦 Products with inventory > 0: ${productsWithInventory}`);
  console.log(`🎯 Products meeting ALL criteria: ${productsMeetingAllCriteria}`);
  console.log('========================');
  
  // Log some example products that are close to criteria
  console.log('🔍 EXAMPLE PRODUCTS NEAR CRITERIA:');
  const nearCriteriaProducts = allProducts
    .filter(product => {
      const normalizedId = normalizeProductId(product.id);
      const productSalesData = salesDataMap.get(normalizedId);
      const salesLast60Days = productSalesData?.salesLast60Days || 0;
      const daysSinceCreation = getDaysSinceCreation(product.createdAt);
      const hasInventory = (product.totalInventory ?? 0) > 0;
      
      return daysSinceCreation <= settings.minAgeDays + 5 || 
             salesLast60Days <= settings.maxSales + 5;
    })
    .slice(0, 10); // Show first 10
    
  nearCriteriaProducts.forEach((product, index) => {
    const normalizedId = normalizeProductId(product.id);
    const productSalesData = salesDataMap.get(normalizedId);
    const salesLast60Days = productSalesData?.salesLast60Days || 0;
    const daysSinceCreation = getDaysSinceCreation(product.createdAt);
    const hasInventory = (product.totalInventory ?? 0) > 0;
    
    console.log(`   ${index + 1}. "${product.title}" - ${daysSinceCreation}d, ${salesLast60Days} sales, inventory: ${hasInventory}`);
  });
};

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin } = await authenticate.admin(request);
  const url = new URL(request.url);
  
  const productsCount = parseInt(url.searchParams.get("count") || "50");
  const page = parseInt(url.searchParams.get("page") || "1");
  const searchQuery = url.searchParams.get("search") || "";
  const settingsUpdated = url.searchParams.get("settingsUpdated");

  // CRITICAL FIX: Get settings from URL parameters OR localStorage
  let currentSettings = loadSettings();
  
  // Check if settings are passed via URL (for server-side loading)
  const minAgeFromUrl = url.searchParams.get("minAgeDays");
  const maxSalesFromUrl = url.searchParams.get("maxSales");
  const requireInventoryFromUrl = url.searchParams.get("requireInventory");
  
  if (minAgeFromUrl || maxSalesFromUrl || requireInventoryFromUrl) {
    currentSettings = {
      minAgeDays: minAgeFromUrl ? parseInt(minAgeFromUrl) : currentSettings.minAgeDays,
      maxSales: maxSalesFromUrl ? parseInt(maxSalesFromUrl) : currentSettings.maxSales,
      requireInventory: requireInventoryFromUrl ? requireInventoryFromUrl === 'true' : currentSettings.requireInventory
    };
    console.log("🔄 Using settings from URL parameters:", currentSettings);
  } else {
    console.log("🎯 Using settings from localStorage:", currentSettings);
  }

  console.log("🚀 Starting Aged Products loader");
  console.log("📊 Parameters:", { productsCount, page, searchQuery, settingsUpdated });

  // Check cache first, but ONLY if settings haven't been updated
  const cachedData = getCachedData();
  if (cachedData && 
      JSON.stringify(cachedData.settings) === JSON.stringify(currentSettings) &&
      !settingsUpdated) {
    console.log('💾 Using cached data');
    return {
      ...cachedData.data,
      filters: currentSettings,
    };
  } else if (settingsUpdated) {
    console.log('🔄 Settings updated - bypassing cache');
  }

  try {
    // STEP 1: Fetch sales data and products in parallel
    console.log("🛒 Step 1: Fetching sales data...");
    const salesDataPromise = fetchAllSalesData(admin);
    
    console.log("📦 Step 2: Fetching products...");
    const productsPromise = fetchAllProducts(admin);
    
    // Wait for both to complete
    const [salesData, allProducts] = await Promise.all([salesDataPromise, productsPromise]);
    
    if (allProducts.length === 0) {
      console.log("❌ No products found in the store.");
      return { 
        agedProducts: [], 
        totalProducts: 0,
        currentPage: page,
        hasNextPage: false,
        hasPreviousPage: false,
        productsCount,
        searchQuery,
        agedProductsCount: 0,
        filters: currentSettings,
      };
    }

    console.log(`📊 Processing ${allProducts.length} products with current settings`);

    // STEP 2: Quick analysis - FIND OLDEST PRODUCTS
    console.log('📊 QUICK ANALYSIS:');
    console.log(`📦 Total Products: ${allProducts.length}`);
    console.log(`📊 Products with sales data: ${Array.from(salesData.keys()).length}`);
    console.log(`🎯 Criteria: Age >= ${currentSettings.minAgeDays} days, Sales <= ${currentSettings.maxSales}, Inventory: ${currentSettings.requireInventory ? 'required' : 'optional'}`);

    // Find and log the actual oldest products
    const sortedByAge = [...allProducts].sort((a, b) => {
      return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
    });
    
    console.log('🔍 OLDEST 5 PRODUCTS:');
    sortedByAge.slice(0, 5).forEach((product, index) => {
      const daysOld = getDaysSinceCreation(product.createdAt);
      console.log(`   ${index + 1}. "${product.title}" - ${daysOld} days old`);
    });

    // STEP 3: Enhanced analysis summary
    logAgingAnalysisSummary(allProducts, salesData, currentSettings);

    // STEP 4: Find aged products with CURRENT settings
    const agedProductsList: AgedProduct[] = [];
    let agedCount = 0;

    console.log("🔍 Applying current criteria...");
    console.log(`🎯 CRITERIA: Age >= ${currentSettings.minAgeDays} days, Sales <= ${currentSettings.maxSales}, Inventory: ${currentSettings.requireInventory ? 'required' : 'optional'}`);

    // Use for loop for better performance
    for (let i = 0; i < allProducts.length; i++) {
      const product = allProducts[i];
      const mainVariant = product.variants?.edges[0]?.node;
      const price = mainVariant?.price || '0.00';
      const basePrice = parseFloat(price);
      const inventory = product.totalInventory || 0;
      
      // Get sales data for this product
      const normalizedProductId = normalizeProductId(product.id);
      const productSalesData = salesData.get(normalizedProductId) || { 
        salesLast60Days: 0, 
        totalSales: 0, 
        revenue: 0, 
        lastSaleDate: null 
      };
      
      const daysSinceCreation = getDaysSinceCreation(product.createdAt);
      
      // Check if product meets aged criteria
      const isAged = isAgedProduct(product, productSalesData, currentSettings);

      // Log products that are close to meeting criteria for debugging
      const isCloseToCriteria = daysSinceCreation >= currentSettings.minAgeDays - 2 || 
                               (productSalesData.salesLast60Days > 0 && productSalesData.salesLast60Days <= currentSettings.maxSales + 2);

      if (isCloseToCriteria) {
        console.log(`🔍 CHECKING: "${product.title.substring(0, 40)}..." - ${daysSinceCreation}d, ${productSalesData.salesLast60Days} sales, inventory: ${inventory} - Meets: ${isAged ? 'YES' : 'NO'}`);
      }

      // ONLY add to agedProductsList if it meets aged criteria
      if (isAged) {
        agedCount++;
        
        const productData: AgedProduct = {
          id: product.id,
          position: agedCount,
          image: product.featuredImage?.url || '',
          title: product.title,
          price: `$${basePrice.toFixed(2)}`,
          salesLast60Days: productSalesData.salesLast60Days,
          totalSales: productSalesData.totalSales,
          revenue: `$${productSalesData.revenue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
          isNew: isProductNew(product.createdAt),
          inStock: inventory,
          created: new Date(product.createdAt).toLocaleDateString('en-US', {
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
          }),
          vendor: product.vendor || 'Unknown',
          status: product.status || 'ACTIVE',
          daysSinceCreation: daysSinceCreation,
          daysSinceLastSale: getDaysSinceLastSale(productSalesData.lastSaleDate),
          isAged: true,
        };

        agedProductsList.push(productData);
        
        // Log the first few products that match
        if (agedCount <= 10) {
          console.log(`✅ MATCHES: "${product.title}" - ${daysSinceCreation} days, ${productSalesData.salesLast60Days} sales, inventory: ${inventory}`);
        }
      }
    }

    console.log(`🎯 Found ${agedCount} products matching current settings`);

    // STEP 5: Apply search filter if provided
    let filteredProducts = agedProductsList;
    if (searchQuery) {
      filteredProducts = agedProductsList.filter((product: AgedProduct) =>
        product.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
        product.vendor.toLowerCase().includes(searchQuery.toLowerCase())
      );
      console.log(`🔍 After search: ${filteredProducts.length} products`);
    }

    // STEP 6: Sort aged products
    const sortedProducts = filteredProducts.sort((a: AgedProduct, b: AgedProduct) => {
      if (b.daysSinceCreation !== a.daysSinceCreation) {
        return b.daysSinceCreation - a.daysSinceCreation;
      }
      return a.salesLast60Days - b.salesLast60Days;
    });

    // STEP 7: Apply pagination
    const startIndex = (page - 1) * productsCount;
    const endIndex = startIndex + productsCount;
    const paginatedProducts = sortedProducts.slice(startIndex, endIndex);
    const totalPages = Math.ceil(sortedProducts.length / productsCount);

    const result = {
      agedProducts: paginatedProducts,
      totalProducts: sortedProducts.length,
      currentPage: page,
      hasNextPage: page < totalPages,
      hasPreviousPage: page > 1,
      productsCount,
      searchQuery,
      agedProductsCount: agedCount,
      filters: currentSettings,
    };

    // Cache the result (only if not a settings update)
    if (!settingsUpdated) {
      setCachedData(result, currentSettings);
    }

    return result;

  } catch (error) {
    console.error('💥 Error in Aged Products loader:', error);
    return { 
      agedProducts: [], 
      totalProducts: 0,
      currentPage: page,
      hasNextPage: false,
      hasPreviousPage: false,
      productsCount,
      searchQuery,
      agedProductsCount: 0,
      filters: currentSettings,
    };
  }
};

// Settings Modal Component
const SettingsModal = ({ 
  open, 
  onClose, 
  settings, 
  onSave 
}: { 
  open: boolean; 
  onClose: () => void; 
  settings: AgingSettings;
  onSave: (settings: AgingSettings) => void;
}) => {
  const [localSettings, setLocalSettings] = useState<AgingSettings>(settings);
  const [minAgeError, setMinAgeError] = useState<string>('');
  const [maxSalesError, setMaxSalesError] = useState<string>('');

  useEffect(() => {
    console.log('⚙️ Settings modal opened with:', settings);
    setLocalSettings(settings);
    setMinAgeError('');
    setMaxSalesError('');
  }, [settings, open]);

  const handleSave = () => {
    // Validate inputs
    let hasError = false;
    
    if (localSettings.minAgeDays < 0) {
      setMinAgeError('Minimum age cannot be negative');
      hasError = true;
    } else {
      setMinAgeError('');
    }
    
    if (localSettings.maxSales < 0) {
      setMaxSalesError('Maximum sales cannot be negative');
      hasError = true;
    } else {
      setMaxSalesError('');
    }
    
    if (!hasError) {
      console.log('✅ Saving validated settings:', localSettings);
      onSave(localSettings);
    } else {
      console.log('❌ Settings validation failed');
    }
  };

  const handleReset = () => {
    console.log('🔄 Resetting to default settings');
    setLocalSettings(DEFAULT_AGING_SETTINGS);
    setMinAgeError('');
    setMaxSalesError('');
  };

  const handleInventoryRequirementChange = useCallback((value: string[]) => {
    const newRequireInventory = value.includes('requireInventory');
    console.log(`📦 Inventory requirement: ${newRequireInventory}`);
    setLocalSettings(prev => ({
      ...prev,
      requireInventory: newRequireInventory
    }));
  }, []);

  const handleMinAgeChange = useCallback((value: string) => {
    const numValue = parseInt(value) || 0;
    console.log(`📅 Minimum age changed to: ${numValue} days`);
    setLocalSettings(prev => ({
      ...prev,
      minAgeDays: numValue
    }));
    
    if (numValue < 0) {
      setMinAgeError('Minimum age cannot be negative');
    } else {
      setMinAgeError('');
    }
  }, []);

  const handleMaxSalesChange = useCallback((value: string) => {
    const numValue = parseInt(value) || 0;
    console.log(`💰 Maximum sales changed to: ${numValue}`);
    setLocalSettings(prev => ({
      ...prev,
      maxSales: numValue
    }));
    
    if (numValue < 0) {
      setMaxSalesError('Maximum sales cannot be negative');
    } else {
      setMaxSalesError('');
    }
  }, []);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Aged Products Settings"
      primaryAction={{
        content: 'Save Settings & Refresh',
        onAction: handleSave,
      }}
      secondaryActions={[
        {
          content: 'Reset to Defaults',
          onAction: handleReset,
        },
      ]}
    >
      <Modal.Section>
        <BlockStack gap="400">
          <Text as="p" variant="bodyMd">
            Configure the criteria for identifying aged products. Products meeting all these conditions will be flagged as "Aged".
          </Text>
          
          <TextField
            label="Minimum Age (days)"
            type="number"
            value={localSettings.minAgeDays.toString()}
            onChange={handleMinAgeChange}
            autoComplete="off"
            min={0}
            error={minAgeError}
            helpText="Products older than or equal to this many days will be considered"
          />
          
          <TextField
            label="Maximum Sales (last 60 days)"
            type="number"
            value={localSettings.maxSales.toString()}
            onChange={handleMaxSalesChange}
            autoComplete="off"
            min={0}
            error={maxSalesError}
            helpText="Products with this many sales or fewer in the last 60 days"
          />
          
          <ChoiceList
            title="Inventory Requirement"
            choices={[
              {
                label: 'Only include products with inventory > 0',
                value: 'requireInventory',
              },
            ]}
            selected={localSettings.requireInventory ? ['requireInventory'] : []}
            onChange={handleInventoryRequirementChange}
          />
          
          <Box 
            padding="400" 
            background="bg-surface-secondary" 
            borderRadius="200"
          >
            <BlockStack gap="200">
              <Text as="h4" variant="bodyMd" fontWeight="semibold">
                New Criteria Summary:
              </Text>
              <Text as="p" variant="bodySm">
                • Age &gt;= {localSettings.minAgeDays} days
              </Text>
              <Text as="p" variant="bodySm">
                • Sales (60 days) &lt;= {localSettings.maxSales}
              </Text>
              <Text as="p" variant="bodySm">
                • {localSettings.requireInventory ? 'Inventory > 0 required' : 'Any inventory level'}
              </Text>
              <Text as="p" variant="bodySm" tone="success">
                Click "Save Settings & Refresh" to see matching products
              </Text>
            </BlockStack>
          </Box>
        </BlockStack>
      </Modal.Section>
    </Modal>
  );
};

// Main Component
export default function AgingPage() {
  const { 
    agedProducts = [], 
    totalProducts,
    currentPage: initialPage,
    hasNextPage,
    hasPreviousPage,
    productsCount: initialCount = 50,
    searchQuery: initialSearch,
    agedProductsCount,
    filters
  } = useLoaderData<LoaderData>();
  
  const submit = useSubmit();
  const navigate = useNavigate();
  
  const [productsCount, setProductsCount] = useState(initialCount);
  const [searchQuery, setSearchQuery] = useState(initialSearch);
  const [currentPage, setCurrentPage] = useState(initialPage);
  const [loading, setLoading] = useState(false);
  const [settingsModalOpen, setSettingsModalOpen] = useState(false);
  const [currentSettings, setCurrentSettings] = useState<AgingSettings>(filters);

  // Reset loading state when new data is loaded
  useEffect(() => {
    setLoading(false);
    console.log('🔄 Data loaded with settings:', filters);
    console.log('📊 Products found:', agedProducts.length);
  }, [agedProducts, filters]);

  // Update current settings when filters change
  useEffect(() => {
    console.log('🎯 Settings updated from loader:', filters);
    setCurrentSettings(filters);
  }, [filters]);

  // Handle count change
  const handleCountChange = (value: string) => {
    const newCount = parseInt(value);
    setProductsCount(newCount);
    setLoading(true);
    
    const params = new URLSearchParams(window.location.search);
    params.set("count", value);
    params.set("page", "1");
    
    submit(params, { replace: true });
  };

  // Handle page change
  const handlePageChange = (page: number) => {
    setCurrentPage(page);
    setLoading(true);
    
    const params = new URLSearchParams(window.location.search);
    params.set("page", page.toString());
    
    navigate(`?${params.toString()}`, { replace: true });
  };

  // Handle search with debounce
  useEffect(() => {
    const timer = setTimeout(() => {
      if (searchQuery !== initialSearch) {
        setLoading(true);
        const params = new URLSearchParams(window.location.search);
        if (searchQuery) {
          params.set("search", searchQuery);
        } else {
          params.delete("search");
        }
        params.set("page", "1");
        
        submit(params, { replace: true });
      }
    }, 500);

    return () => clearTimeout(timer);
  }, [searchQuery, submit, initialSearch]);

  // Handle settings save
  const handleSettingsSave = (newSettings: AgingSettings) => {
    console.log('💾 SAVING NEW SETTINGS:', newSettings);
    
    // Save to localStorage
    saveSettings(newSettings);
    
    // Clear cache to ensure fresh data
    try {
      localStorage.removeItem('aged-products-cache');
      console.log('🗑️ Cache cleared');
    } catch (error) {
      console.error('Error clearing cache:', error);
    }
    
    // Update local state
    setCurrentSettings(newSettings);
    setLoading(true);
    
    // Close modal
    setSettingsModalOpen(false);
    
    // Submit new settings to loader WITH settings in URL parameters
    const params = new URLSearchParams(window.location.search);
    params.set("settingsUpdated", Date.now().toString());
    params.set("minAgeDays", newSettings.minAgeDays.toString());
    params.set("maxSales", newSettings.maxSales.toString());
    params.set("requireInventory", newSettings.requireInventory.toString());
    params.set("page", "1");
    
    console.log('🔄 Submitting new settings to loader with URL parameters...');
    submit(params, { replace: true });
  };

  // Generate count options dynamically
  const generateCountOptions = () => {
    const options = [];
    const commonIncrements = [10, 25, 50, 100, 250];
    
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

  const rows = agedProducts.map((product: AgedProduct) => [
    <Text as="span" key="position">{product.position.toString()}</Text>,
    product.isAged ? (
      <Badge tone="critical" key="aged">Aged</Badge>
    ) : (
      <Badge tone="info" key="aged">Normal</Badge>
    ),
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
    <Text as="span" fontWeight="bold" key="sales60" tone={product.salesLast60Days === 0 ? "critical" : "success"}>
      {product.salesLast60Days}
    </Text>,
    <Text as="span" key="totalSales">{product.totalSales}</Text>,
    <Text as="span" key="revenue">{product.revenue}</Text>,
    <Badge tone={product.isNew ? 'success' : 'info'} key="new">{product.isNew ? 'yes' : 'no'}</Badge>,
    <Text as="span" key="stock">{product.inStock}</Text>,
    <Text as="span" key="created">{product.created}</Text>,
    <Text as="span" key="age" tone={product.daysSinceCreation > currentSettings.minAgeDays ? "critical" : "success"}>
      {product.daysSinceCreation} days
    </Text>,
    <Text as="span" key="lastSale" tone={product.daysSinceLastSale > 60 ? "critical" : "success"}>
      {product.daysSinceLastSale === 9999 ? 'Never' : `${product.daysSinceLastSale} days`}
    </Text>,
  ]);

  // Calculate statistics
  const totalAgedProducts = agedProducts.filter(p => p.isAged).length;
  const averageAge = agedProducts.length > 0 ? 
    Math.round(agedProducts.reduce((sum, p) => sum + p.daysSinceCreation, 0) / agedProducts.length) : 0;
  const zeroSalesProducts = agedProducts.filter(p => p.salesLast60Days === 0).length;

  // Enhanced pagination logic
  const showPagination = totalProducts > 0 && (hasNextPage || hasPreviousPage);
  const totalPages = Math.ceil(totalProducts / productsCount);

  return (
    <Page
      title="Aged Inventory Analysis"
      subtitle="Identify old products with low sales - Customizable criteria applied"
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
                      placeholder="Search by product title or vendor..."
                      value={searchQuery}
                      onChange={setSearchQuery}
                      autoComplete="off"
                      prefix={<Icon source={SearchIcon} />}
                      clearButton
                      onClearButtonClick={() => setSearchQuery('')}
                    />
                  </div>
                  
                  <InlineStack gap="400" blockAlign="center">
                    {/* Settings Button */}
                    <Button
                      icon={SettingsIcon}
                      onClick={() => setSettingsModalOpen(true)}
                      variant="secondary"
                    >
                      Settings
                    </Button>
                    
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

                    {/* Pagination - TOP */}
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
                          label={`Page ${currentPage} of ${totalPages}`}
                        />
                      </div>
                    )}
                  </InlineStack>
                </InlineStack>

                {/* Middle Row: Information */}
                <InlineStack align="space-between" blockAlign="center">
                  <BlockStack gap="100">
                    <Text as="p" variant="bodyMd" fontWeight="medium">
                      Aged Product Criteria (Customizable)
                    </Text>
                    <Text as="p" tone="subdued" variant="bodySm">
                      Age &gt;= {currentSettings.minAgeDays} days • Sales (60 days) &lt;= {currentSettings.maxSales} • {currentSettings.requireInventory ? 'Inventory > 0' : 'Any inventory'}
                    </Text>
                    <Text as="p" tone="subdued" variant="bodySm">
                      {agedProducts.length > 0 
                        ? `Showing ${agedProducts.length} products (${totalAgedProducts} aged) that meet the criteria`
                        : loading 
                          ? 'Loading aged products analysis...'
                          : 'No aged products found matching your criteria.'
                      }
                    </Text>
                    {searchQuery && (
                      <Text as="p" variant="bodySm" tone="subdued">
                        Searching for: "{searchQuery}"
                      </Text>
                    )}
                  </BlockStack>
                  
                  {/* Refresh Button */}
                  <Button onClick={() => window.location.reload()} disabled={loading}>
                    {loading ? 'Refreshing...' : 'Refresh'}
                  </Button>
                </InlineStack>
              </BlockStack>
            </Box>

            {/* Information Section */}
            {agedProducts.length > 0 && (
              <Box padding="400">
                <BlockStack gap="200">
                  <Text as="h3" variant="headingSm">Aged Inventory Analysis</Text>
                  <Text as="p" tone="subdued" variant="bodySm">
                    <strong>Sorting Priority:</strong> 1. Oldest products • 2. Lowest recent sales
                  </Text>
                  <Text as="p" tone="subdued" variant="bodySm">
                    <strong>"New" badge:</strong> Product created in the last 30 days
                  </Text>
                  <InlineStack gap="400">
                    <Text as="p" variant="bodySm" fontWeight="medium">
                      Total Products: <Text as="span" tone="success">{agedProducts.length}</Text>
                    </Text>
                    <Text as="p" variant="bodySm" fontWeight="medium">
                      Aged Products: <Text as="span" tone="critical">{totalAgedProducts}</Text>
                    </Text>
                    <Text as="p" variant="bodySm" fontWeight="medium">
                      Avg. Age: <Text as="span" tone="success">{averageAge} days</Text>
                    </Text>
                    <Text as="p" variant="bodySm" fontWeight="medium">
                      Zero Sales: <Text as="span" tone="critical">{zeroSalesProducts}</Text>
                    </Text>
                  </InlineStack>
                </BlockStack>
              </Box>
            )}

            {/* Data Table */}
            {loading ? (
              <Box padding="800">
                <div style={{ textAlign: 'center' }}>
                  <Text as="p" variant="bodyMd">
                    Loading aged products analysis...
                  </Text>
                </div>
              </Box>
            ) : agedProducts.length > 0 ? (
              <>
                <DataTable
                  columnContentTypes={[
                    'numeric',
                    'text',
                    'text',
                    'text',
                    'numeric',
                    'numeric',
                    'numeric',
                    'numeric',
                    'text',
                    'numeric',
                    'text',
                    'numeric',
                    'numeric',
                  ]}
                  headings={[
                    '#',
                    'Status',
                    'Image',
                    'Title',
                    'Price',
                    'Sales (60d)',
                    'Total Sales',
                    'Revenue',
                    'New',
                    'In Stock',
                    'Created',
                    'Age (Days)',
                    'Last Sale'
                  ]}
                  rows={rows}
                  footerContent={`Showing ${agedProducts.length} products • ${totalAgedProducts} aged products • Page ${currentPage} of ${totalPages}`}
                />

                {/* Bottom Pagination */}
                {showPagination && (
                  <Box padding="400">
                    <InlineStack align="center">
                      <div style={{
                        backgroundColor: '#f6f6f7',
                        padding: '12px 20px',
                        borderRadius: '8px',
                        border: '1px solid #e1e3e5',
                        minWidth: '240px'
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
                  </Box>
                )}
              </>
            ) : (
              <Box padding="800">
                <div style={{ textAlign: 'center' }}>
                  <Text as="p" variant="bodyMd" fontWeight="medium">
                    No aged products found
                  </Text>
                  <Box paddingBlockStart="200">
                    <Text as="p" variant="bodySm" tone="subdued">
                      {searchQuery 
                        ? `No aged products found matching "${searchQuery}".` 
                        : 'No products meet your aged criteria. Try adjusting the settings.'
                      }
                    </Text>
                  </Box>
                  {searchQuery && (
                    <Box paddingBlockStart="200">
                      <Button onClick={() => setSearchQuery('')} disabled={loading}>
                        Clear search
                      </Button>
                    </Box>
                  )}
                  <Box paddingBlockStart="200">
                    <Button onClick={() => setSettingsModalOpen(true)}>
                      Adjust Settings
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
                <strong>Analysis as of:</strong> {getCurrentDateTime()}
              </Text>
              <Text as="p" tone="subdued" variant="bodySm">
                {showPagination 
                  ? `Page ${currentPage} of ${totalPages} • ${productsCount} products per page`
                  : `${productsCount} products per page`
                }
              </Text>
            </InlineStack>
          </Box>
        </Layout.Section>
      </Layout>

      {/* Settings Modal */}
      <SettingsModal
        open={settingsModalOpen}
        onClose={() => setSettingsModalOpen(false)}
        settings={currentSettings}
        onSave={handleSettingsSave}
      />
    </Page>
  );
}