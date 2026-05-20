import type { Metadata, Viewport } from "next"
import { Inter } from "next/font/google"
import "./globals.css"
import { I18nProvider } from "@/lib/i18n"
import { Chatbot } from "@/components/chatbot/chatbot"

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
})

export const metadata: Metadata = {
  title: "EasyJob CM - Trouvez des missions flexibles",
  description: "La plateforme de mise en relation entre travailleurs flexibles et entreprises au Cameroun. Trouvez des missions adaptees a votre emploi du temps.",
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
    description: "La plateforme de mise en relation entre travailleurs flexibles et entreprises au Cameroun.",
    type: "website",
    locale: "fr_CM",
  },
}

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
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="fr" className={`${inter.variable} h-full antialiased`} suppressHydrationWarning data-scroll-behavior="smooth">
      <head>
        <link rel="apple-touch-icon" sizes="180x180" href="/icons/apple-touch-icon.jpg" />
        <link rel="icon" type="image/jpeg" sizes="32x32" href="/icons/favicon-32x32.jpg" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="mobile-web-app-capable" content="yes" />
      </head>
      <body className="min-h-full flex flex-col bg-background text-foreground">
        <I18nProvider>
          {children}
          <Chatbot />
        </I18nProvider>
      </body>
    </html>
  )
}
