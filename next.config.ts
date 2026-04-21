import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  reactStrictMode: true,
  poweredByHeader: false,
  experimental: {
    serverActions: {
      // Templates can be videos up to 50 MB; bump the default 1 MB cap so
      // Server Actions don't reject the upload before it reaches FastAPI.
      bodySizeLimit: "55mb",
    },
  },
};

export default nextConfig;
