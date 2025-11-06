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

interface AgingProduct {
  id: string;
  position: number;
  image: string;
  title: string;
  price: string;
  isNew: boolean;
  inStock: number;
  created: string;
}

// Mock function to simulate API call
const fetchAgingProducts = async (first: number = 25): Promise<any> => {
  await new Promise(resolve => setTimeout(resolve, 1000));
  
  return {
    products: {
      edges: []
    }
  };
};

export default function AgingPage() {
  const [selectedPeriod, setSelectedPeriod] = useState('90');
  const [agingProducts, setAgingProducts] = useState<AgingProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [productsCount, setProductsCount] = useState(25);

  const periodOptions = [
    { label: '90 days', value: '90' },
    { label: '180 days', value: '180' },
    { label: '365 days', value: '365' },
  ];

  useEffect(() => {
    loadAgingProducts();
  }, [selectedPeriod, productsCount]);

  const loadAgingProducts = async () => {
    setLoading(true);
    try {
      const agingData = await fetchAgingProducts(productsCount);
      
      if (agingData?.products && agingData.products.edges.length > 0) {
        const transformedData = transformProductsToAging(
          agingData.products.edges.map((edge: any) => edge.node),
          parseInt(selectedPeriod)
        );
        setAgingProducts(transformedData);
      } else {
        setAgingProducts([]);
      }
    } catch (error) {
      console.error('Error loading aging products:', error);
      setAgingProducts([]);
    } finally {
      setLoading(false);
    }
  };

  const transformProductsToAging = (products: any[], period: number): AgingProduct[] => {
    return products.map((product, index) => {
      const mainVariant = product.variants?.edges[0]?.node;
      const price = mainVariant?.price || '0.00';
      const inventory = product.totalInventory || 0;
      const isNew = false; // Aging products are not new
      
      return {
        id: product.id,
        position: index + 1,
        image: product.featuredImage?.url || '',
        title: product.title,
        price: `$${price}`,
        isNew: isNew,
        inStock: inventory,
        created: formatDate(product.createdAt),
      };
    });
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

  const rows = agingProducts.map((product) => [
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
      title="Aging Inventory within 90 days"
      subtitle="Store-wide statistics for products identified as 'aging.' Aging inventory refers to products with no sales for an extended period."
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
                  <Button onClick={loadAgingProducts} disabled={loading}>
                    Refresh
                  </Button>
                </InlineStack>
              </InlineStack>
            </Box>

            {loading ? (
              <Box padding="800">
                <div style={{ textAlign: 'center' }}>
                  <Spinner size="large" />
                  <Text as="p" tone="subdued" variant="bodyMd">
                    Loading aging inventory...
                  </Text>
                </div>
              </Box>
            ) : agingProducts.length > 0 ? (
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
                footerContent={`Showing ${agingProducts.length} aging products`}
              />
            ) : (
              <Box padding="800">
                <div style={{ textAlign: 'center' }}>
                  <Text as="p" variant="bodyMd">
                    No data for the lookback period yet.
                  </Text>
                </div>
              </Box>
            )}
          </Card>

          {/* Statistics Footer */}
          <Box padding="400">
            <Text as="p" tone="subdued" variant="bodySm">
              <strong>Statistics as of:</strong> {getCurrentDateTime()}
            </Text>
          </Box>
        </Layout.Section>
      </Layout>
    </Page>
  );
}