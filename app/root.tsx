// app/root.tsx

// 1. Import the Polaris CSS stylesheet to load all the visual styles.
import '@shopify/polaris/build/esm/styles.css';

// 2. Import the standard React Router components and the Polaris AppProvider.
import { AppProvider } from "@shopify/polaris";
import { Links, Meta, Outlet, Scripts, ScrollRestoration } from "react-router";

// 3. Define a minimal i18n configuration, which is required by the Polaris AppProvider.
const i18n = {
  Polaris: {
    Resource: {
      Common: {
        button: {
          cancel: 'Cancel',
        },
      },
    },
  },
};

// 4. The main App component that wraps your entire application.
export default function App() {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width,initial-scale=1" />
        <link rel="preconnect" href="https://cdn.shopify.com/" />
        <link
          rel="stylesheet"
          href="https://cdn.shopify.com/static/fonts/inter/v4/styles.css"
        />
        <Meta />
        <Links />
      </head>
      <body>
        {/* 5. Wrap your app in the Polaris AppProvider to enable theming and context. */}
        <AppProvider i18n={i18n}>
          <Outlet />
        </AppProvider>
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}