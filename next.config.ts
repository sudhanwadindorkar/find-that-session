import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  devIndicators: false,
  // Browser opens http://127.0.0.1:53681 while next dev binds 0.0.0.0;
  // allow that host for HMR/dev assets (Docker + local).
  allowedDevOrigins: ["127.0.0.1"],
  // Next.js 16 defaults to Turbopack; empty config acknowledges that the
  // webpack() block below is webpack-only (used with --webpack).
  turbopack: {},
  serverExternalPackages: [
    "better-sqlite3",
    "sqlite-vec",
    "@huggingface/transformers",
    "sharp",
    "onnxruntime-node",
  ],
  experimental: {
    optimizePackageImports: ["@mantine/core", "@mantine/hooks"],
  },
  // If DATABASE_PATH stays under ./data, SQLite/enrich writes must not
  // invalidate the webpack watcher (Turbopack still needs data outside the repo).
  webpack: (config, { dev }) => {
    if (!dev) return config;
    const prev = config.watchOptions?.ignored;
    const ignored = [
      ...(Array.isArray(prev) ? prev : prev ? [prev] : []),
      "**/node_modules/**",
      "**/.git/**",
      "**/data/**",
    ];
    config.watchOptions = {
      ...config.watchOptions,
      ignored,
    };
    return config;
  },
};

export default nextConfig;
