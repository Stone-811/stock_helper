import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import Sidebar from "../components/Sidebar";
import MainContent from "../components/MainContent";
import MobileBottomNav from "../components/MobileBottomNav";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "選股小幫手",
  description: "台灣股票技術分析與強勢股篩選",
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "選股小幫手",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // 不設 maximumScale／userScalable：允許手機雙指放大（WCAG 1.4.4）
  themeColor: "#1a1a2e",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="zh-TW"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex bg-gray-50">
        {/* 清除訪客殘留的舊 Service Worker 與快取（已移除 PWA，避免 ChunkLoadError / 資料 stale） */}
        <script
          dangerouslySetInnerHTML={{
            __html: `if('serviceWorker' in navigator){navigator.serviceWorker.getRegistrations().then(function(rs){rs.forEach(function(r){r.unregister()})}).catch(function(){});if(window.caches){caches.keys().then(function(ks){ks.forEach(function(k){caches.delete(k)})}).catch(function(){})}}`,
          }}
        />
        <Sidebar />
        <MainContent>
          {children}
        </MainContent>
        <MobileBottomNav />
      </body>
    </html>
  );
}
