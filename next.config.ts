import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  outputFileTracingRoot: __dirname,
  turbopack: {
    root: __dirname,
  },
  async redirects() {
    return [
      { source: "/settings", has: [{ type: "query", key: "section", value: "goat" }], destination: "/settings/goat#chat", permanent: false },
      { source: "/settings", has: [{ type: "query", key: "section", value: "goatPage" }], destination: "/settings/goat#goat-page", permanent: false },
    ];
  },
};

export default nextConfig;
