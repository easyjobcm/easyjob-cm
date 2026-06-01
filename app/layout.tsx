import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { I18nProvider } from "@/lib/i18n";
import { ThemeProvider } from "@/lib/hooks/use-theme";
import { SplashScreen } from "@/components/ui/splash-screen";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
});

export const metadata: Metadata = {
  title: "EasyJob CM - Trouvez des missions flexibles",
  description:
    "La plateforme de mise en relation entre travailleurs flexibles et entreprises au Cameroun. Trouvez des missions adaptees a votre emploi du temps.",
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "EasyJob CM",
  },
  formatDetection: {
    telephone: true,
  },
  openGraph: {
    title: "EasyJob CM - Trouvez des missions flexibles",
    description:
      "La plateforme de mise en relation entre travailleurs flexibles et entreprises au Cameroun.",
    type: "website",
    locale: "fr_CM",
  },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#7c3aed" },
    { media: "(prefers-color-scheme: dark)", color: "#1a1625" },
  ],
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="fr"
      className={`${inter.variable} h-full antialiased`}
      suppressHydrationWarning
      data-scroll-behavior="smooth"
    >
      <head>
        <link
          rel="icon"
          type="image/png"
          sizes="192x192"
          href="/icons/manifest-icon-192.maskable.png"
        />
        <link
          rel="icon"
          type="image/png"
          sizes="512x512"
          href="/icons/manifest-icon-512.maskable.png"
        />
        <link
          rel="apple-touch-icon"
          sizes="180x180"
          href="/icons/apple-icon-180.png"
        />
        <link
          rel="shortcut icon"
          href="/icons/manifest-icon-192.maskable.png"
        />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-title" content="EasyJob CM" />
        <meta name="application-name" content="EasyJob CM" />
        <meta name="msapplication-TileColor" content="#7C3AED" />
        <meta
          name="msapplication-TileImage"
          content="/icons/manifest-icon-192.maskable.png"
        />
      </head>
      <body className="min-h-full flex flex-col bg-background text-foreground">
        <ThemeProvider>
          <I18nProvider>
            <SplashScreen />
            {children}
          </I18nProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
