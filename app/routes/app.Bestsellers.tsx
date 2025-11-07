// app/routes/app.Bestsellers.tsx
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
import { fetchAllProducts, fetchProductSalesData } from "../lib/shopify";
import { SearchIcon } from '@shopify/polaris-icons';

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
  selectedPeriod: string;
  productsCount: number;
  searchQuery: string;
}

// UPDATED: "New" is now fixed to the last 10 days
const isProductNew = (createdAt: string): boolean => {
  const createdDate = new Date(createdAt);
  const tenDaysAgo = new Date();
  tenDaysAgo.setDate(tenDaysAgo.getDate() - 10);
  return createdDate > tenDaysAgo;
};

// Updated loader function with pagination and search
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin } = await authenticate.admin(request);
  const url = new URL(request.url);
  
  const selectedPeriod = parseInt(url.searchParams.get("period") || "30");
  const productsCount = parseInt(url.searchParams.get("count") || "250");
  const page = parseInt(url.searchParams.get("page") || "1");
  const searchQuery = url.searchParams.get("search") || "";
  const after = url.searchParams.get("after") || null;

  try {
    // Fetch products with pagination
    const [productsData, salesData] = await Promise.all([
      fetchAllProducts(admin, productsCount, after),
      fetchProductSalesData(admin, selectedPeriod)
    ]);
    
    console.log(`Fetched ${productsData?.data?.products?.edges?.length || 0} products for page ${page}`);
    console.log(`Fetched sales data for ${salesData.size} products`);

    if (productsData?.data?.products && productsData.data.products.edges.length > 0) {
      
      const products = productsData.data.products.edges.map((edge: any) => edge.node);

      type IntermediateBestsellerProduct = Omit<BestsellerProduct, 'position'>;

      // Transform products with REAL sales data
      const transformedData: IntermediateBestsellerProduct[] = products.map((product: any) => {
        const mainVariant = product.variants?.edges[0]?.node;
        const price = mainVariant?.price || '0.00';
        const basePrice = parseFloat(price);
        const inventory = product.totalInventory || 0;
        
        // Get REAL sales data from orders
        const productSalesData = salesData.get(product.id) || { sales: 0, revenue: 0 };
        const sales = productSalesData.sales;
        const revenue = productSalesData.revenue;
        
        const isNew = isProductNew(product.createdAt);
        
        // Simple trend calculation based on sales
        let trend = '→'; // neutral
        if (sales > 0) trend = '↑'; // has sales
        if (sales === 0) trend = '↓'; // no sales
        
        return {
          id: product.id,
          trend,
          image: product.featuredImage?.url || '',
          title: product.title,
          price: `$${basePrice.toFixed(2)}`,
          sales,
          revenue: `$${revenue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
          isNew,
          inStock: inventory,
          created: new Date(product.createdAt).toLocaleDateString('en-US', {
            year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
          }).replace(',', ''),
        };
      });

      // Filter by search query if provided
      let filteredProducts = transformedData;
      if (searchQuery) {
        filteredProducts = transformedData.filter(product =>
          product.title.toLowerCase().includes(searchQuery.toLowerCase())
        );
      }

      // Sort by REAL sales in descending order (most sold products first)
      const productsWithSales = filteredProducts.filter(product => product.sales > 0);
      const productsWithoutSales = filteredProducts.filter(product => product.sales === 0);
      
      const sortedWithSales = productsWithSales.sort((a, b) => b.sales - a.sales);
      const sortedWithoutSales = productsWithoutSales.sort((a, b) => new Date(b.created).getTime() - new Date(a.created).getTime());
      
      // Combine both arrays
      const sortedData = [...sortedWithSales, ...sortedWithoutSales];
      
      // Assign final positions and slice to the desired count
      const finalData: BestsellerProduct[] = sortedData.map((product: IntermediateBestsellerProduct, index: number) => ({
        ...product,
        position: index + 1 + ((page - 1) * productsCount),
      }));

      console.log(`Processed ${filteredProducts.length} products. Showing ${finalData.length} bestsellers.`);
      console.log(`Products with sales: ${productsWithSales.length}, without sales: ${productsWithoutSales.length}`);
      
      // Always show pagination - calculate based on whether we have products
      const hasNextPage = productsData.data.products.pageInfo?.hasNextPage || false;
      const hasPreviousPage = page > 1; // Always show previous if not on first page
      
      return {
        bestsellers: finalData,
        totalProducts: filteredProducts.length,
        currentPage: page,
        hasNextPage,
        hasPreviousPage,
        selectedPeriod: selectedPeriod.toString(),
        productsCount,
        searchQuery,
        endCursor: productsData.data.products.pageInfo?.endCursor,
      };
    }
    
    console.log("No products found in the store.");
    return { 
      bestsellers: [], 
      totalProducts: 0,
      currentPage: page,
      hasNextPage: false,
      hasPreviousPage: false,
      selectedPeriod: selectedPeriod.toString(), 
      productsCount,
      searchQuery,
    };

  } catch (error) {
    console.error('Error in Bestsellers loader:', error);
    return { 
      bestsellers: [], 
      totalProducts: 0,
      currentPage: page,
      hasNextPage: false,
      hasPreviousPage: false,
      selectedPeriod: selectedPeriod.toString(), 
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
    selectedPeriod: initialPeriod = "30", 
    productsCount: initialCount = 250,
    searchQuery: initialSearch
  } = useLoaderData<LoaderData>();
  
  const submit = useSubmit();
  const navigate = useNavigate();
  
  const [selectedPeriod, setSelectedPeriod] = useState(initialPeriod);
  const [productsCount, setProductsCount] = useState(initialCount);
  const [searchQuery, setSearchQuery] = useState(initialSearch);
  const [currentPage, setCurrentPage] = useState(initialPage);

  const periodOptions = [
    { label: '14 days', value: '14' },
    { label: '30 days', value: '30' },
    { label: '90 days', value: '90' },
    { label: '180 days', value: '180' },
    { label: '365 days', value: '365' },
  ];

  // Handle period change
  const handlePeriodChange = (value: string) => {
    setSelectedPeriod(value);
    
    const params = new URLSearchParams(window.location.search);
    params.set("period", value);
    params.set("page", "1"); // Reset to first page when period changes
    
    submit(params, { replace: true });
  };

  // Handle count change
  const handleCountChange = (value: string) => {
    const newCount = parseInt(value);
    setProductsCount(newCount);
    
    const params = new URLSearchParams(window.location.search);
    params.set("count", value);
    params.set("page", "1"); // Reset to first page when count changes
    
    submit(params, { replace: true });
  };

  // Handle page change
  const handlePageChange = (page: number) => {
    setCurrentPage(page);
    
    const params = new URLSearchParams(window.location.search);
    params.set("page", page.toString());
    
    navigate(`?${params.toString()}`, { replace: true });
  };

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
        
        submit(params, { replace: true });
      }
    }, 500);

    return () => clearTimeout(timer);
  }, [searchQuery, submit]);

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

  // Always show pagination in top right
  const showPagination = bestsellers.length > 0;

  return (
    <Page
      title={`Bestsellers (by # of Sales) within ${selectedPeriod} days`}
      subtitle="Store-wide statistics for products identified as 'bestsellers' based on the number of sales"
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
                        Searching for: "{searchQuery}" • Found {totalProducts} matching products
                      </Text>
                    )}
                  </BlockStack>
                  
                  {/* Additional info on the right */}
                  <Text as="span" variant="bodySm" tone="subdued">
                    {bestsellers.length} products displayed
                  </Text>
                </InlineStack>
              </BlockStack>
            </Box>

            {/* Information Section */}
            <Box padding="400">
              <BlockStack gap="200">
                <Text as="h3" variant="headingSm">Trend Indicators</Text>
                <Text as="p" tone="subdued" variant="bodySm">
                  <strong>↑</strong> Product has sales • <strong>→</strong> Neutral position • <strong>↓</strong> No sales
                </Text>
                <Text as="p" tone="subdued" variant="bodySm">
                  <strong>Note:</strong> The "New" badge indicates a product created in the last 10 days.
                </Text>
              </BlockStack>
            </Box>

            {/* Data Table */}
            {bestsellers.length > 0 ? (
              <>
                <DataTable
                  columnContentTypes={['text', 'numeric', 'text', 'text', 'numeric', 'numeric', 'numeric', 'text', 'numeric', 'text']}
                  headings={['Trend', 'Position', 'Image', 'Title', 'Price', '# of Sales', 'Revenue', 'New', 'In Stock', 'Created']}
                  rows={rows}
                  footerContent={`Showing ${bestsellers.length} of ${totalProducts} bestselling products${searchQuery ? ' matching search' : ''}`}
                />

                {/* Bottom Pagination - ALWAYS SHOW */}
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
                      ? `No products found matching "${searchQuery}".` 
                      : 'No products found to calculate bestsellers.'
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