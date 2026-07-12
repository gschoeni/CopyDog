import type { Metadata } from "next";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";

import { ThemeScript } from "@/components/theme/theme-script";
import { WIREFRAME_CSS } from "@/lib/wireframe/design-system-css";

import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "CopyDog",
    template: "%s · CopyDog",
  },
  description:
    "The collaborative copy editor and wireframe tool. Write the words, shape the layout, dance between the two.",
  icons: {
    icon: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><text y=".9em" font-size="90">🐕</text></svg>',
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning className={`${GeistSans.variable} ${GeistMono.variable}`}>
      <head>
        <ThemeScript />
        <style id="wireframe-design-system" dangerouslySetInnerHTML={{ __html: WIREFRAME_CSS }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
