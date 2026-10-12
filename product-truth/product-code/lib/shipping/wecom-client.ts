import { normalizeWecomDirectory } from './wecom-directory'
import { ShippingError } from './config'
export type WecomCredentials = { corpId: string; agentId: number; secret: string }
type Reply = { errcode?: number; errmsg?: string; [key: string]: unknown }
async function call(path: string, query: Record<string,string>, body?: unknown): Promise<Reply> {
  const url = new URL(`https://qyapi.weixin.qq.com/cgi-bin/${path}`)
  for (const [key,value] of Object.entries(query)) url.searchParams.set(key,value)
  let response: Response
  try { response = await fetch(url, { method: body ? 'POST' : 'GET', ...(body ? { headers: { 'Content-Type':'application/json' }, body: JSON.stringify(body) } : {}), cache:'no-store', redirect:'error', signal: AbortSignal.timeout(15000) }) }
  catch { throw new ShippingError(503,'企微接口暂时无法连接，请稍后重试。') }
  let data: Reply
  try { data = await response.json() } catch { throw new ShippingError(503,'企微返回了无法识别的响应。') }
  if (!response.ok || data.errcode !== 0) throw new ShippingError(502,`企微接口拒绝请求（${data.errcode ?? response.status}）。${data.errcode === 60020 ? '请检查应用的可信IP配置。' : ''}`)
  return data
}
export async function wecomToken(credentials: WecomCredentials) {
  const data = await call('gettoken',{ corpid:credentials.corpId,corpsecret:credentials.secret })
  if (typeof data.access_token !== 'string' || !data.access_token) throw new ShippingError(503,'企微没有返回访问令牌。')
  return data.access_token
}
export async function inspectWecomApplication(credentials: WecomCredentials) {
  const access_token = await wecomToken(credentials)
  const app = await call('agent/get',{access_token,agentid:String(credentials.agentId)})
  if (Number(app.agentid)!==credentials.agentId) throw new ShippingError(502,'企微应用信息不匹配。')
  return { appName: typeof app.name==='string'?app.name:'', redirectDomain:typeof app.redirect_domain==='string'?app.redirect_domain:'' }
}
export async function wecomDirectory(credentials: WecomCredentials) {
  const access_token=await wecomToken(credentials)
  const [departments,members]=await Promise.all([call('department/list',{access_token}),call('user/list',{access_token,department_id:'1',fetch_child:'1'})])
  if (!Array.isArray(departments.department) || !Array.isArray(members.userlist)) throw new ShippingError(502,'企微通讯录响应不完整，现有白名单保持不变。')
  return normalizeWecomDirectory(departments.department, members.userlist)
}
export async function wecomIdentity(credentials: WecomCredentials,code: string) {
  const access_token=await wecomToken(credentials)
  const result=await call('auth/getuserinfo',{access_token,code})
  const userId=result.UserId ?? result.userid
  if (typeof userId!=='string' || !userId) throw new ShippingError(403,'当前访问者不是本企业可授权成员。')
  return userId
}
export async function sendWecomMessage(credentials: WecomCredentials,userId: string,content: string) {
  if (!userId || userId==='@all' || userId.includes('|')) throw new ShippingError(400,'请指定一位已绑定的员工。')
  const access_token=await wecomToken(credentials)
  const result=await call('message/send',{access_token},{touser:userId,agentid:credentials.agentId,msgtype:'markdown',markdown:{content},enable_duplicate_check:1,duplicate_check_interval:1800})
  if (result.invaliduser || result.unlicenseduser) throw new ShippingError(502,'目标员工不在应用的可发送范围。')
  return { messageId:typeof result.msgid==='string'?result.msgid:'' }
}
// Robot creators who are not super admins receive encrypted member IDs.
// Official mapping: document/path/101521; only this application's visible users.
export async function resolveWecomBotUserId(credentials: WecomCredentials, openUserId: string) {
  const access_token=await wecomToken(credentials)
  const result=await call('batch/openuserid_to_userid',{access_token},{open_userid_list:[openUserId]})
  if(!Array.isArray(result.userid_list))throw new ShippingError(502,'企微机器人身份映射暂不可用。')
  const item=result.userid_list.find((value:unknown)=>value&&typeof value==='object'&&(value as Record<string,unknown>).open_userid===openUserId)
  return item&&typeof item.userid==='string'?item.userid:null
}
