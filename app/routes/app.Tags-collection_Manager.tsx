// app/routes/app.Tags-collection_Manager.tsx
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
  Text,
  Badge,
  Link,
  BlockStack,
  InlineStack,
  Toast,
  Box,
  Tabs,
} from '@shopify/polaris';
import { authenticate } from '../shopify.server';
import { useLoaderData, useActionData, useSubmit } from "react-router";
import prisma from '../db.server';

// GraphQL queries (unchanged)
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
          variants(first: 50) {
            edges {
              node {
                id
              }
            }
          }
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
  query getOrders($query: String!, $first: Int!) {
    orders(first: $first, query: $query) {
      edges {
        node {
          id
          createdAt
          lineItems(first: 50) {
            edges {
              node {
                variant {
                  id
                  product {
                    id
                  }
                }
                quantity
                title
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

// Type definitions
interface ProductSales {
  [productId: string]: {
    id: string;
    title: string;
    sales: number;
    lastSold: Date;
  };
}

interface Product {
  id: string;
  title: string;
  handle: string;
  tags: string[];
  totalInventory: number;
  createdAt: string;
  updatedAt: string;
  variants: {
    edges: Array<{
      node: {
        id: string;
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
  bestsellersLookback: number; // Fixed at 180 days (6 months)
  bestsellersExcludeOOS: boolean;
  bestsellersCreateCollection: boolean;
  bestsellersCollectionId: string | null;
  trendingEnabled: boolean;
  trendingTag: string;
  trendingCount: number;
  trendingLookback: number; // Fixed at 7 days
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

interface GraphQLResponse<T> {
  data: T;
  errors?: Array<{
    message: string;
    field?: string[];
  }>;
}

interface OrdersResponse {
  orders: {
    edges: Array<{
      node: Order;
    }>;
    pageInfo: {
      hasNextPage: boolean;
      endCursor: string | null;
    };
  };
}

interface Order {
  id: string;
  createdAt: string;
  lineItems: {
    edges: Array<{
      node: {
        variant?: {
          id: string;
          product?: {
            id: string;
          };
        };
        quantity: number;
        title: string;
      };
    }>;
  };
}

async function fetchAllOrders(admin: any, query: string): Promise<Order[]> {
  let allOrders: Order[] = [];
  let hasNextPage = true;
  let cursor: string | null = null;
  
  try {
    while (hasNextPage) {
      console.log('Fetching orders with GraphQL query:', query);
      
      const response = await admin.graphql(GET_ORDERS_QUERY, {
        variables: { 
          query,
          first: 50,
          after: cursor
        }
      });
      
      const data: GraphQLResponse<OrdersResponse> = await response.json();
      
      if (data.errors) {
        throw new Error(data.errors[0].message);
      }
      
      const orders = data.data.orders.edges.map((edge) => edge.node);
      allOrders = [...allOrders, ...orders];
      
      hasNextPage = data.data.orders.pageInfo.hasNextPage;
      cursor = data.data.orders.pageInfo.endCursor;
      
      console.log(`Fetched ${orders.length} orders, total: ${allOrders.length}`);
    }
    
    return allOrders;
  } catch (error) {
    console.error('Error fetching orders via GraphQL:', error);
    throw error;
  }
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
      bestsellersLookback: 180, // Fixed 6 months
      bestsellersExcludeOOS: true,
      bestsellersCreateCollection: true,
      bestsellersCollectionId: null,
      trendingEnabled: true,
      trendingTag: 'br-trending',
      trendingCount: 50,
      trendingLookback: 7, // Fixed 7 days
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
  
  return Response.json({
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
            // bestsellersLookback is fixed at 180 days - not updated from form
            bestsellersExcludeOOS: formData.get('bestsellersExcludeOOS') === 'true',
            bestsellersCreateCollection: formData.get('bestsellersCreateCollection') === 'true',
            
            trendingEnabled: formData.get('trendingEnabled') === 'true',
            trendingTag: formData.get('trendingTag') as string,
            trendingCount: parseInt(formData.get('trendingCount') as string),
            // trendingLookback is fixed at 7 days - not updated from form
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
            bestsellersLookback: 180, // Fixed 180 days on create
            bestsellersExcludeOOS: formData.get('bestsellersExcludeOOS') === 'true',
            bestsellersCreateCollection: formData.get('bestsellersCreateCollection') === 'true',
            
            trendingEnabled: formData.get('trendingEnabled') === 'true',
            trendingTag: formData.get('trendingTag') as string,
            trendingCount: parseInt(formData.get('trendingCount') as string),
            trendingLookback: 7, // Fixed 7 days on create
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
        
        return Response.json({ success: true, message: 'Settings saved successfully!' });
      } catch (error) {
        console.error('Error saving settings:', error);
        return Response.json({ success: false, message: 'Error saving settings to database' });
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
        return Response.json({ success: false, message: 'Error fetching settings from database' });
      }
      
      if (!settings?.bestsellersEnabled) {
        return Response.json({ success: false, message: 'Bestsellers is disabled' });
      }
      
      // Get orders within fixed lookback period (6 months = 180 days)
      const lookbackDate = new Date();
      lookbackDate.setDate(lookbackDate.getDate() - 180); // Fixed 180 days
      
      let orders: any[] = [];
      
      try {
        const query = `created_at:>='${lookbackDate.toISOString().split('T')[0]}'`;
        orders = await fetchAllOrders(admin, query);
      } catch (error) {
        console.error('Failed to fetch orders for bestsellers:', error);
        return Response.json({ 
          success: false, 
          message: `Failed to fetch orders data from Shopify: ${error instanceof Error ? error.message : 'Unknown error'}` 
        });
      }
      
      // Check if we have valid data
      if (orders.length === 0) {
        return Response.json({ 
          success: false, 
          message: 'No orders found in the last 6 months for bestsellers analysis' 
        });
      }
      
      // Calculate product sales
      const productSales: ProductSales = {};
      
      orders.forEach((order: any) => {
        if (order.lineItems && order.lineItems.edges) {
          order.lineItems.edges.forEach((lineItemEdge: any) => {
            const item = lineItemEdge.node;
            const variantId = item.variant?.id;
            const productId = item.variant?.product?.id;
            
            if (!productId) return;
            
            const quantity = item.quantity || 0;
            
            if (!productSales[productId]) {
              productSales[productId] = {
                id: productId,
                title: item.title || 'Unknown Product',
                sales: 0,
                lastSold: new Date(order.createdAt)
              };
            }
            
            productSales[productId].sales += quantity;
            productSales[productId].lastSold = new Date(order.createdAt);
          });
        }
      });
      
      // Sort products by sales (highest first)
      const sortedProducts = Object.values(productSales).sort((a: ProductSales[string], b: ProductSales[string]) => {
        return b.sales - a.sales;
      });
      
      // Get top N products
      const topProducts = sortedProducts.slice(0, settings.bestsellersCount);
      
      // Get all products to check inventory and existing tags
      const productsResponse = await admin.graphql(GET_PRODUCTS_QUERY, {
        variables: { first: 250 }
      });
      const productsData = await productsResponse.json();
      
      if (!productsData.data?.products) {
        return Response.json({ 
          success: false, 
          message: 'Failed to fetch products data' 
        });
      }
      
      const products = productsData.data.products.edges.map((edge: { node: Product }) => edge.node);
      
      // Create or update collection if needed
      let collectionId: string | null = null;
      
      if (settings.bestsellersCreateCollection) {
        collectionId = settings.bestsellersCollectionId;
        
        if (!collectionId) {
          // Create new collection
          const createCollectionResponse = await admin.graphql(CREATE_COLLECTION_MUTATION, {
            variables: {
              input: {
                title: "Bestsellers",
                ruleSet: {
                  rules: [
                    {
                      column: "TAG",
                      relation: "EQUALS",
                      condition: settings.bestsellersTag
                    }
                  ],
                  appliedDisjunctively: false
                }
              }
            }
          });
          
          const createCollectionData = await createCollectionResponse.json();
          
          if (createCollectionData.data.collectionCreate.userErrors.length > 0) {
            return Response.json({ 
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
            console.log('Updated bestsellersCollectionId in database:', collectionId);
          } catch (error) {
            console.error('Error updating collection ID:', error);
          }
        }
      }
      
      // Remove the bestsellers tag from all products first
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
      
      // Add the bestsellers tag to top products
      let taggedCount = 0;
      for (const topProduct of topProducts) {
        const product = products.find((p: Product) => p.id === topProduct.id);
        
        if (!product) continue;
        
        // Check if product is out of stock and should be excluded
        if (settings.bestsellersExcludeOOS && product.totalInventory <= 0) {
          console.log(`Excluding out-of-stock product: ${product.title}`);
          continue;
        }
        
        // Check if product has excluded tags
        if (settings.excludeEnabled && settings.excludeTags.length > 0) {
          const hasExcludedTag = settings.excludeTags.some((tag: string) => product.tags.includes(tag));
          if (hasExcludedTag) {
            console.log(`Excluding product with excluded tag: ${product.title}`);
            continue;
          }
        }
        
        // Add the bestsellers tag
        const newTags = [...product.tags, settings.bestsellersTag];
        
        await admin.graphql(UPDATE_PRODUCT_MUTATION, {
          variables: {
            input: {
              id: product.id,
              tags: newTags
            }
          }
        });
        
        taggedCount++;
        console.log(`Tagged bestseller: ${product.title}`);
      }
      
      return Response.json({ 
        success: true, 
        message: `Bestsellers processed successfully! Tagged ${taggedCount} products with the most sales in the last 6 months.` 
      });
    } else if (actionType === 'processTrending') {
      // Process trending products
      let settings: Settings | null = null;
      
      try {
        settings = await (prisma as any).settings.findUnique({
          where: { shopifyDomain: session.shop }
        });
      } catch (error) {
        console.error('Error fetching settings:', error);
        return Response.json({ success: false, message: 'Error fetching settings from database' });
      }
      
      if (!settings?.trendingEnabled) {
        return Response.json({ success: false, message: 'Trending is disabled' });
      }
      
      // Get orders within fixed trending lookback period (7 days)
      const lookbackDate = new Date();
      lookbackDate.setDate(lookbackDate.getDate() - 7); // Fixed 7 days
      
      let orders: any[] = [];
      
      try {
        const query = `created_at:>='${lookbackDate.toISOString().split('T')[0]}'`;
        orders = await fetchAllOrders(admin, query);
      } catch (error) {
        console.error('Failed to fetch orders for trending:', error);
        return Response.json({ 
          success: false, 
          message: `Failed to fetch orders data for trending products: ${error instanceof Error ? error.message : 'Unknown error'}` 
        });
      }
      
      // Check if we have valid data
      if (orders.length === 0) {
        return Response.json({ 
          success: false, 
          message: 'No orders found in the last 7 days for trending analysis' 
        });
      }
      
      // Calculate product sales with timestamps for trending analysis
      const productSales: ProductSales = {};
      
      orders.forEach((order: any) => {
        const orderDate = new Date(order.createdAt);
        
        if (order.lineItems && order.lineItems.edges) {
          order.lineItems.edges.forEach((lineItemEdge: any) => {
            const item = lineItemEdge.node;
            const variantId = item.variant?.id;
            const productId = item.variant?.product?.id;
            
            if (!productId) return;
            
            const quantity = item.quantity || 0;
            
            if (!productSales[productId]) {
              productSales[productId] = {
                id: productId,
                title: item.title || 'Unknown Product',
                sales: 0,
                lastSold: orderDate
              };
            }
            
            productSales[productId].sales += quantity;
            // For trending, we focus on recent sales velocity rather than total revenue
            // Update lastSold to the most recent order date
            if (orderDate > productSales[productId].lastSold) {
              productSales[productId].lastSold = orderDate;
            }
          });
        }
      });
      
      // For trending, we want products that are selling fast recently
      // We'll sort by most recent sales first, then by sales volume
      const sortedProducts = Object.values(productSales).sort((a: ProductSales[string], b: ProductSales[string]) => {
        // First sort by most recent sale (newest first)
        const recencyDiff = b.lastSold.getTime() - a.lastSold.getTime();
        if (Math.abs(recencyDiff) > 24 * 60 * 60 * 1000) { // If difference is more than 1 day
          return recencyDiff;
        }
        // Then by sales volume
        return b.sales - a.sales;
      });
      
      // Get top N trending products
      const trendingProducts = sortedProducts.slice(0, settings.trendingCount);
      
      // Get all products to check inventory and existing tags
      const productsResponse = await admin.graphql(GET_PRODUCTS_QUERY, {
        variables: { first: 250 }
      });
      const productsData = await productsResponse.json();
      
      if (!productsData.data?.products) {
        return Response.json({ 
          success: false, 
          message: 'Failed to fetch products data for trending' 
        });
      }
      
      const products = productsData.data.products.edges.map((edge: { node: Product }) => edge.node);
      
      // Create or update collection if needed
      let collectionId = settings.trendingCollectionId;
      
      if (settings.trendingCreateCollection) {
        const collectionTitle = settings.trendingCollectionTitle || 'Trending Now';
        
        if (!collectionId) {
          // Create new collection
          const createCollectionResponse = await admin.graphql(CREATE_COLLECTION_MUTATION, {
            variables: {
              input: {
                title: collectionTitle,
                ruleSet: {
                  rules: [
                    {
                      column: "TAG",
                      relation: "EQUALS",
                      condition: settings.trendingTag
                    }
                  ],
                  appliedDisjunctively: false
                }
              }
            }
          });
          
          const createCollectionData = await createCollectionResponse.json();
          
          if (createCollectionData.data.collectionCreate.userErrors.length > 0) {
            return Response.json({ 
              success: false, 
              message: `Error creating collection: ${createCollectionData.data.collectionCreate.userErrors[0].message}` 
            });
          }
          
          collectionId = createCollectionData.data.collectionCreate.collection.id;
          
          // Update settings with collection ID
          try {
            await (prisma as any).settings.update({
              where: { shopifyDomain: session.shop },
              data: { trendingCollectionId: collectionId }
            });
          } catch (error) {
            console.error('Error updating collection ID:', error);
          }
        } else {
          // Update existing collection
          const updateCollectionResponse = await admin.graphql(UPDATE_COLLECTION_MUTATION, {
            variables: {
              input: {
                id: collectionId,
                title: collectionTitle,
                ruleSet: {
                  rules: [
                    {
                      column: "TAG",
                      relation: "EQUALS",
                      condition: settings.trendingTag
                    }
                  ],
                  appliedDisjunctively: false
                }
              }
            }
          });
          
          const updateCollectionData = await updateCollectionResponse.json();
          
          if (updateCollectionData.data.collectionUpdate.userErrors.length > 0) {
            return Response.json({ 
              success: false, 
              message: `Error updating collection: ${updateCollectionData.data.collectionUpdate.userErrors[0].message}` 
            });
          }
        }
      }
      
      // Remove trending tag from all products first
      for (const product of products) {
        if (product.tags.includes(settings.trendingTag)) {
          const newTags = product.tags.filter((tag: string) => tag !== settings.trendingTag);
          
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
      
      // Add trending tag to trending products
      let taggedCount = 0;
      for (const trendingProduct of trendingProducts) {
        const product = products.find((p: Product) => p.id === trendingProduct.id);
        
        if (!product) continue;
        
        // Check if product is out of stock and should be excluded
        if (settings.trendingExcludeOOS && product.totalInventory <= 0) {
          console.log(`Excluding out-of-stock trending product: ${product.title}`);
          continue;
        }
        
        // Check if product has excluded tags
        if (settings.excludeEnabled && settings.excludeTags.length > 0) {
          const hasExcludedTag = settings.excludeTags.some((tag: string) => product.tags.includes(tag));
          if (hasExcludedTag) {
            console.log(`Excluding trending product with excluded tag: ${product.title}`);
            continue;
          }
        }
        
        // Add trending tag
        const newTags = [...product.tags, settings.trendingTag];
        
        await admin.graphql(UPDATE_PRODUCT_MUTATION, {
          variables: {
            input: {
              id: product.id,
              tags: newTags
            }
          }
        });
        
        taggedCount++;
        console.log(`Tagged trending product: ${product.title}`);
      }
      
      return Response.json({ 
        success: true, 
        message: `Trending products processed successfully! Tagged ${taggedCount} products with the most sales in the last 7 days.` 
      });
    } else if (actionType === 'processNewArrivals') {
      // Process new arrivals
      let settings: Settings | null = null;
      
      try {
        settings = await (prisma as any).settings.findUnique({
          where: { shopifyDomain: session.shop }
        });
      } catch (error) {
        console.error('Error fetching settings:', error);
        return Response.json({ success: false, message: 'Error fetching settings from database' });
      }
      
      if (!settings?.newArrivalsEnabled) {
        return Response.json({ success: false, message: 'New Arrivals is disabled' });
      }
      
      // Get products created within the new arrivals period
      const periodDate = new Date();
      periodDate.setDate(periodDate.getDate() - settings.newArrivalsPeriod);
      
      const productsResponse = await admin.graphql(GET_PRODUCTS_QUERY, {
        variables: { 
          first: 250,
          query: `created_at:>='${periodDate.toISOString().split('T')[0]}'`
        }
      });
      const productsData = await productsResponse.json();
      
      if (!productsData.data?.products) {
        return Response.json({ 
          success: false, 
          message: 'Failed to fetch products data for new arrivals' 
        });
      }
      
      const products = productsData.data.products.edges.map((edge: { node: Product }) => edge.node);
      
      // Sort by creation date (newest first)
      const sortedProducts = products.sort((a: Product, b: Product) => 
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      );
      
      // Get top N newest products
      const newestProducts = sortedProducts.slice(0, settings.newArrivalsCount);
      
      // Create or update collection if needed
      let collectionId = settings.newArrivalsCollectionId;
      
      if (settings.newArrivalsCreateCollection) {
        const collectionTitle = settings.newArrivalsCollectionTitle || 'New Arrivals';
        
        if (!collectionId) {
          // Create new collection
          const createCollectionResponse = await admin.graphql(CREATE_COLLECTION_MUTATION, {
            variables: {
              input: {
                title: collectionTitle,
                ruleSet: {
                  rules: [
                    {
                      column: "TAG",
                      relation: "EQUALS",
                      condition: settings.newArrivalsTag
                    }
                  ],
                  appliedDisjunctively: false
                }
              }
            }
          });
          
          const createCollectionData = await createCollectionResponse.json();
          
          if (createCollectionData.data.collectionCreate.userErrors.length > 0) {
            return Response.json({ 
              success: false, 
              message: `Error creating collection: ${createCollectionData.data.collectionCreate.userErrors[0].message}` 
            });
          }
          
          collectionId = createCollectionData.data.collectionCreate.collection.id;
          
          // Update settings with collection ID
          try {
            await (prisma as any).settings.update({
              where: { shopifyDomain: session.shop },
              data: { newArrivalsCollectionId: collectionId }
            });
          } catch (error) {
            console.error('Error updating collection ID:', error);
          }
        } else {
          // Update existing collection
          const updateCollectionResponse = await admin.graphql(UPDATE_COLLECTION_MUTATION, {
            variables: {
              input: {
                id: collectionId,
                title: collectionTitle,
                ruleSet: {
                  rules: [
                    {
                      column: "TAG",
                      relation: "EQUALS",
                      condition: settings.newArrivalsTag
                    }
                  ],
                  appliedDisjunctively: false
                }
              }
            }
          });
          
          const updateCollectionData = await updateCollectionResponse.json();
          
          if (updateCollectionData.data.collectionUpdate.userErrors.length > 0) {
            return Response.json({ 
              success: false, 
              message: `Error updating collection: ${updateCollectionData.data.collectionUpdate.userErrors[0].message}` 
            });
          }
        }
      }
      
      // Remove new arrivals tag from all products first
      for (const product of products) {
        if (product.tags.includes(settings.newArrivalsTag)) {
          const newTags = product.tags.filter((tag: string) => tag !== settings.newArrivalsTag);
          
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
      
      // Add new arrivals tag to newest products
      let taggedCount = 0;
      for (const newestProduct of newestProducts) {
        // Check if product is out of stock and should be excluded
        if (settings.newArrivalsExcludeOOS && newestProduct.totalInventory <= 0) {
          console.log(`Excluding out-of-stock new arrival: ${newestProduct.title}`);
          continue;
        }
        
        // Check if product has excluded tags
        if (settings.excludeEnabled && settings.excludeTags.length > 0) {
          const hasExcludedTag = settings.excludeTags.some((tag: string) => newestProduct.tags.includes(tag));
          if (hasExcludedTag) {
            console.log(`Excluding new arrival with excluded tag: ${newestProduct.title}`);
            continue;
          }
        }
        
        // Add new arrivals tag
        const newTags = [...newestProduct.tags, settings.newArrivalsTag];
        
        await admin.graphql(UPDATE_PRODUCT_MUTATION, {
            variables: {
              input: {
                id: newestProduct.id,
                tags: newTags
              }
            }
          });
        
        taggedCount++;
        console.log(`Tagged new arrival: ${newestProduct.title}`);
      }
      
      return Response.json({ 
        success: true, 
        message: `New arrivals processed successfully! Tagged ${taggedCount} products.` 
      });
    } else if (actionType === 'processAging') {
      // Process aging inventory
      let settings: Settings | null = null;
      
      try {
        settings = await (prisma as any).settings.findUnique({
          where: { shopifyDomain: session.shop }
        });
      } catch (error) {
        console.error('Error fetching settings:', error);
        return Response.json({ success: false, message: 'Error fetching settings from database' });
      }
      
      if (!settings?.agingEnabled) {
        return Response.json({ success: false, message: 'Aging Inventory is disabled' });
      }
      
      // Get orders within the aging lookback period to identify products with no sales
      const lookbackDate = new Date();
      lookbackDate.setDate(lookbackDate.getDate() - settings.agingLookback);
      
      let orders: any[] = [];
      
      try {
        const query = `created_at:>='${lookbackDate.toISOString().split('T')[0]}'`;
        orders = await fetchAllOrders(admin, query);
      } catch (error) {
        console.error('Failed to fetch orders for aging analysis:', error);
        return Response.json({ 
          success: false, 
          message: `Failed to fetch orders data for aging analysis: ${error instanceof Error ? error.message : 'Unknown error'}` 
        });
      }
      
      // Get all products
      const productsResponse = await admin.graphql(GET_PRODUCTS_QUERY, {
        variables: { first: 250 }
      });
      const productsData = await productsResponse.json();
      
      if (!productsData.data?.products) {
        return Response.json({ 
          success: false, 
          message: 'Failed to fetch products data for aging analysis' 
        });
      }
      
      const products = productsData.data.products.edges.map((edge: { node: Product }) => edge.node);
      
      // Create a set of product IDs that have had sales in the lookback period
      const productIdsWithSales = new Set<string>();
      
      if (orders.length > 0) {
        orders.forEach((order: any) => {
          if (order.lineItems && order.lineItems.edges) {
            order.lineItems.edges.forEach((lineItemEdge: any) => {
              const item = lineItemEdge.node;
              const productId = item.variant?.product?.id;
              if (productId) {
                productIdsWithSales.add(productId);
              }
            });
          }
        });
      }
      
      // Filter products that haven't had sales in the lookback period
      const agingProducts = products.filter((product: Product) => 
        !productIdsWithSales.has(product.id)
      );
      
      // Sort by creation date (oldest first)
      const sortedAgingProducts = agingProducts.sort((a: Product, b: Product) => 
        new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
      );
      
      // Get top N oldest products
      const oldestProducts = sortedAgingProducts.slice(0, settings.agingCount);
      
      // Create or update collection if needed
      let collectionId = settings.agingCollectionId;
      
      if (settings.agingCreateCollection) {
        const collectionTitle = settings.agingCollectionTitle || 'Aging Inventory';
        
        if (!collectionId) {
          // Create new collection
          const createCollectionResponse = await admin.graphql(CREATE_COLLECTION_MUTATION, {
            variables: {
              input: {
                title: collectionTitle,
                ruleSet: {
                  rules: [
                    {
                      column: "TAG",
                      relation: "EQUALS",
                      condition: settings.agingTag
                    }
                  ],
                  appliedDisjunctively: false
                }
              }
            }
          });
          
          const createCollectionData = await createCollectionResponse.json();
          
          if (createCollectionData.data.collectionCreate.userErrors.length > 0) {
            return Response.json({ 
              success: false, 
              message: `Error creating collection: ${createCollectionData.data.collectionCreate.userErrors[0].message}` 
            });
          }
          
          collectionId = createCollectionData.data.collectionCreate.collection.id;
          
          // Update settings with collection ID
          try {
            await (prisma as any).settings.update({
              where: { shopifyDomain: session.shop },
              data: { agingCollectionId: collectionId }
            });
          } catch (error) {
            console.error('Error updating collection ID:', error);
          }
        } else {
          // Update existing collection
          const updateCollectionResponse = await admin.graphql(UPDATE_COLLECTION_MUTATION, {
            variables: {
              input: {
                id: collectionId,
                title: collectionTitle,
                ruleSet: {
                  rules: [
                    {
                      column: "TAG",
                      relation: "EQUALS",
                      condition: settings.agingTag
                    }
                  ],
                  appliedDisjunctively: false
                }
              }
            }
          });
          
          const updateCollectionData = await updateCollectionResponse.json();
          
          if (updateCollectionData.data.collectionUpdate.userErrors.length > 0) {
            return Response.json({ 
              success: false, 
              message: `Error updating collection: ${updateCollectionData.data.collectionUpdate.userErrors[0].message}` 
            });
          }
        }
      }
      
      // Remove aging tag from all products first
      for (const product of products) {
        if (product.tags.includes(settings.agingTag)) {
          const newTags = product.tags.filter((tag: string) => tag !== settings.agingTag);
          
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
      
      // Add aging tag to oldest products
      let taggedCount = 0;
      for (const oldestProduct of oldestProducts) {
        // Check if product has excluded tags
        if (settings.excludeEnabled && settings.excludeTags.length > 0) {
          const hasExcludedTag = settings.excludeTags.some((tag: string) => oldestProduct.tags.includes(tag));
          if (hasExcludedTag) {
            console.log(`Excluding aging product with excluded tag: ${oldestProduct.title}`);
            continue;
          }
        }
        
        // Add aging tag
        const newTags = [...oldestProduct.tags, settings.agingTag];
        
        await admin.graphql(UPDATE_PRODUCT_MUTATION, {
          variables: {
            input: {
              id: oldestProduct.id,
              tags: newTags
            }
          }
        });
        
        taggedCount++;
        console.log(`Tagged aging product: ${oldestProduct.title}`);
      }
      
      return Response.json({ 
        success: true, 
        message: `Aging inventory processed successfully! Tagged ${taggedCount} products.` 
      });
    }
    
    return Response.json({ success: false, message: 'Unknown action type' });
  } catch (error) {
    console.error('Error processing action:', error);
    return Response.json({ success: false, message: `Error: ${error instanceof Error ? error.message : 'Unknown error'}` });
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
  
  // Tab navigation state
  const [selectedTab, setSelectedTab] = useState(0);
  
  // State for form fields
  const [bestsellersTag, setBestsellersTag] = useState(settings.bestsellersTag);
  const [bestsellersCount, setBestsellersCount] = useState(settings.bestsellersCount);
  const [bestsellersExcludeOOS, setBestsellersExcludeOOS] = useState(settings.bestsellersExcludeOOS);
  
  const [trendingTag, setTrendingTag] = useState(settings.trendingTag);
  const [trendingCount, setTrendingCount] = useState(settings.trendingCount);
  const [trendingExcludeOOS, setTrendingExcludeOOS] = useState(settings.trendingExcludeOOS);
  
  const [newArrivalsTag, setNewArrivalsTag] = useState(settings.newArrivalsTag);
  const [newArrivalsCount, setNewArrivalsCount] = useState(settings.newArrivalsCount);
  const [newArrivalsPeriod, setNewArrivalsPeriod] = useState(settings.newArrivalsPeriod);
  const [newArrivalsExcludeOOS, setNewArrivalsExcludeOOS] = useState(settings.newArrivalsExcludeOOS);
  
  const [agingTag, setAgingTag] = useState(settings.agingTag);
  const [agingCount, setAgingCount] = useState(settings.agingCount);
  const [agingLookback, setAgingLookback] = useState(settings.agingLookback);
  
  const [excludeEnabled, setExcludeEnabled] = useState(settings.excludeEnabled);
  const [excludeTags, setExcludeTags] = useState(settings.excludeTags || []);
  const [newExcludeTag, setNewExcludeTag] = useState('');
  
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
    formData.append('bestsellersEnabled', settings.bestsellersEnabled.toString());
    formData.append('bestsellersTag', bestsellersTag);
    formData.append('bestsellersCount', bestsellersCount.toString());
    // bestsellersLookback is fixed at 180 days - not included in form data
    formData.append('bestsellersExcludeOOS', bestsellersExcludeOOS.toString());
    formData.append('bestsellersCreateCollection', settings.bestsellersCreateCollection.toString());
    
    // Trending settings
    formData.append('trendingEnabled', settings.trendingEnabled.toString());
    formData.append('trendingTag', trendingTag);
    formData.append('trendingCount', trendingCount.toString());
    // trendingLookback is fixed at 7 days - not included in form data
    formData.append('trendingExcludeOOS', trendingExcludeOOS.toString());
    formData.append('trendingCreateCollection', settings.trendingCreateCollection.toString());
    formData.append('trendingCollectionTitle', settings.trendingCollectionTitle || '');
    
    // New Arrivals settings
    formData.append('newArrivalsEnabled', settings.newArrivalsEnabled.toString());
    formData.append('newArrivalsTag', newArrivalsTag);
    formData.append('newArrivalsCount', newArrivalsCount.toString());
    formData.append('newArrivalsPeriod', newArrivalsPeriod.toString());
    formData.append('newArrivalsExcludeOOS', newArrivalsExcludeOOS.toString());
    formData.append('newArrivalsCreateCollection', settings.newArrivalsCreateCollection.toString());
    formData.append('newArrivalsCollectionTitle', settings.newArrivalsCollectionTitle || '');
    
    // Aging Inventory settings
    formData.append('agingEnabled', settings.agingEnabled.toString());
    formData.append('agingTag', agingTag);
    formData.append('agingCount', agingCount.toString());
    formData.append('agingLookback', agingLookback.toString());
    formData.append('agingCreateCollection', settings.agingCreateCollection.toString());
    formData.append('agingCollectionTitle', settings.agingCollectionTitle || '');
    
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

  const tabs = [
    {
      id: 'bestsellers',
      content: '🏆 Bestsellers',
      panelID: 'bestsellers-panel',
    },
    {
      id: 'trending',
      content: '🔥 Trending',
      panelID: 'trending-panel',
    },
    {
      id: 'new-arrivals',
      content: '🆕 New Arrivals',
      panelID: 'new-arrivals-panel',
    },
    {
      id: 'aging',
      content: '📦 Aging',
      panelID: 'aging-panel',
    },
    {
      id: 'settings',
      content: '⚙️ Settings',
      panelID: 'settings-panel',
    },
  ];

  return (
    <Page
      title="Collection Manager"
    >
      <Layout>
        <Layout.Section>
          <Banner tone="info">
            <Text variant="bodyMd" as="p">
              Thank you for installing Bestsellers ReSort. Click below to schedule a setup call with our team and get the most out of the app.
            </Text>
          </Banner>
        </Layout.Section>

        <Layout.Section>
          <Tabs tabs={tabs} selected={selectedTab} onSelect={setSelectedTab}>
            {selectedTab === 0 && (
              <Card>
                <Box padding="400">
                  <BlockStack gap="400">
                    <FormLayout>
                      <div style={{ padding: '16px', borderBottom: '1px solid #e1e3e5' }}>
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
                          <Text variant="bodyMd" as="p" fontWeight="semibold">Bestsellers Criteria</Text>
                          <Text variant="bodySm" as="p">
                            Products are ranked by the number of units sold in the last 6 months (180 days). The more units sold, the higher the ranking.
                          </Text>
                          
                          <Box paddingBlockStart="200">
                            <div style={{ 
                              padding: '12px', 
                              backgroundColor: '#f6f6f7', 
                              borderRadius: '6px',
                              border: '1px solid #e1e3e5'
                            }}>
                              <Text variant="bodyMd" as="p" fontWeight="medium">
                                Lookback Period: <Badge tone="success">180 days (6 months) - Fixed</Badge>
                              </Text>
                              <Text variant="bodySm" as="p">
                                Bestsellers are calculated based on sales data from the last 6 months to ensure consistent performance measurement.
                              </Text>
                            </div>
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
            )}
            
            {selectedTab === 1 && (
              <Card>
                <Box padding="400">
                  <BlockStack gap="400">
                    <FormLayout>
                      <div style={{ padding: '16px', borderBottom: '1px solid #e1e3e5' }}>
                        <Box paddingBlockStart="400">
                          <TextField
                            label="Tag Name"
                            value={trendingTag}
                            onChange={setTrendingTag}
                            autoComplete="off"
                          />
                          <Text variant="bodySm" as="p">
                            Letters, numbers, dashes or underscores only as recommended by Shopify
                          </Text>
                        </Box>
                      </div>

                      <div style={{ padding: '16px', borderBottom: '1px solid #e1e3e5' }}>
                        <TextField
                          label="Number of Top Trending to Tag"
                          type="number"
                          value={trendingCount.toString()}
                          onChange={(value) => setTrendingCount(parseInt(value) || 0)}
                          autoComplete="off"
                          helpText="Defines how many trending products will get the tag. The most trending products based on recent activity will be tagged."
                        />
                      </div>

                      <div style={{ padding: '16px', borderBottom: '1px solid #e1e3e5' }}>
                        <BlockStack gap="200">
                          <Text variant="bodyMd" as="p" fontWeight="semibold">Trending Criteria</Text>
                          
                          <div style={{ 
                            padding: '12px', 
                            backgroundColor: '#f6f6f7', 
                            borderRadius: '6px',
                            border: '1px solid #e1e3e5'
                          }}>
                            <Text variant="bodyMd" as="p" fontWeight="medium">
                              Lookback Period: <Badge tone="success">7 days - Fixed</Badge>
                            </Text>
                            <Text variant="bodySm" as="p">
                              Trending products are identified based on sales from the last 7 days to capture current popularity and momentum.
                            </Text>
                          </div>
                        </BlockStack>
                      </div>

                      <div style={{ padding: '16px', borderBottom: '1px solid #e1e3e5' }}>
                        <Checkbox
                          label="Exclude Out-of-Stock Products"
                          helpText="Enable this option to exclude sold-out items from the trending list. Keeps your Trending collection clean and relevant with only products customers can buy."
                          checked={trendingExcludeOOS}
                          onChange={setTrendingExcludeOOS}
                        />
                      </div>
                    </FormLayout>
                    
                    <div style={{ padding: '16px', backgroundColor: '#f6f6f7', borderRadius: '8px', marginTop: '16px' }}>
                      <Text variant="bodyMd" as="p" fontWeight="semibold">💡 How Trending Works:</Text>
                      <Text variant="bodySm" as="p">
                        The Trending Section automatically finds and tags your most recently popular or fast-selling products — items that are currently gaining traction. 
                        It helps highlight products that recently started selling well (not just your all-time bestsellers). 
                        When new products become popular, they get the tag — and older ones may lose it, so the list keeps updating automatically.
                      </Text>
                    </div>
                    
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
            )}
            
            {selectedTab === 2 && (
              <Card>
                <Box padding="400">
                  <BlockStack gap="400">
                    <FormLayout>
                      <div style={{ padding: '16px', borderBottom: '1px solid #e1e3e5' }}>
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
            )}
            
            {selectedTab === 3 && (
              <Card>
                <Box padding="400">
                  <BlockStack gap="400">
                    <FormLayout>
                      <div style={{ padding: '16px', borderBottom: '1px solid #e1e3e5' }}>
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
            )}
            
            {selectedTab === 4 && (
              <Card>
                <Box padding="400">
                  <Text variant="headingLg" as="h2">⚙️ Additional Settings</Text>
                  
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
            )}
          </Tabs>
        </Layout.Section>
      </Layout>
      {toastMarkup}
    </Page>
  );
}