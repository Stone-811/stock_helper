'use client'

import { useState, useEffect, useCallback } from 'react'
import { User } from 'firebase/auth'
import {
  onAuthChange,
  signInWithGoogle,
  addAlert,
  getAlertsForStock,
  removeAlert,
  StockAlert,
  AlertType,
} from '../lib/firebase'

const TYPE_OPTIONS: { value: AlertType; label: string; needValue: boolean; unit?: string }[] = [
  { value: 'price_above', label: '股價漲到 ≥', needValue: true, unit: '元' },
  { value: 'price_below', label: '股價跌到 ≤', needValue: true, unit: '元' },
  { value: 'foreign_streak', label: '外資連買 ≥', needValue: true, unit: '天' },
  { value: 'trust_streak', label: '投信連買 ≥', needValue: true, unit: '天' },
  { value: 'macd_bullish', label: 'MACD 轉多頭', needValue: false },
  { value: 'macd_bearish', label: 'MACD 轉空頭', needValue: false },
]

function labelFor(a: StockAlert): string {
  switch (a.type) {
    case 'price_above': return `股價 ≥ ${a.value}`
    case 'price_below': return `股價 ≤ ${a.value}`
    case 'foreign_streak': return `外資連買 ≥ ${a.value} 天`
    case 'trust_streak': return `投信連買 ≥ ${a.value} 天`
    case 'macd_bullish': return 'MACD 轉多頭'
    case 'macd_bearish': return 'MACD 轉空頭'
    default: return a.type
  }
}

export default function AlertButton({ stockId, stockName }: { stockId: string; stockName: string }) {
  const [user, setUser] = useState<User | null>(null)
  const [open, setOpen] = useState(false)
  const [alerts, setAlerts] = useState<StockAlert[]>([])
  const [type, setType] = useState<AlertType>('price_above')
  const [value, setValue] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => onAuthChange(setUser), [])

  const loadAlerts = useCallback(async () => {
    setAlerts(await getAlertsForStock(stockId))
  }, [stockId])

  useEffect(() => {
    if (user && open) loadAlerts()
  }, [user, open, loadAlerts])

  const currentType = TYPE_OPTIONS.find((t) => t.value === type)!

  const handleAdd = async () => {
    if (currentType.needValue && !value) return
    setSaving(true)
    await addAlert(stockId, stockName, type, currentType.needValue ? parseFloat(value) : 0)
    setValue('')
    await loadAlerts()
    setSaving(false)
  }

  const handleRemove = async (id: string) => {
    await removeAlert(id)
    await loadAlerts()
  }

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-lg border border-gray-300 bg-white text-gray-700 hover:bg-gray-50"
      >
        🔔 到價提醒
        {alerts.filter((a) => a.enabled).length > 0 && (
          <span className="ml-0.5 px-1.5 rounded-full bg-orange-500 text-white text-xs">
            {alerts.filter((a) => a.enabled).length}
          </span>
        )}
      </button>

      {open && (
        <>
          {/* 點擊外部關閉 */}
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 mt-2 w-80 bg-white rounded-lg shadow-lg border border-gray-200 z-50 p-4">
            {!user ? (
              <div className="text-center py-2">
                <p className="text-sm text-gray-600 mb-3">登入後可設定到價 / 訊號提醒，達成時 Email 通知你</p>
                <button
                  onClick={() => signInWithGoogle()}
                  className="px-4 py-2 text-sm font-medium rounded-lg bg-blue-600 text-white hover:bg-blue-700"
                >
                  Google 登入
                </button>
              </div>
            ) : (
              <>
                <div className="text-sm font-medium text-gray-800 mb-2">新增提醒條件</div>
                <div className="flex items-center gap-2 mb-3">
                  <select
                    value={type}
                    onChange={(e) => setType(e.target.value as AlertType)}
                    className="flex-1 border border-gray-300 rounded px-2 py-1.5 text-sm"
                  >
                    {TYPE_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                  </select>
                  {currentType.needValue && (
                    <input
                      type="number"
                      value={value}
                      onChange={(e) => setValue(e.target.value)}
                      placeholder={currentType.unit}
                      className="w-20 border border-gray-300 rounded px-2 py-1.5 text-sm"
                    />
                  )}
                  <button
                    onClick={handleAdd}
                    disabled={saving || (currentType.needValue && !value)}
                    className="px-3 py-1.5 text-sm font-medium rounded bg-orange-500 text-white hover:bg-orange-600 disabled:opacity-50"
                  >
                    新增
                  </button>
                </div>

                <div className="border-t border-gray-100 pt-2">
                  <div className="text-xs text-gray-500 mb-1">已設定的提醒</div>
                  {alerts.length === 0 ? (
                    <p className="text-sm text-gray-400 py-2">尚無提醒</p>
                  ) : (
                    <ul className="space-y-1 max-h-48 overflow-y-auto">
                      {alerts.map((a) => (
                        <li key={a.id} className="flex items-center justify-between text-sm py-1">
                          <span className={a.enabled ? 'text-gray-700' : 'text-gray-400 line-through'}>
                            {labelFor(a)}
                            {!a.enabled && <span className="ml-1 text-xs text-green-600 no-underline">已觸發</span>}
                          </span>
                          <button onClick={() => handleRemove(a.id)} className="text-red-500 hover:text-red-600 text-xs">
                            刪除
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                <p className="text-xs text-gray-400 mt-2">達成時會 Email 通知 {user.email}（每日收盤後檢查）</p>
              </>
            )}
          </div>
        </>
      )}
    </div>
  )
}
