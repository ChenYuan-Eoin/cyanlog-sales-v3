import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const source = readFileSync(resolve(process.cwd(), 'app/configs/dialogs/AIEditForm.tsx'), 'utf8')
const dialogSource = readFileSync(resolve(process.cwd(), 'app/configs/dialogs/ConfigEditDialog.tsx'), 'utf8')
const clientSource = readFileSync(resolve(process.cwd(), 'app/configs/ConfigsClient.tsx'), 'utf8')
const sharedDialogSource = readFileSync(resolve(process.cwd(), 'components/ui/dialog.tsx'), 'utf8')
const alertDialogSource = readFileSync(resolve(process.cwd(), 'components/ui/alert-dialog.tsx'), 'utf8')
const appShellSource = readFileSync(resolve(process.cwd(), 'components/layout/AppShell.tsx'), 'utf8')

describe('AI platform editor source contract', () => {
  it('separates the model service editor from the available-model editor', () => {
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

  it('makes authentication explicit and keeps discovered service models read-only', () => {
    expect(source).toContain('认证方式')
    expect(source).toContain('<option value="none">无需认证</option>')
    expect(source).toContain('<option value="bearer">Bearer Token</option>')
    expect(source).toContain('发现的模型（只读）')
    expect(source).toContain('保存连接后，请到“可用模型”中选择并添加')
    expect(source).toContain('选择一个检测到的模型，作为当前可用模型')
    expect(source).toContain('hover:bg-white')
    expect(source).toContain('focus-visible:ring-2')
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

  it('creates model-service revisions with an explicit server-side credential action', () => {
    expect(clientSource).toContain('revision_source_id: config.id')
    expect(clientSource).toContain("credential_action: canReuseCredential ? 'reuse' : 'clear'")
    expect(clientSource).toContain("? 'replace'")
    expect(clientSource).toContain('isMaskedApiKey(sanitizedValue.api_key)')
    expect(clientSource).toContain("config.status !== 'ARCHIVED'")
    expect(clientSource).toContain('canUseProviderRevisionSource ?')
  })

  it('presents configuration identifiers and probe guidance in business language', () => {
    expect(source).toContain('配置编号（通常无需修改）')
    expect(source).toContain('>版本记录编号</label>')
    expect(source).toContain('>配置编号</label>')
    expect(source).not.toContain('>稳定资产标识</label>')
    expect(source).not.toContain('>记录键</label>')
    expect(source).toContain('系统自动生成')
    expect(source).toContain('凭据状态：')
    expect(source).toContain('建议处理：')
    expect(source).toContain('选择产品功能入口')
    expect(dialogSource).toContain('overscroll-contain')
  })

  it('confirms every close path when the form has unsaved changes', () => {
    expect(dialogSource).not.toContain("import { confirmAction } from '@/lib/toast'")
    expect(dialogSource).toContain('initialConfigSnapshotRef')
    expect(dialogSource).toContain('hasUnsavedChanges')
    expect(dialogSource).toContain('discardConfirmationOpen')
    expect(dialogSource).toContain('<AlertDialog')
    expect(dialogSource).toContain('放弃未保存修改')
    expect(dialogSource).toContain('onOpenChange={requestOpenChange}')
    expect(dialogSource).toContain('setDiscardConfirmationOpen(false)')
    expect(dialogSource).toContain('onOpenChange(false)')
    expect(dialogSource).toContain("window.addEventListener('beforeunload', warnBeforeUnload)")
    expect(dialogSource).toContain("window.removeEventListener('beforeunload', warnBeforeUnload)")
    expect(dialogSource).toContain('(!hasUnsavedChanges && !saving)')
    expect(alertDialogSource).toContain('@base-ui/react/alert-dialog')
  })

  it('uses one isolated application root and a viewport-owned modal stack', () => {
    expect(appShellSource).toContain('data-slot="app-root"')
    expect(appShellSource).toContain('className="isolate min-h-screen"')
    expect(sharedDialogSource).toContain('<DialogViewport>')
    expect(sharedDialogSource).toContain('data-slot="dialog-viewport"')
    expect(sharedDialogSource).toContain('max-h-[calc(100dvh-2rem)]')
    expect(sharedDialogSource).toContain('w-full max-w-sm')
    expect(sharedDialogSource).not.toContain('sm:max-w-sm')
    expect(sharedDialogSource).toContain('overscroll-contain')
    expect(sharedDialogSource).not.toContain('supports-backdrop-filter:backdrop-blur')
    expect(sharedDialogSource).not.toContain('fixed top-1/2 left-1/2')
  })
})
