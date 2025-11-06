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

interface NewArrivalProduct {
  id: string;
  position: number;
  image: string;
  title: string;
  price: string;
  isNew: boolean;
  inStock: number;
  created: string;
}

export default function NewArrivalsPage() {
  const [selectedPeriod, setSelectedPeriod] = useState('7');
  const [newArrivals, setNewArrivals] = useState<NewArrivalProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [productsCount, setProductsCount] = useState(25);

  const periodOptions = [
    { label: '3 days', value: '3' },
    { label: '7 days', value: '7' },
    { label: '14 days', value: '14' },
    { label: '30 days', value: '30' },
    { label: '90 days', value: '90' },
  ];

  useEffect(() => {
    loadNewArrivals();
  }, [selectedPeriod, productsCount]);

  const loadNewArrivals = async () => {
    setLoading(true);
    try {
      // Calculate cutoff date based on selected period
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - parseInt(selectedPeriod));
      
      // Use the correct Shopify REST API endpoint
      // In Shopify apps, fetch to /admin/api/* is automatically authenticated
      const response = await fetch(`/admin/api/2024-01/products.json?limit=${productsCount}`);
      
      if (response.ok) {
        const data = await response.json();
        
        if (data.products) {
          // Filter products by creation date (client-side filtering)
          const recentProducts = data.products.filter((product: any) => {
            const productDate = new Date(product.created_at);
            return productDate >= cutoffDate;
          });

          // Sort by creation date (newest first)
          recentProducts.sort((a: any, b: any) => 
            new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
          );

          const transformedData = transformProductsToNewArrivals(recentProducts);
          setNewArrivals(transformedData);
        } else {
          setNewArrivals([]);
        }
      } else {
        console.error('API response not OK:', response.status, response.statusText);
        setNewArrivals([]);
      }
    } catch (error) {
      console.error('Error loading new arrivals:', error);
      setNewArrivals([]);
    } finally {
      setLoading(false);
    }
  };

  const transformProductsToNewArrivals = (products: any[]): NewArrivalProduct[] => {
    return products.map((product, index) => {
      const mainVariant = product.variants?.[0];
      const price = mainVariant?.price || '0.00';
      const inventory = mainVariant?.inventory_quantity || 0;
      
      return {
        id: product.id.toString(),
        position: index + 1,
        image: product.image?.src || '',
        title: product.title,
        price: `$${parseFloat(price).toFixed(2)}`,
        isNew: true,
        inStock: inventory,
        created: formatDate(product.created_at),
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

  const downloadCSV = () => {
    const headers = ['Position', 'Title', 'Price', 'New', 'In Stock', 'Created'];
    const csvData = newArrivals.map(product => [
      product.position,
      `"${product.title}"`,
      product.price.replace('$', ''),
      product.isNew ? 'yes' : 'no',
      product.inStock,
      `"${product.created}"`
    ]);

    const csvContent = [
      headers.join(','),
      ...csvData.map(row => row.join(','))
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `new-arrivals-${selectedPeriod}days.csv`;
    a.click();
    window.URL.revokeObjectURL(url);
  };

  const getCurrentDateTime = (): string => {
    const now = new Date();
    return now.toLocaleDateString('en-GB', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric'
    }) + ' ' + now.toLocaleTimeString('en-GB', {
      hour: '2-digit',
      minute: '2-digit'
    }) + ' (GMT - 05:00)';
  };

  const rows = newArrivals.map((product) => [
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
    <Badge tone="success" key="new">yes</Badge>,
    <Text as="span" key="stock">{product.inStock}</Text>,
    <Text as="span" key="created">{product.created}</Text>,
  ]);

  return (
    <Page
      title={`New Arrivals within ${selectedPeriod} days`}
      subtitle="Statistics for products created during a defined period."
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
                  <Button onClick={loadNewArrivals} disabled={loading}>
                    Refresh
                  </Button>
                  <Button onClick={downloadCSV} disabled={loading || newArrivals.length === 0}>
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
                    Loading real products from your Shopify store...
                  </Text>
                </div>
              </Box>
            ) : newArrivals.length > 0 ? (
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
                footerContent={`Showing ${newArrivals.length} real products from your store`}
              />
            ) : (
              <Box padding="800">
                <div style={{ textAlign: 'center' }}>
                  <Text as="p" variant="bodyMd" tone="subdued">
                    No products found in your store for the selected period.
                  </Text>
                  <Text as="p" variant="bodySm" tone="subdued">
                    Make sure you have products created in the last {selectedPeriod} days.
                  </Text>
                  <Button onClick={loadNewArrivals} size="slim">
                    Try Again
                  </Button>
                </div>
              </Box>
            )}
          </Card>

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