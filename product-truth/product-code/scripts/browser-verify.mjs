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

// 1. 本地可撤销会话（由 setup-e2e-user.mjs 生成，不使用本地密码）
const token = process.env.E2E_AUTH_TOKEN
if (!token) throw new Error('缺少 E2E_AUTH_TOKEN')
await page.context().addCookies([
  { name: 'token', value: token, domain: 'localhost', path: '/', httpOnly: true },
  { name: 'client_token', value: token, domain: 'localhost', path: '/' },
])
await page.addInitScript((value) => localStorage.setItem('token', value), token)
E('本地 E2E 会话', true)

// 2. 配置中心截图（交易配置）
await page.goto(`${BASE}/configs`, { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(1500)
await page.screenshot({ path: `${OUT}/configs-trading.png`, fullPage: false })
E('配置中心页可访问', page.url().includes('/configs'))

// 3. ONES 结构化报价页
await page.goto(`${BASE}/quotes/new-ones`, { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(2000)
const selects = page.locator('select')
const count = await selects.count()
E('new-ones 选品控件渲染', count >= 4, `selects=${count}`)

// 引导式向导 Step1：选 PRODUCT + ENT_V6 + PUBLIC_CLOUD + SUB_YEAR + 12个月
await page.waitForFunction(() => document.querySelectorAll('select').length >= 6, null, { timeout: 15000 })
// select 顺序（Step1）：0=区域 1=产品 2=版本 3=部署 4=授权 5=期限
await page.locator('select').nth(1).selectOption({ index: 1 })
await page.waitForFunction(() => {
  const s = document.querySelectorAll('select')
  return s.length >= 3 && [...s[2].options].some((o) => o.value === 'ENT_V6')
}, null, { timeout: 10000 })
await page.locator('select').nth(2).selectOption('ENT_V6')
await page.waitForFunction(() => {
  const s = document.querySelectorAll('select')
  return s.length >= 4 && [...s[3].options].some((o) => o.value === 'PUBLIC_CLOUD')
}, null, { timeout: 10000 })
await page.locator('select').nth(3).selectOption('PUBLIC_CLOUD')
await page.waitForFunction(() => {
  const s = document.querySelectorAll('select')
  return s.length >= 5 && [...s[4].options].some((o) => o.value === 'SUB_YEAR')
}, null, { timeout: 10000 })
await page.locator('select').nth(4).selectOption('SUB_YEAR')
await page.waitForTimeout(400)
// 客户名称（Step1）
await page.locator('input').nth(0).fill('深圳市云启数字科技有限公司')
// 下一步 → Step2
await page.getByRole('button', { name: '下一步' }).click()
await page.waitForTimeout(600)
// Step2：数量 10、行折扣 0、整单折扣 0（无需原因）
await page.getByRole('button', { name: '下一步' }).click()
await page.waitForTimeout(800)
// Step3：算价汇总 + 大写
const bodyText = await page.locator('body').innerText()
const subtotalMatch = bodyText.match(/合计：¥([\d,\.]+)/)
const subtotal = subtotalMatch ? Number(subtotalMatch[1].replace(/,/g, '')) : 0
const previewOk = subtotal > 0 && !bodyText.includes('零元整')
E('选品联动+实时算价（PROJECT/ENT_V6/公有云/按年订阅）', previewOk, `合计=${subtotalMatch?.[1] ?? '无'}`)
// 预览延迟测量（Step3 改数量：回 Step2 改数量 11 → Step3 合计变化）
await page.getByRole('button', { name: '上一步' }).click()
await page.waitForTimeout(400)
await page.locator('input[type=number]').nth(0).fill('11')
await page.getByRole('button', { name: '下一步' }).click()
const t0 = Date.now()
await page.waitForFunction(
  (prev) => {
    const m = document.body.innerText.match(/合计：¥([\d,\.]+)/)
    if (!m) return false
    const n = Number(m[1].replace(/,/g, ''))
    return n !== prev && n > 0
  },
  subtotal,
  { timeout: 5000 }
)
const latency = Date.now() - t0
E('预览刷新延迟 <500ms', latency < 500, `${latency}ms`)
await page.screenshot({ path: `${OUT}/new-ones.png`, fullPage: false })

// 5. 保存报价（客户名称已在 Step1 填写；Step3 点击保存）
await page.click('button:has-text("保存报价草稿")')
await page.waitForURL(/\/quotes\/[0-9a-f-]{36}$/, { timeout: 20000 })
const quoteId = page.url().split('/').pop()
E('UI 保存报价 → 详情页', !!quoteId, `id=${quoteId}`)

// 6. 打印页零泄漏
await page.goto(`${BASE}/quotes/${quoteId}/print`, { waitUntil: 'domcontentloaded' })
await page.waitForFunction(() => document.body.innerText.includes('报价单') && document.body.innerText.includes('大写'), null, { timeout: 15000 })
const printText = await page.locator('body').innerText()
const forbidden = ['internal_cost', 'margin_rate', 'approval_opinion', 'ROLE_SPECIAL', '王雪婧', 'min_price']
const leaked = forbidden.filter((k) => printText.includes(k))
E('打印页内部信息零泄漏', leaked.length === 0, leaked.length ? `泄漏:${leaked}` : '无内部字段')
E('打印页含表头/大写/水印', printText.includes('深圳复临科技有限公司报价单') && printText.includes('大写') && printText.includes('脱敏'))
await page.screenshot({ path: `${OUT}/print.png`, fullPage: true })

await browser.close()
console.log('🏁 浏览器走查结束 quote_id=' + quoteId)
