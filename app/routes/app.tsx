import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { 
  Outlet, 
  useLoaderData, 
  useRouteError
} from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { AppProvider as ShopifyAppProvider } from "@shopify/shopify-app-react-router/react";
import { AppProvider, Frame } from "@shopify/polaris";
import enTranslations from '@shopify/polaris/locales/en.json';
import { authenticate } from "../shopify.server";

// Import your TopNavbar component
import { TopNavbar } from "../components/TopNavbar";
import { AppLogger } from "../utils/logging";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  AppLogger.info('App layout loader started', { url: request.url });
  
  await authenticate.admin(request);

  const apiKey = process.env.SHOPIFY_API_KEY || "";
  
  AppLogger.info('App layout loader completed', { apiKey: apiKey ? 'set' : 'missing' });
  
  return { apiKey };
};

export default function App() {
  const { apiKey } = useLoaderData<typeof loader>();

  AppLogger.info('App component rendered', { 
    apiKey: apiKey ? 'set' : 'missing'
  });

  return (
    <ShopifyAppProvider embedded apiKey={apiKey}>
      <AppProvider i18n={enTranslations}>
        <Frame topBar={<TopNavbar />}>
          <Outlet />
        </Frame>
      </AppProvider>
    </ShopifyAppProvider>
  );
}

// Shopify needs React Router to catch some thrown responses, so that their headers are included in the response.
export function ErrorBoundary() {
  const error = useRouteError();
  AppLogger.error('App ErrorBoundary caught an error', error);
  return boundary.error(error);
}

export const headers: HeadersFunction = (headersArgs) => {
  AppLogger.debug('App headers function called');
  return boundary.headers(headersArgs);
};