import "@shopify/shopify-app-react-router/adapters/node";
import {
  ApiVersion,
  AppDistribution,
  shopifyApp,
} from "@shopify/shopify-app-react-router/server";
import { PrismaSessionStorage } from "@shopify/shopify-app-session-storage-prisma";
import prisma from "./db.server";
import { AppLogger } from "./utils/logging"; // Add logging

// Validate required environment variables
const requiredEnvVars = [
  'SHOPIFY_API_KEY',
  'SHOPIFY_API_SECRET', 
  'SHOPIFY_APP_URL',
  'SCOPES'
];

const missingVars = requiredEnvVars.filter(varName => !process.env[varName]);
if (missingVars.length > 0) {
  AppLogger.error('Missing required environment variables', {
    missing: missingVars,
    allEnvVars: Object.keys(process.env)
  });
  throw new Error(`Missing required environment variables: ${missingVars.join(', ')}`);
}

const shopify = shopifyApp({
  apiKey: process.env.SHOPIFY_API_KEY!,
  apiSecretKey: process.env.SHOPIFY_API_SECRET!,
  apiVersion: ApiVersion.October25,
  scopes: process.env.SCOPES!.split(","),
  appUrl: process.env.SHOPIFY_APP_URL!,
  authPathPrefix: "/auth",
  sessionStorage: new PrismaSessionStorage(prisma),
  distribution: AppDistribution.AppStore,
  ...(process.env.SHOP_CUSTOM_DOMAIN
    ? { customShopDomains: [process.env.SHOP_CUSTOM_DOMAIN] }
    : {}),
  // Optional: Add logging for Shopify operations
  logger: {
    log: (level, message) => {
      AppLogger.info(`[Shopify] ${message}`, { level });
    },
  },
});

// Log Shopify app initialization
AppLogger.info('Shopify app configured successfully', {
  apiVersion: ApiVersion.October25,
  distribution: AppDistribution.AppStore,
  hasCustomDomain: !!process.env.SHOP_CUSTOM_DOMAIN
});

export default shopify;
export const apiVersion = ApiVersion.October25;
export const addDocumentResponseHeaders = shopify.addDocumentResponseHeaders;
export const authenticate = shopify.authenticate;
export const unauthenticated = shopify.unauthenticated;
export const login = shopify.login;
export const registerWebhooks = shopify.registerWebhooks;
export const sessionStorage = shopify.sessionStorage;