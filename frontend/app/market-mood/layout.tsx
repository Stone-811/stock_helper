import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: '市場溫度｜選股小幫手',
  description: '大盤當沖比、融資融券餘額、台股與美股恐慌指數',
}

export default function MarketMoodLayout({ children }: { children: React.ReactNode }) {
  return children
}
