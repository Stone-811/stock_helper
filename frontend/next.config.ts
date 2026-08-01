import type { NextConfig } from "next";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const defaultCache = require("next-pwa/cache");

// eslint-disable-next-line @typescript-eslint/no-require-imports
const withPWA = require("next-pwa")({
  dest: "public",
  register: true,
  skipWaiting: true,
  disable: process.env.NODE_ENV === "development",
  runtimeCaching: [
    {
      // 行情類 API 只快取 60 秒（原 next-pwa 預設 24 小時，會讓使用者看到舊資料）
      urlPattern: ({ url }: { url: URL }) => url.pathname.startsWith("/api/"),
      handler: "NetworkFirst",
      options: {
        cacheName: "api-cache",
        expiration: { maxEntries: 64, maxAgeSeconds: 60 },
        networkTimeoutSeconds: 10,
      },
    },
    ...defaultCache,
  ],
});

const nextConfig: NextConfig = {
  // Vercel 部署不需要 standalone 模式
  // 若需要 Docker 部署，請取消下方註解
  // output: "standalone",

  // Turbopack 配置（Next.js 16 需要）
  turbopack: {},
};

export default withPWA(nextConfig);
