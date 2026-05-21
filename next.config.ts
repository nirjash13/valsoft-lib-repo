import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // TODO(next-16-cache-components): Verify whether "use cache" / cacheComponents requires
  // an explicit opt-in flag under Next.js 16 (it was experimental in 15). Enable here once
  // confirmed against Next 16 release notes.
};

export default nextConfig;
