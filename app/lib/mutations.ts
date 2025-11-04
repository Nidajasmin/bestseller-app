export const UPDATE_COLLECTION = `
  mutation collectionUpdate($input: CollectionInput!) {
    collectionUpdate(input: $input) {
      collection {
        id
        title
        products(first: 50) {
          edges {
            node {
              id
              title
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

export const COLLECTION_REORDER_PRODUCTS = `
  mutation collectionReorderProducts($collectionId: ID!, $moves: [MoveInput!]!) {
    collectionReorderProducts(collectionId: $collectionId, moves: $moves) {
      job {
        id
      }
      userErrors {
        field
        message
      }
    }
  }
`;