/**
 * 「只採用最後一次送出的請求」的序號閘門（強勢股頁、強勢月報、選股頁共用）。
 *
 * 為什麼要有：換條件就重抓的頁面，慢網路時舊請求的回應可能比新的晚到，
 * 不擋的話會把新條件的結果蓋回舊的——強勢月報冷算要數十秒，「先選冷的 A 月、
 * 再選有快取的 B 月」時，下拉選單與整張表會被蓋回 A 月；選股頁連點兩個快速策略時，
 * 「已套用條件」是新的、卡片與「符合 N 檔」卻是舊條件的結果。
 * 做法原樣抽自強勢股頁原本的 reqSeq（2026-10-26 已驗證）：
 *
 *   const req = useLatestRequest()
 *   const n = req.start()                  // 送出前取號（同時讓之前的請求作廢）
 *   ...await fetch...
 *   if (!req.isLatest(n)) return           // 每個 setState 之前都要檢查
 *   finally { if (req.isLatest(n)) setLoading(false) }  // ⚠️ 不可無條件關掉載入中
 *   req.cancel()                           // 還沒送出新請求、但要先作廢進行中的（例如防抖等待期間）
 *
 * 回傳的物件在元件整個生命週期固定不變，放進 effect 依賴也不會重跑。
 * 不引入資料抓取框架：只解決「舊回應蓋掉新結果」這一件事。
 */

import { useState } from 'react'

export interface LatestRequest {
  /** 取一個新序號；之前取過的序號全部作廢 */
  start(): number
  /** 不取號、只作廢進行中的請求 */
  cancel(): void
  /** 這個序號是不是最後一次 start() 拿到的、而且之後沒有 cancel() */
  isLatest(n: number): boolean
}

export function useLatestRequest(): LatestRequest {
  // 用 useState 的初始化函式建立一次：計數器是閉包裡的變數，不是 state，改它不會觸發重繪
  const [req] = useState<LatestRequest>(() => {
    let seq = 0
    return {
      start: () => ++seq,
      cancel: () => {
        seq++
      },
      isLatest: (n) => n === seq,
    }
  })
  return req
}
