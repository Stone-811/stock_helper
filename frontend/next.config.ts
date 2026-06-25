import type { NextConfig } from "next";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const withPWA = require("next-pwa")({
  dest: "public",
  register: true,
  skipWaiting: true,
  disable: process.env.NODE_ENV === "development",
});

const nextConfig: NextConfig = {
  // Vercel 部署不需要 standalone 模式
  // 若需要 Docker 部署，請取消下方註解
  // output: "standalone",
};

export default withPWA(nextConfig);
