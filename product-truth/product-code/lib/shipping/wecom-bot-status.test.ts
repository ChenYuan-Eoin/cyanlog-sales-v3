import { expect, it } from 'vitest'
import { wecomBotConnectionLabel } from './wecom-bot-status'
it('expires old authentication and never presents a disabled bot as online',()=>{
 const now=Date.now(), verified_at=new Date(now-60000).toISOString()
 expect(wecomBotConnectionLabel({status:'active',verified_at},now)).toContain('在线')
 expect(wecomBotConnectionLabel({status:'active',verified_at},now+150000)).toContain('过期')
 expect(wecomBotConnectionLabel({status:'disabled',verified_at},now)).toBe('已停用')
 expect(wecomBotConnectionLabel({status:'draft',verified_at:null},now)).toContain('尚未确认在线')
})
