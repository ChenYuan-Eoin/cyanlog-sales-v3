import { NextResponse } from 'next/server'
export const runtime='nodejs'
function retired(){return NextResponse.json({error:'SMTP邮箱验证已停用，请在下单权限中心配置企业微信。'},{status:410,headers:{'Cache-Control':'no-store'}})}
export const GET=retired
export const POST=retired
