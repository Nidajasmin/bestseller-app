// app/api/graphql/route.ts
import { authenticate } from "../../shopify.server";

export async function POST(request: Request) {
  const { admin } = await authenticate.admin(request);
  
  try {
    const { query, variables } = await request.json();
    
    const response = await admin.graphql(query, { variables });
    
    const data = await response.json();
    
    return Response.json(data);
  } catch (error) {
    console.error("GraphQL API error:", error);
    return Response.json(
      { error: "Failed to process GraphQL request" },
      { status: 500 }
    );
  }
}