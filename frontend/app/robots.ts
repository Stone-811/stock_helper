import type { MetadataRoute } from 'next'

const SITE_URL = 'https://stock-analysis--stock-analysis-b5602.asia-east1.hosted.app'

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      allow: '/',
    },
    sitemap: `${SITE_URL}/sitemap.xml`,
  }
}
