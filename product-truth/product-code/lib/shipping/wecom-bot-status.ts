export function wecomBotConnectionLabel(bot:{status:string;verified_at:string|null},now=Date.now()) {
 if(bot.status==='disabled')return '已停用'
 const heartbeat=Date.parse(bot.verified_at||'')
 if(bot.status==='active'&&Number.isFinite(heartbeat)&&heartbeat<=now&&now-heartbeat<150000)return '接收服务在线 · 最近心跳正常'
 if(bot.verified_at)return '接收服务离线或心跳过期 · 请检查运行服务'
 return '凭据已保存 · 尚未确认在线'
}
