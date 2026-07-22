async (page) => {
  const results = []
  const consoleMessages = []
  page.on('console', (message) => {
    const type = message.type()
    if (type === 'error' || type === 'warning') {
      consoleMessages.push({ type, text: message.text().slice(0, 500) })
    }
  })

  async function collect(name, url, viewport) {
    await page.setViewportSize(viewport)
    await page.goto(`http://localhost:3000${url}`, { waitUntil: 'domcontentloaded', timeout: 45000 })
    await page.waitForTimeout(1500)
    await page.screenshot({
      path: `output/playwright/${name}.png`,
      fullPage: true,
    })
    const data = await page.evaluate(() => {
      const bodyText = document.body.innerText || ''
      const hasHorizontalOverflow = document.documentElement.scrollWidth > window.innerWidth + 8
      const buttons = Array.from(document.querySelectorAll('button')).map((button) => button.innerText.trim()).filter(Boolean)
      const headings = Array.from(document.querySelectorAll('h1,h2,h3')).map((heading) => heading.textContent?.trim()).filter(Boolean)
      return {
        title: document.title,
        url: location.pathname + location.search,
        bodySample: bodyText.slice(0, 3000),
        bodyLength: bodyText.length,
        hasHorizontalOverflow,
        buttons: buttons.slice(0, 60),
        headings: headings.slice(0, 40),
        favicon: document.querySelector('link[rel~="icon"]')?.getAttribute('href') || '',
        aiLevelMentions: (bodyText.match(/AI_LEVEL_/g) || []).length,
        legacyThreeLayerMentions: (bodyText.match(/L1|L2|L3|三级|三层模型/g) || []).length,
      }
    })
    results.push({ name, url, viewport, ...data })
  }

  const desktop = { width: 1440, height: 1000 }
  const ipad = { width: 1024, height: 1366 }

  await collect('verify-ai-config-desktop', '/configs?tab=ai', desktop)
  await collect('verify-rules-config-desktop', '/configs?tab=rules', desktop)
  await collect('verify-contracts-hub-desktop', '/contracts', desktop)

  const contractsText = results.find((item) => item.name === 'verify-contracts-hub-desktop')?.bodySample || ''
  const firstContractHref = await page.evaluate(() => {
    const anchors = Array.from(document.querySelectorAll('a[href^="/contracts/"]'))
    const candidate = anchors.find((anchor) => /^\/contracts\/[0-9a-f-]{20,}(\?|$)/i.test(anchor.getAttribute('href') || ''))
    return candidate?.getAttribute('href') || ''
  })
  const firstCompareHref = await page.evaluate(() => {
    const anchors = Array.from(document.querySelectorAll('a[href^="/contracts/"]'))
    const candidate = anchors.find((anchor) => /^\/contracts\/[0-9a-f-]{20,}\/compare(\?|$)/i.test(anchor.getAttribute('href') || ''))
    return candidate?.getAttribute('href') || ''
  })

  if (firstContractHref) {
    await collect('verify-contract-review-desktop', firstContractHref, desktop)
    await collect('verify-contract-review-ipad', firstContractHref, ipad)
  }

  if (firstCompareHref) {
    await collect('verify-contract-compare-result-desktop', firstCompareHref, desktop)
    await collect('verify-contract-compare-result-ipad', firstCompareHref, ipad)
  }

  await page.setViewportSize(desktop)
  const verification = {
    generatedAt: new Date().toISOString(),
    firstContractHref,
    firstCompareHref,
    contractsTextSample: contractsText,
    results,
    consoleMessages: consoleMessages.slice(-80),
  }
  return verification
}
