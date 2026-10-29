// 真机性能硬门：100 行 SKU 报价，修改后预览刷新 <500ms（V3 既有编辑器）
import { test, expect } from '@playwright/test'

test('100 行 SKU 预览刷新 <500ms', async ({ page, request }) => {
  const token = process.env.E2E_AUTH_TOKEN
  expect(token).toBeTruthy()
  await page.context().addCookies([
    { name: 'token', value: token!, domain: 'localhost', path: '/', httpOnly: true },
    { name: 'client_token', value: token!, domain: 'localhost', path: '/' },
  ])
  await page.addInitScript((t) => localStorage.setItem('token', t), token)
  await page.goto('http://localhost:3100/quotes/new', { waitUntil: 'domcontentloaded' })
  try {
    await page.getByText('增加 SKU').waitFor({ timeout: 45000 })
  } catch {
    console.log('[DIAG] url:', page.url())
    console.log('[DIAG] body:', (await page.locator('body').innerText()).slice(0, 300))
    throw new Error('增加 SKU 未出现')
  }
  await page.waitForTimeout(1200)
  console.log('[DIAG] initial selects:', await page.locator('select').count())

  const add = page.getByRole('button', { name: /增加 SKU/ })
  const initial = await page.locator('select').count()
  for (let i = 0; i < 120; i += 1) {
    await add.click()
    if (await page.locator('select').count() >= 100) break
  }
  await page.waitForFunction(() => document.querySelectorAll('select').length >= 100, null, { timeout: 15000 })
  await page.waitForTimeout(400)

  const selects = page.locator('select')
  const count = await selects.count()
  console.log('[DIAG] final selects:', count)
  expect(count).toBeGreaterThanOrEqual(100)
  // 选真实有价产品（矩阵价盘产品的 base_price=0，选它会永远小计 ¥0）
  const productsRes = await request.get('http://localhost:3100/api/products?status=active', {
    headers: { Authorization: `Bearer ${token}` },
  })
  const productsJson = await productsRes.json()
  const products = (Array.isArray(productsJson) ? productsJson : (productsJson?.data ?? [])) as Array<Record<string, unknown>>
  const priced = products.find((item) => Number(item?.base_price) > 0)
  if (!priced) {
    throw new Error('未找到有 base_price 的产品，无法执行性能门')
  }
  const optValue = String(priced.id)
  for (let i = 0; i < 100; i += 1) {
    await selects.nth(i).selectOption(optValue)
  }
  await page.waitForTimeout(1200)

  const before = await page.locator('body').innerText()
  const beforeMatch = before.match(/小计\s*[¥]?([\d,\.]+)/)
  expect(beforeMatch).not.toBeNull()

  const qty = page.locator('input[type=number]').nth(1)
  await qty.fill('2')
  const t0 = Date.now()
  await page.waitForFunction(
    (prev) => {
      const m = document.body.innerText.match(/小计\s*[¥]?([\d,\.]+)/)
      return !!m && m[1] !== prev
    },
    beforeMatch![1],
    { timeout: 5000 }
  )
  const latency = Date.now() - t0
  console.log(`[PERF-EVIDENCE] rows=${count} 小计变化延迟=${latency}ms`)
  expect(latency).toBeLessThan(500)
})
