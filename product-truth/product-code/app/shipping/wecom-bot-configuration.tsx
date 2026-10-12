'use client'
import { useEffect, useRef, useState } from 'react'
import type { WecomBot } from '@/lib/shipping/wecom-bot-settings'
import styles from './config-drawer.module.css'
type Setup = { id:string;token:string;encodingAESKey:string }
export default function WecomBotConfiguration({ corpId, ready }: { corpId:string;ready:boolean }) {
 const [bots,setBots]=useState<WecomBot[]>([]),[name,setName]=useState('寄件助手'),[botId,setBotId]=useState('')
 const [setup,setSetup]=useState<Setup|null>(null),[origin,setOrigin]=useState(''),[busy,setBusy]=useState(false),[message,setMessage]=useState('')
 const running=useRef(false)
 async function request(body?:unknown){const response=await fetch('/api/shipping/wecom/bot',{...(body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{cache:'no-store'})});const data=await response.json();if(!response.ok)throw new Error(data.error||'机器人配置暂不可用');return data}
 useEffect(()=>{setOrigin(window.location.origin);setSetup(null);let active=true;request().then(data=>{if(active)setBots(data.bots)}).catch(e=>{if(active)setMessage(e.message)});return()=>{active=false}},[corpId])
 async function act(body:unknown,notice:string){if(running.current)return;running.current=true;setBusy(true);setMessage('');try{const data=await request(body);setBots(data.bots);if(data.setupKeys)setSetup({id:data.bot?.id||data.botId,...data.setupKeys});setMessage(notice)}catch(error){setMessage((error as Error).message)}finally{running.current=false;setBusy(false)}}
 async function copy(value:string){try{await navigator.clipboard.writeText(value);setMessage('已复制，请仅填写到本企业机器人配置中。')}catch{setMessage('复制失败，请手动复制。')}}
 const url=(id:string)=>`${origin}/api/shipping/public/wecom/bot/${id}`
 return <section className={styles.section} aria-label="企微机器人配置"><h3>机器人提报通道</h3><p className={styles.hint}>使用URL回调，无需常驻服务器。机器人接收员工寄件提报，操作员确认后才下单；应用私信通知使用上方企业应用连接。</p>
 {!ready&&<p>请先启用企业应用并同步组织，再配置机器人。</p>}
 <details><summary>新增 / 更换机器人</summary><fieldset disabled={busy||!ready}><label>备注名称<input value={name} maxLength={80} onChange={e=>setName(e.target.value)}/></label><label>Bot ID<input value={botId} onChange={e=>setBotId(e.target.value)} placeholder="企微智能机器人详情中的Bot ID"/></label><p className={styles.hint}>在企微后台选择“URL回调”。系统生成独立Token和EncodingAESKey，不使用长连接Secret。</p><button type="button" disabled={!name.trim()||!botId.trim()} onClick={()=>void act({action:'prepare',bot:{name,botId}},'机器人草稿已保存，当前机器人保持不变。请将接入参数填入企微后台并完成URL验证。')}>生成回调配置</button></fieldset></details>
 {setup&&<section aria-label="机器人接入参数"><h4>填写到企微后台</h4><label>回调URL<input readOnly value={url(setup.id)}/></label><button type="button" onClick={()=>void copy(url(setup.id))}>复制回调URL</button><label>Token<input type="password" readOnly value={setup.token}/></label><button type="button" onClick={()=>void copy(setup.token)}>复制Token</button><label>EncodingAESKey<input type="password" readOnly value={setup.encodingAESKey}/></label><button type="button" onClick={()=>void copy(setup.encodingAESKey)}>复制EncodingAESKey</button><p className={styles.hint}>在企微保存并验证URL后，刷新下方状态，再启用机器人。回调域名需满足企微的企业域名要求；验证失败时当前配置不会自动切换。</p><button type="button" onClick={()=>setSetup(null)}>收起接入参数</button></section>}
 <button type="button" disabled={busy} onClick={()=>void act(undefined,'接入状态已刷新。')}>刷新接入状态</button>
 <div className={styles.accountList}>{bots.filter(bot=>bot.corp_id===corpId).map(bot=><article className={styles.account} key={bot.id}><div><strong>{bot.name}</strong><p>{bot.bot_id} · {bot.status==='active'?'当前启用':bot.status==='draft'?'待启用':'已停用'}</p><p>{bot.verified_at?'已收到有效的URL验签请求':'等待企微验证回调URL'}{bot.last_message_at?` · 最近收到消息：${new Date(bot.last_message_at).toLocaleString('zh-CN')}`:''}</p><div className={styles.actions}><button type="button" disabled={busy} onClick={()=>void act({action:'setup',id:bot.id},'接入参数已读取，请勿转发给无关人员。')}>查看 / 复制接入参数</button>{bot.status==='active'?<button type="button" disabled={busy} onClick={()=>void act({action:'disable',id:bot.id},'机器人已停用，不再受理新提报。')}>停用机器人</button>:<button type="button" disabled={busy||!bot.verified_at} onClick={()=>void act({action:'activate',id:bot.id},'机器人已启用；请从企微发送一条提报消息验证实际接收。')}>启用此机器人（替换当前通道）</button>}</div></div></article>)}</div>
 {message&&<p role="status" className={styles.message}>{message}</p>}
 </section>
}
