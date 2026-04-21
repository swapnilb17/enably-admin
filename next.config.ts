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
    // proxy.ts buffers request bodies so both middleware and the route
    // handler can read them. Default cap is 10 MB and truncates template
    // video uploads without returning a proper error; match the Server
    // Action limit so all three layers agree.
    proxyClientMaxBodySize: "55mb",
  },
};

export default nextConfig;
