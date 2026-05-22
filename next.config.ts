import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  images: {
    // Book cover hosts. `next/image` rejects any remote host not listed here;
    // an unlisted host throws "Invalid src prop … hostname not configured",
    // which hard-500s the public catalog and breaks covers across the app.
    remotePatterns: [
      { protocol: "https", hostname: "covers.openlibrary.org" },
      { protocol: "https", hostname: "books.google.com" },
      { protocol: "https", hostname: "books.googleusercontent.com" },
    ],
  },
  // TODO(next-16-cache-components): Verify whether "use cache" / cacheComponents requires
  // an explicit opt-in flag under Next.js 16 (it was experimental in 15). Enable here once
  // confirmed against Next 16 release notes.
};

export default nextConfig;
