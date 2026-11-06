import SentimentStat from './SentimentStat'
import { fmtMd, type Stat } from '../lib/sentiment'

/**
 * 大盤當沖比（上市、上櫃）、融資融券（上市、上櫃）與恐慌指數（台股、美股）的指標卡組。
 * 由 MarketMoodSections 組成三組（卡＋走勢圖），放在首頁（/market-mood 頁 2026-11-06 拿掉）。
 * 各卡的 ⓘ 說明文字只寫在這裡（首頁的市場溫度是唯一使用處）。
 *
 * ⚠️ stat 為 null（沒資料／抓不到）時卡片顯示「暫無資料」，不可傳 0 進來。
 */
export function DaytradeStats({ twse, tpex }: { twse: Stat | null; tpex: Stat | null }) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-3 md:gap-4">
      <SentimentStat
        title="上市當沖比" stat={twse} digits={1} unit="%" deltaUnit="個百分點" size="lg"
        tipTitle="上市當沖比"
        tip="證交所公布的「當日沖銷交易買進金額 ÷ 全市場成交金額」。當沖＝同一天買進又賣出。這是新聞說的「當沖比」；另一種用股數算的數字分母含 ETF 和權證，會跟著它們的成交量亂跳，所以不用。證交所當天晚上才公布，22:00 以前看到的是前一個交易日。"
      />
      <SentimentStat
        title="上櫃當沖比" stat={tpex} digits={1} unit="%" deltaUnit="個百分點" size="lg"
        tipTitle="上櫃當沖比"
        tip="櫃買中心公布的「當日沖銷交易買進金額 ÷ 上櫃市場成交金額」。上櫃股票多為中小型股，當沖比通常比上市高，兩個數字不要直接相比。"
      />
    </div>
  )
}

export function MarginStats({ mgTwse, mgTpex, shTwse, shTpex }: { mgTwse: Stat | null; mgTpex: Stat | null; shTwse: Stat | null; shTpex: Stat | null }) {
  // 手機也一排兩張（上市｜上櫃）：2026-11-06 業主：「上市融資、上櫃融資同一排，各佔版面50%」。電腦本來就是兩欄。
  return (
    <div className="grid grid-cols-2 gap-3 md:gap-4">
      <SentimentStat
        title="上市融資餘額" stat={mgTwse} digits={0} unit=" 億" deltaUnit="億元"
        tipTitle="融資餘額"
        tip="投資人向券商借錢買股票、還沒還的總金額（證交所每天公布，單位換成億元）。餘額增加代表借錢買股的人變多。"
      />
      <SentimentStat
        title="上櫃融資餘額" stat={mgTpex} digits={0} unit=" 億" deltaUnit="億元"
        tipTitle="上櫃融資餘額"
        tip="櫃買中心公布的上櫃市場融資餘額合計（億元）。"
      />
      <SentimentStat
        title="上市融券餘額" stat={shTwse} digits={0} unit=" 張" deltaUnit="張"
        tipTitle="融券餘額"
        tip="投資人向券商借股票先賣、還沒買回的總張數（證交所每天公布）。餘額增加代表看空的人變多。這裡不含借券賣出。"
      />
      <SentimentStat
        title="上櫃融券餘額" stat={shTpex} digits={0} unit=" 張" deltaUnit="張"
        tipTitle="上櫃融券餘額"
        tip="櫃買中心公布的上櫃市場融券餘額合計（張）。"
      />
    </div>
  )
}

export function VixStats({ taivix, vix, taivixFrom }: { taivix: Stat | null; vix: Stat | null; taivixFrom: string | null }) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-3 md:gap-4">
      <SentimentStat
        title="台股恐慌指數（臺指VIX）" stat={taivix} digits={2} unit="" deltaUnit="" size="lg"
        tipTitle="臺指VIX"
        tip={<>期貨交易所用臺指選擇權算出來的「市場預期未來 30 天的波動」，每天 13:45 收盤值。數字越高代表市場越緊張。{taivixFrom ? `本站自 ${fmtMd(taivixFrom)}（${taivixFrom.slice(0, 4)} 年）起統計，` : ''}更早的官方不再提供。台股的數字一向比美股高很多，兩個不能互相比。</>}
      />
      <SentimentStat
        title="美股恐慌指數（VIX）" stat={vix} digits={2} unit="" deltaUnit="" size="lg" dateNote="美股收盤"
        tipTitle="美股 VIX"
        tip="芝加哥選擇權交易所用 S&P 500 選擇權算出的 30 天預期波動。日期是美國當地的交易日：美股 11/4 收盤等於台灣 11/5 清晨，可以當隔天台股開盤前的參考。"
      />
    </div>
  )
}
