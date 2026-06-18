import { NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import OpenAI from 'openai'
import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
const supabase = createClient(supabaseUrl, supabaseServiceKey)

const INVESTMENT_RESEARCH_PROMPT = `# Investment Research Prompt v3.1

> 用於產出 Professional Investment Research PDF v1.0。
> 核心目標：不是判斷股票便宜，而是判斷公司未來 3~5 年靠什麼賺錢，以及公司是否正在變強。

---

## 1. Role

你是一位專業產業與投資研究分析師。

你的任務是針對指定公司產出一份結構化研究報告，預設輸出為 Markdown 格式。

報告必須優先分析：

1. 營收分佈
2. 各事業群業務內容
3. 業務未來前瞻性
4. 上下游依賴
5. 競爭對手
6. 成長引擎
7. 風險
8. 市場結構 Dashboard（含當沖比例）

財務指標與估值僅作輔助，不得成為報告主體。

---

## 2. Report Structure

報告必須包含以下章節。

### Chapter 1: Executive Summary

必須回答：

- 公司目前主要靠什麼賺錢？
- 未來 3~5 年靠什麼成長？
- 最大成長動能是什麼？
- 最大風險是什麼？

---

### Chapter 2: Revenue Mix Analysis

必須提供營收分佈表。

格式：

| Business Segment | Revenue % | Main Products | Growth Driver | Data Confidence |
|---|---:|---|---|---|

要求：

- Total Revenue = 100%
- 若公司未正式披露完整分佈，必須標示為 Estimated
- 不得將推估資料寫成官方資料
- 必須分 Official / Estimated / Inference / Opinion

---

### Chapter 3: Business Analysis

每個事業群都必須分析：

- 業務內容
- 產品或服務
- 主要客戶
- 應用場景
- 未來性
- 替代風險

---

### Chapter 4: Future Outlook

使用以下評分標準：

| Rating | Definition |
|---|---|
| ★★★★★ | CAGR > 20% 或具結構性高成長 |
| ★★★★☆ | CAGR 10~20% |
| ★★★☆☆ | CAGR 5~10% |
| ★★☆☆☆ | CAGR 0~5% |
| ★☆☆☆☆ | 負成長或結構性衰退 |

---

### Chapter 5: Supply Chain Analysis

必須包含：

- 上游供應商 / 技術提供者
- 下游客戶
- 公司在價值鏈中的位置
- 公司是否可被替代

---

### Chapter 6: Competitor Analysis

必須提供競爭對手比較表。

格式：

| Company | Role | Strength | Weakness | AI / Growth Exposure |
|---|---|---|---|---|

至少比較：

- 市占率或市場地位
- 技術能力
- 客戶結構
- 毛利率或商業模式
- 成長性

---

### Chapter 7: Growth Drivers

必須列出未來 3 年成長引擎。

格式：

| Growth Driver | Importance | Timeline | Evidence | Risk |
|---|---|---|---|---|

---

### Chapter 8: Market Structure Dashboard

此章節用於判斷股票交易結構與短線籌碼風險。

必須包含：

| Item | Latest / Avg | Interpretation | Data Source |
|---|---:|---|---|
| Day Trading Ratio | % | 低 / 中 / 高 / 過熱 | TWSE / Goodinfo |
| Trading Volume | shares / lots | 流動性 | TWSE |
| Foreign Ownership | % | 外資關注度 | TWSE / MOPS / Broker Data |
| Investment Trust Holdings | % | 投信關注度 | TWSE / Broker Data |
| ETF Exposure | Included / Not Included | 被動資金影響 | TWSE / ETF issuer |

#### Day Trading Ratio Interpretation

| Day Trading Ratio | Interpretation |
|---:|---|
| < 15% | 非常穩定 |
| 15~25% | 穩定 |
| 25~35% | 熱絡 |
| 35~50% | 高波動 |
| > 50% | 投機性偏高 / 過熱 |

注意：

- 當沖比例只代表市場交易結構
- 不代表公司基本面好壞
- 高當沖比例代表短線波動風險較高

---

### Chapter 9: Risk Analysis

必須包含：

| Risk | Probability | Impact | How to Monitor |
|---|---|---|---|

至少分析：

- Industry Risk
- Technology Risk
- Customer Risk
- Geopolitical Risk
- Valuation Risk
- Market Structure Risk

---

### Chapter 10: Bull / Base / Bear Case

必須包含：

- Bull Case
- Base Case
- Bear Case
- Key Assumptions
- Key Metrics to Track

---

### Chapter 11: Investment Conclusion

必須回答：

1. 公司現在靠什麼賺錢？
2. 未來靠什麼賺更多錢？
3. 哪些業務獲利衰退？
4. 誰是競爭對手？
5. 誰可能取代它？
6. 最大風險是什麼？
7. 為什麼值得持續追蹤？

---

## 3. Data Quality Rules

### Source Priority

資料優先來源順序：

1. Company Annual Report
2. Quarterly Earnings Report
3. Investor Conference / Earnings Call
4. Company Presentation
5. Official Press Release
6. Stock Exchange / MOPS
7. Industry Research
8. Reputable News
9. Financial Data Platforms

禁止優先使用：

- Forums
- Blogs
- Social Media Rumors
- Unverified YouTube / Podcast Claims

---

### Data Confidence Tag

所有關鍵數字必須標示：

| Tag | Meaning |
|---|---|
| Official | 公司或交易所正式披露 |
| Estimated | 根據公開資料推估 |
| Inference | 根據產業邏輯推論 |
| Opinion | 分析師主觀想法 |

---

### Missing Data Rule

若資料找不到，必須寫：

\`\`\`text
Data Not Publicly Available
\`\`\`

禁止：

- 編造數字
- 將推估寫成官方
- 使用沒有來源的精確數字

---

## 4. Golden Rule

不要問問：

\`\`\`text
PE 幾倍？
\`\`\`

問問：

\`\`\`text
公司未來 3~5 年靠什麼賺錢？
\`\`\`

如果無法回答這個問題：

\`\`\`text
不要投資。
\`\`\`
`

// 使用 Claude API 生成報告
async function generateWithClaude(userMessage: string): Promise<{ content: string; model: string }> {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    throw new Error('ANTHROPIC_API_KEY not configured')
  }

  const anthropic = new Anthropic({ apiKey })
  const message = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 8192,
    messages: [
      {
        role: 'user',
        content: INVESTMENT_RESEARCH_PROMPT + '\n\n---\n\n' + userMessage
      }
    ]
  })

  const content = message.content
    .filter(block => block.type === 'text')
    .map(block => (block as { type: 'text'; text: string }).text)
    .join('\n')

  return { content, model: 'claude-sonnet-4-20250514' }
}

// 使用 OpenAI GPT 生成報告
async function generateWithOpenAI(userMessage: string): Promise<{ content: string; model: string }> {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY not configured')
  }

  const openai = new OpenAI({ apiKey })
  const completion = await openai.chat.completions.create({
    model: 'gpt-4o',
    max_tokens: 8192,
    messages: [
      {
        role: 'system',
        content: INVESTMENT_RESEARCH_PROMPT
      },
      {
        role: 'user',
        content: userMessage
      }
    ]
  })

  const content = completion.choices[0]?.message?.content || ''
  return { content, model: 'gpt-4o' }
}

export async function POST(request: Request) {
  try {
    // 從 request header 取得 auth token
    const authHeader = request.headers.get('authorization')

    // 驗證用戶身份
    let userId: string | null = null
    if (authHeader) {
      const token = authHeader.replace('Bearer ', '')
      const { data: { user }, error } = await supabase.auth.getUser(token)
      if (!error && user) {
        userId = user.id
      }
    }

    const { stock_id, stock_name } = await request.json()

    if (!stock_id) {
      return NextResponse.json(
        { error: 'Missing stock_id' },
        { status: 400 }
      )
    }

    // 組合 prompt
    const userMessage = `Deep Dive：${stock_name || stock_id}（股票代碼：${stock_id}）

請根據上述的 Investment Research Prompt 格式，產出這家公司的完整投資研究報告。

重要提醒：
1. 使用繁體中文撰寫
2. 所有表格都要包含完整內容
3. 數據要標明來源信心度（Official / Estimated / Inference / Opinion）
4. 如果找不到資料，請標示「Data Not Publicly Available」
5. 輸出格式為 Markdown`

    // 根據環境變數選擇 AI 提供者（優先使用 OpenAI）
    let reportContent: string
    let modelUsed: string

    if (process.env.OPENAI_API_KEY) {
      const result = await generateWithOpenAI(userMessage)
      reportContent = result.content
      modelUsed = result.model
    } else if (process.env.ANTHROPIC_API_KEY) {
      const result = await generateWithClaude(userMessage)
      reportContent = result.content
      modelUsed = result.model
    } else {
      return NextResponse.json(
        { error: 'No AI API key configured. Set OPENAI_API_KEY or ANTHROPIC_API_KEY' },
        { status: 500 }
      )
    }

    // 儲存到 Supabase
    let savedReport = null
    if (userId) {
      const { data, error } = await supabase
        .from('stock_analysis_reports')
        .insert({
          user_id: userId,
          stock_id: stock_id,
          stock_name: stock_name || stock_id,
          report_content: reportContent,
          model_used: modelUsed
        })
        .select()
        .single()

      if (error) {
        console.error('Error saving report:', error)
      } else {
        savedReport = data
      }
    }

    return NextResponse.json({
      success: true,
      report: {
        stock_id,
        stock_name: stock_name || stock_id,
        content: reportContent,
        model_used: modelUsed,
        saved: !!savedReport,
        id: savedReport?.id
      }
    })

  } catch (error) {
    console.error('Error generating analysis:', error)
    const errorMessage = error instanceof Error ? error.message : 'Failed to generate analysis'
    return NextResponse.json(
      { error: errorMessage },
      { status: 500 }
    )
  }
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const stockId = searchParams.get('stock_id')
    const limit = parseInt(searchParams.get('limit') || '10')

    let query = supabase
      .from('stock_analysis_reports')
      .select('id, stock_id, stock_name, model_used, created_at')
      .order('created_at', { ascending: false })
      .limit(limit)

    if (stockId) {
      query = query.eq('stock_id', stockId)
    }

    const { data, error } = await query

    if (error) throw error

    return NextResponse.json({ reports: data })

  } catch (error) {
    console.error('Error fetching reports:', error)
    return NextResponse.json(
      { error: 'Failed to fetch reports' },
      { status: 500 }
    )
  }
}
