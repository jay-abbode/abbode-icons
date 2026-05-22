import "./globals.css";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Abbode Icon Library",
  description: "Internal embroidery icon catalog for the Abbode team and partners.",
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
