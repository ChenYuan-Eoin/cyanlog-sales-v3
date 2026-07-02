import type { CSSProperties } from "react";
import type { Metadata } from "next";
import localFont from "next/font/local";
import { Analytics } from "@vercel/analytics/react";
import { SpeedInsights } from "@vercel/speed-insights/next";
import "./globals.css";
import { AppShell } from "@/components/layout/AppShell";
import { BrandingProvider } from "@/components/branding/BrandingProvider";
import { ClientErrorMonitor } from "@/components/observability/ClientErrorMonitor";
import { RuntimeThemeLoader } from "@/components/theme/RuntimeThemeLoader";
import { getServerAuthToken } from "@/lib/server-auth";
import { getPublishedUITheme } from "@/lib/ui-theme";
import { resolveFaviconUrl, themeToCssVariables } from "@/lib/ui-theme-shared";

const FAVICON_VERSION = "20260626";

export const metadata: Metadata = {
  title: "ONES Sales",
  description: "智能协作平台",
};

const geistSans = localFont({
  src: "./fonts/GeistVF.woff",
  variable: "--font-geist-sans",
  weight: "100 900",
});
const geistMono = localFont({
  src: "./fonts/GeistMonoVF.woff",
  variable: "--font-geist-mono",
  weight: "100 900",
});

const enableVercelTelemetry =
  Boolean(process.env.VERCEL_URL || process.env.VERCEL_PROJECT_PRODUCTION_URL)
  || process.env.ENABLE_VERCEL_TELEMETRY === "1";

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const token = await getServerAuthToken();
  const theme = await getPublishedUITheme(token);
  const themeVariables = themeToCssVariables(theme) as CSSProperties;
  const faviconUrl = resolveFaviconUrl(theme) || `/favicon.ico?v=${FAVICON_VERSION}`;

  return (
    <html
      lang="zh-CN"
      className={`${geistSans.variable} ${geistMono.variable}`}
      style={themeVariables}
      data-brand-name={theme.brandName}
      data-brand-short-name={theme.brandShortName}
      data-logo-url={theme.logoUrl}
      data-product-title={theme.productTitle}
      data-product-subtitle={theme.productSubtitle}
      data-login-subtitle={theme.loginSubtitle}
    >
      <head>
        <link data-runtime-favicon="true" rel="icon" href={faviconUrl} />
        <link data-runtime-favicon="true" rel="shortcut icon" href={faviconUrl} />
        <link data-runtime-favicon="true" rel="apple-touch-icon" href={faviconUrl} />
      </head>
      <body className="antialiased">
        <BrandingProvider value={theme}>
          <ClientErrorMonitor />
          <RuntimeThemeLoader initialTheme={theme} />
          <AppShell>{children}</AppShell>
          {enableVercelTelemetry ? <Analytics /> : null}
          {enableVercelTelemetry ? <SpeedInsights /> : null}
        </BrandingProvider>
      </body>
    </html>
  );
}
