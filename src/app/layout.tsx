import type { Metadata, Viewport } from "next";
import { Fredoka, Lilita_One } from "next/font/google";
import "./globals.css";

const fredoka = Fredoka({
  variable: "--font-fredoka",
  subsets: ["latin"],
});

const lilita = Lilita_One({
  variable: "--font-lilita",
  weight: "400",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Block Blast",
  description: "Drag colourful blocks onto the board, blast full rows and columns, and chain combos.",
  appleWebApp: {
    capable: true,
    title: "Block Blast",
    statusBarStyle: "black-translucent",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
  themeColor: "#1f1270",
  colorScheme: "dark",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${fredoka.variable} ${lilita.variable} h-full antialiased`}>
      <body className="h-full">{children}</body>
    </html>
  );
}
