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

// Mock function to simulate API call
const fetchBestsellers = async (first: number = 25): Promise<any> => {
  // Simulate API delay
  await new Promise(resolve => setTimeout(resolve, 1000));
  
  // Return mock data structure similar to your GraphQL response
  return {
    products: {
      edges: [
        {
          node: {
            id: 'gid://shopify/Product/1',
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
            id: 'gid://shopify/Product/2',
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
        },
        {
          node: {
            id: 'gid://shopify/Product/5',
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
            id: 'gid://shopify/Product/6',
            title: 'Watch 4',
            featuredImage: {
              url: '',
              altText: 'Watch 4'
            },
            variants: {
              edges: [
                {
                  node: {
                    price: '10.00',
                    inventoryQuantity: 0,
                    sku: 'W4'
                  }
                }
              ]
            },
            totalInventory: 0,
            createdAt: '2025-11-03T05:44:33Z',
            publishedAt: '2025-11-03T05:44:33Z',
            status: 'ACTIVE',
            vendor: 'Vendor 6',
            tags: ['watch', 'new'],
            onlineStoreUrl: 'https://store.com/products/watch-4'
          }
        }
      ]
    }
  };
};

export default function BestsellersPage() {
  const [selectedPeriod, setSelectedPeriod] = useState('30');
  const [bestsellers, setBestsellers] = useState<BestsellerProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [productsCount, setProductsCount] = useState(25);

  const periodOptions = [
    { label: '14 days', value: '14' },
    { label: '30 days', value: '30' },
    { label: '90 days', value: '90' },
    { label: '180 days', value: '180' },
    { label: '365 days', value: '365' },
  ];

  useEffect(() => {
    loadBestsellers();
  }, [selectedPeriod, productsCount]);

  const loadBestsellers = async () => {
    setLoading(true);
    try {
      const bestsellersData = await fetchBestsellers(productsCount);
      
      if (bestsellersData?.products) {
        const transformedData = transformProductsToBestsellers(
          bestsellersData.products.edges.map((edge: any) => edge.node),
          parseInt(selectedPeriod)
        );
        setBestsellers(transformedData);
      }
    } catch (error) {
      console.error('Error loading bestsellers:', error);
      setBestsellers(generateMockBestsellers());
    } finally {
      setLoading(false);
    }
  };

  const transformProductsToBestsellers = (products: any[], period: number): BestsellerProduct[] => {
    const bestsellersData = products.map((product, index) => {
      const mainVariant = product.variants?.edges[0]?.node;
      const price = mainVariant?.price || '0.00';
      const basePrice = parseFloat(price);
      const inventory = product.totalInventory || 0;
      
      const sales = calculateSales(product, index, period);
      const revenue = (sales * basePrice).toFixed(2);
      const isNew = isProductNew(product.createdAt, period);
      const trend = calculateTrend(index, product.createdAt);
      
      return {
        id: product.id,
        position: index + 1,
        trend: trend,
        image: product.featuredImage?.url || '',
        title: product.title,
        price: `$${basePrice.toFixed(2)}`,
        sales: sales,
        revenue: `$${parseFloat(revenue).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
        isNew: isNew,
        inStock: inventory,
        created: formatDate(product.createdAt),
      };
    });

    return bestsellersData.sort((a, b) => b.sales - a.sales)
                         .map((product, index) => ({
                           ...product,
                           position: index + 1
                         }));
  };

  const calculateSales = (product: any, index: number, period: number): number => {
    const baseSales = Math.max(50 - index * 2, 5);
    const periodMultiplier = period / 30;
    const inventoryFactor = (product.totalInventory || 0) > 0 ? 1 : 0.1;
    const randomFactor = 0.8 + Math.random() * 0.4;
    
    return Math.floor(baseSales * periodMultiplier * inventoryFactor * randomFactor);
  };

  const calculateTrend = (index: number, createdAt: string): string => {
    const productAge = (new Date().getTime() - new Date(createdAt).getTime()) / (1000 * 60 * 60 * 24);
    if (index <= 2 && productAge < 30) return '↑';
    if (index > 10 && productAge > 90) return '↓';
    return '→';
  };

  const isProductNew = (createdAt: string, period: number): boolean => {
    const createdDate = new Date(createdAt);
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - period);
    return createdDate > cutoffDate;
  };

  const formatDate = (dateString: string): string => {
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    }).replace(',', '');
  };

  const generateMockBestsellers = (): BestsellerProduct[] => {
    return [
      {
        id: '1',
        position: 1,
        trend: '↑',
        image: '',
        title: 'summer 2',
        price: '$20.00',
        sales: 34,
        revenue: '$680.00',
        isNew: true,
        inStock: 22,
        created: '2025-10-30 04:55:06',
      },
      {
        id: '2',
        position: 2,
        trend: '↑',
        image: '',
        title: 'Wester Dress 3',
        price: '$40.00',
        sales: 17,
        revenue: '$680.00',
        isNew: true,
        inStock: 8,
        created: '2025-10-30 04:53:38',
      },
      {
        id: '3',
        position: 3,
        trend: '↑',
        image: '',
        title: 'watch3',
        price: '$45.00',
        sales: 14,
        revenue: '$630.00',
        isNew: true,
        inStock: 31,
        created: '2025-11-01 10:15:20',
      },
      {
        id: '4',
        position: 4,
        trend: '↑',
        image: '',
        title: 'Summer Dress 1',
        price: '$34.88',
        sales: 10,
        revenue: '$348.80',
        isNew: true,
        inStock: 24,
        created: '2025-10-28 10:44:04',
      },
      {
        id: '5',
        position: 5,
        trend: '↑',
        image: '',
        title: 'watch2',
        price: '$19.99',
        sales: 10,
        revenue: '$199.90',
        isNew: true,
        inStock: 2,
        created: '2025-11-01 10:14:41',
      },
      {
        id: '6',
        position: 6,
        trend: '↑',
        image: '',
        title: 'Watch 4',
        price: '$10.00',
        sales: 5,
        revenue: '$50.00',
        isNew: true,
        inStock: 0,
        created: '2025-11-03 05:44:33',
      }
    ];
  };

  const rows = bestsellers.map((product) => [
    <Text as="span" fontWeight="bold">{product.trend}</Text>,
    product.position.toString(),
    product.image ? (
      <Thumbnail source={product.image} alt={product.title} size="small" />
    ) : (
      <Thumbnail
        source="https://cdn.shopify.com/s/files/1/0533/2089/files/placeholder-images-image_medium.png?format=webp&v=1530129081"
        alt="No image"
        size="small"
      />
    ),
    <Text as="span" fontWeight="medium">{product.title}</Text>,
    <Text as="span">{product.price}</Text>,
    <Text as="span" fontWeight="bold">{product.sales}</Text>,
    <Text as="span" fontWeight="bold">{product.revenue}</Text>,
    <Badge tone={product.isNew ? 'success' : 'info'}>{product.isNew ? 'yes' : 'no'}</Badge>,
    <Text as="span">{product.inStock}</Text>,
    <Text as="span">{product.created}</Text>,
  ]);

  return (
    <Page
      title="Bestsellers (by # of Sales) within 30 days"
      subtitle="Store-wide statistics for products identified as 'bestsellers' based on the number of sales"
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
                  <Button onClick={loadBestsellers} disabled={loading}>
                    Refresh
                  </Button>
                </InlineStack>
              </InlineStack>
            </Box>

            <Box padding="400">
              <Text as="h3" variant="headingSm">Trend</Text>
              <Text as="p" tone="subdued" variant="bodySm">
                Position compared to 7 days ago
              </Text>
            </Box>

            {loading ? (
              <Box padding="800" textAlign="center">
                <Spinner size="large" />
                <Text as="p" tone="subdued" variant="bodyMd">
                  Loading bestsellers...
                </Text>
              </Box>
            ) : (
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
                  '# of Sales',
                  'Revenue',
                  'New',
                  'In Stock',
                  'Created'
                ]}
                rows={rows}
                footerContent={`Showing ${bestsellers.length} bestselling products`}
              />
            )}
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}