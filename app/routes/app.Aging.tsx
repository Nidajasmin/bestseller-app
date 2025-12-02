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
import { AppLogger } from "../utils/logging";

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
    AppLogger.info('Starting sales data fetch from orders');
    
    const salesMap = new Map<string, SalesData>();
    const last60DaysDate = getLast60DaysDate();
    let after: string | null = null;
    let hasNextPage = true;
    let totalOrdersProcessed = 0;
    const MAX_ORDERS = 500;
    const startTime = Date.now();
    const MAX_TIME_MS = 30000;

    while (hasNextPage && totalOrdersProcessed < MAX_ORDERS && (Date.now() - startTime) < MAX_TIME_MS) {
      AppLogger.debug('Fetching orders batch', {
        batch: Math.floor(totalOrdersProcessed / 50) + 1,
        after: after ? 'yes' : 'no'
      });

      const response: any = await admin.graphql(GET_ALL_ORDERS, {
        variables: {
          first: 50,
          after: after
        }
      });
      
      const data: any = await response.json();
      
      if (data.errors || !data.data?.orders?.edges) {
        AppLogger.error('Error fetching orders data', data.errors, {
          batch: Math.floor(totalOrdersProcessed / 50) + 1
        });
        break;
      }

      const orders = data.data.orders.edges;
      totalOrdersProcessed += orders.length;

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
      
      if ((Date.now() - startTime) > MAX_TIME_MS) {
        AppLogger.warn('Sales data fetch time limit reached', {
          ordersProcessed: totalOrdersProcessed,
          timeElapsed: Date.now() - startTime
        });
        break;
      }
    }

    AppLogger.info('Sales data fetch completed', {
      productsWithSales: salesMap.size,
      totalOrdersProcessed,
      timeElapsed: Date.now() - startTime
    });
    
    return salesMap;
    
  } catch (error) {
    AppLogger.error('Error fetching sales data', error, {
      operation: 'fetchAllSalesData'
    });
    return new Map();
  }
}

// Optimized function to fetch products with limits
async function fetchAllProducts(admin: any): Promise<any[]> {
  try {
    AppLogger.info('Starting products fetch from store');
    
    const allProducts: any[] = [];
    let after: string | null = null;
    let hasNextPage = true;
    let pageCount = 0;
    const MAX_PRODUCTS = 500;
    const MAX_PAGES = 5;
    const startTime = Date.now();

    while (hasNextPage && pageCount < MAX_PAGES && allProducts.length < MAX_PRODUCTS) {
      pageCount++;
      
      AppLogger.debug('Fetching products batch', {
        page: pageCount,
        after: after ? 'yes' : 'no'
      });

      const response: any = await admin.graphql(GET_ALL_PRODUCTS, {
        variables: {
          first: 100,
          after: after
        }
      });
      
      const data: any = await response.json();
      
      if (data.errors || !data.data?.products?.edges) {
        AppLogger.error('Error fetching products data', data.errors, {
          page: pageCount,
          operation: 'fetchAllProducts'
        });
        break;
      }

      const products = data.data.products.edges.map((edge: any) => edge.node);
      allProducts.push(...products);

      if (allProducts.length >= MAX_PRODUCTS) {
        AppLogger.info('Reached maximum products limit', { maxProducts: MAX_PRODUCTS });
        break;
      }

      hasNextPage = data.data.products.pageInfo?.hasNextPage || false;
      after = data.data.products.pageInfo?.endCursor;
      
      if (!hasNextPage) break;
    }

    AppLogger.info('Products fetch completed', {
      totalProducts: allProducts.length,
      timeElapsed: Date.now() - startTime
    });
    
    return allProducts;
    
  } catch (error) {
    AppLogger.error('Error fetching products', error, {
      operation: 'fetchAllProducts'
    });
    return [];
  }
}

const getDaysSinceCreation = (createdAt: string): number => {
  const createdDate = new Date(createdAt);
  const today = new Date();
  
  createdDate.setHours(0, 0, 0, 0);
  today.setHours(0, 0, 0, 0);
  
  const diffTime = today.getTime() - createdDate.getTime();
  const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
  
  return Math.max(0, diffDays);
};

const getDaysSinceLastSale = (lastSaleDate: string | null): number => {
  if (!lastSaleDate) return 9999;
  const lastSale = new Date(lastSaleDate);
  const today = new Date();
  const diffTime = Math.abs(today.getTime() - lastSale.getTime());
  return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
};

const isProductNew = (createdAt: string): boolean => {
  const createdDate = new Date(createdAt);
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  return createdDate > thirtyDaysAgo;
};

const isAgedProduct = (product: any, salesData: SalesData, settings: AgingSettings): boolean => {
  const daysSinceCreation = getDaysSinceCreation(product.createdAt);
  const hasInventory = (product.totalInventory ?? 0) > 0;
  const salesLast60Days = salesData.salesLast60Days;
  
  const meetsAgeCriteria = daysSinceCreation >= settings.minAgeDays;
  const meetsSalesCriteria = salesLast60Days <= settings.maxSales;
  const meetsInventoryCriteria = !settings.requireInventory || hasInventory;
  
  const meetsAllCriteria = meetsAgeCriteria && meetsSalesCriteria && meetsInventoryCriteria;

  return meetsAllCriteria;
};

const logAgingAnalysisSummary = (allProducts: any[], salesDataMap: Map<string, SalesData>, settings: AgingSettings) => {
  AppLogger.info('Aging analysis summary started', {
    totalProducts: allProducts.length,
    settings
  });
  
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
  
  AppLogger.info('Aging analysis statistics', {
    totalProducts,
    productsWithSales: productsWithSalesData,
    productsWithZeroSales,
    productsWithAgeOverMin,
    productsWithLowSales,
    productsWithInventory,
    productsMeetingAllCriteria
  });
  
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
    .slice(0, 10);
    
  if (nearCriteriaProducts.length > 0) {
    AppLogger.debug('Products near aging criteria', {
      nearCriteriaProducts: nearCriteriaProducts.map(p => ({
        title: p.title.substring(0, 40),
        daysSinceCreation: getDaysSinceCreation(p.createdAt),
        salesLast60Days: salesDataMap.get(normalizeProductId(p.id))?.salesLast60Days || 0,
        inventory: p.totalInventory || 0
      }))
    });
  }
};

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin } = await authenticate.admin(request);
  const url = new URL(request.url);
  
  const productsCount = parseInt(url.searchParams.get("count") || "50");
  const page = parseInt(url.searchParams.get("page") || "1");
  const searchQuery = url.searchParams.get("search") || "";
  const settingsUpdated = url.searchParams.get("settingsUpdated");

  let currentSettings = loadSettings();
  
  const minAgeFromUrl = url.searchParams.get("minAgeDays");
  const maxSalesFromUrl = url.searchParams.get("maxSales");
  const requireInventoryFromUrl = url.searchParams.get("requireInventory");
  
  if (minAgeFromUrl || maxSalesFromUrl || requireInventoryFromUrl) {
    currentSettings = {
      minAgeDays: minAgeFromUrl ? parseInt(minAgeFromUrl) : currentSettings.minAgeDays,
      maxSales: maxSalesFromUrl ? parseInt(maxSalesFromUrl) : currentSettings.maxSales,
      requireInventory: requireInventoryFromUrl ? requireInventoryFromUrl === 'true' : currentSettings.requireInventory
    };
    AppLogger.info('Using settings from URL parameters', { settings: currentSettings });
  } else {
    AppLogger.info('Using settings from localStorage', { settings: currentSettings });
  }

  AppLogger.info('Aged Products loader started', {
    productsCount,
    page,
    searchQuery,
    settingsUpdated: !!settingsUpdated,
    currentSettings
  });

  const cachedData = getCachedData();
  if (cachedData && 
      JSON.stringify(cachedData.settings) === JSON.stringify(currentSettings) &&
      !settingsUpdated) {
    AppLogger.info('Using cached aged products data');
    return {
      ...cachedData.data,
      filters: currentSettings,
    };
  } else if (settingsUpdated) {
    AppLogger.info('Settings updated - bypassing cache');
  }

  try {
    AppLogger.info('Fetching sales data and products in parallel');
    const salesDataPromise = fetchAllSalesData(admin);
    const productsPromise = fetchAllProducts(admin);
    
    const [salesData, allProducts] = await Promise.all([salesDataPromise, productsPromise]);
    
    if (allProducts.length === 0) {
      AppLogger.warn('No products found in store');
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

    AppLogger.info('Processing products for aging analysis', {
      totalProducts: allProducts.length,
      productsWithSalesData: salesData.size
    });

    const sortedByAge = [...allProducts].sort((a, b) => {
      return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
    });
    
    AppLogger.debug('Oldest products in store', {
      oldestProducts: sortedByAge.slice(0, 5).map((p, index) => ({
        position: index + 1,
        title: p.title.substring(0, 40),
        daysOld: getDaysSinceCreation(p.createdAt)
      }))
    });

    logAgingAnalysisSummary(allProducts, salesData, currentSettings);

    const agedProductsList: AgedProduct[] = [];
    let agedCount = 0;

    AppLogger.info('Applying aging criteria to products', {
      criteria: {
        minAgeDays: currentSettings.minAgeDays,
        maxSales: currentSettings.maxSales,
        requireInventory: currentSettings.requireInventory
      }
    });

    for (let i = 0; i < allProducts.length; i++) {
      const product = allProducts[i];
      const mainVariant = product.variants?.edges[0]?.node;
      const price = mainVariant?.price || '0.00';
      const basePrice = parseFloat(price);
      const inventory = product.totalInventory || 0;
      
      const normalizedProductId = normalizeProductId(product.id);
      const productSalesData = salesData.get(normalizedProductId) || { 
        salesLast60Days: 0, 
        totalSales: 0, 
        revenue: 0, 
        lastSaleDate: null 
      };
      
      const daysSinceCreation = getDaysSinceCreation(product.createdAt);
      
      const isAged = isAgedProduct(product, productSalesData, currentSettings);

      const isCloseToCriteria = daysSinceCreation >= currentSettings.minAgeDays - 2 || 
                               (productSalesData.salesLast60Days > 0 && productSalesData.salesLast60Days <= currentSettings.maxSales + 2);

      if (isCloseToCriteria) {
        AppLogger.debug('Product near aging criteria', {
          title: product.title.substring(0, 40),
          daysSinceCreation,
          salesLast60Days: productSalesData.salesLast60Days,
          inventory,
          meetsCriteria: isAged
        });
      }

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
        
        if (agedCount <= 10) {
          AppLogger.debug('Product matches aging criteria', {
            title: product.title,
            daysSinceCreation,
            salesLast60Days: productSalesData.salesLast60Days,
            inventory
          });
        }
      }
    }

    AppLogger.info('Aging analysis completed', {
      totalAgedProducts: agedCount,
      criteria: currentSettings
    });

    let filteredProducts = agedProductsList;
    if (searchQuery) {
      filteredProducts = agedProductsList.filter((product: AgedProduct) =>
        product.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
        product.vendor.toLowerCase().includes(searchQuery.toLowerCase())
      );
      AppLogger.info('Applied search filter', {
        searchQuery,
        beforeSearch: agedProductsList.length,
        afterSearch: filteredProducts.length
      });
    }

    const sortedProducts = filteredProducts.sort((a: AgedProduct, b: AgedProduct) => {
      if (b.daysSinceCreation !== a.daysSinceCreation) {
        return b.daysSinceCreation - a.daysSinceCreation;
      }
      return a.salesLast60Days - b.salesLast60Days;
    });

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

    if (!settingsUpdated) {
      setCachedData(result, currentSettings);
      AppLogger.info('Cached aged products data');
    }

    AppLogger.info('Loader returning aged products data', {
      returnedProducts: paginatedProducts.length,
      totalProducts: sortedProducts.length,
      currentPage: page,
      totalPages
    });

    return result;

  } catch (error) {
    AppLogger.error('Error in Aged Products loader', error, {
      productsCount,
      page,
      searchQuery
    });
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
    AppLogger.info('Settings modal opened', { settings });
    setLocalSettings(settings);
    setMinAgeError('');
    setMaxSalesError('');
  }, [settings, open]);

  const handleSave = () => {
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
      AppLogger.info('Saving validated aging settings', { settings: localSettings });
      onSave(localSettings);
    } else {
      AppLogger.warn('Settings validation failed', {
        minAgeError,
        maxSalesError
      });
    }
  };

  const handleReset = () => {
    AppLogger.info('Resetting to default aging settings');
    setLocalSettings(DEFAULT_AGING_SETTINGS);
    setMinAgeError('');
    setMaxSalesError('');
  };

  const handleInventoryRequirementChange = useCallback((value: string[]) => {
    const newRequireInventory = value.includes('requireInventory');
    AppLogger.debug('Inventory requirement changed', { requireInventory: newRequireInventory });
    setLocalSettings(prev => ({
      ...prev,
      requireInventory: newRequireInventory
    }));
  }, []);

  const handleMinAgeChange = useCallback((value: string) => {
    const numValue = parseInt(value) || 0;
    AppLogger.debug('Minimum age changed', { minAgeDays: numValue });
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
    AppLogger.debug('Maximum sales changed', { maxSales: numValue });
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
            Configure criteria for identifying aged products. Products meeting all these conditions will be flagged as "Aged".
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
            helpText="Products with this many sales or fewer in last 60 days"
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

  useEffect(() => {
    AppLogger.info('AgingPage component mounted', {
      initialAgedProducts: agedProducts.length,
      initialSettings: filters,
      currentPage: initialPage,
      searchQuery: initialSearch
    });
  }, []);

  useEffect(() => {
    setLoading(false);
    AppLogger.info('Aging page data loaded', {
      agedProductsCount: agedProducts.length,
      totalProducts,
      filters,
      currentPage,
      searchQuery
    });
  }, [agedProducts, filters, currentPage, searchQuery, totalProducts]);

  useEffect(() => {
    AppLogger.debug('Aging settings updated from loader', { filters });
    setCurrentSettings(filters);
  }, [filters]);

  const handleCountChange = (value: string) => {
    const newCount = parseInt(value);
    AppLogger.info('Products per page changed', {
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
    AppLogger.info('Page changed', {
      from: currentPage,
      to: page
    });
    setCurrentPage(page);
    setLoading(true);
    
    const params = new URLSearchParams(window.location.search);
    params.set("page", page.toString());
    
    navigate(`?${params.toString()}`, { replace: true });
  };

  useEffect(() => {
    const timer = setTimeout(() => {
      if (searchQuery !== initialSearch) {
        AppLogger.info('Search query executed', {
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
        
        submit(params, { replace: true });
      }
    }, 500);

    return () => clearTimeout(timer);
  }, [searchQuery, submit, initialSearch]);

  const handleSettingsSave = (newSettings: AgingSettings) => {
    AppLogger.info('Saving new aging settings', {
      oldSettings: currentSettings,
      newSettings
    });
    
    saveSettings(newSettings);
    
    try {
      localStorage.removeItem('aged-products-cache');
      AppLogger.info('Aged products cache cleared');
    } catch (error) {
      AppLogger.error('Error clearing aged products cache', error);
    }
    
    setCurrentSettings(newSettings);
    setLoading(true);
    
    setSettingsModalOpen(false);
    
    const params = new URLSearchParams(window.location.search);
    params.set("settingsUpdated", Date.now().toString());
    params.set("minAgeDays", newSettings.minAgeDays.toString());
    params.set("maxSales", newSettings.maxSales.toString());
    params.set("requireInventory", newSettings.requireInventory.toString());
    params.set("page", "1");
    
    AppLogger.info('Submitting new settings to loader', {
      urlParams: {
        minAgeDays: newSettings.minAgeDays,
        maxSales: newSettings.maxSales,
        requireInventory: newSettings.requireInventory
      }
    });
    submit(params, { replace: true });
  };

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

  const totalAgedProducts = agedProducts.filter(p => p.isAged).length;
  const averageAge = agedProducts.length > 0 ? 
    Math.round(agedProducts.reduce((sum, p) => sum + p.daysSinceCreation, 0) / agedProducts.length) : 0;
  const zeroSalesProducts = agedProducts.filter(p => p.salesLast60Days === 0).length;

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
            <Box padding="400" borderBlockEndWidth="025" borderColor="border">
              <BlockStack gap="400">
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
                      onClearButtonClick={() => {
                        AppLogger.info('Search cleared');
                        setSearchQuery('');
                      }}
                    />
                  </div>
                  
                  <InlineStack gap="400" blockAlign="center">
                    <Button
                      icon={SettingsIcon}
                      onClick={() => {
                        AppLogger.info('Settings button clicked');
                        setSettingsModalOpen(true);
                      }}
                      variant="secondary"
                    >
                      Settings
                    </Button>
                    
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
                        ? `Showing ${agedProducts.length} products (${totalAgedProducts} aged) that meet criteria`
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
                  
                  <Button onClick={() => {
                    AppLogger.info('Manual refresh triggered');
                    window.location.reload();
                  }} disabled={loading}>
                    {loading ? 'Refreshing...' : 'Refresh'}
                  </Button>
                </InlineStack>
              </BlockStack>
            </Box>

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
                    <Button onClick={() => {
                      AppLogger.info('Adjust settings clicked from empty state');
                      setSettingsModalOpen(true);
                    }}>
                      Adjust Settings
                    </Button>
                  </Box>
                </div>
              </Box>
            )}
          </Card>

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

      <SettingsModal
        open={settingsModalOpen}
        onClose={() => {
          AppLogger.info('Settings modal closed');
          setSettingsModalOpen(false);
        }}
        settings={currentSettings}
        onSave={handleSettingsSave}
      />
    </Page>
  );
}