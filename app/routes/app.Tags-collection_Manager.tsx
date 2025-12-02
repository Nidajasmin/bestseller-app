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
import { AppLogger } from '../utils/logging'; // Import the logger

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
                inventoryQuantity
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
                    title
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

// Type definitions (unchanged)
interface ProductSales {
  [productId: string]: {
    id: string;
    title: string;
    sales: number;
    lastSold: Date;
    variantId?: string;
  };
}

interface Product {
  id: string;
  title: string;
  handle: string;
  tags: string[];
  totalInventory: number;
  createdAt: string;
  variants: {
    edges: Array<{
      node: {
        id: string;
        inventoryQuantity: number;
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
  lastProcessed: Date | null;
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
            title: string;
          };
        };
        quantity: number;
        title: string;
      };
    }>;
  };
}

interface ProductsResponse {
  products: {
    edges: Array<{
      node: Product;
    }>;
    pageInfo: {
      hasNextPage: boolean;
      endCursor: string | null;
    };
  };
}

async function fetchAllOrders(admin: any, query: string): Promise<Order[]> {
  let allOrders: Order[] = [];
  let hasNextPage = true;
  let cursor: string | null = null;
  
  try {
    AppLogger.info('Starting to fetch all orders', { query });
    
    while (hasNextPage) {
      AppLogger.debug('Fetching orders batch with GraphQL', { query, cursor });
      
      const response = await admin.graphql(GET_ORDERS_QUERY, {
        variables: { 
          query,
          first: 50,
          after: cursor
        }
      });
      
      const data: GraphQLResponse<OrdersResponse> = await response.json();
      
      if (data.errors) {
        AppLogger.error('GraphQL errors while fetching orders', { errors: data.errors });
        throw new Error(data.errors[0].message);
      }
      
      const orders = data.data.orders.edges.map((edge) => edge.node);
      allOrders = [...allOrders, ...orders];
      
      hasNextPage = data.data.orders.pageInfo.hasNextPage;
      cursor = data.data.orders.pageInfo.endCursor;
      
      AppLogger.debug(`Fetched ${orders.length} orders in batch`, { 
        totalSoFar: allOrders.length,
        hasNextPage,
        cursor 
      });
    }
    
    AppLogger.info('Successfully fetched all orders', { totalOrders: allOrders.length });
    return allOrders;
  } catch (error) {
    AppLogger.error('Error fetching orders via GraphQL', error, { query });
    throw error;
  }
}

async function fetchAllProducts(admin: any): Promise<Product[]> {
  let allProducts: Product[] = [];
  let hasNextPage = true;
  let cursor: string | null = null;
  
  try {
    AppLogger.info('Starting to fetch all products');
    
    while (hasNextPage) {
      const productsQuery = `#graphql
        query getProducts($first: Int!, $after: String) {
          products(first: $first, after: $after) {
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
                      inventoryQuantity
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
      
      AppLogger.debug('Fetching products batch', { cursor });
      
      const response = await admin.graphql(productsQuery, {
        variables: { first: 100, after: cursor }
      });
      
      const data: GraphQLResponse<ProductsResponse> = await response.json();
      
      if (!data.data?.products) {
        AppLogger.warn('No products data returned from GraphQL');
        break;
      }
      
      const productsBatch = data.data.products.edges.map((edge: { node: Product }) => edge.node);
      allProducts = [...allProducts, ...productsBatch];
      
      hasNextPage = data.data.products.pageInfo.hasNextPage;
      cursor = data.data.products.pageInfo.endCursor;
      
      AppLogger.debug(`Fetched ${productsBatch.length} products in batch`, {
        totalSoFar: allProducts.length,
        hasNextPage,
        cursor
      });
    }
    
    AppLogger.info(`Successfully fetched ${allProducts.length} total products from store`);
    return allProducts;
  } catch (error) {
    AppLogger.error('Error fetching products', error);
    throw error;
  }
}

async function checkCollectionExists(admin: any, collectionId: string): Promise<boolean> {
  try {
    AppLogger.debug('Checking if collection exists', { collectionId });
    
    const response = await admin.graphql(`#graphql
      query getCollection($id: ID!) {
        collection(id: $id) {
          id
        }
      }
    `, {
      variables: { id: collectionId }
    });
    
    const data = await response.json();
    const exists = !!data.data.collection;
    
    AppLogger.debug('Collection existence check result', { collectionId, exists });
    return exists;
  } catch (error) {
    AppLogger.error('Error checking collection existence', error, { collectionId });
    return false;
  }
}

function formatDateForQuery(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

// Loader function
export async function loader({ request }: { request: Request }) {
  AppLogger.info('Loader function started', { url: request.url });
  
  const { admin, session } = await authenticate.admin(request);
  
  try {
    AppLogger.shopifyAPI('getShop', 'shop', { shop: session.shop });
    const shopResponse = await admin.graphql(GET_SHOP_QUERY);
    const shopData = await shopResponse.json();
    const shop = shopData.data.shop;
    
    AppLogger.shopifyAPI('getCollections', 'collections', { shop: session.shop });
    const collectionsResponse = await admin.graphql(GET_COLLECTIONS_QUERY, {
      variables: { first: 50 }
    });
    const collectionsData = await collectionsResponse.json();
    const collections = collectionsData.data.collections.edges.map((edge: { node: Collection }) => edge.node);
    
    let settings: Settings | null = null;
    
    try {
      AppLogger.db('findUnique', 'settings', { shopifyDomain: session.shop });
      settings = await (prisma as any).settings.findUnique({
        where: { shopifyDomain: session.shop }
      });
      
      if (!settings) {
        AppLogger.db('create', 'settings', { shopifyDomain: session.shop });
        settings = await (prisma as any).settings.create({
          data: {
            shopifyDomain: session.shop,
          }
        });
        AppLogger.info('Created new settings record', { shop: session.shop });
      } else {
        AppLogger.info('Found existing settings', { shop: session.shop });
      }
    } catch (error) {
      AppLogger.error('Error accessing settings in database', error, { shop: session.shop });
      settings = {
        id: 'default',
        shopifyDomain: session.shop,
        bestsellersEnabled: true,
        bestsellersTag: 'Bestsellers_products',
        bestsellersCount: 50,
        bestsellersLookback: 180,
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
        lastProcessed: null,
      };
      AppLogger.warn('Using default settings due to database error');
    }
    
    AppLogger.info('Loader function completed successfully', {
      shop: shop.name,
      collectionsCount: collections.length,
      settingsFound: !!settings
    });
    
    return Response.json({
      shop,
      collections,
      settings,
      shopifyDomain: session.shop,
    });
  } catch (error) {
    AppLogger.error('Loader function failed', error, { shop: session.shop });
    throw error;
  }
};

// Action function
export async function action({ request }: { request: Request }) {
  const { admin, session } = await authenticate.admin(request);
  const formData = await request.formData();
  const actionType = formData.get('actionType') as string;
  
  AppLogger.info('Action function started', { actionType, shop: session.shop });
  
  try {
    if (actionType === 'saveSettings') {
      try {
        AppLogger.db('upsert', 'settings', { shopifyDomain: session.shop });
        
        const settings = await (prisma as any).settings.upsert({
          where: { shopifyDomain: session.shop },
          update: {
            bestsellersEnabled: formData.get('bestsellersEnabled') === 'true',
            bestsellersTag: formData.get('bestsellersTag') as string,
            bestsellersCount: parseInt(formData.get('bestsellersCount') as string),
            bestsellersExcludeOOS: formData.get('bestsellersExcludeOOS') === 'true',
            bestsellersCreateCollection: formData.get('bestsellersCreateCollection') === 'true',
            
            trendingEnabled: formData.get('trendingEnabled') === 'true',
            trendingTag: formData.get('trendingTag') as string,
            trendingCount: parseInt(formData.get('trendingCount') as string),
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
            bestsellersLookback: 180,
            bestsellersExcludeOOS: formData.get('bestsellersExcludeOOS') === 'true',
            bestsellersCreateCollection: formData.get('bestsellersCreateCollection') === 'true',
            
            trendingEnabled: formData.get('trendingEnabled') === 'true',
            trendingTag: formData.get('trendingTag') as string,
            trendingCount: parseInt(formData.get('trendingCount') as string),
            trendingLookback: 7,
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
        
        AppLogger.info('Settings saved successfully', { shop: session.shop });
        return Response.json({ success: true, message: 'Settings saved successfully!' });
      } catch (error) {
        AppLogger.error('Error saving settings to database', error, { shop: session.shop });
        return Response.json({ success: false, message: 'Error saving settings to database' });
      }
    } else if (actionType === 'processBestsellers') {
      AppLogger.info('Processing bestsellers started', { shop: session.shop });
      
      let settings: Settings | null = null;
      
      try {
        AppLogger.db('findUnique', 'settings', { shopifyDomain: session.shop });
        settings = await (prisma as any).settings.findUnique({
          where: { shopifyDomain: session.shop }
        });
      } catch (error) {
        AppLogger.error('Error fetching settings for bestsellers', error, { shop: session.shop });
        return Response.json({ success: false, message: 'Error fetching settings from database' });
      }
      
      if (!settings?.bestsellersEnabled) {
        AppLogger.warn('Bestsellers processing attempted but disabled', { shop: session.shop });
        return Response.json({ success: false, message: 'Bestsellers is disabled' });
      }
      
      const lookbackDate = new Date();
      lookbackDate.setDate(lookbackDate.getDate() - 180);
      const formattedDate = formatDateForQuery(lookbackDate);
      
      let orders: any[] = [];
      
      try {
        const query = `created_at:>'${formattedDate}'`;
        AppLogger.info('Fetching orders for bestsellers', { query, lookbackDate: formattedDate });
        orders = await fetchAllOrders(admin, query);
        
        AppLogger.info(`Found ${orders.length} orders for bestsellers analysis`, {
          lookbackPeriod: '180 days'
        });
        
        if (orders.length === 0) {
          AppLogger.warn('No orders found for bestsellers analysis', { lookbackPeriod: '180 days' });
          return Response.json({ 
            success: false, 
            message: 'No orders found in the last 6 months for bestsellers analysis' 
          });
        }
      } catch (error) {
        AppLogger.error('Failed to fetch orders for bestsellers', error, { shop: session.shop });
        return Response.json({ 
          success: false, 
          message: `Failed to fetch orders data from Shopify: ${error instanceof Error ? error.message : 'Unknown error'}` 
        });
      }
      
      AppLogger.info(`Processing ${orders.length} orders for bestsellers calculation`);
      
      const productSales: ProductSales = {};
      
      orders.forEach((order: any) => {
        if (order.lineItems && order.lineItems.edges) {
          order.lineItems.edges.forEach((lineItemEdge: any) => {
            const item = lineItemEdge.node;
            const variantId = item.variant?.id;
            const productId = item.variant?.product?.id;
            const productTitle = item.variant?.product?.title || item.title || 'Unknown Product';
            
            if (!productId) {
              AppLogger.debug('No product ID found for line item', { itemTitle: item.title });
              return;
            }
            
            const quantity = item.quantity || 0;
            
            if (!productSales[productId]) {
              productSales[productId] = {
                id: productId,
                title: productTitle,
                sales: 0,
                lastSold: new Date(order.createdAt),
                variantId: variantId
              };
            }
            
            productSales[productId].sales += quantity;
            const orderDate = new Date(order.createdAt);
            if (orderDate > productSales[productId].lastSold) {
              productSales[productId].lastSold = orderDate;
            }
          });
        }
      });
      
      AppLogger.info(`Calculated sales for ${Object.keys(productSales).length} products`);
      
      const sortedProducts = Object.values(productSales).sort((a: ProductSales[string], b: ProductSales[string]) => {
        return b.sales - a.sales;
      });
      
      const topProducts = sortedProducts.slice(0, settings.bestsellersCount);
      
      AppLogger.info('Top bestsellers identified', {
        topCount: topProducts.length,
        topProducts: topProducts.map(p => `${p.title}: ${p.sales} sales`)
      });
      
      // Get ALL products to ensure we find all products from orders
      const allProducts = await fetchAllProducts(admin);
      
      // Create or update collection if needed
      let collectionId: string | null = null;
      
      if (settings.bestsellersCreateCollection) {
        collectionId = settings.bestsellersCollectionId;
        
        if (collectionId) {
          const exists = await checkCollectionExists(admin, collectionId);
          if (!exists) {
            AppLogger.warn('Bestsellers collection no longer exists in Shopify, creating new one', { collectionId });
            collectionId = null;
          }
        }
        
        if (!collectionId) {
          AppLogger.shopifyAPI('createCollection', 'collection', { title: "Bestsellers" });
          
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
            AppLogger.error('Error creating bestsellers collection', null, {
              userErrors: createCollectionData.data.collectionCreate.userErrors
            });
          } else {
            collectionId = createCollectionData.data.collectionCreate.collection.id;
            
            try {
              AppLogger.db('update', 'settings', { bestsellersCollectionId: collectionId });
              await (prisma as any).settings.update({
                where: { shopifyDomain: session.shop },
                data: { bestsellersCollectionId: collectionId }
              });
              AppLogger.info('Updated bestsellersCollectionId in database', { collectionId });
            } catch (error) {
              AppLogger.error('Error updating collection ID in database', error, { collectionId });
            }
          }
        }
      }
      
      // Remove the bestsellers tag from all products that currently have it
      // BUT only if they're not in our top products list
      const topProductIds = new Set(topProducts.map(p => p.id));
      
      for (const product of allProducts) {
        if (product.tags.includes(settings.bestsellersTag) && !topProductIds.has(product.id)) {
          const newTags = product.tags.filter((tag: string) => tag !== settings.bestsellersTag);
          
          try {
            AppLogger.shopifyAPI('updateProduct', 'product', { 
              productId: product.id, 
              action: 'remove bestsellers tag' 
            });
            
            await admin.graphql(UPDATE_PRODUCT_MUTATION, {
              variables: {
                input: {
                  id: product.id,
                  tags: newTags
                }
              }
            });
            AppLogger.debug(`Removed bestsellers tag from: ${product.title}`, { productId: product.id });
          } catch (error) {
            AppLogger.error(`Error removing bestsellers tag from ${product.title}`, error, { productId: product.id });
          }
        }
      }
      
      // Add the bestsellers tag to top products
      let taggedCount = 0;
      let skippedCount = 0;
      
      for (const topProduct of topProducts) {
        const product = allProducts.find((p: Product) => p.id === topProduct.id);
        
        if (!product) {
          AppLogger.warn('Product not found in store for bestsellers tagging', {
            productId: topProduct.id,
            productTitle: topProduct.title
          });
          skippedCount++;
          continue;
        }
        
        // Check if product is out of stock and should be excluded
        if (settings.bestsellersExcludeOOS) {
          const totalInventory = product.variants.edges.reduce((sum: number, variant: any) => {
            return sum + (variant.node.inventoryQuantity || 0);
          }, 0);
          
          if (totalInventory <= 0) {
            AppLogger.debug(`Excluding out-of-stock product from bestsellers: ${product.title}`, {
              inventory: totalInventory
            });
            skippedCount++;
            continue;
          }
        }
        
        // Check if product has excluded tags
        if (settings.excludeEnabled && settings.excludeTags.length > 0) {
          const hasExcludedTag = settings.excludeTags.some((tag: string) => product.tags.includes(tag));
          if (hasExcludedTag) {
            AppLogger.debug(`Excluding product with excluded tag from bestsellers: ${product.title}`);
            skippedCount++;
            continue;
          }
        }
        
        // Add the bestsellers tag if not already present
        if (!product.tags.includes(settings.bestsellersTag)) {
          const newTags = [...product.tags, settings.bestsellersTag];
          
          try {
            AppLogger.shopifyAPI('updateProduct', 'product', {
              productId: product.id,
              action: 'add bestsellers tag'
            });
            
            await admin.graphql(UPDATE_PRODUCT_MUTATION, {
              variables: {
                input: {
                  id: product.id,
                  tags: newTags
                }
              }
            });
            
            taggedCount++;
            AppLogger.info(`Tagged bestseller: ${product.title}`, {
              sales: topProduct.sales,
              inventory: product.totalInventory
            });
          } catch (error) {
            AppLogger.error(`Error adding bestsellers tag to ${product.title}`, error, { productId: product.id });
          }
        } else {
          AppLogger.debug(`Bestseller tag already present: ${product.title}`);
          taggedCount++; // Count as tagged since it already has the tag
        }
      }
      
      // Update last processed time
      try {
        AppLogger.db('update', 'settings', { lastProcessed: new Date() });
        await (prisma as any).settings.update({
          where: { shopifyDomain: session.shop },
          data: { lastProcessed: new Date() }
        });
      } catch (error) {
        AppLogger.error('Error updating last processed time', error, { shop: session.shop });
      }
      
      AppLogger.info('Bestsellers processing completed successfully', {
        taggedCount,
        skippedCount,
        totalProcessed: topProducts.length
      });
      
      return Response.json({ 
        success: true, 
        message: `Bestsellers processed successfully! Tagged ${taggedCount} products, skipped ${skippedCount} products.` 
      });
    } else if (actionType === 'processTrending') {
      AppLogger.info('Processing trending products started', { shop: session.shop });
      
      let settings: Settings | null = null;
      
      try {
        AppLogger.db('findUnique', 'settings', { shopifyDomain: session.shop });
        settings = await (prisma as any).settings.findUnique({
          where: { shopifyDomain: session.shop }
        });
      } catch (error) {
        AppLogger.error('Error fetching settings for trending', error, { shop: session.shop });
        return Response.json({ success: false, message: 'Error fetching settings from database' });
      }
      
      if (!settings?.trendingEnabled) {
        AppLogger.warn('Trending processing attempted but disabled', { shop: session.shop });
        return Response.json({ success: false, message: 'Trending is disabled' });
      }
      
      // Get orders from the last 7 days for trending (ROLLING WINDOW - always last 7 days)
      const lookbackDate = new Date();
      lookbackDate.setDate(lookbackDate.getDate() - 7);
      const formattedDate = formatDateForQuery(lookbackDate);
      
      let orders: any[] = [];
      
      try {
        const query = `created_at:>'${formattedDate}'`;
        AppLogger.info('Fetching orders for trending products', { 
          query, 
          lookbackDate: formattedDate,
          note: 'Rolling 7-day window for trending products'
        });
        
        orders = await fetchAllOrders(admin, query);
        
        AppLogger.info(`Found ${orders.length} orders for trending analysis`, {
          lookbackPeriod: '7 days'
        });
        
        if (orders.length === 0) {
          AppLogger.warn('No orders found for trending analysis', { lookbackPeriod: '7 days' });
          return Response.json({ 
            success: false, 
            message: 'No orders found in the last 7 days for trending analysis' 
          });
        }
      } catch (error) {
        AppLogger.error('Failed to fetch orders for trending', error, { shop: session.shop });
        return Response.json({ 
          success: false, 
          message: `Failed to fetch orders data for trending products: ${error instanceof Error ? error.message : 'Unknown error'}` 
        });
      }
      
      AppLogger.info(`Processing ${orders.length} orders for trending calculation`);
      
      const productSales: ProductSales = {};
      
      orders.forEach((order: any) => {
        const orderDate = new Date(order.createdAt);
        
        if (order.lineItems && order.lineItems.edges) {
          order.lineItems.edges.forEach((lineItemEdge: any) => {
            const item = lineItemEdge.node;
            const variantId = item.variant?.id;
            const productId = item.variant?.product?.id;
            const productTitle = item.variant?.product?.title || item.title || 'Unknown Product';
            
            if (!productId) {
              AppLogger.debug('No product ID found for trending line item', { itemTitle: item.title });
              return;
            }
            
            const quantity = item.quantity || 0;
            
            if (!productSales[productId]) {
              productSales[productId] = {
                id: productId,
                title: productTitle,
                sales: 0,
                lastSold: orderDate,
                variantId: variantId
              };
            }
            
            productSales[productId].sales += quantity;
            if (orderDate > productSales[productId].lastSold) {
              productSales[productId].lastSold = orderDate;
            }
          });
        }
      });
      
      AppLogger.info(`Calculated sales for ${Object.keys(productSales).length} trending products`);
      
      // For trending, we want to prioritize both recent sales AND sales velocity
      const now = new Date();
      const sortedProducts = Object.values(productSales).sort((a: ProductSales[string], b: ProductSales[string]) => {
        // First, prioritize products sold more recently
        const aRecency = now.getTime() - a.lastSold.getTime();
        const bRecency = now.getTime() - b.lastSold.getTime();
        
        // If one product was sold much more recently, prioritize it
        if (Math.abs(aRecency - bRecency) > 12 * 60 * 60 * 1000) { // 12 hours difference
          return aRecency - bRecency; // Lower recency = more recent
        }
        
        // If recency is similar, prioritize by sales volume
        return b.sales - a.sales;
      });
      
      const trendingProducts = sortedProducts.slice(0, settings.trendingCount);
      
      AppLogger.info('Top trending products identified', {
        topCount: trendingProducts.length,
        trendingProducts: trendingProducts.map(p => 
          `${p.title}: ${p.sales} units, last sold: ${p.lastSold.toISOString()}`
        )
      });
      
      // Get ALL products
      const allProducts = await fetchAllProducts(admin);
      
      // Create or update collection if needed
      let collectionId = settings.trendingCollectionId;
      
      if (settings.trendingCreateCollection) {
        const collectionTitle = settings.trendingCollectionTitle || 'Trending Now';
        
        if (collectionId) {
          const exists = await checkCollectionExists(admin, collectionId);
          if (!exists) {
            AppLogger.warn('Trending collection no longer exists in Shopify, creating new one', { collectionId });
            collectionId = null;
          }
        }
        
        if (!collectionId) {
          AppLogger.shopifyAPI('createCollection', 'collection', { title: collectionTitle });
          
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
            AppLogger.error('Error creating trending collection', null, {
              userErrors: createCollectionData.data.collectionCreate.userErrors
            });
          } else {
            collectionId = createCollectionData.data.collectionCreate.collection.id;
            
            try {
              AppLogger.db('update', 'settings', { trendingCollectionId: collectionId });
              await (prisma as any).settings.update({
                where: { shopifyDomain: session.shop },
                data: { trendingCollectionId: collectionId }
              });
              AppLogger.info('Updated trendingCollectionId in database', { collectionId });
            } catch (error) {
              AppLogger.error('Error updating trending collection ID in database', error, { collectionId });
            }
          }
        }
      }
      
      // Remove trending tag from products that are no longer trending
      const trendingProductIds = new Set(trendingProducts.map(p => p.id));
      
      for (const product of allProducts) {
        if (product.tags.includes(settings.trendingTag) && !trendingProductIds.has(product.id)) {
          const newTags = product.tags.filter((tag: string) => tag !== settings.trendingTag);
          
          try {
            AppLogger.shopifyAPI('updateProduct', 'product', {
              productId: product.id,
              action: 'remove trending tag'
            });
            
            await admin.graphql(UPDATE_PRODUCT_MUTATION, {
              variables: {
                input: {
                  id: product.id,
                  tags: newTags
                }
              }
            });
            AppLogger.debug(`Removed trending tag from: ${product.title}`, { productId: product.id });
          } catch (error) {
            AppLogger.error(`Error removing trending tag from ${product.title}`, error, { productId: product.id });
          }
        }
      }
      
      // Add trending tag to trending products
      let taggedCount = 0;
      let skippedCount = 0;
      
      for (const trendingProduct of trendingProducts) {
        const product = allProducts.find((p: Product) => p.id === trendingProduct.id);
        
        if (!product) {
          AppLogger.warn('Trending product not found in store for tagging', {
            productId: trendingProduct.id,
            productTitle: trendingProduct.title
          });
          skippedCount++;
          continue;
        }
        
        // Check if product is out of stock and should be excluded
        if (settings.trendingExcludeOOS) {
          const totalInventory = product.variants.edges.reduce((sum: number, variant: any) => {
            return sum + (variant.node.inventoryQuantity || 0);
          }, 0);
          
          if (totalInventory <= 0) {
            AppLogger.debug(`Excluding out-of-stock trending product: ${product.title}`, {
              inventory: totalInventory
            });
            skippedCount++;
            continue;
          }
        }
        
        // Check if product has excluded tags
        if (settings.excludeEnabled && settings.excludeTags.length > 0) {
          const hasExcludedTag = settings.excludeTags.some((tag: string) => product.tags.includes(tag));
          if (hasExcludedTag) {
            AppLogger.debug(`Excluding trending product with excluded tag: ${product.title}`);
            skippedCount++;
            continue;
          }
        }
        
        // Add trending tag if not already present
        if (!product.tags.includes(settings.trendingTag)) {
          const newTags = [...product.tags, settings.trendingTag];
          
          try {
            AppLogger.shopifyAPI('updateProduct', 'product', {
              productId: product.id,
              action: 'add trending tag'
            });
            
            await admin.graphql(UPDATE_PRODUCT_MUTATION, {
              variables: {
                input: {
                  id: product.id,
                  tags: newTags
                }
              }
            });
            
            taggedCount++;
            AppLogger.info(`Tagged trending product: ${product.title}`, {
              sales: trendingProduct.sales,
              lastSold: trendingProduct.lastSold.toISOString()
            });
          } catch (error) {
            AppLogger.error(`Error adding trending tag to ${product.title}`, error, { productId: product.id });
          }
        } else {
          AppLogger.debug(`Trending tag already present: ${product.title}`);
          taggedCount++;
        }
      }
      
      AppLogger.info('Trending products processing completed successfully', {
        taggedCount,
        skippedCount,
        totalProcessed: trendingProducts.length
      });
      
      return Response.json({ 
        success: true, 
        message: `Trending products processed successfully! Tagged ${taggedCount} products, skipped ${skippedCount} products.` 
      });
    } else if (actionType === 'processNewArrivals') {
      AppLogger.info('Processing new arrivals started', { shop: session.shop });
      
      let settings: Settings | null = null;
      
      try {
        AppLogger.db('findUnique', 'settings', { shopifyDomain: session.shop });
        settings = await (prisma as any).settings.findUnique({
          where: { shopifyDomain: session.shop }
        });
      } catch (error) {
        AppLogger.error('Error fetching settings for new arrivals', error, { shop: session.shop });
        return Response.json({ success: false, message: 'Error fetching settings from database' });
      }
      
      if (!settings?.newArrivalsEnabled) {
        AppLogger.warn('New arrivals processing attempted but disabled', { shop: session.shop });
        return Response.json({ success: false, message: 'New Arrivals is disabled' });
      }
      
      // Get products created within the new arrivals period
      const periodDate = new Date();
      periodDate.setDate(periodDate.getDate() - settings.newArrivalsPeriod);
      const formattedDate = formatDateForQuery(periodDate);
      
      AppLogger.info('Processing new arrivals', {
        periodDays: settings.newArrivalsPeriod,
        sinceDate: formattedDate
      });
      
      // Get ALL products first to handle pagination properly
      const allProducts = await fetchAllProducts(admin);
      
      // Filter products created within the period
      const recentProducts = allProducts.filter((product: Product) => {
        const productDate = new Date(product.createdAt);
        return productDate >= periodDate;
      });
      
      AppLogger.info(`Found ${recentProducts.length} products created in the last ${settings.newArrivalsPeriod} days`);
      
      // Sort by creation date (newest first)
      const sortedProducts = recentProducts.sort((a: Product, b: Product) => 
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      );
      
      // Get top N newest products
      const newestProducts = sortedProducts.slice(0, settings.newArrivalsCount);
      
      AppLogger.info('Top new arrivals identified', {
        newArrivalsCount: newestProducts.length,
        newArrivals: newestProducts.map(p => `${p.title}: ${p.createdAt}`)
      });
      
      // Create or update collection if needed
      let collectionId = settings.newArrivalsCollectionId;
      
      if (settings.newArrivalsCreateCollection) {
        const collectionTitle = settings.newArrivalsCollectionTitle || 'New Arrivals';
        
        // Check if collection exists in Shopify
        if (collectionId) {
          const exists = await checkCollectionExists(admin, collectionId);
          if (!exists) {
            AppLogger.warn('New Arrivals collection no longer exists in Shopify, creating new one', { collectionId });
            collectionId = null;
          }
        }
        
        if (!collectionId) {
          // Create new collection
          AppLogger.shopifyAPI('createCollection', 'collection', { title: collectionTitle });
          
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
            AppLogger.error('Error creating new arrivals collection', null, {
              userErrors: createCollectionData.data.collectionCreate.userErrors
            });
            return Response.json({ 
              success: false, 
              message: `Error creating collection: ${createCollectionData.data.collectionCreate.userErrors[0].message}` 
            });
          }
          
          collectionId = createCollectionData.data.collectionCreate.collection.id;
          
          // Update settings with collection ID
          try {
            AppLogger.db('update', 'settings', { newArrivalsCollectionId: collectionId });
            await (prisma as any).settings.update({
              where: { shopifyDomain: session.shop },
              data: { newArrivalsCollectionId: collectionId }
            });
            AppLogger.info('Created new arrivals collection and updated database', { collectionId });
          } catch (error) {
            AppLogger.error('Error updating collection ID in database', error, { collectionId });
          }
        } else {
          // Update existing collection
          AppLogger.shopifyAPI('updateCollection', 'collection', { collectionId, title: collectionTitle });
          
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
            AppLogger.error('Error updating new arrivals collection', null, {
              userErrors: updateCollectionData.data.collectionUpdate.userErrors
            });
          } else {
            AppLogger.info('Updated existing new arrivals collection', { collectionId });
          }
        }
      }
      
      // Remove new arrivals tag from products that are no longer new
      const newProductIds = new Set(newestProducts.map(p => p.id));
      
      for (const product of allProducts) {
        if (product.tags.includes(settings.newArrivalsTag) && !newProductIds.has(product.id)) {
          const newTags = product.tags.filter((tag: string) => tag !== settings.newArrivalsTag);
          
          try {
            AppLogger.shopifyAPI('updateProduct', 'product', {
              productId: product.id,
              action: 'remove new arrivals tag'
            });
            
            await admin.graphql(UPDATE_PRODUCT_MUTATION, {
              variables: {
                input: {
                  id: product.id,
                  tags: newTags
                }
              }
            });
            AppLogger.debug(`Removed new arrivals tag from: ${product.title}`, { productId: product.id });
          } catch (error) {
            AppLogger.error(`Error removing new arrivals tag from ${product.title}`, error, { productId: product.id });
          }
        }
      }
      
      // Add new arrivals tag to newest products
      let taggedCount = 0;
      let skippedCount = 0;
      
      for (const newestProduct of newestProducts) {
        // Check if product is out of stock and should be excluded
        if (settings.newArrivalsExcludeOOS) {
          const totalInventory = newestProduct.variants.edges.reduce((sum: number, variant: any) => {
            return sum + (variant.node.inventoryQuantity || 0);
          }, 0);
          
          if (totalInventory <= 0) {
            AppLogger.debug(`Excluding out-of-stock new arrival: ${newestProduct.title}`, {
              inventory: totalInventory
            });
            skippedCount++;
            continue;
          }
        }
        
        // Check if product has excluded tags
        if (settings.excludeEnabled && settings.excludeTags.length > 0) {
          const hasExcludedTag = settings.excludeTags.some((tag: string) => newestProduct.tags.includes(tag));
          if (hasExcludedTag) {
            AppLogger.debug(`Excluding new arrival with excluded tag: ${newestProduct.title}`);
            skippedCount++;
            continue;
          }
        }
        
        // Add new arrivals tag if not already present
        if (!newestProduct.tags.includes(settings.newArrivalsTag)) {
          const newTags = [...newestProduct.tags, settings.newArrivalsTag];
          
          try {
            AppLogger.shopifyAPI('updateProduct', 'product', {
              productId: newestProduct.id,
              action: 'add new arrivals tag'
            });
            
            await admin.graphql(UPDATE_PRODUCT_MUTATION, {
              variables: {
                input: {
                  id: newestProduct.id,
                  tags: newTags
                }
              }
            });
            
            taggedCount++;
            AppLogger.info(`Tagged new arrival: ${newestProduct.title}`, {
              createdAt: newestProduct.createdAt
            });
          } catch (error) {
            AppLogger.error(`Error adding new arrivals tag to ${newestProduct.title}`, error, { productId: newestProduct.id });
          }
        } else {
          AppLogger.debug(`New arrivals tag already present: ${newestProduct.title}`);
          taggedCount++;
        }
      }
      
      AppLogger.info('New arrivals processing completed successfully', {
        taggedCount,
        skippedCount,
        totalProcessed: newestProducts.length
      });
      
      return Response.json({ 
        success: true, 
        message: `New arrivals processed successfully! Tagged ${taggedCount} products, skipped ${skippedCount} products.` 
      });
    } else if (actionType === 'processAging') {
      AppLogger.info('Processing aging inventory started', { shop: session.shop });
      
      let settings: Settings | null = null;
      
      try {
        AppLogger.db('findUnique', 'settings', { shopifyDomain: session.shop });
        settings = await (prisma as any).settings.findUnique({
          where: { shopifyDomain: session.shop }
        });
      } catch (error) {
        AppLogger.error('Error fetching settings for aging inventory', error, { shop: session.shop });
        return Response.json({ success: false, message: 'Error fetching settings from database' });
      }
      
      if (!settings?.agingEnabled) {
        AppLogger.warn('Aging inventory processing attempted but disabled', { shop: session.shop });
        return Response.json({ success: false, message: 'Aging Inventory is disabled' });
      }
      
      // Get orders within the aging lookback period to identify products with no sales
      const lookbackDate = new Date();
      lookbackDate.setDate(lookbackDate.getDate() - settings.agingLookback);
      const formattedDate = formatDateForQuery(lookbackDate);
      
      let orders: any[] = [];
      
      try {
        const query = `created_at:>'${formattedDate}'`;
        AppLogger.info('Fetching orders for aging inventory analysis', { 
          query, 
          lookbackDate: formattedDate,
          lookbackDays: settings.agingLookback
        });
        
        orders = await fetchAllOrders(admin, query);
        
        AppLogger.info(`Found ${orders.length} orders in the last ${settings.agingLookback} days for aging analysis`);
      } catch (error) {
        AppLogger.error('Failed to fetch orders for aging analysis', error, { shop: session.shop });
        return Response.json({ 
          success: false, 
          message: `Failed to fetch orders data for aging analysis: ${error instanceof Error ? error.message : 'Unknown error'}` 
        });
      }
      
      // Get ALL products
      const allProducts = await fetchAllProducts(admin);
      
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
      
      AppLogger.info(`Found ${productIdsWithSales.size} products with sales in the last ${settings.agingLookback} days`);
      
      // Filter products that haven't had sales in the lookback period
      const agingProducts = allProducts.filter((product: Product) => 
        !productIdsWithSales.has(product.id)
      );
      
      AppLogger.info(`Found ${agingProducts.length} products with no sales in the last ${settings.agingLookback} days`);
      
      // Sort by creation date (oldest first)
      const sortedAgingProducts = agingProducts.sort((a: Product, b: Product) => 
        new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
      );
      
      // Get top N oldest products
      const oldestProducts = sortedAgingProducts.slice(0, settings.agingCount);
      
      AppLogger.info('Top aging products identified', {
        agingCount: oldestProducts.length,
        agingProducts: oldestProducts.map(p => `${p.title}: ${p.createdAt}`)
      });
      
      // Create or update collection if needed
      let collectionId = settings.agingCollectionId;
      
      if (settings.agingCreateCollection) {
        const collectionTitle = settings.agingCollectionTitle || 'Aging Inventory';
        
        // Check if collection exists in Shopify
        if (collectionId) {
          const exists = await checkCollectionExists(admin, collectionId);
          if (!exists) {
            AppLogger.warn('Aging Inventory collection no longer exists in Shopify, creating new one', { collectionId });
            collectionId = null;
          }
        }
        
        if (!collectionId) {
          // Create new collection
          AppLogger.shopifyAPI('createCollection', 'collection', { title: collectionTitle });
          
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
            AppLogger.error('Error creating aging collection', null, {
              userErrors: createCollectionData.data.collectionCreate.userErrors
            });
            return Response.json({ 
              success: false, 
              message: `Error creating collection: ${createCollectionData.data.collectionCreate.userErrors[0].message}` 
            });
          }
          
          collectionId = createCollectionData.data.collectionCreate.collection.id;
          
          // Update settings with collection ID
          try {
            AppLogger.db('update', 'settings', { agingCollectionId: collectionId });
            await (prisma as any).settings.update({
              where: { shopifyDomain: session.shop },
              data: { agingCollectionId: collectionId }
            });
            AppLogger.info('Created aging inventory collection and updated database', { collectionId });
          } catch (error) {
            AppLogger.error('Error updating collection ID in database', error, { collectionId });
          }
        } else {
          // Update existing collection
          AppLogger.shopifyAPI('updateCollection', 'collection', { collectionId, title: collectionTitle });
          
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
            AppLogger.error('Error updating aging collection', null, {
              userErrors: updateCollectionData.data.collectionUpdate.userErrors
            });
          } else {
            AppLogger.info('Updated existing aging collection', { collectionId });
          }
        }
      }
      
      // Remove aging tag from products that are no longer aging
      const agingProductIds = new Set(oldestProducts.map(p => p.id));
      
      for (const product of allProducts) {
        if (product.tags.includes(settings.agingTag) && !agingProductIds.has(product.id)) {
          const newTags = product.tags.filter((tag: string) => tag !== settings.agingTag);
          
          try {
            AppLogger.shopifyAPI('updateProduct', 'product', {
              productId: product.id,
              action: 'remove aging tag'
            });
            
            await admin.graphql(UPDATE_PRODUCT_MUTATION, {
              variables: {
                input: {
                  id: product.id,
                  tags: newTags
                }
              }
            });
            AppLogger.debug(`Removed aging tag from: ${product.title}`, { productId: product.id });
          } catch (error) {
            AppLogger.error(`Error removing aging tag from ${product.title}`, error, { productId: product.id });
          }
        }
      }
      
      // Add aging tag to oldest products
      let taggedCount = 0;
      let skippedCount = 0;
      
      for (const oldestProduct of oldestProducts) {
        // Check if product has excluded tags
        if (settings.excludeEnabled && settings.excludeTags.length > 0) {
          const hasExcludedTag = settings.excludeTags.some((tag: string) => oldestProduct.tags.includes(tag));
          if (hasExcludedTag) {
            AppLogger.debug(`Excluding aging product with excluded tag: ${oldestProduct.title}`);
            skippedCount++;
            continue;
          }
        }
        
        // Add aging tag if not already present
        if (!oldestProduct.tags.includes(settings.agingTag)) {
          const newTags = [...oldestProduct.tags, settings.agingTag];
          
          try {
            AppLogger.shopifyAPI('updateProduct', 'product', {
              productId: oldestProduct.id,
              action: 'add aging tag'
            });
            
            await admin.graphql(UPDATE_PRODUCT_MUTATION, {
              variables: {
                input: {
                  id: oldestProduct.id,
                  tags: newTags
                }
              }
            });
            
            taggedCount++;
            AppLogger.info(`Tagged aging product: ${oldestProduct.title}`, {
              createdAt: oldestProduct.createdAt
            });
          } catch (error) {
            AppLogger.error(`Error adding aging tag to ${oldestProduct.title}`, error, { productId: oldestProduct.id });
          }
        } else {
          AppLogger.debug(`Aging tag already present: ${oldestProduct.title}`);
          taggedCount++;
        }
      }
      
      AppLogger.info('Aging inventory processing completed successfully', {
        taggedCount,
        skippedCount,
        totalProcessed: oldestProducts.length
      });
      
      return Response.json({ 
        success: true, 
        message: `Aging inventory processed successfully! Tagged ${taggedCount} products, skipped ${skippedCount} products.` 
      });
    }
    
    AppLogger.warn('Unknown action type received', { actionType });
    return Response.json({ success: false, message: 'Unknown action type' });
  } catch (error) {
    AppLogger.error('Error processing action', error, { actionType, shop: session.shop });
    return Response.json({ success: false, message: `Error: ${error instanceof Error ? error.message : 'Unknown error'}` });
  }
}

// The component code remains exactly the same as before
export default function CollectionManager() {
  const { shop, collections, settings, shopifyDomain } = useLoaderData();
  const actionData = useActionData();
  const submit = useSubmit();
  
  const [toastActive, setToastActive] = useState(false);
  const [toastMessage, setToastMessage] = useState('');
  const [toastError, setToastError] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [processingType, setProcessingType] = useState('');
  
  const [selectedTab, setSelectedTab] = useState(0);
  
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
    AppLogger.info('Saving settings from UI', { shop: shopifyDomain });
    const formData = new FormData();
    
    formData.append('actionType', 'saveSettings');
    
    formData.append('bestsellersEnabled', settings.bestsellersEnabled.toString());
    formData.append('bestsellersTag', bestsellersTag);
    formData.append('bestsellersCount', bestsellersCount.toString());
    formData.append('bestsellersExcludeOOS', bestsellersExcludeOOS.toString());
    formData.append('bestsellersCreateCollection', settings.bestsellersCreateCollection.toString());
    
    formData.append('trendingEnabled', settings.trendingEnabled.toString());
    formData.append('trendingTag', trendingTag);
    formData.append('trendingCount', trendingCount.toString());
    formData.append('trendingExcludeOOS', trendingExcludeOOS.toString());
    formData.append('trendingCreateCollection', settings.trendingCreateCollection.toString());
    formData.append('trendingCollectionTitle', settings.trendingCollectionTitle || '');
    
    formData.append('newArrivalsEnabled', settings.newArrivalsEnabled.toString());
    formData.append('newArrivalsTag', newArrivalsTag);
    formData.append('newArrivalsCount', newArrivalsCount.toString());
    formData.append('newArrivalsPeriod', newArrivalsPeriod.toString());
    formData.append('newArrivalsExcludeOOS', newArrivalsExcludeOOS.toString());
    formData.append('newArrivalsCreateCollection', settings.newArrivalsCreateCollection.toString());
    formData.append('newArrivalsCollectionTitle', settings.newArrivalsCollectionTitle || '');
    
    formData.append('agingEnabled', settings.agingEnabled.toString());
    formData.append('agingTag', agingTag);
    formData.append('agingCount', agingCount.toString());
    formData.append('agingLookback', agingLookback.toString());
    formData.append('agingCreateCollection', settings.agingCreateCollection.toString());
    formData.append('agingCollectionTitle', settings.agingCollectionTitle || '');
    
    formData.append('excludeEnabled', excludeEnabled.toString());
    excludeTags.forEach((tag: string) => formData.append('excludeTags', tag));
    
    submit(formData, { method: 'post' });
  };
  
  const handleProcessBestsellers = () => {
    AppLogger.info('User triggered bestsellers processing from UI', { shop: shopifyDomain });
    setProcessing(true);
    setProcessingType('bestsellers');
    
    const formData = new FormData();
    formData.append('actionType', 'processBestsellers');
    
    submit(formData, { method: 'post' });
  };
  
  const handleProcessTrending = () => {
    AppLogger.info('User triggered trending processing from UI', { shop: shopifyDomain });
    setProcessing(true);
    setProcessingType('trending');
    
    const formData = new FormData();
    formData.append('actionType', 'processTrending');
    
    submit(formData, { method: 'post' });
  };
  
  const handleProcessNewArrivals = () => {
    AppLogger.info('User triggered new arrivals processing from UI', { shop: shopifyDomain });
    setProcessing(true);
    setProcessingType('newArrivals');
    
    const formData = new FormData();
    formData.append('actionType', 'processNewArrivals');
    
    submit(formData, { method: 'post' });
  };
  
  const handleProcessAging = () => {
    AppLogger.info('User triggered aging inventory processing from UI', { shop: shopifyDomain });
    setProcessing(true);
    setProcessingType('aging');
    
    const formData = new FormData();
    formData.append('actionType', 'processAging');
    
    submit(formData, { method: 'post' });
  };
  
  const handleAddExcludeTag = () => {
    if (newExcludeTag.trim() && !excludeTags.includes(newExcludeTag.trim())) {
      AppLogger.debug('User added exclude tag', { tag: newExcludeTag.trim() });
      setExcludeTags([...excludeTags, newExcludeTag.trim()]);
      setNewExcludeTag('');
    }
  };
  
  const handleRemoveExcludeTag = (tagToRemove: string) => {
    AppLogger.debug('User removed exclude tag', { tag: tagToRemove });
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