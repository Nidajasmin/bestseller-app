// lib/shopify.ts
import { GraphQLClient } from 'graphql-request';
import { GET_COLLECTIONS } from './queries';

export const client = new GraphQLClient('/api/graphql', {
  headers: {
    'Content-Type': 'application/json',
  },
});

// Function to fetch collections
export async function fetchCollections(first: number = 20) {
  try {
    const data = await client.request(GET_COLLECTIONS, { first });
    return data;
  } catch (error) {
    console.error('Error fetching collections:', error);
    throw error;
  }
}