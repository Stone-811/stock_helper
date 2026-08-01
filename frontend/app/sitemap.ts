import type { MetadataRoute } from 'next'
import { getLatestDate, getStocksByDate } from '../lib/firebase-admin'

export const revalidate = 86400 // 一天更新一次

const SITE_URL = 'https://stock-analysis--stock-analysis-b5602.asia-east1.hosted.app'

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const staticPages: MetadataRoute.Sitemap = [
    { url: SITE_URL, priority: 1, changeFrequency: 'daily' },
    { url: `${SITE_URL}/strong-stocks`, priority: 0.8, changeFrequency: 'daily' },
    { url: `${SITE_URL}/watchlist`, priority: 0.5, changeFrequency: 'weekly' },
  ]

  try {
    const date = await getLatestDate()
    const stocks = date ? await getStocksByDate(date) : []
    const stockPages: MetadataRoute.Sitemap = stocks.map((s: { stock_id: string }) => ({
      url: `${SITE_URL}/stock/${s.stock_id}`,
      priority: 0.6,
      changeFrequency: 'daily',
    }))
    return [...staticPages, ...stockPages]
  } catch {
    return staticPages
  }
}
