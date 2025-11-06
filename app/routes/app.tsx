import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { Outlet, useLoaderData, useRouteError, useNavigate } from "react-router";
import { useEffect } from "react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { AppProvider as ShopifyAppProvider } from "@shopify/shopify-app-react-router/react";
import { AppProvider, Frame } from "@shopify/polaris";
import enTranslations from '@shopify/polaris/locales/en.json';
import { authenticate } from "../shopify.server";

// Import your TopNavbar component
import { TopNavbar } from "../components/TopNavbar";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);

  // eslint-disable-next-line no-undef
  return { apiKey: process.env.SHOPIFY_API_KEY || "" };
};

export default function App() {
  const { apiKey } = useLoaderData<typeof loader>();
  const navigate = useNavigate();

  // This effect redirects to the dashboard on initial load
  useEffect(() => {
    if (window.location.pathname === "/app") {
      navigate("/app/collections_list");
    }
  }, [navigate]);

  return (
    <ShopifyAppProvider embedded apiKey={apiKey}>
      <AppProvider i18n={enTranslations}>
        {/* The TopNavbar is passed to the Frame, so it stays visible on all pages. */}
        <Frame topBar={<TopNavbar />}>
          <Outlet />
        </Frame>
      </AppProvider>
    </ShopifyAppProvider>
  );
}

// Shopify needs React Router to catch some thrown responses, so that their headers are included in the response.
export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};