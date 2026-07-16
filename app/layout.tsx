import "./globals.css";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Abbode Embroidery",
  description: "Abbode's internal home — icon catalog, product & color trends, and order data.",
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "any" },
      { url: "/icon.png", type: "image/png", sizes: "512x512" },
    ],
    apple: { url: "/apple-touch-icon.png", sizes: "180x180" },
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-porcelain text-espresso">
        {children}
      </body>
    </html>
  );
}
