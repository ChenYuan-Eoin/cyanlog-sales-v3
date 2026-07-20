import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const source = readFileSync(resolve(process.cwd(), 'app/configs/dialogs/AIEditForm.tsx'), 'utf8')
const dialogSource = readFileSync(resolve(process.cwd(), 'app/configs/dialogs/ConfigEditDialog.tsx'), 'utf8')
const clientSource = readFileSync(resolve(process.cwd(), 'app/configs/ConfigsClient.tsx'), 'utf8')

describe('AI platform editor source contract', () => {
  it('separates the Provider connection editor from the model editor', () => {
    const providerStart = source.indexOf("kind === 'provider_connection'")
    const modelStart = source.indexOf("kind === 'model_catalog_entry'", providerStart)
    const providerSection = source.slice(providerStart, modelStart)

    expect(providerSection).toContain('Base URL')
    expect(providerSection).toContain('替换 API Key / Token')
    expect(providerSection).not.toContain('Provider 模型 ID')
    expect(providerSection).not.toContain('运行阶段')
    expect(providerSection).not.toContain('规则引擎')
  })

  it('sends a connection-only probe with config identity and no masked credential reuse in the browser', () => {
    expect(source).toContain("probe_mode: mode")
    expect(source).toContain('config_id: configId')
    expect(source).toContain('runtime_location: runtimeLocation')
    expect(source).toContain('auth_mode: authMode')
    expect(source).toContain('!isMaskedApiKey(value.api_key)')
    expect(source).toContain('!isMaskedApiKey(storedProviderKey)')
    expect(source).toContain("handleProbe('connection')")
  })

  it('makes authentication explicit and keeps discovered Provider models read-only', () => {
    expect(source).toContain('认证方式')
    expect(source).toContain('<option value="none">无需认证</option>')
    expect(source).toContain('<option value="bearer">Bearer Token</option>')
    expect(source).toContain('发现的模型（只读）')
    expect(source).toContain('保存连接后，请到“模型目录”选择并登记')
    expect(source).toContain('选择一个模型填入当前目录条目')
  })

  it('renders an auditable route order and only offers published dependencies', () => {
    expect(source).toContain('当前模型调用顺序')
    expect(source).toContain('上移')
    expect(source).toContain('下移')
    expect(source).toContain('移除')
    expect(source).toContain('可添加的已发布模型')
    expect(source).toContain("grouped.aiApplications.filter((item) => item.status === 'PUBLISHED'")
    expect(source).toContain("grouped.modelCatalogEntries.filter((item) => item.status === 'PUBLISHED'")
    expect(source).toContain("grouped.businessUsePoints.filter((item) => item.status === 'PUBLISHED'")
    expect(source).toContain("grouped.providerConnections.filter((item) => item.status === 'PUBLISHED'")
    expect(source).toContain('请选择已发布且启用的连接')
    expect(source).not.toContain('勾选顺序即降级顺序')
  })

  it('keeps save failures inside the dialog and blocks duplicate submissions', () => {
    expect(dialogSource).toContain('aria-live="assertive"')
    expect(dialogSource).toContain('aria-busy={saving}')
    expect(dialogSource).toContain("saving ? '保存中…' : '保存'")
    expect(dialogSource).toContain('htmlFor="config-description"')
    expect(dialogSource).toContain('min-h-11 min-w-11')
    expect(clientSource).toContain('configSaveInFlightRef.current')
    expect(clientSource).toContain('setConfigDialogError')
  })

  it('creates Provider revisions with an explicit server-side credential action', () => {
    expect(clientSource).toContain('revision_source_id: config.id')
    expect(clientSource).toContain("credential_action: canReuseCredential ? 'reuse' : 'clear'")
    expect(clientSource).toContain("? 'replace'")
    expect(clientSource).toContain('isMaskedApiKey(sanitizedValue.api_key)')
    expect(clientSource).toContain("config.status !== 'ARCHIVED'")
    expect(clientSource).toContain('canUseProviderRevisionSource ?')
  })

  it('keeps machine identifiers advanced and probe guidance human-readable', () => {
    expect(source).toContain('高级标识（通常无需修改）')
    expect(source).toContain('系统自动生成')
    expect(source).toContain('凭据状态：')
    expect(source).toContain('建议处理：')
    expect(source).toContain('选择产品功能入口')
    expect(dialogSource).toContain('overscroll-contain')
  })
})
