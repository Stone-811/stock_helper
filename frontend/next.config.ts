import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone", // 啟用 Docker 部署模式
};

export default nextConfig;
