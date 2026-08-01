import Link from 'next/link'

export default function NotFound() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center gap-4 bg-gray-50 px-4 text-center">
      <div className="text-6xl">🔍</div>
      <h1 className="text-2xl font-bold text-gray-800">找不到頁面</h1>
      <p className="text-gray-500">您要找的股票或頁面不存在，請確認代碼是否正確。</p>
      <Link
        href="/"
        className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors"
      >
        返回首頁
      </Link>
    </div>
  )
}
