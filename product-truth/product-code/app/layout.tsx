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
import {
  BRAND_ASSET_VERSION,
  OFFICIAL_APPLE_TOUCH_ICON,
  OFFICIAL_FAVICON_PNG_32,
  isOfficialFaviconUrl,
  resolveBrandImageUrl,
  resolveFaviconUrl,
  themeToCssVariables,
} from "@/lib/ui-theme-shared";

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

function stableHash(value: string) {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = ((hash << 5) - hash + value.charCodeAt(index)) | 0;
  }
  return Math.abs(hash).toString(36);
}

function withRuntimeFaviconVersion(url: string) {
  const separator = url.includes("?") ? "&" : "?";
  return `${url}${separator}brand_favicon=${BRAND_ASSET_VERSION}-${stableHash(url)}`;
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const token = await getServerAuthToken();
  const theme = await getPublishedUITheme(token);
  const themeVariables = themeToCssVariables(theme) as CSSProperties;
  const rawFaviconUrl = resolveFaviconUrl(theme);
  const faviconUrl = withRuntimeFaviconVersion(rawFaviconUrl);
  const faviconIsSvg = rawFaviconUrl.toLowerCase().includes(".svg");
  const officialFavicon = isOfficialFaviconUrl(rawFaviconUrl);
  const faviconPng32Url = officialFavicon ? withRuntimeFaviconVersion(OFFICIAL_FAVICON_PNG_32) : null;
  const appleTouchIconUrl = officialFavicon
    ? withRuntimeFaviconVersion(OFFICIAL_APPLE_TOUCH_ICON)
    : faviconUrl;
  const logoUrl = resolveBrandImageUrl(theme, "full", "dark") || resolveBrandImageUrl(theme, "symbol", "dark");

  return (
    <html
      lang="zh-CN"
      className={`${geistSans.variable} ${geistMono.variable}`}
      style={themeVariables}
      data-brand-name={theme.brandName}
      data-brand-short-name={theme.brandShortName}
      data-logo-url={logoUrl}
      data-product-title={theme.productTitle}
      data-product-subtitle={theme.productSubtitle}
      data-login-subtitle={theme.loginSubtitle}
    >
      <head>
        <link
          data-runtime-favicon="true"
          rel="icon"
          href={faviconUrl}
          type={faviconIsSvg ? "image/svg+xml" : "image/png"}
          sizes={faviconIsSvg ? "any" : undefined}
        />
        {faviconPng32Url ? (
          <link
            data-runtime-favicon="true"
            rel="icon"
            href={faviconPng32Url}
            type="image/png"
            sizes="32x32"
          />
        ) : null}
        <link
          data-runtime-favicon="true"
          rel="shortcut icon"
          href={faviconUrl}
          type={faviconIsSvg ? "image/svg+xml" : "image/png"}
          sizes={faviconIsSvg ? "any" : undefined}
        />
        <link
          data-runtime-favicon="true"
          rel="apple-touch-icon"
          href={appleTouchIconUrl}
          type={officialFavicon ? "image/png" : faviconIsSvg ? "image/svg+xml" : "image/png"}
          sizes={officialFavicon ? "180x180" : undefined}
        />
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
