import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Stack — Library Management",
  description: "Multi-tenant library management for the modern age.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>{children}</body>
    </html>
  );
}
