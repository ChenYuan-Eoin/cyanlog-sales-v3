'use client'
import { useEffect,useRef,useState,type ReactNode,type FormEvent } from 'react'
import { contactSchema } from '@/lib/shipping/validation'
import { parseAddress } from '@/lib/shipping/address'
import { normalizeDomesticShippingPhone } from '@/lib/shipping/phone'
import { DEFAULT_INTAKE_RULES,intakeFieldSchema,type IntakeRules } from '@/lib/shipping/intake-rules'
import { emptyContact,type Contact } from '@/lib/shipping/types'
import MyWorkorders from './my-workorders'
import styles from './sales-portal.module.css'
export type EmployeeProfile={id:string;email:string;sender:Contact|null;team:string;updatedAt:string;wecom?:boolean;companyName?:string;phoneSource?:'wecom'|'preset'|'unavailable'}
export type EmployeeAccessState={employee:EmployeeProfile|null;controls:ReactNode;canSubmit:boolean;unavailableReason:string;sessionKey:number;sender:Contact;team:string}
const endpoint='/api/shipping/public/employee'
async function call(body?:unknown){const response=await fetch(endpoint,{...(body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{cache:'no-store',signal:AbortSignal.timeout(10000)})});const data=await response.json();if(!response.ok)throw new Error(data.error||'员工寄件服务暂不可用');return data}
export default function EmployeeAccess({children,requireVerification=false,rules=DEFAULT_INTAKE_RULES,initialEmployee=null}: {children:(state:EmployeeAccessState)=>ReactNode;requireVerification?:boolean;emailAvailable?:boolean;rules?:IntakeRules;initialEmployee?:EmployeeProfile|null}){
 const [draftDirty,setDraftDirty]=useState(false)
 const [employee,setEmployee]=useState(initialEmployee),[loading,setLoading]=useState(!initialEmployee),[loadFailed,setLoadFailed]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('')
 const [sender,setSender]=useState<Contact>(initialEmployee?.sender||emptyContact()),[team,setTeam]=useState(initialEmployee?.team||''),[senderText,setSenderText]=useState(''),[remember,setRemember]=useState(false),[sessionKey,setSessionKey]=useState(0)
 const running=useRef(false)
 function accept(profile:EmployeeProfile|null){setEmployee(profile);if(profile){setSender(profile.sender||emptyContact());setTeam(profile.team)}else if(employee){setSender(emptyContact());setTeam('');setSessionKey(k=>k+1)}}
 useEffect(()=>{let active=true;call().then(data=>{if(active){setEmployee(data.employee);if(data.employee){setSender(data.employee.sender||emptyContact());setTeam(data.employee.team)}else if(initialEmployee){setSender(emptyContact());setTeam('');setSessionKey(k=>k+1)}}}).catch(e=>{if(active){setLoadFailed(true);setError(e.message)}}).finally(()=>{if(active)setLoading(false)});return()=>{active=false}},[initialEmployee])
 useEffect(()=>{if(requireVerification)return;try{const saved=JSON.parse(localStorage.getItem('shipping-anonymous-sender-v1')||'null');if(saved?.remember&&contactSchema.safeParse(saved.sender).success&&typeof saved.team==='string'){setSender(saved.sender);setTeam(saved.team);setRemember(true)}}catch{/* optional device draft */}},[requireVerification])
 useEffect(()=>{if(!remember||employee||requireVerification)return;try{localStorage.setItem('shipping-anonymous-sender-v1',JSON.stringify({remember:true,sender,team}))}catch{/* optional device draft */}},[remember,employee,requireVerification,sender,team])
 async function retry(){setLoading(true);setError('');setLoadFailed(false);try{const next=(await call()).employee as EmployeeProfile|null;if(next&&next.id===employee?.id&&draftDirty){setEmployee(next);setTeam(next.team);setSender(current=>({...next.sender||emptyContact(),province:current.province,city:current.city,county:current.county,address:current.address}))}else{accept(next)}}catch(e){setLoadFailed(true);setError((e as Error).message)}finally{setLoading(false)}}
 async function save(event:FormEvent){event.preventDefault();if(!employee||running.current)return;running.current=true;setBusy(true);setError('');try{const contact=contactSchema.parse({...sender,phone:normalizeDomesticShippingPhone(sender.phone)});accept((await call({action:'save_profile',profile:{sender:contact,team,expectedUpdatedAt:employee.updatedAt}})).employee);setDraftDirty(false);setNotice('揽收地址已保存，下次自动带入。')}catch(e){setError((e as Error).message)}finally{running.current=false;setBusy(false)}}
 async function logout(){if(running.current)return;running.current=true;setBusy(true);try{await call({action:'logout'});setEmployee(null);setSender(emptyContact());setTeam('');setSenderText('');setNotice('');setRemember(false);setDraftDirty(false);setSessionKey(k=>k+1);try{localStorage.removeItem('shipping-anonymous-sender-v1')}catch{/* optional storage */}}catch(e){setError((e as Error).message)}finally{running.current=false;setBusy(false)}}
 if(requireVerification&&(!employee||loadFailed))return <main className={styles.page}><section className={styles.card}><h1>{loading?'正在验证企业微信身份…':'需要企业微信授权身份'}</h1>{error&&<p role="alert">{error}</p>}{!loading&&<><a href="/api/shipping/public/wecom/authorize">使用企业微信验证身份</a><button type="button" onClick={()=>void retry()}>重新读取资料</button></>}</section></main>
 const verified=employee?.wecom===true
 const teamRule=verified?{enabled:true,required:true,minLength:1}:rules.team
 const teamCheck=intakeFieldSchema(teamRule,'所属团队',80,verified?[]:rules.teamOptions).safeParse(team)
 const senderCheck=contactSchema.safeParse({...sender,phone:normalizeDomesticShippingPhone(sender.phone)})
 const unavailableReason=loading?'正在读取寄件资料…':busy?'正在处理寄件资料…':!senderCheck.success?(verified&&employee?.phoneSource==='unavailable'?'请管理员补齐或配置预置寄件电话。':'请解析或补齐实际揽收地址和联系电话。'):!teamCheck.success?(verified?'企微部门资料暂缺，请联系管理员同步通讯录。':teamCheck.error.issues.map(e=>e.message).join('；')):''
 const controls=<>
  <section className={styles.card} aria-label="员工身份"><h2>{verified?'企业微信身份已验证':'开放提报'}</h2>{verified?<><p>{employee?.sender?.name} · {employee?.companyName} · {employee?.team}</p><button type="button" disabled={busy} onClick={()=>void retry()}>刷新寄件资料</button><button type="button" disabled={busy} onClick={()=>void logout()}>退出 / 换人</button></>:<p>当前入口允许开放提报，资料由操作员核对后才下单。</p>}{error&&<p role="alert" className={styles.error}>{error}</p>}{loadFailed&&!requireVerification&&<button type="button" onClick={()=>void retry()}>重新读取资料</button>}</section>
  <section className={styles.card} aria-label="我的寄件资料"><h2>我的寄件资料</h2><p>{verified?'姓名、联系电话、寄件单位和部门由企业资料确定；可填写或更新揽收地址。':'粘贴寄方信息后核对，提交后由操作员确认。'}</p><form onSubmit={save}><fieldset className={styles.fields} disabled={busy}>
   <label>粘贴寄方信息<textarea aria-label="寄方地址文本" rows={3} value={senderText} onChange={e=>setSenderText(e.target.value)} placeholder="粘贴揽收地址，或姓名、电话和完整地址"/></label><button type="button" disabled={!senderText.trim()} onClick={()=>{const parsed=parseAddress(senderText);setDraftDirty(true);setSender(verified?{...parsed.contact,name:sender.name,phone:sender.phone}:parsed.contact);setNotice(parsed.warnings.filter(w=>!verified||!/(联系电话|联系人姓名)/.test(w)).join('；'))}}>解析寄方信息</button>
   <div className={styles.grid2}>{(['name','phone','province','city','county','address'] as const).map((field,index)=><label key={field}>{['寄件人姓名','寄件人联系电话','寄件省份','寄件城市','寄件区县','详细寄件地址'][index]}<input required disabled={verified&&(field==='name'||field==='phone')} value={sender[field]} onChange={e=>{if(verified&&(field==='name'||field==='phone'))return;setDraftDirty(true);setSender(s=>({...s,[field]:e.target.value}))}}/></label>)}</div>
   {verified&&<label>寄件单位<input disabled value={employee?.companyName||''}/></label>}
   {(verified||rules.team.enabled)&&<label>所属团队{!verified&&rules.teamOptions.length?<select required={rules.team.required} value={team} onChange={e=>setTeam(e.target.value)}><option value="">请选择所属团队</option>{rules.teamOptions.map(name=><option key={name}>{name}</option>)}</select>:<input disabled={verified} required={teamRule.required} maxLength={80} value={team} onChange={e=>setTeam(e.target.value)}/>}</label>}
   {employee?.phoneSource==='unavailable'&&<p>身份已验证，但寄件电话需管理员补齐或配置预置号码；已有工单仍可查询。</p>}
   {employee?.phoneSource==='preset'&&<p>联系电话使用管理员预置号码，供快递联系；身份仍以企业微信账号为准。</p>}
   {employee?<button type="submit">保存揽收地址</button>:<label><input type="checkbox" checked={remember} onChange={e=>{setRemember(e.target.checked);if(!e.target.checked)try{localStorage.removeItem('shipping-anonymous-sender-v1')}catch{/* optional storage */}}}/>在本设备记住寄件资料（公共设备请勿勾选）</label>}
  </fieldset></form>{notice&&<p role="status">{notice}</p>}</section>
  {employee&&<details className={styles.card}><summary>我的提报记录</summary><MyWorkorders key={employee.id}/></details>}
 </>
 return children({employee,controls,canSubmit:!loading&&!busy&&(!requireVerification||Boolean(employee)&&!loadFailed)&&senderCheck.success&&teamCheck.success,unavailableReason,sessionKey,sender,team})
}
