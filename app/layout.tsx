import "./globals.css";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Abbode Icon Library",
  description: "Internal embroidery icon catalog for the Abbode team and partners.",
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
