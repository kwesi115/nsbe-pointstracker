import type { Metadata, Viewport } from "next";
import { Archivo, IBM_Plex_Mono, Inter } from "next/font/google";
import ThemeSync from "@/components/theme/ThemeSync";
import { ToastProvider } from "@/components/ui/Toast";
import { THEME_INIT_SCRIPT } from "@/lib/theme";
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
  title: "Membership Portal",
  description: "Chapter attendance and points tracking for NSBE.",
};

// viewport-fit=cover opts into the notch/home-indicator safe area on iOS —
// without it, env(safe-area-inset-*) (see globals.css) always resolves to 0
// and a fixed bottom bar sits under the home indicator.
//
// colorScheme emits <meta name="color-scheme" content="light dark">, so native
// controls and scrollbars can render dark at all; globals.css then pins
// color-scheme to whichever theme <html> actually has.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  colorScheme: "light dark",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    // suppressHydrationWarning: THEME_INIT_SCRIPT adds `dark` to this element's
    // class before React hydrates, so the DOM intentionally differs from the JSX.
    <html
      lang="en"
      suppressHydrationWarning
      className={`${archivo.variable} ${inter.variable} ${plexMono.variable} h-full antialiased`}
    >
      <head>
        {/* Sets the theme class before first paint — without it every hard load flashes light. See lib/theme.ts. */}
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body className="min-h-full flex flex-col bg-background text-foreground">
        <ThemeSync />
        <ToastProvider>{children}</ToastProvider>
      </body>
    </html>
  );
}
