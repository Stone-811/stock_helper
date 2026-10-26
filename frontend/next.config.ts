import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Turbopack 配置（Next.js 16 需要）
  turbopack: {},
  // 2026-10-26 強勢股卡片頁與總表合併成 /strong-stocks（上方切換卡片／表格）。
  // 舊的總表書籤轉過去並直接開表格。用 307（permanent: false）：之後若再調整網址，
  // 瀏覽器不會把 308 永久快取住而轉不回來。
  async redirects() {
    return [{ source: '/strong-table', destination: '/strong-stocks?view=table', permanent: false }]
  },
};

export default nextConfig;
