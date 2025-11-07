//app/lib/queries.ts
export const GET_COLLECTIONS = `#graphql
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
`;

// Get a single collection
export const GET_COLLECTION = `#graphql
  query GetCollection($id: ID!) {
    collection(id: $id) {
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
`;

// Get products in a collection with pagination
export const GET_COLLECTION_PRODUCTS = `#graphql
  query GetCollectionProducts($id: ID!, $first: Int!, $after: String) {
    collection(id: $id) {
      products(first: $first, after: $after) {
        edges {
          node {
            id
            title
            handle
            featuredImage {
              id
              url
              altText
            }
            variants(first: 1) {
              edges {
                node {
                  id
                  title
                  price
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
  }
`;

// Featured products metafield
export const UPDATE_FEATURED_PRODUCTS = `#graphql
  mutation UpdateCollectionMetafield($input: CollectionInput!) {
    collectionUpdate(input: $input) {
      collection {
        id
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
      userErrors {
        field
        message
      }
    }
  }
`;


// Add these queries to your existing queries file
export const GET_BESTSELLERS = `
  query GetBestsellers($first: Int!, $sortKey: ProductSortKeys = BEST_SELLING) {
    products(first: $first, sortKey: $sortKey) {
      edges {
        node {
          id
          title
          handle
          description
          featuredImage {
            url
            altText
          }
          variants(first: 10) {
            edges {
              node {
                id
                price
                sku
                inventoryQuantity
                createdAt
              }
            }
          }
          totalInventory
          createdAt
          publishedAt
          status
          vendor
          tags
          onlineStoreUrl
        }
      }
    }
  }
`;

export const GET_PRODUCTS_BY_DATE = `
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
`;

// Add this query to your lib/queries.ts file
export const GET_NEW_ARRIVALS = `#graphql
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

// Add this to your existing queries.ts file
export const GET_AGING_PRODUCTS = `#graphql
  query GetAgingProducts($first: Int!, $query: String) {
    products(first: $first, query: $query, sortKey: CREATED_AT, reverse: false) {
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
export const GET_ORDERS_WITH_LINE_ITEMS = `#graphql
  query GetOrdersWithLineItems($first: Int!, $query: String!, $after: String) {
    orders(first: $first, query: $query, after: $after) {
      edges {
        node {
          id
          lineItems(first: 50) {
            edges {
              node {
                product {
                  id
                }
                quantity
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