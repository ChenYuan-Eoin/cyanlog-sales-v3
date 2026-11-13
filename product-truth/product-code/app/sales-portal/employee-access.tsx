'use client'

import { useEffect, useRef, useState, type ReactNode, type FormEvent } from 'react'
import { ChevronDown, LogOut, MapPin, RefreshCw, ShieldCheck } from 'lucide-react'
import { contactSchema } from '@/lib/shipping/validation'
import { parseAddress } from '@/lib/shipping/address'
import { normalizeDomesticShippingPhone } from '@/lib/shipping/phone'
import { DEFAULT_INTAKE_RULES, intakeFieldSchema, type IntakeRules } from '@/lib/shipping/intake-rules'
import { emptyContact, type Contact } from '@/lib/shipping/types'
import styles from './sales-portal.module.css'

type AddressSource = 'company' | 'personal' | 'custom'
export type EmployeeProfile = { id:string;email:string;identityName?:string;identityPhone?:string;sender:Contact|null;senderChoices?:{company:Contact|null;personal:Contact|null};senderSource?:AddressSource;team:string;departmentId?:string;departments?:Array<{id:string;name:string;path:string;isPrimary:boolean}>;updatedAt:string;wecom?:boolean;fxiaoke?:boolean;companyName?:string;phoneSource?:'wecom'|'preset'|'unavailable' }
export type EmployeeAccessState = { employee:EmployeeProfile|null;controls:ReactNode;identityControls:ReactNode;canSubmit:boolean;unavailableReason:string;sessionKey:number;sender:Contact;team:string;departmentId:string }
const endpoint = '/api/shipping/public/employee'
const sourceLabels = { company:'公司默认', personal:'我的常用', custom:'本次地址' }
const addressFields = ['province','city','county','address'] as const
function sourceFor(profile:EmployeeProfile|null):AddressSource { return profile?.senderSource || (profile?.sender?.address ? 'personal' : 'custom') }
function addressText(sender:Contact) { return `${sender.province}${sender.city === sender.province ? '' : sender.city}${sender.county}${sender.address}` }
async function call(body?:unknown, target=endpoint) {
 const response = await fetch(target, { ...(body ? { method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(10000) } : { cache:'no-store',signal:AbortSignal.timeout(10000) }) })
 const data = await response.json()
 if (!response.ok) throw new Error(data.error || '员工寄件服务暂不可用')
 return data
}
export default function EmployeeAccess({ children, requireVerification=false, rules=DEFAULT_INTAKE_RULES, initialEmployee=null, companySender=null, mode='public' }: { children:(state:EmployeeAccessState)=>ReactNode;requireVerification?:boolean;emailAvailable?:boolean;rules?:IntakeRules;initialEmployee?:EmployeeProfile|null;companySender?:Contact|null;mode?:'public'|'fxiaoke' }) {
 const initialSender=initialEmployee?.sender || (!requireVerification ? companySender : null) || emptyContact()
 const [employee,setEmployee] = useState(initialEmployee), [loading,setLoading] = useState(true), [loadFailed,setLoadFailed] = useState(false), [busy,setBusy] = useState(false)
 const [error,setError] = useState(''), [notice,setNotice] = useState(''), [sessionKey,setSessionKey] = useState(0)
 const [sender,setSender] = useState<Contact>(initialSender), [team,setTeam] = useState(initialEmployee?.team || ''), [departmentId,setDepartmentId] = useState(initialEmployee?.departmentId || '')
 const [source,setSource] = useState<AddressSource>(!initialEmployee&&companySender&&!requireVerification?'company':sourceFor(initialEmployee)), [draft,setDraft] = useState<Contact>(initialSender)
 const [editing,setEditing] = useState(!contactSchema.safeParse(initialSender).success), [dirty,setDirty] = useState(false)
 const [common,setCommon] = useState<{sender:Contact;team:string}|null>(null)
 const senderTouched=useRef(false), customDraft=useRef<Contact|null>(null)
 const [senderText,setSenderText] = useState(''), [saveCommon,setSaveCommon] = useState(false), [remember,setRemember] = useState(false)
 const running = useRef(false)
 const verified = employee?.wecom === true || employee?.fxiaoke === true
 const profileEndpoint = mode === 'fxiaoke' ? '/api/shipping/owner/profile' : endpoint
 function accept(profile:EmployeeProfile|null) {
  customDraft.current=null;senderTouched.current=false
  if (employee?.id !== profile?.id) setSessionKey(value=>value+1)
  setEmployee(profile);setSender(profile?.sender || emptyContact());setDraft(profile?.sender || emptyContact());setTeam(profile?.team || '');setDepartmentId(profile?.departmentId || '')
  setSource(sourceFor(profile));setDirty(false);setEditing(!contactSchema.safeParse(profile?.sender).success);setSenderText('');setSaveCommon(false)
 }
 useEffect(()=>{
  // The public form uses self-reported sender details, never a background WeCom check.
  if (!requireVerification) { setLoading(false); return }
  let active=true
  call(undefined,profileEndpoint).then(data=>{if(!active)return;const profile=data.employee as EmployeeProfile|null;if(profile?.id!==initialEmployee?.id){customDraft.current=null;senderTouched.current=false;setSessionKey(k=>k+1);setSaveCommon(false);setDirty(false);setNotice('')}setEmployee(profile);if(profile){setSender(profile.sender || emptyContact());setDraft(profile.sender || emptyContact());setTeam(profile.team);setDepartmentId(profile.departmentId || '');setSource(sourceFor(profile));setEditing(!contactSchema.safeParse(profile.sender).success)}else if(initialEmployee){setSender(emptyContact());setDraft(emptyContact());setTeam('');setDepartmentId('');setEditing(true)}}).catch(e=>{if(active){setLoadFailed(true);setError(e.message)}}).finally(()=>{if(active)setLoading(false)})
  return()=>{active=false}
 },[initialEmployee,requireVerification,profileEndpoint])
 useEffect(()=>{if(requireVerification||initialEmployee)return;try{const saved=JSON.parse(localStorage.getItem('shipping-anonymous-sender-v1') || 'null');if(saved?.remember&&contactSchema.safeParse(saved.sender).success&&typeof saved.team==='string'){senderTouched.current=true;setCommon({sender:saved.sender,team:saved.team});setSender(saved.sender);setDraft(saved.sender);setTeam(saved.team);setSource('personal');setEditing(false)}}catch{/* optional device draft */}},[initialEmployee,requireVerification])
 useEffect(()=>{if(requireVerification||employee||senderTouched.current||!companySender)return;setSender(companySender);setDraft(companySender);setSource('company');setEditing(!contactSchema.safeParse(companySender).success)},[companySender,employee,requireVerification])
 async function retry() {
  if(running.current)return
  running.current=true;setLoading(true);setError('');setLoadFailed(false)
  try {
   const next=(await call(undefined,profileEndpoint)).employee as EmployeeProfile|null
   if(next&&next.id===employee?.id&&(dirty||editing)) {
     const identity=next.wecom?{name:next.sender?.name || '',phone:next.sender?.phone || ''}:{}
     setEmployee(next);setTeam(next.team);setDepartmentId(next.departmentId || '');setSender(current=>({...current,...identity}));setDraft(current=>({...current,...identity}));setNotice('企业资料已刷新，本次地址和未保存内容已保留。')
   } else {accept(next);setNotice('寄件资料已刷新。')}
  } catch(e) {setLoadFailed(true);setError((e as Error).message)} finally {running.current=false;setLoading(false)}
 }
 function selectAddress(next:AddressSource) {
  senderTouched.current=true
  setError('');setNotice('');setSaveCommon(false);setRemember(false)
  if(editing)customDraft.current=draft
  if(next==='custom'){setDraft(customDraft.current || sender);setEditing(true);return}
  const choice=next==='personal'?(employee?.senderChoices?.personal || (!employee?.senderChoices?employee?.sender:null) || (!employee?common?.sender:null)):(employee?.senderChoices?.company || (!employee?companySender:null))
  if(!choice)return
  const contact=employee?.wecom?{...choice,name:sender.name,phone:sender.phone}:choice
  if(!employee&&next==='personal'&&common)setTeam(common.team)
  setSource(next);setSender(contact);setDraft(contact);setDirty(true);setEditing(false)
 }
 async function apply(event:FormEvent) {
  event.preventDefault();if(running.current)return
  setError('')
  const result=contactSchema.safeParse({...draft,phone:normalizeDomesticShippingPhone(draft.phone)})
  if(!result.success){setError(result.error.issues.map(issue=>issue.message).join('；'));return}
  if(employee?.wecom&&(result.data.name!==employee.sender?.name||result.data.phone!==employee.sender?.phone)){setError('寄件身份已变化，请刷新企业资料后重试。');return}
  if(employee&&saveCommon) {
   running.current=true;setBusy(true)
   try {const next=(await call({action:'save_profile',profile:{sender:result.data,team,departmentId:mode==='fxiaoke'?departmentId:undefined,expectedUpdatedAt:employee.updatedAt}},profileEndpoint)).employee as EmployeeProfile|null;if(!next)throw new Error('身份已失效，请重新验证后保存。');accept(next);setNotice('揽收地址已保存为我的常用地址，下次自动带入。')}catch(e){setError((e as Error).message)}finally{running.current=false;setBusy(false)}
  } else {
   senderTouched.current=true;customDraft.current=result.data
   setSender(result.data);setSource('custom');setDirty(true);setEditing(false);setNotice('已使用本次揽收地址。')
   if(!employee&&remember){
    try{localStorage.setItem('shipping-anonymous-sender-v1',JSON.stringify({remember:true,sender:result.data,team}));setCommon({sender:result.data,team});setSource('personal');setNotice('已保存为本设备的常用地址，下次自动带入。')}
    catch{setNotice('本次地址已使用，但浏览器未能保存常用地址。')}
    setRemember(false)
   }
  }
 }
 async function logout() {
  if(running.current)return
  running.current=true;setBusy(true);setError('')
  try {await call({action:'logout'},profileEndpoint);accept(null);setNotice('');setRemember(false);try{localStorage.removeItem('shipping-anonymous-sender-v1')}catch{/* optional storage */}}catch(e){setError((e as Error).message)}finally{running.current=false;setBusy(false)}
 }
 function forgetCommon() {
  try{localStorage.removeItem('shipping-anonymous-sender-v1');setCommon(null);setRemember(false);if(source==='personal')setSource('custom');setNotice('本设备常用地址已移除，本次寄件资料保留。')}
  catch{setError('本设备常用地址未能移除，请稍后重试。')}
 }
 if(requireVerification&&!employee)return <main className={styles.page}><section className={`${styles.card} ${styles.loginCard}`}><ShieldCheck size={28}/><h1>{mode==='fxiaoke'?(loading?'正在核对纷享身份…':'需要重新登录纷享销客'):(loading?'正在验证企业微信身份…':'需要企业微信授权身份')}</h1>{error&&<p role="alert" className={styles.error}>{error}</p>}{!loading&&<><a className={styles.primaryButton} href={mode==='fxiaoke'?'/login':'/api/shipping/public/wecom/authorize'}>{mode==='fxiaoke'?'前往登录':'使用企业微信验证身份'}</a><button className={styles.secondaryButton} type="button" onClick={()=>void retry()}>重新读取资料</button></>}</section></main>
 const teamRule=employee?.wecom?{enabled:true,required:true,minLength:1}:rules.team
 const teamCheck=intakeFieldSchema(teamRule,'所属团队',80,employee?.wecom?[]:rules.teamOptions).safeParse(team)
 const selectedDepartment=mode==='fxiaoke'?employee?.departments?.find(item=>item.id===departmentId):undefined
 const senderCheck=contactSchema.safeParse({...sender,phone:normalizeDomesticShippingPhone(sender.phone)})
 const unavailableReason=loading?'正在读取寄件资料…':busy?'正在处理寄件资料…':editing?'请使用或取消正在编辑的揽收地址。':!senderCheck.success?(verified&&employee?.phoneSource==='unavailable'?'请管理员补齐或配置预置寄件电话。':'请解析或补齐实际揽收地址和联系电话。'):mode==='fxiaoke'&&!selectedDepartment?'当前所属部门未开放提报，或部门资料已变化。本人历史工单仍可查看。':!teamCheck.success&&mode!=='fxiaoke'?(employee?.wecom?'企微部门资料暂缺，请联系管理员同步通讯录。':teamCheck.error.issues.map(e=>e.message).join('；')):''
 const accountName=employee?.fxiaoke?(employee.identityName||employee.email||'纷享员工'):sender.name
 const identityControls=<section className={styles.identityCard} aria-label="员工身份"><div className={styles.avatar} aria-hidden="true">{accountName?.slice(0,1)||'寄'}</div><div className={styles.identityBody}><div className={styles.identityHeading}><strong>{verified?accountName:'开放提报'}</strong>{verified&&<span className={styles.verifiedBadge}><ShieldCheck size={13}/>{employee?.fxiaoke?'纷享销客已连接':'企业微信身份已验证'}</span>}</div><p>{verified?(employee?.fxiaoke?[employee.email,employee.identityPhone,team].filter(Boolean).join(' · '):[employee?.companyName,employee?.team,sender.phone].filter((value,index,all)=>value&&all.indexOf(value)===index).join(' · ')):'资料由前台核对后下单'}</p></div>{employee?.wecom&&<details className={styles.accountMenu}><summary>账号<ChevronDown size={14}/></summary><div><button type="button" disabled={busy||loading} onClick={()=>void retry()}><RefreshCw size={14}/>刷新寄件资料</button><button type="button" disabled={busy||loading} onClick={()=>void logout()}><LogOut size={14}/>退出 / 换人</button></div></details>}</section>
 const personal=employee?.senderChoices?.personal || (!employee?.senderChoices?employee?.sender:null) || (!employee?common?.sender:null)
 const company=employee?.senderChoices?.company || (!employee?companySender:null)
 const controls=<section className={`${styles.card} ${styles.addressCard}`} aria-label="我的寄件资料">
  <div className={styles.sectionHeading}><h2><span className={styles.sectionNumber}>01</span>从哪里寄出</h2><span className={styles.addressBadge}>{editing?'编辑中':sourceLabels[source]}</span></div>
  <fieldset className={styles.addressChoices} disabled={busy||loading} aria-label="选择揽收地址">{(['company','personal','custom'] as const).map(choice=><label className={styles.addressChoice} key={choice}><input type="radio" name="pickup-address-source" value={choice} checked={choice==='custom'?editing||source==='custom':!editing&&source===choice} disabled={choice==='company'?!company:choice==='personal'?!personal:false} onChange={()=>selectAddress(choice)}/><span><strong>{choice==='custom'?'自定义地址':sourceLabels[choice]}</strong><small>{choice==='company'?(company?'企业统一地址':'暂不可用'):choice==='personal'?(personal?(employee?'已保存的地址':'本设备已保存'):'暂未保存'):'本次临时使用'}</small></span></label>)}</fieldset>
  {mode==='fxiaoke'&&<label>所属团队<select required value={departmentId} disabled={busy||loading||!employee?.departments?.length} onChange={e=>{const next=employee?.departments?.find(item=>item.id===e.target.value);setDepartmentId(next?.id||'');setTeam(next?.name||'')}}><option value="">{employee?.departments?.length?'请选择本人所属部门':'当前没有可提报的部门'}</option>{employee?.departments?.map(item=><option key={item.id} value={item.id}>{item.path}</option>)}</select></label>}
  {!employee&&common&&<button type="button" className={styles.textButton} disabled={busy||loading} onClick={forgetCommon}>移除本设备常用地址</button>}
  <div className={styles.addressSummary}><MapPin size={18}/><div><strong>{sender.name||'寄件人待填写'} <span>{sender.phone}</span></strong><p>{addressText(sender)||'请填写实际揽收地址'}</p></div><button className={styles.textButton} type="button" disabled={busy||loading} aria-expanded={editing} onClick={()=>{senderTouched.current=true;if(editing){setDraft(sender);setEditing(false)}else{setDraft(sender);setEditing(true)}setError('');setSaveCommon(false)}}>{editing?'收起寄方编辑':'更换揽收地址'}</button></div>
  <div hidden={!editing} className={styles.addressEditor}><form onSubmit={apply}><fieldset className={styles.fields} disabled={busy||loading}>
   <label>粘贴寄方信息<textarea aria-label="寄方地址文本" rows={2} value={senderText} onChange={e=>{senderTouched.current=true;setSenderText(e.target.value)}} placeholder="粘贴实际揽收地址"/></label><button className={styles.textButton} type="button" disabled={!senderText.trim()} onClick={()=>{const parsed=parseAddress(senderText);if(addressFields.every(field=>parsed.contact[field])){setDraft(employee?.wecom?{...parsed.contact,name:sender.name,phone:sender.phone}:parsed.contact);setNotice(parsed.warnings.filter(w=>!employee?.wecom||!/(联系电话|联系人姓名)/.test(w)).join('；'))}else{setNotice('本次未能识别完整揽收地址，现有寄方资料已保留。'+parsed.warnings.join('；'))}}}>解析寄方信息</button>
   <div className={styles.grid2}>{(['name','phone',...addressFields] as const).map((field,index)=><label key={field}>{['寄件人姓名','寄件人联系电话','寄件省份','寄件城市','寄件区县','详细寄件地址'][index]}<input required disabled={employee?.wecom&&(field==='name'||field==='phone')} value={draft[field]} onChange={e=>{if(employee?.wecom&&(field==='name'||field==='phone'))return;senderTouched.current=true;setDraft(current=>({...current,[field]:e.target.value}))}}/></label>)}</div>
   {employee?.wecom&&<label>寄件单位<input disabled value={employee?.companyName||''}/></label>}
   {mode!=='fxiaoke'&&(verified||rules.team.enabled)&&<label>所属团队{!employee?.wecom&&rules.teamOptions.length?<select required={rules.team.required} value={team} onChange={e=>{senderTouched.current=true;setTeam(e.target.value)}}><option value="">请选择所属团队</option>{rules.teamOptions.map(name=><option key={name} value={name}>{name}</option>)}</select>:<input disabled={employee?.wecom} required={teamRule.required} maxLength={80} value={team} onChange={e=>{senderTouched.current=true;setTeam(e.target.value)}}/>}</label>}
   {employee?.phoneSource==='unavailable'&&<p>身份已验证，但寄件电话需管理员补齐或配置预置号码；已有工单仍可查询。</p>}
   {employee?.phoneSource==='preset'&&<p className={styles.hint}>联系电话使用管理员预置号码，身份仍以企业微信账号为准。</p>}
   <div className={styles.addressActions}>{employee?<label className={styles.remember}><input type="checkbox" checked={saveCommon} onChange={e=>setSaveCommon(e.target.checked)}/>同时保存为我的常用地址</label>:<label className={styles.remember}><input type="checkbox" checked={remember} onChange={e=>setRemember(e.target.checked)}/>同时保存为我的常用地址（本设备）</label>}<button className={styles.secondaryButton} type="button" onClick={()=>{customDraft.current=null;setDraft(sender);setEditing(false);setError('');setSaveCommon(false);setRemember(false)}}>取消编辑</button><button className={styles.primaryButton} type="submit">{busy?'保存中…':saveCommon?'保存揽收地址':'使用此地址'}</button></div>
  </fieldset></form></div>{error&&<p role="alert" className={styles.error}>{error}</p>}{notice&&<p role="status" className={styles.notice}>{notice}</p>}{loadFailed&&!requireVerification&&<button type="button" onClick={()=>void retry()}>重新读取资料</button>}
 </section>
 return children({employee,controls,identityControls,canSubmit:!loading&&!busy&&!editing&&(!requireVerification||Boolean(employee)&&!loadFailed)&&senderCheck.success&&(mode==='fxiaoke'?Boolean(selectedDepartment):teamCheck.success),unavailableReason,sessionKey,sender,team,departmentId})
}
