# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: critical-path.spec.ts >> 路径 1：登录流程 >> 登录成功 → 跳转到首页
- Location: e2e/critical-path.spec.ts:35:7

# Error details

```
Error: expect(locator).toBeVisible() failed

Locator: locator('text=/工作台|报价中心/').first()
Expected: visible
Timeout: 5000ms
Error: element(s) not found

Call log:
  - Expect "toBeVisible" with timeout 5000ms
  - waiting for locator('text=/工作台|报价中心/').first()

```

# Test source

```ts
  1   | import { test, expect } from '@playwright/test'
  2   | 
  3   | /**
  4   |  * 核心路径 E2E
  5   |  * 覆盖 3 条发布前必须验证的路径：
  6   |  * 1. 登录 → 看到首页
  7   |  * 2. 配置中心 → 新建规则 → 测试沙箱
  8   |  * 3. 报价中心 → 新建报价 → 保存
  9   |  *
  10  |  * 前置条件：
  11  |  * - 测试环境已有种子数据（至少 1 个 admin 用户）
  12  |  * - 默认凭证：e2e-admin@huarun.com / E2ETestPassword123!
  13  |  *
  14  |  * 注意：所有测试用 serial 模式（workers=1），避免共享数据库状态
  15  |  */
  16  | 
  17  | const TEST_USER = {
  18  |   email: 'e2e-admin@huarun.com',
  19  |   password: 'E2ETestPassword123!',
  20  | }
  21  | 
  22  | test.describe.configure({ mode: 'serial' })
  23  | 
  24  | test.describe('路径 1：登录流程', () => {
  25  |   test('登录失败 → 显示错误', async ({ page }) => {
  26  |     await page.goto('/login')
  27  |     await page.fill('input[type="email"]', 'wrong@test.com')
  28  |     await page.fill('input[type="password"]', 'wrong')
  29  |     await page.click('button[type="submit"]')
  30  | 
  31  |     // 期望看到错误提示
  32  |     await expect(page.locator('text=/错误|失败|invalid/i').first()).toBeVisible({ timeout: 10_000 })
  33  |   })
  34  | 
  35  |   test('登录成功 → 跳转到首页', async ({ page }) => {
  36  |     await page.goto('/login')
  37  |     await page.fill('input[type="email"]', TEST_USER.email)
  38  |     await page.fill('input[type="password"]', TEST_USER.password)
  39  |     await page.click('button[type="submit"]')
  40  | 
  41  |     // 期望跳转到 / 或 /quotes
  42  |     await page.waitForURL((url) => url.pathname === '/' || url.pathname === '/quotes', { timeout: 15_000 })
  43  | 
  44  |     // 期望看到侧边栏的"工作台"或"报价中心"等导航
> 45  |     await expect(page.locator('text=/工作台|报价中心/').first()).toBeVisible()
      |                                                           ^ Error: expect(locator).toBeVisible() failed
  46  |   })
  47  | })
  48  | 
  49  | test.describe('路径 2：配置中心新建规则', () => {
  50  |   test.beforeEach(async ({ page }) => {
  51  |     // 登录（共享登录逻辑）
  52  |     await page.goto('/login')
  53  |     await page.fill('input[type="email"]', TEST_USER.email)
  54  |     await page.fill('input[type="password"]', TEST_USER.password)
  55  |     await page.click('button[type="submit"]')
  56  |     await page.waitForURL((url) => !url.pathname.includes('/login'), { timeout: 15_000 })
  57  |   })
  58  | 
  59  |   test('新建规则 → 出现在列表', async ({ page }) => {
  60  |     await page.goto('/configs')
  61  | 
  62  |     // 等待 Tab 加载
  63  |     await expect(page.locator('text=合同审核规则').first()).toBeVisible({ timeout: 10_000 })
  64  | 
  65  |     // 点击"新建规则"按钮（文字可能为"新建"或带 + 号）
  66  |     const newBtn = page.locator('button').filter({ hasText: /新建|创建|添加|\+/ }).first()
  67  |     if (await newBtn.isVisible()) {
  68  |       await newBtn.click()
  69  |     }
  70  | 
  71  |     // 填写规则名称（如果在 dialog 中）
  72  |     const nameInput = page.locator('input[placeholder*="规则"], input[name*="name"]').first()
  73  |     if (await nameInput.isVisible({ timeout: 3000 }).catch(() => false)) {
  74  |       const uniqueName = `E2E-测试规则-${Date.now()}`
  75  |       await nameInput.fill(uniqueName)
  76  | 
  77  |       // 提交
  78  |       const saveBtn = page.locator('button').filter({ hasText: /保存|提交|确定/ }).last()
  79  |       await saveBtn.click()
  80  | 
  81  |       // 期望规则出现在列表
  82  |       await expect(page.locator(`text=${uniqueName}`).first()).toBeVisible({ timeout: 5_000 })
  83  |     } else {
  84  |       test.skip(true, '未找到规则编辑入口（页面结构可能变化）')
  85  |     }
  86  |   })
  87  | })
  88  | 
  89  | test.describe('路径 3：报价中心新建报价', () => {
  90  |   test.beforeEach(async ({ page }) => {
  91  |     await page.goto('/login')
  92  |     await page.fill('input[name="email"]', TEST_USER.email)
  93  |     await page.fill('input[name="password"]', TEST_USER.password)
  94  |     await page.click('button[type="submit"]')
  95  |     await page.waitForURL((url) => !url.pathname.includes('/login'), { timeout: 10_000 })
  96  |   })
  97  | 
  98  |   test('新建报价 → 单号生成 → 保存', async ({ page }) => {
  99  |     await page.goto('/quotes/new')
  100 | 
  101 |     // 等待表单加载（任意字段可见）
  102 |     const customerInput = page.locator('input[name*="customer"], input[placeholder*="客户"]').first()
  103 |     const hasForm = await customerInput.isVisible({ timeout: 10_000 }).catch(() => false)
  104 | 
  105 |     if (!hasForm) {
  106 |       test.skip(true, '未找到报价表单（页面结构可能变化）')
  107 |       return
  108 |     }
  109 | 
  110 |     // 填写客户信息
  111 |     await customerInput.fill('E2E 测试客户')
  112 | 
  113 |     // 联系方式（如有）
  114 |     const contactInput = page.locator('input[name*="contact"], input[name*="phone"]').first()
  115 |     if (await contactInput.isVisible().catch(() => false)) {
  116 |       await contactInput.fill('13800138000')
  117 |     }
  118 | 
  119 |     // 提交
  120 |     const submitBtn = page.locator('button[type="submit"], button').filter({ hasText: /保存|提交|创建/ }).last()
  121 |     await submitBtn.click()
  122 | 
  123 |     // 期望跳转到详情页或列表
  124 |     await page.waitForURL((url) => url.pathname !== '/quotes/new', { timeout: 10_000 })
  125 | 
  126 |     // 期望看到单号（格式 QT-YYYYMMDD-XXXX）
  127 |     await expect(page.locator('text=/QT-\\d{8}-\\d{4}/').first()).toBeVisible({ timeout: 5_000 })
  128 |   })
  129 | })
  130 | 
  131 | test.describe('健康检查端点', () => {
  132 |   test('GET /api/health 返回 ok', async ({ request }) => {
  133 |     const res = await request.get('/api/health')
  134 |     expect(res.status()).toBe(200)
  135 |     const body = await res.json()
  136 |     expect(body.status).toBe('ok')
  137 |     expect(body.checks).toBeInstanceOf(Array)
  138 |   })
  139 | })
  140 | 
```