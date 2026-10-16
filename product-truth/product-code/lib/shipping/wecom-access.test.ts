// @vitest-environment node
import { beforeEach, expect, it, vi } from 'vitest'
const mock = vi.hoisted(() => ({ read: vi.fn(), sync: vi.fn() }))
vi.mock('./wecom-settings', () => ({ readWecomSettings: mock.read, syncWecomDirectory: mock.sync }))
import { currentWecomAccess, hasFreshWecomDirectory, isAllowedWecomMember, WECOM_DIRECTORY_MAX_AGE_MS } from './wecom-access'
import type { WecomSettingsRow } from './wecom-settings'
const config = () => ({ org_id:'org-a',corp_id:'corp-a',agent_id:7,updated_at:'version-1',directory_synced_at:new Date().toISOString() } as WecomSettingsRow)
const member = { org_id:'org-a',wecom_corp_id:'corp-a',wechat_userid:'person',is_active:true,wecom_allowed:true }
beforeEach(() => { vi.resetAllMocks() })
it('reuses a fresh snapshot without making a provider request',async()=>{
 const fresh=config();expect(await currentWecomAccess(fresh)).toBe(fresh);expect(mock.sync).not.toHaveBeenCalled()
})
it.each([null,'invalid',new Date(Date.now()+60000).toISOString(),new Date(Date.now()-WECOM_DIRECTORY_MAX_AGE_MS).toISOString()])('does not trust invalid or expired timestamp %s',stamp=>{
 expect(hasFreshWecomDirectory({...config(),directory_synced_at:stamp})).toBe(false)
})
it.each([{org_id:'foreign'},{wecom_corp_id:'foreign'},{is_active:false},{wecom_allowed:false},{wechat_userid:''}])('denies a foreign, inactive, or restricted member %j',change=>{
 expect(isAllowedWecomMember({...member,...change},config())).toBe(false)
})
it('accepts only a valid member from the current organization and enterprise',()=>{
 expect(isAllowedWecomMember(member,config())).toBe(true)
 expect(isAllowedWecomMember(member,{...config(),directory_synced_at:null})).toBe(false)
})
it('coalesces refreshes and uses only a fresh authoritative result',async()=>{
 const old={...config(),directory_synced_at:null},fresh=config()
 mock.sync.mockResolvedValue(undefined);mock.read.mockResolvedValue(fresh)
 expect(await Promise.all([currentWecomAccess(old),currentWecomAccess(old)])).toEqual([fresh,fresh])
 expect(mock.sync).toHaveBeenCalledExactlyOnceWith('org-a')
 expect(mock.read).toHaveBeenCalledWith('org-a',{fresh:true})
})
it('fails closed on provider errors and permits a later successful refresh',async()=>{
 const old={...config(),directory_synced_at:null}
 mock.sync.mockRejectedValueOnce(new Error('provider offline')).mockResolvedValueOnce(undefined)
 await expect(currentWecomAccess(old)).rejects.toMatchObject({status:503})
 expect(mock.read).not.toHaveBeenCalled();expect(old.directory_synced_at).toBeNull()
 mock.read.mockResolvedValue(config());await expect(currentWecomAccess(old)).resolves.toMatchObject({org_id:'org-a'})
})
it.each([{corp_id:'new-corp'},{agent_id:9}])('refuses a connection changed while refreshing %j',change=>{
 mock.sync.mockResolvedValue(undefined);mock.read.mockResolvedValue({...config(),...change})
 return expect(currentWecomAccess({...config(),directory_synced_at:null})).rejects.toMatchObject({status:403})
})
