// lib/shopify.ts
import { authenticate } from "../shopify.server";
import { GET_COLLECTIONS, GET_BESTSELLERS, GET_PRODUCTS_BY_DATE, GET_NEW_ARRIVALS } from './queries';

// Function to fetch collections
export async function fetchCollections(admin: any, first: number = 20): Promise<any> {
  try {
    const response = await admin.graphql(`
      query GetCollections($first: Int!, $after: String) {
        collections(first: $first, after: $after) {
          edges {
            node {
              id
              title
              handle
              descriptionHtml
              ruleSet {
                rules {
                  column
                  relation
                  condition
                }
              }
              image {
                id
                url
                altText
              }
              productsCount {
                count
              }
              metafields(first: 10) {
                edges {
                  node {
                    id
                    key
                    namespace
                    value
                    type
                  }
                }
              }
            }
          }
          pageInfo {
            hasNextPage
            hasPreviousPage
            endCursor
            startCursor
          }
        }
      }
    `, {
      variables: { first }
    });
    
    return response.json();
  } catch (error) {
    console.error('Error fetching collections:', error);
    throw error;
  }
}

// Function to fetch products by date range
export async function fetchProductsByDate(admin: any, first: number = 25, days: number = 30): Promise<any> {
  try {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - days);
    const dateFilter = `created_at:>='${cutoffDate.toISOString()}'`;
    
    const response = await admin.graphql(`
      query GetProductsByDate($first: Int!, $query: String) {
        products(first: $first, query: $query) {
          edges {
            node {
              id
              title
              createdAt
              publishedAt
              totalInventory
              variants(first: 5) {
                edges {
                  node {
                    price
                    inventoryQuantity
                  }
                }
              }
            }
          }
        }
      }
    `, {
      variables: { first, query: dateFilter }
    });
    
    return response.json();
  } catch (error) {
    console.error('Error fetching products by date:', error);
    throw error;
  }
}

// Function to fetch new arrivals
export async function fetchNewArrivals(first: number = 25, days: number = 7): Promise<any> {
  try {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - days);
    const dateFilter = `created_at:>='${cutoffDate.toISOString()}'`;
    
    const query = `
      query GetNewArrivals($first: Int!, $query: String) {
        products(first: $first, query: $query, sortKey: CREATED_AT, reverse: true) {
          edges {
            node {
              id
              title
              handle
              featuredImage {
                url
                altText
              }
              variants(first: 1) {
                edges {
                  node {
                    price
                    inventoryQuantity
                  }
                }
              }
              totalInventory
              createdAt
              publishedAt
              status
              vendor
            }
          }
        }
      }
    `;

    const response = await fetch('/api/graphql', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        query,
        variables: { first, query: dateFilter }
      }),
    });
    
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    
    return response.json();
  } catch (error) {
    console.error('Error fetching new arrivals:', error);
    throw error;
  }
}

export async function fetchBestsellers(admin: any, first: number = 100): Promise<any> {
  try {
    const query = `
      query GetProductsForBestsellers($first: Int!) {
        products(first: $first, sortKey: CREATED_AT, reverse: true) {
          edges {
            node {
              id
              title
              handle
              featuredImage { url altText }
              variants(first: 1) { edges { node { price } } }
              totalInventory
              createdAt
              publishedAt
              status
              vendor
            }
          }
        }
      }
    `;

    // We fetch the most recent products to have a good pool to work with
    const response = await admin.graphql(query, { variables: { first } });
    return response.json();
  } catch (error) {
    console.error('Error fetching products for bestsellers:', error);
    throw error;
  }
}

/// lib/shopify.ts
export async function fetchAgingProducts(admin: any, first: number = 250, after: string | null = null) {
  const query = `
    query getAgingProducts($first: Int!, $after: String) {
      products(first: $first, after: $after, sortKey: CREATED_AT, reverse: false) {
        pageInfo {
          hasNextPage
          hasPreviousPage
          startCursor
          endCursor
        }
        edges {
          cursor
          node {
            id
            title
            createdAt
            featuredImage {
              url
            }
            vendor
            status
            totalInventory
            variants(first: 1) {
              edges {
                node {
                  price
                }
              }
            }
          }
        }
      }
    }
  `;

  try {
    const response = await admin.graphql(query, {
      variables: {
        first,
        after
      }
    });
    
    return await response.json();
  } catch (error) {
    console.error('Error fetching aging products:', error);
    throw error;
  }
}

// lib/shopify.ts - Updated fetchAllProducts function
export async function fetchAllProducts(admin: any, first: number = 250, after: string | null = null): Promise<any> {
  try {
    const query = `
      query GetAllProducts($first: Int!, $after: String) {
        products(first: $first, after: $after, sortKey: CREATED_AT, reverse: true) {
          pageInfo {
            hasNextPage
            hasPreviousPage
            startCursor
            endCursor
          }
          edges {
            node {
              id
              title
              handle
              featuredImage { url altText }
              variants(first: 1) { edges { node { price } } }
              totalInventory
              createdAt
              publishedAt
              status
              vendor
            }
          }
        }
      }
    `;
    const response = await admin.graphql(query, { 
      variables: { first, after }
    });
    return response.json();
  } catch (error) {
    console.error('Error fetching all products:', error);
    throw error;
  }
}





export async function fetchProductSalesData(admin: any, days: number): Promise<Map<string, { sales: number; revenue: number }>> {
  const salesMap = new Map<string, { sales: number; revenue: number }>();
  let hasNextPage = true;
  let cursor: string | null = null;
  
  // Calculate the date filter for the last 'N' days
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - days);
  
  const queryFilter = `created_at:>'${cutoffDate.toISOString()}' AND financial_status:paid`;

  const GET_ORDERS_WITH_LINE_ITEMS = `#graphql
    query GetOrdersWithLineItems($first: Int!, $query: String!, $after: String) {
      orders(first: $first, query: $query, after: $after) {
        edges {
          node {
            id
            createdAt
            lineItems(first: 50) {
              edges {
                node {
                  product {
                    id
                  }
                  quantity
                  originalUnitPriceSet {
                    shopMoney {
                      amount
                    }
                  }
                  discountedUnitPriceSet {
                    shopMoney {
                      amount
                    }
                  }
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

  console.log(`Fetching PAID orders for the last ${days} days...`);

  try {
    // Loop through all pages of orders
    while (hasNextPage) {
      const response: any = await admin.graphql(GET_ORDERS_WITH_LINE_ITEMS, {
        variables: { first: 250, query: queryFilter, after: cursor }
      });
      const data: any = await response.json();

      // Check for GraphQL errors
      if (data.errors) {
        console.error('GraphQL Errors:', data.errors);
        throw new Error(`GraphQL error: ${JSON.stringify(data.errors)}`);
      }

      if (data?.data?.orders?.edges) {
        console.log(`Processing ${data.data.orders.edges.length} orders in this page...`);
        
        for (const orderEdge of data.data.orders.edges) {
          const order = orderEdge.node;
          
          if (order.lineItems?.edges) {
            for (const lineItemEdge of order.lineItems.edges) {
              const lineItem = lineItemEdge.node;
              
              // Ensure the line item is associated with a product and has valid data
              if (lineItem.product?.id && lineItem.quantity > 0) {
                const productId = lineItem.product.id;
                const quantity = lineItem.quantity;
                
                // Use the discounted price if available, otherwise use original price
                let price = 0;
                if (lineItem.discountedUnitPriceSet?.shopMoney?.amount) {
                  price = parseFloat(lineItem.discountedUnitPriceSet.shopMoney.amount);
                } else if (lineItem.originalUnitPriceSet?.shopMoney?.amount) {
                  price = parseFloat(lineItem.originalUnitPriceSet.shopMoney.amount);
                }
                
                // Initialize product in map if not present
                if (!salesMap.has(productId)) {
                  salesMap.set(productId, { sales: 0, revenue: 0 });
                }
                
                // Aggregate sales and revenue
                const current = salesMap.get(productId)!;
                current.sales += quantity;
                current.revenue += quantity * price;
              }
            }
          }
        }
      } else {
        console.log('No orders found or unexpected data structure:', data);
      }

      // Check for more pages
      hasNextPage = data?.data?.orders?.pageInfo?.hasNextPage || false;
      cursor = data?.data?.orders?.pageInfo?.endCursor || null;
      
      if (hasNextPage) {
        console.log(`Fetching next page with cursor: ${cursor}`);
      }
    }

    console.log(`Finished processing PAID orders. Found sales data for ${salesMap.size} products.`);
    
    // Log some sample data for debugging
    if (salesMap.size > 0) {
      console.log('Sample sales data:');
      let count = 0;
      salesMap.forEach((value, key) => {
        if (count < 5) {
          console.log(`Product ${key}: ${value.sales} sales, $${value.revenue.toFixed(2)} revenue`);
          count++;
        }
      });
    } else {
      console.log('No sales data found for any products in the selected period.');
    }
    
    return salesMap;
  } catch (error) {
    console.error('Error in fetchProductSalesData:', error);
    throw error;
  }
}