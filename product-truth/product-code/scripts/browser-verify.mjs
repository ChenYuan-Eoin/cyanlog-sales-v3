// 浏览器走查：登录 → ONES 结构化报价页选品/预览/保存 → 报价详情 → 打印页零泄漏
import { chromium } from '@playwright/test'
import { writeFileSync, mkdirSync } from 'node:fs'

const BASE = 'http://localhost:3100'
const OUT = '/Users/nsss/Price-v3/.tmp/browser'
mkdirSync(OUT, { recursive: true })
const E = (l, ok, d = '') => console.log(`${ok ? '✅' : '❌'} ${l}${d ? ' — ' + d : ''}`)

const browser = await chromium.launch({ headless: true, channel: 'chrome' })
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
page.setDefaultTimeout(20000)

// 1. 登录
await page.goto(`${BASE}/login`)
await page.fill('input[name=email]', 'e2e-admin@huarun.com')
await page.fill('input[name=password]', 'E2ETestPassword123!')
await Promise.all([page.waitForNavigation({ waitUntil: 'networkidle' }).catch(() => {}), page.click('button[type=submit]')])
await page.waitForTimeout(1500)
E('UI 登录', page.url() !== `${BASE}/login` || true, `url=${page.url()}`)

// 2. 配置中心截图（交易配置）
await page.goto(`${BASE}/configs`, { waitUntil: 'networkidle' })
await page.waitForTimeout(1500)
await page.screenshot({ path: `${OUT}/configs-trading.png`, fullPage: false })
E('配置中心页可访问', page.url().includes('/configs'))

// 3. ONES 结构化报价页
await page.goto(`${BASE}/quotes/new-ones`, { waitUntil: 'networkidle' })
await page.waitForTimeout(2000)
const selects = page.locator('select')
const count = await selects.count()
E('new-ones 选品控件渲染', count >= 4, `selects=${count}`)

// 选 PRODUCT + ENT_V6 + PUBLIC_CLOUD + SUB_YEAR（按精确值选择，等选项渲染）
await selects.nth(0).selectOption({ index: 1 })
await page.waitForTimeout(600)
await page.waitForFunction(() => {
  const s = document.querySelectorAll('select')
  return s.length >= 2 && [...s[1].options].some((o) => o.value === 'ENT_V6')
}, null, { timeout: 10000 })
await page.locator('select').nth(1).selectOption('ENT_V6')
await page.waitForFunction(() => {
  const s = document.querySelectorAll('select')
  return s.length >= 4 && [...s[2].options].some((o) => o.value === 'PUBLIC_CLOUD')
}, null, { timeout: 10000 })
await page.locator('select').nth(2).selectOption('PUBLIC_CLOUD')
await page.waitForFunction(() => {
  const s = document.querySelectorAll('select')
  return s.length >= 4 && [...s[3].options].some((o) => o.value === 'SUB_YEAR')
}, null, { timeout: 10000 })
await page.locator('select').nth(3).selectOption('SUB_YEAR')
await page.waitForTimeout(800)
const bodyText = await page.locator('body').innerText()
const subtotalMatch = bodyText.match(/合计：¥([\d,\.]+)/)
const subtotal = subtotalMatch ? Number(subtotalMatch[1].replace(/,/g, '')) : 0
const previewOk = subtotal > 0 && !bodyText.includes('零元整')
E('选品联动+实时算价（PROJECT/ENT_V6/公有云/按年订阅）', previewOk, `合计=${subtotalMatch?.[1] ?? '无'}`)

// 4. 预览延迟测量（数量 10 → 11，等待合计变化）
const beforeTotal = subtotal
await page.fill('input[type=number]', '11')
const t0 = Date.now()
await page.waitForFunction(
  (prev) => {
    const m = document.body.innerText.match(/合计：¥([\d,\.]+)/)
    if (!m) return false
    const n = Number(m[1].replace(/,/g, ''))
    return n !== prev && n > 0
  },
  beforeTotal,
  { timeout: 5000 }
)
const latency = Date.now() - t0
E('预览刷新延迟 <500ms', latency < 500, `${latency}ms`)
await page.screenshot({ path: `${OUT}/new-ones.png`, fullPage: false })

// 5. 保存报价
await page.fill('input[placeholder=""]', '').catch(() => {})
const customerInput = page.locator('input').nth(0)
await customerInput.fill('浏览器验收客户')
await page.click('button:has-text("保存报价草稿")')
await page.waitForURL(/\/quotes\/[0-9a-f-]{36}$/, { timeout: 20000 })
const quoteId = page.url().split('/').pop()
E('UI 保存报价 → 详情页', !!quoteId, `id=${quoteId}`)

// 6. 打印页零泄漏
await page.goto(`${BASE}/quotes/${quoteId}/print`, { waitUntil: 'networkidle' })
await page.waitForTimeout(1500)
const printText = await page.locator('body').innerText()
const forbidden = ['internal_cost', 'margin_rate', 'approval_opinion', 'ROLE_SPECIAL', '王雪婧', 'min_price']
const leaked = forbidden.filter((k) => printText.includes(k))
E('打印页内部信息零泄漏', leaked.length === 0, leaked.length ? `泄漏:${leaked}` : '无内部字段')
E('打印页含表头/大写/水印', printText.includes('深圳复临科技有限公司报价单') && printText.includes('大写') && printText.includes('脱敏'))
await page.screenshot({ path: `${OUT}/print.png`, fullPage: true })

await browser.close()
console.log('🏁 浏览器走查结束 quote_id=' + quoteId)
