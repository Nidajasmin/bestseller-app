// app/routes/app.Aging.tsx
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
import { fetchAgingProducts } from "../lib/shopify";
import { SearchIcon } from '@shopify/polaris-icons';

interface AgingProduct {
  id: string;
  position: number;
  image: string;
  title: string;
  price: string;
  isNew: boolean;
  inStock: number;
  created: string;
  vendor: string;
  status: string;
}

interface LoaderData {
  agingProducts: AgingProduct[];
  totalProducts: number;
  currentPage: number;
  hasNextPage: boolean;
  hasPreviousPage: boolean;
  productsCount: number;
  searchQuery: string;
}

// Helper function to check if a product is "new" (created in the last 30 days)
const isProductNew = (createdAt: string): boolean => {
  const createdDate = new Date(createdAt);
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  return createdDate > thirtyDaysAgo;
};

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin } = await authenticate.admin(request);
  const url = new URL(request.url);
  
  const productsCount = parseInt(url.searchParams.get("count") || "250");
  const page = parseInt(url.searchParams.get("page") || "1");
  const searchQuery = url.searchParams.get("search") || "";
  const after = url.searchParams.get("after") || null;

  try {
    const agingData = await fetchAgingProducts(admin, productsCount, after);
    
    if (agingData?.data?.products && agingData.data.products.edges.length > 0) {
      const allProducts = agingData.data.products.edges.map((edge: any) => edge.node);
      
      console.log(`Found ${allProducts.length} products for page ${page}.`);

      // Filter products by search query if provided
      let filteredProducts = allProducts;
      if (searchQuery) {
        filteredProducts = allProducts.filter((product: any) =>
          product.title.toLowerCase().includes(searchQuery.toLowerCase())
        );
      }

      const transformedData = filteredProducts.map((product: any, index: number) => {
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
          isNew: isProductNew(product.createdAt),
          inStock: inventory,
          created: new Date(product.createdAt).toLocaleDateString('en-US', {
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
          }).replace(',', ''),
          vendor: product.vendor || 'Unknown',
          status: product.status || 'ACTIVE',
        };
      });

      return {
        agingProducts: transformedData,
        totalProducts: filteredProducts.length,
        currentPage: page,
        hasNextPage: agingData.data.products.pageInfo?.hasNextPage || false,
        hasPreviousPage: agingData.data.products.pageInfo?.hasPreviousPage || false,
        productsCount,
        searchQuery,
        endCursor: agingData.data.products.pageInfo?.endCursor,
      };
    }
    
    console.log("No products found in the store.");
    return { 
      agingProducts: [], 
      totalProducts: 0,
      currentPage: page,
      hasNextPage: false,
      hasPreviousPage: false,
      productsCount,
      searchQuery,
    };

  } catch (error) {
    console.error('Error in Aging loader:', error);
    return { 
      agingProducts: [], 
      totalProducts: 0,
      currentPage: page,
      hasNextPage: false,
      hasPreviousPage: false,
      productsCount,
      searchQuery,
    };
  }
};

export default function AgingPage() {
  const { 
    agingProducts = [], 
    totalProducts,
    currentPage: initialPage,
    hasNextPage,
    hasPreviousPage,
    productsCount: initialCount,
    searchQuery: initialSearch
  } = useLoaderData<LoaderData>();
  
  const submit = useSubmit();
  const navigate = useNavigate();
  
  const [productsCount, setProductsCount] = useState(initialCount);
  const [searchQuery, setSearchQuery] = useState(initialSearch);
  const [currentPage, setCurrentPage] = useState(initialPage);

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

  // Generate count options dynamically (1 to 500 with common increments)
  const generateCountOptions = () => {
    const options = [];
    
    // Add common increments
    const commonIncrements = [1, 5, 10, 25, 50, 100, 250, 500];
    
    commonIncrements.forEach(count => {
      options.push({
        label: `${count} product${count !== 1 ? 's' : ''}`,
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

  const rows = agingProducts.map((product: AgingProduct) => [
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
    <Badge tone={product.isNew ? 'success' : 'info'} key="new">{product.isNew ? 'yes' : 'no'}</Badge>,
    <Text as="span" key="stock">{product.inStock}</Text>,
    <Text as="span" key="created">{product.created}</Text>,
  ]);

  return (
    <Page
      title="Oldest Store Inventory"
      subtitle="Products in your store, shown from oldest to newest."
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
                </InlineStack>

                {/* Middle Row: Information */}
                <InlineStack align="space-between" blockAlign="center">
                  <BlockStack gap="100">
                    <Text as="p" variant="bodyMd">
                      This view shows the oldest products in your store. The "New" badge indicates if a product was created in the last 30 days.
                    </Text>
                    {searchQuery && (
                      <Text as="p" variant="bodySm" tone="subdued">
                        Searching for: "{searchQuery}" • Found {totalProducts} matching products
                      </Text>
                    )}
                  </BlockStack>
                  
                  {/* Pagination Controls */}
                  {(hasNextPage || hasPreviousPage) && (
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
                  )}
                </InlineStack>
              </BlockStack>
            </Box>

            {/* Data Table */}
            {agingProducts.length > 0 ? (
              <>
                <DataTable
                  columnContentTypes={[
                    'numeric',
                    'text',
                    'text',
                    'numeric',
                    'text',
                    'numeric',
                    'text',
                  ]}
                  headings={[
                    '#',
                    'Image',
                    'Title',
                    'Price',
                    'New',
                    'In Stock',
                    'Created'
                  ]}
                  rows={rows}
                  footerContent={`Showing ${agingProducts.length} of ${totalProducts} oldest products${searchQuery ? ' matching search' : ''}`}
                />

                {/* Bottom Pagination */}
                {(hasNextPage || hasPreviousPage) && (
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
                      : 'No products found in your store.'
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
                Page {currentPage} • {productsCount} products per page
              </Text>
            </InlineStack>
          </Box>
        </Layout.Section>
      </Layout>
    </Page>
  );
}