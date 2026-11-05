import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Turbopack 配置（Next.js 16 需要）
  turbopack: {},
  // 2026-10-26 強勢股卡片頁與總表合併成 /strong-stocks（上方切換卡片／表格）。
  // 舊的總表書籤轉過去並直接開表格。用 307（permanent: false）：之後若再調整網址，
  // 瀏覽器不會把 308 永久快取住而轉不回來。
  // 2026-11-06 自選股功能拿掉（業主：「不用這個功能」）：舊的 /watchlist 書籤／主畫面捷徑轉到首頁，
  // 不讓它掉到「找不到頁面」。同樣用 307，萬一之後加回來不會被瀏覽器快取住。
  async redirects() {
    return [
      { source: '/strong-table', destination: '/strong-stocks?view=table', permanent: false },
      { source: '/watchlist', destination: '/', permanent: false },
    ]
  },
};

export default nextConfig;
