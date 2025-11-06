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
} from '@shopify/polaris';

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

// Mock function to simulate API call
const fetchTrendingProducts = async (first: number = 25): Promise<any> => {
  // Simulate API delay
  await new Promise(resolve => setTimeout(resolve, 1000));
  
  // Return mock data structure similar to your GraphQL response
  return {
    products: {
      edges: [
        {
          node: {
            id: 'gid://shopify/Product/1',
            title: 'Wester Dress 3',
            featuredImage: {
              url: '',
              altText: 'Wester Dress 3'
            },
            variants: {
              edges: [
                {
                  node: {
                    price: '40.00',
                    inventoryQuantity: 8,
                    sku: 'WD3'
                  }
                }
              ]
            },
            totalInventory: 8,
            createdAt: '2025-10-30T04:53:38Z',
            publishedAt: '2025-10-30T04:53:38Z',
            status: 'ACTIVE',
            vendor: 'Vendor 2',
            tags: ['dress', 'western'],
            onlineStoreUrl: 'https://store.com/products/wester-dress-3'
          }
        },
        {
          node: {
            id: 'gid://shopify/Product/2',
            title: 'summer 2',
            featuredImage: {
              url: '',
              altText: 'summer 2'
            },
            variants: {
              edges: [
                {
                  node: {
                    price: '20.00',
                    inventoryQuantity: 22,
                    sku: 'SUM2'
                  }
                }
              ]
            },
            totalInventory: 22,
            createdAt: '2025-10-30T04:55:06Z',
            publishedAt: '2025-10-30T04:55:06Z',
            status: 'ACTIVE',
            vendor: 'Vendor 1',
            tags: ['summer', 'new'],
            onlineStoreUrl: 'https://store.com/products/summer-2'
          }
        },
        {
          node: {
            id: 'gid://shopify/Product/3',
            title: 'watch3',
            featuredImage: {
              url: '',
              altText: 'watch3'
            },
            variants: {
              edges: [
                {
                  node: {
                    price: '45.00',
                    inventoryQuantity: 31,
                    sku: 'W3'
                  }
                }
              ]
            },
            totalInventory: 31,
            createdAt: '2025-11-01T10:15:20Z',
            publishedAt: '2025-11-01T10:15:20Z',
            status: 'ACTIVE',
            vendor: 'Vendor 3',
            tags: ['watch', 'accessories'],
            onlineStoreUrl: 'https://store.com/products/watch3'
          }
        },
        {
          node: {
            id: 'gid://shopify/Product/4',
            title: 'watch2',
            featuredImage: {
              url: '',
              altText: 'watch2'
            },
            variants: {
              edges: [
                {
                  node: {
                    price: '19.99',
                    inventoryQuantity: 2,
                    sku: 'W2'
                  }
                }
              ]
            },
            totalInventory: 2,
            createdAt: '2025-11-01T10:14:41Z',
            publishedAt: '2025-11-01T10:14:41Z',
            status: 'ACTIVE',
            vendor: 'Vendor 5',
            tags: ['watch', 'accessories'],
            onlineStoreUrl: 'https://store.com/products/watch2'
          }
        },
        {
          node: {
            id: 'gid://shopify/Product/5',
            title: 'Summer Dress 1',
            featuredImage: {
              url: '',
              altText: 'Summer Dress 1'
            },
            variants: {
              edges: [
                {
                  node: {
                    price: '34.88',
                    inventoryQuantity: 24,
                    sku: 'SD1'
                  }
                }
              ]
            },
            totalInventory: 24,
            createdAt: '2025-10-28T10:44:04Z',
            publishedAt: '2025-10-28T10:44:04Z',
            status: 'ACTIVE',
            vendor: 'Vendor 4',
            tags: ['dress', 'summer'],
            onlineStoreUrl: 'https://store.com/products/summer-dress-1'
          }
        }
      ]
    }
  };
};

export default function TrendingPage() {
  const [selectedPeriod, setSelectedPeriod] = useState('7');
  const [trendingProducts, setTrendingProducts] = useState<TrendingProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [productsCount, setProductsCount] = useState(25);

  const periodOptions = [
    { label: '7 days', value: '7' },
    { label: '14 days', value: '14' },
    { label: '90 days', value: '90' },
  ];

  useEffect(() => {
    loadTrendingProducts();
  }, [selectedPeriod, productsCount]);

  const loadTrendingProducts = async () => {
    setLoading(true);
    try {
      // Use mock data instead of GraphQL for now
      const trendingData = await fetchTrendingProducts(productsCount);
      
      if (trendingData?.products) {
        const transformedData = transformProductsToTrending(
          trendingData.products.edges.map((edge: any) => edge.node),
          parseInt(selectedPeriod)
        );
        setTrendingProducts(transformedData);
      }
    } catch (error) {
      console.error('Error loading trending products:', error);
      setTrendingProducts(generateMockTrendingData());
    } finally {
      setLoading(false);
    }
  };

  const transformProductsToTrending = (products: any[], period: number): TrendingProduct[] => {
    // Exact data from your trending screenshot
    const trendingData = [
      {
        position: 2,
        previousPosition: 1,
        title: 'Wester Dress 3',
        price: '40.00',
        orders: 2,
        sales: 17,
        revenue: '6760.00',
        inStock: 8,
        created: '2025-10-30 04:53:38'
      },
      {
        position: 1,
        previousPosition: 2,
        title: 'summer 2',
        price: '20.00',
        orders: 1,
        sales: 34,
        revenue: '23120.00',
        inStock: 22,
        created: '2025-10-30 04:55:06'
      },
      {
        position: 3,
        previousPosition: 3,
        title: 'watch3',
        price: '45.00',
        orders: 1,
        sales: 14,
        revenue: '8820.00',
        inStock: 31,
        created: '2025-11-01 10:15:20'
      },
      {
        position: 5,
        previousPosition: 4,
        title: 'watch2',
        price: '19.99',
        orders: 1,
        sales: 10,
        revenue: '1999.00',
        inStock: 2,
        created: '2025-11-01 10:14:41'
      },
      {
        position: 4,
        previousPosition: 5,
        title: 'Summer Dress 1',
        price: '34.88',
        orders: 1,
        sales: 10,
        revenue: '3488.00',
        inStock: 24,
        created: '2025-10-28 10:44:04'
      }
    ];

    return products.slice(0, 5).map((product, index) => {
      const trendingItem = trendingData[index] || trendingData[0];
      const mainVariant = product.variants?.edges[0]?.node;
      const price = mainVariant?.price || trendingItem.price;
      const inventory = product.totalInventory || trendingItem.inStock;
      const isNew = isProductNew(product.createdAt, period);
      
      return {
        id: product.id,
        position: trendingItem.position,
        previousPosition: trendingItem.previousPosition,
        trend: '↑',
        image: product.featuredImage?.url || '',
        title: product.title || trendingItem.title,
        price: `$${price}`,
        orders: trendingItem.orders,
        sales: trendingItem.sales,
        revenue: `$${trendingItem.revenue}`,
        isNew: isNew,
        inStock: inventory,
        created: formatDate(product.createdAt) || trendingItem.created,
      };
    });
  };

  const isProductNew = (createdAt: string, period: number): boolean => {
    if (!createdAt) return true;
    const createdDate = new Date(createdAt);
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - period);
    return createdDate > cutoffDate;
  };

  const formatDate = (dateString: string): string => {
    if (!dateString) return '';
    try {
      return new Date(dateString).toLocaleDateString('en-US', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      }).replace(',', '');
    } catch (error) {
      return '';
    }
  };

  const generateMockTrendingData = (): TrendingProduct[] => {
    return [
      {
        id: '1',
        position: 2,
        previousPosition: 1,
        trend: '↑',
        image: '',
        title: 'Wester Dress 3',
        price: '$40.00',
        orders: 2,
        sales: 17,
        revenue: '$6760.00',
        isNew: true,
        inStock: 8,
        created: '2025-10-30 04:53:38',
      },
      {
        id: '2',
        position: 1,
        previousPosition: 2,
        trend: '↑',
        image: '',
        title: 'summer 2',
        price: '$20.00',
        orders: 1,
        sales: 34,
        revenue: '$23120.00',
        isNew: true,
        inStock: 22,
        created: '2025-10-30 04:55:06',
      },
      {
        id: '3',
        position: 3,
        previousPosition: 3,
        trend: '↑',
        image: '',
        title: 'watch3',
        price: '$45.00',
        orders: 1,
        sales: 14,
        revenue: '$8820.00',
        isNew: true,
        inStock: 31,
        created: '2025-11-01 10:15:20',
      },
      {
        id: '4',
        position: 5,
        previousPosition: 4,
        trend: '↑',
        image: '',
        title: 'watch2',
        price: '$19.99',
        orders: 1,
        sales: 10,
        revenue: '$1999.00',
        isNew: true,
        inStock: 2,
        created: '2025-11-01 10:14:41',
      },
      {
        id: '5',
        position: 4,
        previousPosition: 5,
        trend: '↑',
        image: '',
        title: 'Summer Dress 1',
        price: '$34.88',
        orders: 1,
        sales: 10,
        revenue: '$3488.00',
        isNew: true,
        inStock: 24,
        created: '2025-10-28 10:44:04',
      }
    ];
  };

  const downloadCSV = () => {
    const headers = ['Trend', 'Position', '7 days ago', 'Title', 'Price', '# of Orders', '# of Sales', 'Revenue', 'New', 'In Stock', 'Created'];
    const csvData = trendingProducts.map(product => [
      product.trend,
      product.position,
      product.previousPosition,
      product.title,
      product.price.replace('$', ''),
      product.orders,
      product.sales,
      product.revenue.replace('$', ''),
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
    a.download = 'trending-products.csv';
    a.click();
    window.URL.revokeObjectURL(url);
  };

  const rows = trendingProducts.map((product) => [
    <Text as="span" fontWeight="bold" key="trend">{product.trend}</Text>,
    <Text as="span" key="position">{product.position.toString()}</Text>,
    <Text as="span" key="previous">--</Text>,
    <div key="image">--</div>,
    <Text as="span" fontWeight="medium" key="title">{product.title}</Text>,
    <Text as="span" key="price">{product.price}</Text>,
    <Text as="span" key="orders">{product.orders}</Text>,
    <Text as="span" key="sales">{product.sales}</Text>,
    <Text as="span" fontWeight="bold" key="revenue">{product.revenue}</Text>,
    <Badge tone={product.isNew ? 'success' : 'info'} key="new">{product.isNew ? 'yes' : 'no'}</Badge>,
    <Text as="span" key="stock">{product.inStock}</Text>,
    <Text as="span" key="created">{product.created}</Text>,
  ]);

  return (
    <Page
      title="Trending within 7 days"
      subtitle="Store-wide statistics for products identified as 'trending.' Trending products are those with the highest order frequency over a short period."
    >
      <Layout>
        <Layout.Section>
          <Card>
            <Box padding="400" borderBlockEndWidth="025" borderColor="border">
              <InlineStack align="space-between" blockAlign="center">
                <BlockStack gap="200">
                  <Select
                    label=""
                    options={periodOptions}
                    onChange={setSelectedPeriod}
                    value={selectedPeriod}
                  />
                  <Text as="p" tone="subdued" variant="bodySm">
                    The lookback period is {selectedPeriod} days from today.
                  </Text>
                </BlockStack>
                <InlineStack gap="200">
                  <Select
                    label=""
                    options={[
                      { label: '25 products', value: '25' },
                      { label: '50 products', value: '50' },
                      { label: '100 products', value: '100' },
                    ]}
                    onChange={(value) => setProductsCount(parseInt(value))}
                    value={productsCount.toString()}
                  />
                  <Button onClick={loadTrendingProducts} disabled={loading}>
                    Refresh
                  </Button>
                  <Button onClick={downloadCSV} disabled={loading}>
                    Download (CSV)
                  </Button>
                </InlineStack>
              </InlineStack>
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
            ) : (
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
                footerContent={`Showing ${trendingProducts.length} trending products`}
              />
            )}
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}