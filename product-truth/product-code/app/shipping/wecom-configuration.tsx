'use client'
import { useEffect,useRef,useState } from 'react'
import type { WecomSettings,WecomMember } from '@/lib/shipping/wecom-settings'
import styles from './config-drawer.module.css'
type Reply={settings:WecomSettings;members:WecomMember[];appName?:string}
async function request(body?:unknown):Promise<Reply>{const r=await fetch('/api/shipping/wecom',{...(body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{cache:'no-store'})});const data=await r.json();if(!r.ok||!data.settings)throw new Error(data.error||'企微配置暂不可用');return data}
export default function WecomConfiguration({onMessage}: {onMessage?:(message:string)=>void}){
 const [settings,setSettings]=useState<WecomSettings|null>(null),[members,setMembers]=useState<WecomMember[]>([]),[secret,setSecret]=useState(''),[busy,setBusy]=useState(false),[dirty,setDirty]=useState(false),[message,setMessage]=useState('')
 const running=useRef(false)
 function receive(data:Reply){setSettings(data.settings);setMembers(data.members||[])}
 useEffect(()=>{let active=true;request().then(data=>{if(active)receive(data)}).catch(e=>{if(active)setMessage(e.message)});return()=>{active=false}},[])
 async function act(body:unknown,success:string){if(running.current)return;running.current=true;setBusy(true);setMessage('');onMessage?.('');try{receive(await request(body));setMessage(success);onMessage?.(success);return true}catch(e){setMessage((e as Error).message);onMessage?.((e as Error).message);return false}finally{running.current=false;setBusy(false)}}
 async function save(){if(!settings)return;const ok=await act({action:'save',settings:{corpId:settings.corpId,agentId:settings.agentId,orderCheckMode:settings.orderCheckMode,fallbackPhone:settings.fallbackPhone,deniedMessage:settings.deniedMessage,expectedUpdatedAt:settings.updatedAt,...(secret?{secret}:{})}},'企微应用已验证并保存。首次接入或变更凭证后，请同步通讯录。');if(ok){setSecret('');setDirty(false)}}
 return <section className={styles.section} aria-label="下单权限中心"><h3>下单权限中心</h3><p className={styles.hint}>员工使用企微身份，无需注册系统账号。保存时验证应用，同步名单后才能启用白名单提报；姓名、手机号、单位和部门由服务端确定。</p>
 {settings&&<fieldset disabled={busy} onChange={()=>setDirty(true)}>
  <label>企业ID（CorpID）<input value={settings.corpId} onChange={e=>setSettings({...settings,corpId:e.target.value})}/></label>
  <label>应用ID（AgentID）<input type="number" min="1" value={settings.agentId||''} onChange={e=>setSettings({...settings,agentId:Number(e.target.value)||null})}/></label>
  <label>应用密钥（Secret）<input type="password" autoComplete="new-password" value={secret} onChange={e=>setSecret(e.target.value)} placeholder={settings.hasSecret?'已加密保存，留空保持':'填自建应用Secret，不是Bot Secret'}/></label>
  <label>下单校验模式<select value={settings.orderCheckMode} onChange={e=>setSettings({...settings,orderCheckMode:Number(e.target.value) as 0|1})}><option value="1">仅限企微白名单</option><option value="0">全员开放（不校验员工身份）</option></select></label>
  <label>预置寄件电话（可选）<input value={settings.fallbackPhone} onChange={e=>setSettings({...settings,fallbackPhone:e.target.value})} placeholder="真实可联系的公司电话；通讯录电话无效时使用"/></label>
  <label>无权限提示文案<input value={settings.deniedMessage} maxLength={200} onChange={e=>setSettings({...settings,deniedMessage:e.target.value})}/></label>
  <div className={styles.actions}><button type="button" onClick={()=>void save()}>{busy?'处理中…':'保存并验证企微应用'}</button><button type="button" className={styles.secondary} disabled={!settings.hasSecret||dirty} onClick={()=>void act({action:'sync'},'企微通讯录已同步，白名单与部门信息已更新。')}>同步企业微信通讯录</button></div>
  {dirty&&<p className={styles.hint}>请先保存当前更改，再同步通讯录。</p>}
  <p className={styles.hint}>授权回调域名：{settings.redirectDomain||'保存后读取'}；名单更新时间：{settings.directorySyncedAt?new Date(settings.directorySyncedAt).toLocaleString('zh-CN'):'尚未同步'}</p>
 </fieldset>}
 {members.length>0&&<div className={styles.accountList}>{members.map(member=><article key={member.id} className={styles.account}><div><strong>{member.wecom_name}</strong><small>{member.mobile||'通讯录未返回手机号'} · {member.department_names.join(' / ')} · {member.is_active?'在职/已激活':'企微已停用'}</small><label className={styles.checkbox}><input type="checkbox" checked={member.wecom_allowed} disabled={busy||dirty} onChange={e=>void act({action:'member',member:{id:member.id,allowed:e.target.checked,usePresetPhone:member.use_preset_phone}},'员工权限已更新。')}/>允许提报</label><label className={styles.checkbox}><input type="checkbox" checked={member.use_preset_phone} disabled={busy||dirty||!settings?.fallbackPhone} onChange={e=>void act({action:'member',member:{id:member.id,allowed:member.wecom_allowed,usePresetPhone:e.target.checked}},'员工寄件电话来源已更新。')}/>使用公司预置电话</label></div></article>)}</div>}
 {message&&<p className={styles.message} role="status">{message}</p>}
 </section>
}
