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