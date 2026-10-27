'use client'
import { useEffect, useRef, useState } from 'react'
import type { WecomBot } from '@/lib/shipping/wecom-bot-settings'
import { wecomBotConnectionLabel } from '@/lib/shipping/wecom-bot-status'
import type { BotReadinessCheck } from '@/lib/shipping/wecom-bot-readiness'
import styles from './config-drawer.module.css'
type Setup = { id:string;token:string;encodingAESKey:string }
type Enrollment = { botId:string;remoteBotId:string;token:string;expiresAt:string }
export default function WecomBotConfiguration({ corpId, ready }: { corpId:string;ready:boolean }) {
 const [bots,setBots]=useState<WecomBot[]>([]),[name,setName]=useState('寄件助手'),[botId,setBotId]=useState('')
 const [setup,setSetup]=useState<Setup|null>(null),[origin,setOrigin]=useState(''),[busy,setBusy]=useState(false),[message,setMessage]=useState('')
 const [enrollment,setEnrollment]=useState<Enrollment|null>(null)
 const [transport,setTransport]=useState<'long_connection'|'url_callback'>('long_connection')
 const [secret,setSecret]=useState(''),[editingId,setEditingId]=useState<string|undefined>()
 const [checks,setChecks]=useState<BotReadinessCheck[]>([])
 const [now,setNow]=useState(()=>Date.now())
 useEffect(()=>{const timer=setInterval(()=>setNow(Date.now()),30000);return()=>clearInterval(timer)},[])
 const running=useRef(false)
 async function request(body?:unknown){const response=await fetch('/api/shipping/wecom/bot',{...(body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{cache:'no-store'})});const data=await response.json();if(!response.ok)throw new Error(data.error||'机器人配置暂不可用');return data}
 useEffect(()=>{setOrigin(window.location.origin);setSetup(null);setEnrollment(null);setSecret('');setEditingId(undefined);setBotId('');if(!corpId){setBots([]);return}let active=true;request().then(data=>{if(active){setBots(data.bots);setChecks(data.checks||[])}}).catch(e=>{if(active)setMessage(e.message)});return()=>{active=false}},[corpId])
 async function act(body:unknown,notice:string){if(running.current)return;running.current=true;setBusy(true);setMessage('');try{const data=await request(body);setBots(data.bots);if(data.checks)setChecks(data.checks);setNow(Date.now());if(body&&typeof body==='object'&&'action'in body&&body.action==='save_long_connection'){setSecret('');setEditingId(data.bot.id)}if(body&&typeof body==='object'&&'action'in body&&body.action==='disable')setSetup(null);if(data.setupKeys)setSetup({id:data.bot?.id||data.botId,...data.setupKeys});if(data.enrollment)setEnrollment(data.enrollment);setMessage(notice)}catch(error){setMessage((error as Error).message)}finally{running.current=false;setBusy(false)}}
 async function copy(value:string){try{await navigator.clipboard.writeText(value);setMessage('已复制，请仅填写到本企业机器人配置中。')}catch{setMessage('复制失败，请手动复制。')}}
 const url=(id:string)=>`${origin}/api/shipping/public/wecom/bot/${id}`
 return <section className={styles.section} aria-label="企微机器人配置"><h3>企微智能机器人（可选）</h3><label>接入方式<select value={transport} onChange={e=>{setTransport(e.target.value as typeof transport);setSetup(null);setEnrollment(null);setSecret('');setEditingId(undefined);setBotId('')}}><option value="long_connection">长连接（云桌面/本机）</option><option value="url_callback">URL 回调（已有配置）</option></select></label>
 {transport==='long_connection'&&<>
 <p className={styles.hint}>与企微后台的“使用长连接”对应，无需回调 URL、Token 或 EncodingAESKey。</p>
 {!corpId&&<p>请先配置所属企业。</p>}
 <fieldset className={styles.formGroup} disabled={busy||!corpId}>
 <label>备注名称<input value={name} maxLength={80} onChange={e=>setName(e.target.value)}/></label>
 <label>Bot ID<input value={botId} autoComplete="off" onChange={e=>setBotId(e.target.value)} placeholder="智能机器人 API 配置中的 Bot ID"/></label>
 <label>机器人 Secret<input type="password" value={secret} autoComplete="new-password" onChange={e=>setSecret(e.target.value)} placeholder={editingId?'已保存，留空保留原 Secret':'智能机器人 API 配置中的 Secret'}/></label>
 <button type="button" disabled={!name.trim()||!botId.trim()||(!editingId&&!secret.trim())} onClick={()=>void act({action:'save_long_connection',bot:{id:editingId,name,botId,secret}},'长连接凭据已加密保存。连接状态需由本机接收服务确认。')}>保存长连接配置</button>
 </fieldset>
 <section aria-label="寄件接入检查"><h4>接通步骤与业务默认值</h4><ol><li>企微选择 API 模式 → 使用长连接，保存对应 Bot ID 和 Secret。</li><li>生成接入令牌，在接收服务完成接入并启动。保存凭据不会自动启动服务；消息 MCP 地址不用于此处。</li><li>点击刷新接入状态，检查在线心跳和下方业务条件，然后单聊发送一条收件信息。</li></ol><p>默认：系统寄件人、顺丰标快、文件/合同、预估 1kg、寄方月结。管理员确认资料和费用后才正式下单；未保价，特殊物品或需求请管理员核对。</p>{checks.map(check=><p key={check.key}><strong>{check.label}：{check.ready?'已配置':'需处理'}</strong> · {check.action}</p>)}</section><button type="button" disabled={busy} onClick={()=>void act(undefined,'接入状态已刷新。')}>刷新接入状态</button>
 <p className={styles.hint}>运行位置：云桌面或本机。接收服务须持续运行；运行环境离线时连接会中断。</p>
 <div className={styles.accountList}>{bots.filter(bot=>bot.corp_id===corpId&&bot.transport==='long_connection').map(bot=><article className={styles.account} key={bot.id}><strong>{bot.name}</strong><p>{bot.bot_id}</p><p>{wecomBotConnectionLabel(bot,now)}</p><p>最近业务心跳：{bot.verified_at?new Date(bot.verified_at).toLocaleString('zh-CN'):'尚未收到'} · 最近消息：{bot.last_message_at?new Date(bot.last_message_at).toLocaleString('zh-CN'):'尚未收到'}</p><button type="button" disabled={busy} onClick={()=>{setEditingId(bot.id);setName(bot.name);setBotId(bot.bot_id);setSecret('')}}>修改长连接配置</button><button type="button" disabled={busy||bot.status==='disabled'} onClick={()=>void act({action:'runtime_enrollment',id:bot.id},'云桌面接入令牌已生成，十分钟内有效。请只写入云桌面私有环境文件。')}>生成云桌面接入令牌</button>{bot.status!=='disabled'&&<button type="button" disabled={busy} onClick={()=>void act({action:'disable',id:bot.id},'机器人已停用，接收服务将在下一次请求时停止。')}>停用机器人</button>}</article>)}</div>
 {enrollment&&<section aria-label="云桌面接入令牌"><p className={styles.hint}>令牌只绑定当前机器人配置，十分钟内有效；接入完成后应立即删除，过期时间：{new Date(enrollment.expiresAt).toLocaleString('zh-CN')}。</p><label>Bot ID<input readOnly value={enrollment.remoteBotId}/></label><label>系统连接 ID<input readOnly value={enrollment.botId}/></label><p>运行地址：{origin}。接入程序使用系统连接 ID 换取凭据，自动保存企微 Bot ID；两者不可互换。</p><label>接入令牌<input type="password" readOnly value={enrollment.token}/></label><button type="button" onClick={()=>void copy(enrollment.token)}>复制接入令牌</button><button type="button" onClick={()=>setEnrollment(null)}>收起</button></section>}
 </>}
 {transport==='url_callback'&&<>
 <p className={styles.hint}>仅用于企微后台选择“使用 URL 回调”的机器人，与长连接独立。</p>
 {!ready&&<p>请先连接企业应用并核对成员状态，再配置机器人。</p>}
 <details open={ready && !bots.some(bot => bot.corp_id === corpId&&bot.transport!=='long_connection')}><summary>新增 / 更换机器人</summary><fieldset className={styles.formGroup} disabled={busy||!ready}><label>备注名称<input value={name} maxLength={80} onChange={e=>setName(e.target.value)}/></label><label>Bot ID<input value={botId} onChange={e=>setBotId(e.target.value)} placeholder="企微智能机器人详情中的Bot ID"/></label><p className={styles.hint}>填写 Bot ID 后生成回调参数。</p><button type="button" disabled={!name.trim()||!botId.trim()} onClick={()=>void act({action:'prepare',bot:{name,botId}},'机器人草稿已保存，当前机器人保持不变。请将接入参数填入企微后台并完成URL验证。')}>生成回调配置</button></fieldset></details>
 {setup&&<section aria-label="机器人接入参数"><h4>填写到企微后台</h4><p className={styles.hint}>打开企微智能机器人，选择 API 模式 → URL 回调，填入以下三项并保存。</p><label>回调URL<input readOnly value={url(setup.id)}/></label><button type="button" onClick={()=>void copy(url(setup.id))}>复制回调URL</button><label>Token<input type="password" readOnly value={setup.token}/></label><button type="button" onClick={()=>void copy(setup.token)}>复制Token</button><label>EncodingAESKey<input type="password" readOnly value={setup.encodingAESKey}/></label><button type="button" onClick={()=>void copy(setup.encodingAESKey)}>复制EncodingAESKey</button><p className={styles.hint}>企微验证 URL 后，刷新状态并启用机器人。域名须满足企微备案及主体关联要求。</p><button type="button" onClick={()=>setSetup(null)}>收起接入参数</button></section>}
 <button type="button" disabled={busy} onClick={()=>void act(undefined,'接入状态已刷新。')}>刷新接入状态</button>
 <div className={styles.accountList}>{bots.filter(bot=>bot.corp_id===corpId&&bot.transport!=='long_connection').map(bot=><article className={styles.account} key={bot.id}><div><strong>{bot.name}</strong><p>{bot.bot_id} · {bot.status==='active'?'当前启用':bot.status==='draft'?'待启用':'已停用'}</p><p>{bot.verified_at?'URL 验证通过':'等待企微验证回调URL'}{bot.last_message_at?` · 最近收到消息：${new Date(bot.last_message_at).toLocaleString('zh-CN')}`:''}</p><div className={styles.actions}><button type="button" disabled={busy} onClick={()=>void act({action:'setup',id:bot.id},'接入参数已读取，请勿转发给无关人员。')}>查看 / 复制接入参数</button>{bot.status==='active'?<button type="button" disabled={busy} onClick={()=>void act({action:'disable',id:bot.id},'机器人已停用，不再受理新提报。')}>停用机器人</button>:<button type="button" disabled={busy||!bot.verified_at} onClick={()=>void act({action:'activate',id:bot.id},'机器人已启用；请从企微发送一条提报消息验证实际接收。')}>启用此机器人（替换当前通道）</button>}{bot.status==='draft'&&!bot.verified_at&&<button type="button" disabled={busy} onClick={()=>void act({action:'repair',id:bot.id},'已检查并修复接入参数。请将下面三项完整复制到企微，不要在企微单独随机生成密钥。')}>修复接入参数</button>}{bot.status==='draft'&&<button type="button" disabled={busy} onClick={()=>void act({action:'disable',id:bot.id},'此机器人草稿已停用，当前启用通道保持不变。')}>放弃此草稿</button>}</div></div></article>)}</div>
 </>}
 {message&&<p role="status" className={styles.message}>{message}</p>}
 </section>
}
