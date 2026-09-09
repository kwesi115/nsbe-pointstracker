import type { Metadata, Viewport } from "next";
import { Archivo, IBM_Plex_Mono, Inter } from "next/font/google";
import { ToastProvider } from "@/components/ui/Toast";
import "./globals.css";

const archivo = Archivo({
  variable: "--font-archivo",
  weight: ["700", "800"],
  subsets: ["latin"],
});

const inter = Inter({
  variable: "--font-inter",
  weight: ["400", "500", "600"],
  subsets: ["latin"],
});

const plexMono = IBM_Plex_Mono({
  variable: "--font-plex-mono",
  weight: ["500", "600"],
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "NSBE Points Tracker",
  description: "Chapter attendance and points tracking for NSBE.",
};

// viewport-fit=cover opts into the notch/home-indicator safe area on iOS —
// without it, env(safe-area-inset-*) (see globals.css) always resolves to 0
// and a fixed bottom bar sits under the home indicator.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${archivo.variable} ${inter.variable} ${plexMono.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col bg-paper text-ink">
        <ToastProvider>{children}</ToastProvider>
      </body>
    </html>
  );
}
