import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Vercel 部署不需要 standalone 模式
  // 若需要 Docker 部署，請取消下方註解
  // output: "standalone",
};

export default nextConfig;
