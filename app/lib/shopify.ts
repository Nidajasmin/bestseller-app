// lib/shopify.ts
import { GraphQLClient } from 'graphql-request';
import { GET_COLLECTIONS, GET_BESTSELLERS, GET_PRODUCTS_BY_DATE, GET_NEW_ARRIVALS } from './queries';

export const client = new GraphQLClient('/api/graphql', {
  headers: {
    'Content-Type': 'application/json',
  },
});

// Function to fetch collections (your existing)
export async function fetchCollections(first: number = 20): Promise<any> {
  try {
    const data = await client.request(GET_COLLECTIONS, { first });
    return data;
  } catch (error) {
    console.error('Error fetching collections:', error);
    throw error;
  }
}

// Function to fetch bestsellers
export async function fetchBestsellers(first: number = 25): Promise<any> {
  try {
    const data = await client.request(GET_BESTSELLERS, { 
      first,
      sortKey: 'BEST_SELLING' 
    });
    return data;
  } catch (error) {
    console.error('Error fetching bestsellers:', error);
    throw error;
  }
}

// Function to fetch products by date range
export async function fetchProductsByDate(first: number = 25, days: number = 30): Promise<any> {
  try {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - days);
    const dateFilter = `created_at:>='${cutoffDate.toISOString()}'`;
    
    const data = await client.request(GET_NEW_ARRIVALS, { 
      first,
      query: dateFilter
    });
    return data;
  } catch (error) {
    console.error('Error fetching products by date:', error);
    throw error;
  }
}

// Function specifically for new arrivals with better sorting
export async function fetchNewArrivals(first: number = 25, days: number = 7): Promise<any> {
  try {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - days);
    const dateFilter = `created_at:>='${cutoffDate.toISOString()}'`;
    
    const data = await client.request(GET_NEW_ARRIVALS, { 
      first,
      query: dateFilter
    });
    return data;
  } catch (error) {
    console.error('Error fetching new arrivals:', error);
    throw error;
  }
}