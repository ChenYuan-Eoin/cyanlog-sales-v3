import type { CSSProperties } from "react";
import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";
import { AppShell } from "@/components/layout/AppShell";
import { BrandingProvider } from "@/components/branding/BrandingProvider";
import { ClientErrorMonitor } from "@/components/observability/ClientErrorMonitor";
import { RuntimeThemeLoader } from "@/components/theme/RuntimeThemeLoader";
import { getServerAuthToken } from "@/lib/server-auth";
import { getPublishedUITheme } from "@/lib/ui-theme";
import { resolveFaviconUrl, themeToCssVariables } from "@/lib/ui-theme-shared";

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

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const token = getServerAuthToken();
  const theme = await getPublishedUITheme(token);
  const themeVariables = themeToCssVariables(theme) as CSSProperties;

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
      <body className="antialiased">
        <BrandingProvider value={theme}>
          <ClientErrorMonitor />
          <RuntimeThemeLoader />
          <AppShell>{children}</AppShell>
        </BrandingProvider>
      </body>
    </html>
  );
}

export async function generateMetadata(): Promise<Metadata> {
  const token = getServerAuthToken();
  const theme = await getPublishedUITheme(token);
  const faviconUrl = resolveFaviconUrl(theme)

  return {
    title: theme.productTitle || theme.brandName || "Cyanlog Sales",
    description: theme.productSubtitle || "智能销售支撑平台",
    icons: faviconUrl
      ? {
          icon: faviconUrl,
          shortcut: faviconUrl,
          apple: faviconUrl,
        }
      : undefined,
  };
}
