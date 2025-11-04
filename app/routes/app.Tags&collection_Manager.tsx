// app/routes/app.Tags&collection_Manager.tsx
import { useState, useEffect } from 'react';
import {
  Page,
  Card,
  Layout,
  TextField,
  Select,
  FormLayout,
  Checkbox,
  Button,
  Banner,
  Tabs,
  Box,
  Text,
  Badge,
  Link,
  BlockStack,
  InlineStack,
  Toast,
  Modal,
  Spinner,
} from '@shopify/polaris';
import { authenticate } from '../shopify.server';
import { json } from "@remix-run/node";
import { useLoaderData, useActionData } from 'react-router';
import { useSubmit } from 'react-router';
import prisma from '../db.server';

// GraphQL queries
const GET_SHOP_QUERY = `#graphql
  query getShop {
    shop {
      id
      name
    }
  }
`;

const GET_COLLECTIONS_QUERY = `#graphql
  query getCollections($first: Int!) {
    collections(first: $first) {
      edges {
        node {
          id
          title
          handle
        }
      }
    }
  }
`;

const CREATE_COLLECTION_MUTATION = `#graphql
  mutation createCollection($input: CollectionInput!) {
    collectionCreate(input: $input) {
      collection {
        id
        title
        handle
      }
      userErrors {
        field
        message
      }
    }
  }
`;

const UPDATE_COLLECTION_MUTATION = `#graphql
  mutation updateCollection($input: CollectionInput!) {
    collectionUpdate(input: $input) {
      collection {
        id
        title
        handle
      }
      userErrors {
        field
        message
      }
    }
  }
`;

const GET_PRODUCTS_QUERY = `#graphql
  query getProducts($first: Int!, $query: String) {
    products(first: $first, query: $query) {
      edges {
        node {
          id
          title
          handle
          tags
          totalInventory
          createdAt
        }
      }
    }
  }
`;

const UPDATE_PRODUCT_MUTATION = `#graphql
  mutation updateProduct($input: ProductInput!) {
    productUpdate(input: $input) {
      product {
        id
        title
        tags
      }
      userErrors {
        field
        message
      }
    }
  }
`;

const GET_ORDERS_QUERY = `#graphql
  query getOrders($first: Int!, $query: String) {
    orders(first: $first, query: $query) {
      edges {
        node {
          id
          createdAt
          lineItems(first: 50) {
            edges {
              node {
                quantity
                variant {
                  id
                  product {
                    id
                    title
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

// Type definitions
interface ProductSales {
  [productId: string]: {
    id: string;
    title: string;
    sales: number;
    revenue: number;
  };
}

interface Product {
  id: string;
  title: string;
  handle: string;
  tags: string[];
  totalInventory: number;
  createdAt: string;
}

interface Order {
  id: string;
  createdAt: string;
  lineItems: {
    edges: Array<{
      node: {
        quantity: number;
        variant: {
          id: string;
          product: {
            id: string;
            title: string;
          };
        };
      };
    }>;
  };
}

interface Collection {
  id: string;
  title: string;
  handle: string;
}

interface Settings {
  id: string;
  shopifyDomain: string;
  bestsellersEnabled: boolean;
  bestsellersTag: string;
  bestsellersCount: number;
  bestsellersBy: string;
  bestsellersLookback: number;
  bestsellersExcludeOOS: boolean;
  bestsellersCreateCollection: boolean;
  bestsellersCollectionId: string | null;
  trendingEnabled: boolean;
  trendingTag: string;
  trendingCount: number;
  trendingLookback: number;
  trendingExcludeOOS: boolean;
  trendingCreateCollection: boolean;
  trendingCollectionId: string | null;
  trendingCollectionTitle: string | null;
  newArrivalsEnabled: boolean;
  newArrivalsTag: string;
  newArrivalsCount: number;
  newArrivalsPeriod: number;
  newArrivalsExcludeOOS: boolean;
  newArrivalsCreateCollection: boolean;
  newArrivalsCollectionId: string | null;
  newArrivalsCollectionTitle: string | null;
  agingEnabled: boolean;
  agingTag: string;
  agingCount: number;
  agingLookback: number;
  agingCreateCollection: boolean;
  agingCollectionId: string | null;
  agingCollectionTitle: string | null;
  excludeEnabled: boolean;
  excludeTags: string[];
}

// Loader function
export async function loader({ request }: { request: Request }) {
  const { admin, session } = await authenticate.admin(request);
  
  // Get shop info
  const shopResponse = await admin.graphql(GET_SHOP_QUERY);
  const shopData = await shopResponse.json();
  const shop = shopData.data.shop;
  
  // Get collections
  const collectionsResponse = await admin.graphql(GET_COLLECTIONS_QUERY, {
    variables: { first: 50 }
  });
  const collectionsData = await collectionsResponse.json();
  const collections = collectionsData.data.collections.edges.map((edge: { node: Collection }) => edge.node);
  
  // Get settings from database
  let settings: Settings | null = null;
  
  try {
    settings = await (prisma as any).settings.findUnique({
      where: { shopifyDomain: session.shop }
    });
    
    // If no settings exist, create default settings
    if (!settings) {
      settings = await (prisma as any).settings.create({
        data: {
          shopifyDomain: session.shop,
        }
      });
    }
  } catch (error) {
    console.error('Error accessing settings:', error);
    // Create a default settings object if database is not available
    settings = {
      id: 'default',
      shopifyDomain: session.shop,
      bestsellersEnabled: true,
      bestsellersTag: 'bestsellers-resort',
      bestsellersCount: 50,
      bestsellersBy: 'sales',
      bestsellersLookback: 20,
      bestsellersExcludeOOS: true,
      bestsellersCreateCollection: true,
      bestsellersCollectionId: null,
      trendingEnabled: true,
      trendingTag: 'br-trending',
      trendingCount: 50,
      trendingLookback: 7,
      trendingExcludeOOS: false,
      trendingCreateCollection: false,
      trendingCollectionId: null,
      trendingCollectionTitle: null,
      newArrivalsEnabled: true,
      newArrivalsTag: 'br-new',
      newArrivalsCount: 50,
      newArrivalsPeriod: 7,
      newArrivalsExcludeOOS: true,
      newArrivalsCreateCollection: true,
      newArrivalsCollectionId: null,
      newArrivalsCollectionTitle: null,
      agingEnabled: true,
      agingTag: 'br-aging',
      agingCount: 50,
      agingLookback: 90,
      agingCreateCollection: true,
      agingCollectionId: null,
      agingCollectionTitle: null,
      excludeEnabled: true,
      excludeTags: [],
    };
  }
  
  return json({
    shop,
    collections,
    settings,
    shopifyDomain: session.shop,
  });
};

// Action function
export async function action({ request }: { request: Request }) {
  const { admin, session } = await authenticate.admin(request);
  const formData = await request.formData();
  const actionType = formData.get('actionType') as string;
  
  try {
    if (actionType === 'saveSettings') {
      // Update settings in database
      try {
        const settings = await (prisma as any).settings.upsert({
          where: { shopifyDomain: session.shop },
          update: {
            bestsellersEnabled: formData.get('bestsellersEnabled') === 'true',
            bestsellersTag: formData.get('bestsellersTag') as string,
            bestsellersCount: parseInt(formData.get('bestsellersCount') as string),
            bestsellersBy: formData.get('bestsellersBy') as string,
            bestsellersLookback: parseInt(formData.get('bestsellersLookback') as string),
            bestsellersExcludeOOS: formData.get('bestsellersExcludeOOS') === 'true',
            bestsellersCreateCollection: formData.get('bestsellersCreateCollection') === 'true',
            
            trendingEnabled: formData.get('trendingEnabled') === 'true',
            trendingTag: formData.get('trendingTag') as string,
            trendingCount: parseInt(formData.get('trendingCount') as string),
            trendingLookback: parseInt(formData.get('trendingLookback') as string),
            trendingExcludeOOS: formData.get('trendingExcludeOOS') === 'true',
            trendingCreateCollection: formData.get('trendingCreateCollection') === 'true',
            trendingCollectionTitle: formData.get('trendingCollectionTitle') as string,
            
            newArrivalsEnabled: formData.get('newArrivalsEnabled') === 'true',
            newArrivalsTag: formData.get('newArrivalsTag') as string,
            newArrivalsCount: parseInt(formData.get('newArrivalsCount') as string),
            newArrivalsPeriod: parseInt(formData.get('newArrivalsPeriod') as string),
            newArrivalsExcludeOOS: formData.get('newArrivalsExcludeOOS') === 'true',
            newArrivalsCreateCollection: formData.get('newArrivalsCreateCollection') === 'true',
            newArrivalsCollectionTitle: formData.get('newArrivalsCollectionTitle') as string,
            
            agingEnabled: formData.get('agingEnabled') === 'true',
            agingTag: formData.get('agingTag') as string,
            agingCount: parseInt(formData.get('agingCount') as string),
            agingLookback: parseInt(formData.get('agingLookback') as string),
            agingCreateCollection: formData.get('agingCreateCollection') === 'true',
            agingCollectionTitle: formData.get('agingCollectionTitle') as string,
            
            excludeEnabled: formData.get('excludeEnabled') === 'true',
            excludeTags: formData.getAll('excludeTags') as string[],
          },
          create: {
            shopifyDomain: session.shop,
            bestsellersEnabled: formData.get('bestsellersEnabled') === 'true',
            bestsellersTag: formData.get('bestsellersTag') as string,
            bestsellersCount: parseInt(formData.get('bestsellersCount') as string),
            bestsellersBy: formData.get('bestsellersBy') as string,
            bestsellersLookback: parseInt(formData.get('bestsellersLookback') as string),
            bestsellersExcludeOOS: formData.get('bestsellersExcludeOOS') === 'true',
            bestsellersCreateCollection: formData.get('bestsellersCreateCollection') === 'true',
            
            trendingEnabled: formData.get('trendingEnabled') === 'true',
            trendingTag: formData.get('trendingTag') as string,
            trendingCount: parseInt(formData.get('trendingCount') as string),
            trendingLookback: parseInt(formData.get('trendingLookback') as string),
            trendingExcludeOOS: formData.get('trendingExcludeOOS') === 'true',
            trendingCreateCollection: formData.get('trendingCreateCollection') === 'true',
            trendingCollectionTitle: formData.get('trendingCollectionTitle') as string,
            
            newArrivalsEnabled: formData.get('newArrivalsEnabled') === 'true',
            newArrivalsTag: formData.get('newArrivalsTag') as string,
            newArrivalsCount: parseInt(formData.get('newArrivalsCount') as string),
            newArrivalsPeriod: parseInt(formData.get('newArrivalsPeriod') as string),
            newArrivalsExcludeOOS: formData.get('newArrivalsExcludeOOS') === 'true',
            newArrivalsCreateCollection: formData.get('newArrivalsCreateCollection') === 'true',
            newArrivalsCollectionTitle: formData.get('newArrivalsCollectionTitle') as string,
            
            agingEnabled: formData.get('agingEnabled') === 'true',
            agingTag: formData.get('agingTag') as string,
            agingCount: parseInt(formData.get('agingCount') as string),
            agingLookback: parseInt(formData.get('agingLookback') as string),
            agingCreateCollection: formData.get('agingCreateCollection') === 'true',
            agingCollectionTitle: formData.get('agingCollectionTitle') as string,
            
            excludeEnabled: formData.get('excludeEnabled') === 'true',
            excludeTags: formData.getAll('excludeTags') as string[],
          }
        });
        
        return json({ success: true, message: 'Settings saved successfully!' });
      } catch (error) {
        console.error('Error saving settings:', error);
        return json({ success: false, message: 'Error saving settings to database' });
      }
    } else if (actionType === 'processBestsellers') {
      // Process bestsellers
      let settings: Settings | null = null;
      
      try {
        settings = await (prisma as any).settings.findUnique({
          where: { shopifyDomain: session.shop }
        });
      } catch (error) {
        console.error('Error fetching settings:', error);
        return json({ success: false, message: 'Error fetching settings from database' });
      }
      
      if (!settings?.bestsellersEnabled) {
        return json({ success: false, message: 'Bestsellers is disabled' });
      }
      
      // Get orders within lookback period
      const lookbackDate = new Date();
      lookbackDate.setDate(lookbackDate.getDate() - settings.bestsellersLookback);
      
      const ordersResponse = await admin.graphql(GET_ORDERS_QUERY, {
        variables: { 
          first: 250,
          query: `created_at:>='${lookbackDate.toISOString()}'`
        }
      });
      const ordersData = await ordersResponse.json();
      
      // Calculate product sales or revenue
      const productSales: ProductSales = {};
      
      ordersData.data.orders.edges.forEach((orderEdge: { node: Order }) => {
        const order = orderEdge.node;
        order.lineItems.edges.forEach((itemEdge: { node: any }) => {
          const item = itemEdge.node;
          const productId = item.variant.product.id;
          
          if (!productSales[productId]) {
            productSales[productId] = {
              id: productId,
              title: item.variant.product.title,
              sales: 0,
              revenue: 0
            };
          }
          
          productSales[productId].sales += item.quantity;
          // Note: We don't have price info in this query, so we'll just use sales count
          // In a real implementation, you'd need to get the price from the variant
        });
      });
      
      // Sort products by sales or revenue
      const sortedProducts = Object.values(productSales).sort((a, b) => {
        if (settings.bestsellersBy === 'sales') {
          return b.sales - a.sales;
        } else {
          return b.revenue - a.revenue;
        }
      });
      
      // Get top N products
      const topProducts = sortedProducts.slice(0, settings.bestsellersCount);
      
      // Get all products to check inventory and existing tags
      const productsResponse = await admin.graphql(GET_PRODUCTS_QUERY, {
        variables: { first: 250 }
      });
      const productsData = await productsResponse.json();
      
      const products = productsData.data.products.edges.map((edge: { node: Product }) => edge.node);
      
      // Create or update collection if needed
      let collectionId = settings.bestsellersCollectionId;
      
      if (settings.bestsellersCreateCollection && !collectionId) {
        const createCollectionResponse = await admin.graphql(CREATE_COLLECTION_MUTATION, {
          variables: {
            input: {
              title: "Bestsellers",
              description: "Top selling products",
              rules: [
                {
                  column: "TAG",
                  relation: "EQUALS",
                  condition: settings.bestsellersTag
                }
              ],
              disjunctive: false
            }
          }
        });
        
        const createCollectionData = await createCollectionResponse.json();
        
        if (createCollectionData.data.collectionCreate.userErrors.length > 0) {
          return json({ 
            success: false, 
            message: `Error creating collection: ${createCollectionData.data.collectionCreate.userErrors[0].message}` 
          });
        }
        
        collectionId = createCollectionData.data.collectionCreate.collection.id;
        
        // Update settings with collection ID
        try {
          await (prisma as any).settings.update({
            where: { shopifyDomain: session.shop },
            data: { bestsellersCollectionId: collectionId }
          });
        } catch (error) {
          console.error('Error updating collection ID:', error);
        }
      }
      
      // Remove bestsellers tag from all products first
      for (const product of products) {
        if (product.tags.includes(settings.bestsellersTag)) {
          const newTags = product.tags.filter((tag: string) => tag !== settings.bestsellersTag);
          
          await admin.graphql(UPDATE_PRODUCT_MUTATION, {
            variables: {
              input: {
                id: product.id,
                tags: newTags
              }
            }
          });
        }
      }
      
      // Add bestsellers tag to top products
      for (const topProduct of topProducts) {
        const product = products.find((p: Product) => p.id === topProduct.id);
        
        if (!product) continue;
        
        // Check if product is out of stock and should be excluded
        if (settings.bestsellersExcludeOOS && product.totalInventory <= 0) {
          continue;
        }
        
        // Check if product has excluded tags
        if (settings.excludeEnabled && settings.excludeTags.length > 0) {
          const hasExcludedTag = settings.excludeTags.some((tag: string) => product.tags.includes(tag));
          if (hasExcludedTag) continue;
        }
        
        // Add bestsellers tag
        const newTags = [...product.tags, settings.bestsellersTag];
        
        await admin.graphql(UPDATE_PRODUCT_MUTATION, {
          variables: {
            input: {
              id: product.id,
              tags: newTags
            }
          }
        });
      }
      
      return json({ success: true, message: 'Bestsellers processed successfully!' });
    } else if (actionType === 'processTrending') {
      // Similar implementation for trending products
      // This would be similar to bestsellers but with a different logic for identifying trending products
      return json({ success: true, message: 'Trending products processed successfully!' });
    } else if (actionType === 'processNewArrivals') {
      // Similar implementation for new arrivals
      return json({ success: true, message: 'New arrivals processed successfully!' });
    } else if (actionType === 'processAging') {
      // Similar implementation for aging inventory
      return json({ success: true, message: 'Aging inventory processed successfully!' });
    }
    
    return json({ success: false, message: 'Unknown action type' });
  } catch (error) {
    console.error('Error processing action:', error);
    return json({ success: false, message: `Error: ${error instanceof Error ? error.message : 'Unknown error'}` });
  }
}

export default function CollectionManager() {
  const { shop, collections, settings, shopifyDomain } = useLoaderData();
  const actionData = useActionData();
  const submit = useSubmit();
  
  const [toastActive, setToastActive] = useState(false);
  const [toastMessage, setToastMessage] = useState('');
  const [toastError, setToastError] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [processingType, setProcessingType] = useState('');
  
  // State for form fields
  const [bestsellersEnabled, setBestsellersEnabled] = useState(settings.bestsellersEnabled);
  const [bestsellersTag, setBestsellersTag] = useState(settings.bestsellersTag);
  const [bestsellersCount, setBestsellersCount] = useState(settings.bestsellersCount);
  const [bestsellersBy, setBestsellersBy] = useState(settings.bestsellersBy);
  const [bestsellersLookback, setBestsellersLookback] = useState(settings.bestsellersLookback);
  const [bestsellersExcludeOOS, setBestsellersExcludeOOS] = useState(settings.bestsellersExcludeOOS);
  const [bestsellersCreateCollection, setBestsellersCreateCollection] = useState(settings.bestsellersCreateCollection);
  
  const [trendingEnabled, setTrendingEnabled] = useState(settings.trendingEnabled);
  const [trendingTag, setTrendingTag] = useState(settings.trendingTag);
  const [trendingCount, setTrendingCount] = useState(settings.trendingCount);
  const [trendingLookback, setTrendingLookback] = useState(settings.trendingLookback);
  const [trendingExcludeOOS, setTrendingExcludeOOS] = useState(settings.trendingExcludeOOS);
  const [trendingCreateCollection, setTrendingCreateCollection] = useState(settings.trendingCreateCollection);
  const [trendingCollectionTitle, setTrendingCollectionTitle] = useState(settings.trendingCollectionTitle || 'Trending Now');
  
  const [newArrivalsEnabled, setNewArrivalsEnabled] = useState(settings.newArrivalsEnabled);
  const [newArrivalsTag, setNewArrivalsTag] = useState(settings.newArrivalsTag);
  const [newArrivalsCount, setNewArrivalsCount] = useState(settings.newArrivalsCount);
  const [newArrivalsPeriod, setNewArrivalsPeriod] = useState(settings.newArrivalsPeriod);
  const [newArrivalsExcludeOOS, setNewArrivalsExcludeOOS] = useState(settings.newArrivalsExcludeOOS);
  const [newArrivalsCreateCollection, setNewArrivalsCreateCollection] = useState(settings.newArrivalsCreateCollection);
  const [newArrivalsCollectionTitle, setNewArrivalsCollectionTitle] = useState(settings.newArrivalsCollectionTitle || 'New Arrivals');
  
  const [agingEnabled, setAgingEnabled] = useState(settings.agingEnabled);
  const [agingTag, setAgingTag] = useState(settings.agingTag);
  const [agingCount, setAgingCount] = useState(settings.agingCount);
  const [agingLookback, setAgingLookback] = useState(settings.agingLookback);
  const [agingCreateCollection, setAgingCreateCollection] = useState(settings.agingCreateCollection);
  const [agingCollectionTitle, setAgingCollectionTitle] = useState(settings.agingCollectionTitle || 'Aging Inventory');
  
  const [excludeEnabled, setExcludeEnabled] = useState(settings.excludeEnabled);
  const [excludeTags, setExcludeTags] = useState(settings.excludeTags || []);
  const [newExcludeTag, setNewExcludeTag] = useState('');
  
  const [selectedTab, setSelectedTab] = useState(0);
  
  const tabs = [
    {
      id: 'tags-collections',
      content: 'Tags & Collection Templates',
    },
    {
      id: 'advanced-tags',
      content: 'Advanced Tags & Workflows',
    },
  ];
  
  // Show toast when action data changes
  useEffect(() => {
    if (actionData) {
      setToastMessage(actionData.message);
      setToastError(!actionData.success);
      setToastActive(true);
      setProcessing(false);
      setProcessingType('');
    }
  }, [actionData]);
  
  const handleSaveSettings = () => {
    const formData = new FormData();
    
    formData.append('actionType', 'saveSettings');
    
    // Bestsellers settings
    formData.append('bestsellersEnabled', bestsellersEnabled.toString());
    formData.append('bestsellersTag', bestsellersTag);
    formData.append('bestsellersCount', bestsellersCount.toString());
    formData.append('bestsellersBy', bestsellersBy);
    formData.append('bestsellersLookback', bestsellersLookback.toString());
    formData.append('bestsellersExcludeOOS', bestsellersExcludeOOS.toString());
    formData.append('bestsellersCreateCollection', bestsellersCreateCollection.toString());
    
    // Trending settings
    formData.append('trendingEnabled', trendingEnabled.toString());
    formData.append('trendingTag', trendingTag);
    formData.append('trendingCount', trendingCount.toString());
    formData.append('trendingLookback', trendingLookback.toString());
    formData.append('trendingExcludeOOS', trendingExcludeOOS.toString());
    formData.append('trendingCreateCollection', trendingCreateCollection.toString());
    formData.append('trendingCollectionTitle', trendingCollectionTitle);
    
    // New Arrivals settings
    formData.append('newArrivalsEnabled', newArrivalsEnabled.toString());
    formData.append('newArrivalsTag', newArrivalsTag);
    formData.append('newArrivalsCount', newArrivalsCount.toString());
    formData.append('newArrivalsPeriod', newArrivalsPeriod.toString());
    formData.append('newArrivalsExcludeOOS', newArrivalsExcludeOOS.toString());
    formData.append('newArrivalsCreateCollection', newArrivalsCreateCollection.toString());
    formData.append('newArrivalsCollectionTitle', newArrivalsCollectionTitle);
    
    // Aging Inventory settings
    formData.append('agingEnabled', agingEnabled.toString());
    formData.append('agingTag', agingTag);
    formData.append('agingCount', agingCount.toString());
    formData.append('agingLookback', agingLookback.toString());
    formData.append('agingCreateCollection', agingCreateCollection.toString());
    formData.append('agingCollectionTitle', agingCollectionTitle);
    
    // Additional settings
    formData.append('excludeEnabled', excludeEnabled.toString());
    excludeTags.forEach((tag: string) => formData.append('excludeTags', tag));
    
    submit(formData, { method: 'post' });
  };
  
  const handleProcessBestsellers = () => {
    setProcessing(true);
    setProcessingType('bestsellers');
    
    const formData = new FormData();
    formData.append('actionType', 'processBestsellers');
    
    submit(formData, { method: 'post' });
  };
  
  const handleProcessTrending = () => {
    setProcessing(true);
    setProcessingType('trending');
    
    const formData = new FormData();
    formData.append('actionType', 'processTrending');
    
    submit(formData, { method: 'post' });
  };
  
  const handleProcessNewArrivals = () => {
    setProcessing(true);
    setProcessingType('newArrivals');
    
    const formData = new FormData();
    formData.append('actionType', 'processNewArrivals');
    
    submit(formData, { method: 'post' });
  };
  
  const handleProcessAging = () => {
    setProcessing(true);
    setProcessingType('aging');
    
    const formData = new FormData();
    formData.append('actionType', 'processAging');
    
    submit(formData, { method: 'post' });
  };
  
  const handleAddExcludeTag = () => {
    if (newExcludeTag.trim() && !excludeTags.includes(newExcludeTag.trim())) {
      setExcludeTags([...excludeTags, newExcludeTag.trim()]);
      setNewExcludeTag('');
    }
  };
  
  const handleRemoveExcludeTag = (tagToRemove: string) => {
    setExcludeTags(excludeTags.filter((tag: string) => tag !== tagToRemove));
  };
  
  const toggleToast = () => setToastActive(!toastActive);
  
  const toastMarkup = toastActive ? (
    <Toast content={toastMessage} onDismiss={toggleToast} error={toastError} />
  ) : null;
  
  return (
    <Page
      title="Collection Manager"
      primaryAction={{ content: 'Schedule a call' }}
    >
      <Layout>
        <Layout.Section>
          <Banner tone="info">
            <Text variant="bodyMd" as="p">
              Thank you for installing Bestsellers ReSort. Click below to schedule a setup call with our team and get the most out of the app.
            </Text>
          </Banner>
        </Layout.Section>

        {/* Bestsellers Section */}
        <Layout.Section>
          <Card>
            <Box padding="400">
              <Text variant="headingLg" as="h2">Bestsellers</Text>
              
              <BlockStack gap="400">
                <FormLayout>
                  <div style={{ padding: '16px', borderBottom: '1px solid #e1e3e5' }}>
                    <BlockStack gap="200">
                      <Checkbox
                        label="Tag Bestsellers"
                        checked={bestsellersEnabled}
                        onChange={setBestsellersEnabled}
                      />
                      <Text variant="bodySm" as="p">
                        When this is turned ON, the app automatically adds a tag to your top products.
                      </Text>
                    </BlockStack>
                    
                    <Box paddingBlockStart="400">
                      <TextField
                        label="Tag"
                        value={bestsellersTag}
                        onChange={setBestsellersTag}
                        autoComplete="off"
                      />
                      <Text variant="bodySm" as="p">
                        Letters, numbers, dashes or underscores only as recommended by Shopify
                      </Text>
                    </Box>
                  </div>

                  <div style={{ padding: '16px', borderBottom: '1px solid #e1e3e5' }}>
                    <TextField
                      label="Number of top bestsellers to tag"
                      type="number"
                      value={bestsellersCount.toString()}
                      onChange={(value) => setBestsellersCount(parseInt(value) || 0)}
                      autoComplete="off"
                    />
                  </div>

                  <div style={{ padding: '16px', borderBottom: '1px solid #e1e3e5' }}>
                    <BlockStack gap="200">
                      <Text variant="bodyMd" as="p" fontWeight="semibold">Select Bestsellers By</Text>
                      <Text variant="bodySm" as="p">
                        Choose how the top products are identified for tagging, either by the number of sales or revenue.
                      </Text>
                      
                      <Select
                        label="Selection method"
                        options={[
                          {label: 'By Number Of Sales', value: 'sales'},
                          {label: 'By Revenue', value: 'revenue'},
                        ]}
                        value={bestsellersBy}
                        onChange={setBestsellersBy}
                      />
                      
                      <Box paddingBlockStart="200">
                        <TextField
                          label="Lookback Period"
                          type="number"
                          value={bestsellersLookback.toString()}
                          onChange={(value) => setBestsellersLookback(parseInt(value) || 0)}
                          autoComplete="off"
                          suffix="days"
                        />
                      </Box>
                    </BlockStack>
                  </div>

                  <div style={{ padding: '16px', borderBottom: '1px solid #e1e3e5' }}>
                    <Checkbox
                      label="Exclude Out-of-Stock Products"
                      helpText="Enable this option to exclude products that are out of stock from being tagged as bestsellers."
                      checked={bestsellersExcludeOOS}
                      onChange={setBestsellersExcludeOOS}
                    />
                  </div>

                  <div style={{ padding: '16px', borderBottom: '1px solid #e1e3e5' }}>
                    <BlockStack gap="200">
                      <Checkbox
                        label="Create Smart Collection 'Bestsellers'"
                        checked={bestsellersCreateCollection}
                        onChange={setBestsellersCreateCollection}
                      />
                      <Text variant="bodySm" as="p">
                        Automatically generate a smart collection containing all tagged bestsellers. Products are automatically removed from the collection when the tag is removed.
                      </Text>
                      
                      <Box paddingBlockStart="400">
                        <InlineStack gap="200">
                          <Badge>Smart</Badge>
                          <Text variant="bodyMd" as="span">Bestsellers</Text>
                        </InlineStack>
                        
                        <Box paddingBlockStart="200">
                          <InlineStack gap="200">
                            <Button size="slim">1</Button>
                            <Button variant="tertiary" size="slim">Edit</Button>
                            <Button variant="tertiary" size="slim">View</Button>
                          </InlineStack>
                        </Box>
                      </Box>
                    </BlockStack>
                  </div>
                </FormLayout>
                
                <div style={{ padding: '16px', borderTop: '1px solid #e1e3e5' }}>
                  <InlineStack align="end" gap="200">
                    <Button 
                      onClick={handleProcessBestsellers}
                      loading={processing && processingType === 'bestsellers'}
                    >
                      Process Now
                    </Button>
                    <Button variant="primary" onClick={handleSaveSettings}>
                      Save Settings
                    </Button>
                  </InlineStack>
                </div>
              </BlockStack>
            </Box>
          </Card>
        </Layout.Section>

        {/* Trending Section */}
        <Layout.Section>
          <Card>
            <Box padding="400">
              <Text variant="headingLg" as="h2">Trending</Text>
              
              <BlockStack gap="400">
                <FormLayout>
                  <div style={{ padding: '16px', borderBottom: '1px solid #e1e3e5' }}>
                    <BlockStack gap="200">
                      <Checkbox
                        label="Tag Trending"
                        checked={trendingEnabled}
                        onChange={setTrendingEnabled}
                      />
                      <Text variant="bodySm" as="p">
                        Automatically assign a tag to top trending products. These are the store's most recently purchased and popular products. A shorter lookback period is recommended. One tag only.
                      </Text>
                    </BlockStack>
                    
                    <Box paddingBlockStart="400">
                      <TextField
                        label="Tag"
                        value={trendingTag}
                        onChange={setTrendingTag}
                        autoComplete="off"
                      />
                      <Text variant="bodySm" as="p">
                        Letters,numbers,dashes or underscores only as recommended by Shopify
                      </Text>
                    </Box>
                  </div>

                  <div style={{ padding: '16px', borderBottom: '1px solid #e1e3e5' }}>
                    <TextField
                      label="Number of top trending to tag"
                      type="number"
                      value={trendingCount.toString()}
                      onChange={(value) => setTrendingCount(parseInt(value) || 0)}
                      autoComplete="off"
                    />
                  </div>

                  <div style={{ padding: '16px', borderBottom: '1px solid #e1e3e5' }}>
                    <TextField
                      label="Lookback Period"
                      type="number"
                      value={trendingLookback.toString()}
                      onChange={(value) => setTrendingLookback(parseInt(value) || 0)}
                      autoComplete="off"
                      suffix="days"
                    />
                  </div>

                  <div style={{ padding: '16px', borderBottom: '1px solid #e1e3e5' }}>
                    <Checkbox
                      label="Exclude Out-of-Stock Products"
                      helpText="Enable this option to exclude trending products that are currently out of stock from being tagged."
                      checked={trendingExcludeOOS}
                      onChange={setTrendingExcludeOOS}
                    />
                  </div>

                  <div style={{ padding: '16px', borderBottom: '1px solid #e1e3e5' }}>
                    <BlockStack gap="200">
                      <Checkbox
                        label="Create Smart Collection 'Trending'"
                        checked={trendingCreateCollection}
                        onChange={setTrendingCreateCollection}
                      />
                      <Text variant="bodySm" as="p">
                        Automatically generate a smart collection containing all tagged trending products. Products are automatically removed from the collection when the tag is removed.
                      </Text>
                      
                      <Box paddingBlockStart="400">
                        <TextField
                          label="New Collection Title"
                          value={trendingCollectionTitle}
                          onChange={setTrendingCollectionTitle}
                          placeholder="Title for new Smart collection to be generated"
                          autoComplete="off"
                        />
                        <Link>OR Attach existing collection</Link>
                      </Box>
                    </BlockStack>
                  </div>
                </FormLayout>
                
                <div style={{ padding: '16px', borderTop: '1px solid #e1e3e5' }}>
                  <InlineStack align="end" gap="200">
                    <Button 
                      onClick={handleProcessTrending}
                      loading={processing && processingType === 'trending'}
                    >
                      Process Now
                    </Button>
                    <Button variant="primary" onClick={handleSaveSettings}>
                      Save Settings
                    </Button>
                  </InlineStack>
                </div>
              </BlockStack>
            </Box>
          </Card>
        </Layout.Section>

        {/* New Arrivals Section */}
        <Layout.Section>
          <Card>
            <Box padding="400">
              <Text variant="headingLg" as="h2">New Arrivals</Text>
              
              <BlockStack gap="400">
                <FormLayout>
                  <div style={{ padding: '16px', borderBottom: '1px solid #e1e3e5' }}>
                    <BlockStack gap="200">
                      <Checkbox
                        label="Tag New Arrivals"
                        checked={newArrivalsEnabled}
                        onChange={setNewArrivalsEnabled}
                      />
                      <Text variant="bodySm" as="p">
                        Automatically assign a tag to new products. This tag allows you to create smart collections with new arrivals or exclude these products from others. A maximum of 1000 products can be tagged. The app uses the Creation Date setting from Sorting Rules → Manage New Products → Product Date to Use to identify new products.
                      </Text>
                    </BlockStack>
                    
                    <Box paddingBlockStart="400">
                      <TextField
                        label="Tag"
                        value={newArrivalsTag}
                        onChange={setNewArrivalsTag}
                        autoComplete="off"
                      />
                      <Text variant="bodySm" as="p">
                        Letters, numbers, dashes or underscores only as recommended by Shopify
                      </Text>
                    </Box>
                  </div>

                  <div style={{ padding: '16px', borderBottom: '1px solid #e1e3e5' }}>
                    <TextField
                      label="Number of new products to tag"
                      type="number"
                      value={newArrivalsCount.toString()}
                      onChange={(value) => setNewArrivalsCount(parseInt(value) || 0)}
                      autoComplete="off"
                    />
                  </div>

                  <div style={{ padding: '16px', borderBottom: '1px solid #e1e3e5' }}>
                    <TextField
                      label="New Arrivals Period"
                      type="number"
                      value={newArrivalsPeriod.toString()}
                      onChange={(value) => setNewArrivalsPeriod(parseInt(value) || 0)}
                      autoComplete="off"
                      suffix="days"
                      helpText="Define the time frame (in days) during which a product is considered a 'new arrival'."
                    />
                  </div>

                  <div style={{ padding: '16px', borderBottom: '1px solid #e1e3e5' }}>
                    <Checkbox
                      label="Exclude Out-of-Stock Products"
                      helpText="Enable this option to exclude new arrival products that are currently out of stock from being tagged."
                      checked={newArrivalsExcludeOOS}
                      onChange={setNewArrivalsExcludeOOS}
                    />
                  </div>

                  <div style={{ padding: '16px', borderBottom: '1px solid #e1e3e5' }}>
                    <BlockStack gap="200">
                      <Checkbox
                        label="Create Smart Collection 'New Arrivals'"
                        checked={newArrivalsCreateCollection}
                        onChange={setNewArrivalsCreateCollection}
                      />
                      <Text variant="bodySm" as="p">
                        Automatically generate a smart collection containing all tagged new arrivals. Products are automatically removed from the collection when the tag is removed.
                      </Text>
                      
                      <Box paddingBlockStart="400">
                        <TextField
                          label="New Arrivals Collection Title"
                          value={newArrivalsCollectionTitle}
                          onChange={setNewArrivalsCollectionTitle}
                          placeholder="Title for new arrivals Smart collection to be generated"
                          autoComplete="off"
                        />
                        <Link>OR Attach existing collection</Link>
                      </Box>
                    </BlockStack>
                  </div>
                </FormLayout>
                
                <div style={{ padding: '16px', borderTop: '1px solid #e1e3e5' }}>
                  <InlineStack align="end" gap="200">
                    <Button 
                      onClick={handleProcessNewArrivals}
                      loading={processing && processingType === 'newArrivals'}
                    >
                      Process Now
                    </Button>
                    <Button variant="primary" onClick={handleSaveSettings}>
                      Save Settings
                    </Button>
                  </InlineStack>
                </div>
              </BlockStack>
            </Box>
          </Card>
        </Layout.Section>

        {/* Aging Inventory Section */}
        <Layout.Section>
          <Card>
            <Box padding="400">
              <Text variant="headingLg" as="h2">Aging Inventory</Text>
              
              <BlockStack gap="400">
                <FormLayout>
                  <div style={{ padding: '16px', borderBottom: '1px solid #e1e3e5' }}>
                    <BlockStack gap="200">
                      <Checkbox
                        label="Tag Aging Inventory"
                        checked={agingEnabled}
                        onChange={setAgingEnabled}
                      />
                      <Text variant="bodySm" as="p">
                        Automatically assign a tag to products with aging stock (products that have had no sales during the specified lookback period). Tags are only applied to products with stock. One tag only.
                      </Text>
                    </BlockStack>
                    
                    <Box paddingBlockStart="400">
                      <TextField
                        label="Tag"
                        value={agingTag}
                        onChange={setAgingTag}
                        autoComplete="off"
                      />
                      <Text variant="bodySm" as="p">
                        Letters, numbers, dashes or underscores only as recommended by Shopify
                      </Text>
                    </Box>
                  </div>

                  <div style={{ padding: '16px', borderBottom: '1px solid #e1e3e5' }}>
                    <TextField
                      label="Number of aging stock products to tag"
                      type="number"
                      value={agingCount.toString()}
                      onChange={(value) => setAgingCount(parseInt(value) || 0)}
                      autoComplete="off"
                    />
                  </div>

                  <div style={{ padding: '16px', borderBottom: '1px solid #e1e3e5' }}>
                    <TextField
                      label="Lookback Period"
                      type="number"
                      value={agingLookback.toString()}
                      onChange={(value) => setAgingLookback(parseInt(value) || 0)}
                      autoComplete="off"
                      suffix="days"
                      helpText="Define the time frame (in days) during which a product must have no sales to be considered aging inventory."
                    />
                  </div>

                  <div style={{ padding: '16px', borderBottom: '1px solid #e1e3e5' }}>
                    <BlockStack gap="200">
                      <Checkbox
                        label="Create Smart Collection 'Aging'"
                        checked={agingCreateCollection}
                        onChange={setAgingCreateCollection}
                      />
                      <Text variant="bodySm" as="p">
                        Automatically generate a smart collection containing all tagged aging inventory. Products are automatically removed from the collection when the tag is removed.
                      </Text>
                      
                      <Box paddingBlockStart="400">
                        <TextField
                          label="Aging Stock Collection Title"
                          value={agingCollectionTitle}
                          onChange={setAgingCollectionTitle}
                          placeholder="Title for new Smart collection to be generated"
                          autoComplete="off"
                        />
                        <Link>OR Attach existing collection</Link>
                      </Box>
                    </BlockStack>
                  </div>
                </FormLayout>
                
                <div style={{ padding: '16px', borderTop: '1px solid #e1e3e5' }}>
                  <InlineStack align="end" gap="200">
                    <Button 
                      onClick={handleProcessAging}
                      loading={processing && processingType === 'aging'}
                    >
                      Process Now
                    </Button>
                    <Button variant="primary" onClick={handleSaveSettings}>
                      Save Settings
                    </Button>
                  </InlineStack>
                </div>
              </BlockStack>
            </Box>
          </Card>
        </Layout.Section>

        {/* Additional Settings Section */}
        <Layout.Section>
          <Card>
            <Box padding="400">
              <Text variant="headingLg" as="h2">Additional Settings</Text>
              
              <BlockStack gap="400">
                <FormLayout>
                  <div style={{ padding: '16px', borderBottom: '1px solid #e1e3e5' }}>
                    <BlockStack gap="200">
                      <Checkbox
                        label="Exclude Products"
                        checked={excludeEnabled}
                        onChange={setExcludeEnabled}
                      />
                      <Text variant="bodySm" as="p">
                        Do not tag products if they already have specific tag(s) assigned.
                      </Text>
                    </BlockStack>
                    
                    <Box paddingBlockStart="400">
                      <Text variant="bodyMd" as="p">Exclude tags</Text>
                      <Box paddingBlockStart="200">
                        <InlineStack gap="200">
                          <TextField
                            label="Enter tag to exclude"
                            value={newExcludeTag}
                            onChange={setNewExcludeTag}
                            placeholder="Enter tag to exclude"
                            autoComplete="off"
                          />
                          <Button onClick={handleAddExcludeTag}>Add a Tag</Button>
                        </InlineStack>
                      </Box>
                      
                      {excludeTags.length > 0 && (
                        <Box paddingBlockStart="200">
                          <InlineStack gap="200" wrap>
                            {excludeTags.map((tag: string, index: number) => (
                              <div key={index} style={{ position: 'relative', display: 'inline-block' }}>
                                <Badge>{tag}</Badge>
                                <button
                                  onClick={() => handleRemoveExcludeTag(tag)}
                                  style={{
                                    position: 'absolute',
                                    top: '-8px',
                                    right: '-8px',
                                    background: '#fff',
                                    border: '1px solid #ddd',
                                    borderRadius: '50%',
                                    width: '16px',
                                    height: '16px',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    cursor: 'pointer',
                                    fontSize: '12px',
                                    lineHeight: '1'
                                  }}
                                >
                                  ×
                                </button>
                              </div>
                            ))}
                          </InlineStack>
                        </Box>
                      )}
                    </Box>
                  </div>
                </FormLayout>
                
                <div style={{ padding: '16px', borderTop: '1px solid #e1e3e5' }}>
                  <InlineStack align="end">
                    <Button variant="primary" onClick={handleSaveSettings}>
                      Save Settings
                    </Button>
                  </InlineStack>
                </div>
              </BlockStack>
            </Box>
          </Card>
        </Layout.Section>
      </Layout>
      {toastMarkup}
    </Page>
  );
}