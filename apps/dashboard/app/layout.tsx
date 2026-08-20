import type { Metadata } from "next";
import { Inter } from "next/font/google";
import type { PropsWithChildren } from "react";
import { ToastProvider } from "../components/ui/toast";
import { THEME_INIT_SCRIPT } from "../lib/theme";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });

export const metadata: Metadata = {
  title: "AI Customer Support Platform",
  description: "Workspace administration dashboard",
};

export default function RootLayout({ children }: PropsWithChildren) {
  return (
    // suppressHydrationWarning is scoped to this element only (React
    // does not propagate it to children) - it exists specifically for
    // the data-theme attribute the inline script below sets before
    // hydration, which the server-rendered HTML can never predict
    // (it doesn't know the client's localStorage). Every other
    // attribute on <html>/<body> is still fully checked as normal.
    <html lang="en" className={inter.variable} suppressHydrationWarning>
      {/* Runs before hydration so an explicit dark-mode choice applies
          before first paint - without this, the page would flash light
          (the server-rendered default) and then snap to dark a moment
          later on every load. */}
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body className="min-h-screen bg-page text-slate-900 antialiased">
        <ToastProvider>{children}</ToastProvider>
      </body>
    </html>
  );
}
