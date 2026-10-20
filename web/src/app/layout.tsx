import type { Metadata, Viewport } from "next";

import { ThemeProvider } from "@/lib/theme";
import { I18nProvider } from "@/lib/i18n";
import { ServiceWorker } from "@/components/ServiceWorker";

import "./globals.css";

export const metadata: Metadata = {
  title: "SuaraSah — Sahkan Suara",
  description:
    "Semak sama ada nota suara atau panggilan benar-benar datang daripada orang itu. Verify voice provenance and get warned about AI voices.",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, statusBarStyle: "default", title: "SuaraSah" },
  icons: {
    icon: [
      { url: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: "/apple-touch-icon.png",
  },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  themeColor: "#1b4ddb",
  width: "device-width",
  initialScale: 1,
  // The verdict must stay readable, so zooming stays available.
  maximumScale: 5,
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ms-MY" suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `
              try {
                var theme = localStorage.getItem('suarasah.theme');
                var prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
                if (theme === 'dark' || (theme !== 'light' && prefersDark)) {
                  document.documentElement.classList.add('dark');
                } else {
                  document.documentElement.classList.remove('dark');
                }
              } catch (_) {}
            `,
          }}
        />
      </head>
      <body className="bg-slate-50 text-ink dark:bg-[#0c1017] dark:text-slate-100 transition-colors duration-200">
        <ThemeProvider>
          <I18nProvider>
            {children}
            <ServiceWorker />
          </I18nProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
