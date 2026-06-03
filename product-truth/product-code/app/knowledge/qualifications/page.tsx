// F017 商务资质库 - 列表页

import { supabaseAdmin } from '@/lib/supabase'
import {
  QUAL_TYPE_LABEL,
  QUAL_TYPE_COLOR,
  isExpiringSoon,
  isExpired,
  type BusinessQualification,
} from '@/lib/business-qualifications/types'
import { Card, CardContent } from '@/components/ui/card'

export const dynamic = 'force-dynamic'

export default async function QualificationsPage() {
  const { data: records } = await supabaseAdmin
    .from('business_qualifications')
    .select('*')
    .order('expires_at', { ascending: true })

  const quals = (records as BusinessQualification[] | null) || []

  // 统计
  const expiringCount = quals.filter((q) => isExpiringSoon(q.expires_at)).length
  const expiredCount = quals.filter((q) => isExpired(q.expires_at)).length

  return (
    <div className="p-6 lg:p-8 max-w-6xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl lg:text-3xl font-bold text-slate-900 mb-1">商务资质</h1>
        <p className="text-sm text-slate-500">管理企业资质、人员资质、业绩证明与合作伙伴资料</p>
      </div>

      {(expiringCount > 0 || expiredCount > 0) && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
          {expiredCount > 0 && (
            <div className="rounded-md border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">
              ⚠️ <strong>{expiredCount}</strong> 项资质已过期，禁止用于投标
            </div>
          )}
          {expiringCount > 0 && (
            <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
              🔔 <strong>{expiringCount}</strong> 项资质将在 30 天内到期
            </div>
          )}
        </div>
      )}

      {quals.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-slate-500">
            还没有资质记录。可通过 API 添加。
          </CardContent>
        </Card>
      ) : (
        <div className="rounded-lg border bg-white overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50">
              <tr>
                <th className="text-left px-4 py-3 font-medium text-slate-700">名称</th>
                <th className="text-left px-4 py-3 font-medium text-slate-700">类型</th>
                <th className="text-left px-4 py-3 font-medium text-slate-700">编号</th>
                <th className="text-left px-4 py-3 font-medium text-slate-700">颁发</th>
                <th className="text-left px-4 py-3 font-medium text-slate-700">到期</th>
                <th className="text-left px-4 py-3 font-medium text-slate-700">状态</th>
              </tr>
            </thead>
            <tbody>
              {quals.map((q) => {
                const expired = isExpired(q.expires_at)
                const expSoon = isExpiringSoon(q.expires_at)
                return (
                  <tr key={q.id} className="border-t border-slate-100">
                    <td className="px-4 py-3 text-slate-900">{q.title}</td>
                    <td className="px-4 py-3">
                      <span
                        className={`text-xs px-2 py-0.5 rounded-full ${
                          QUAL_TYPE_COLOR[q.qual_type as keyof typeof QUAL_TYPE_COLOR]
                        }`}
                      >
                        {QUAL_TYPE_LABEL[q.qual_type as keyof typeof QUAL_TYPE_LABEL]}
                      </span>
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-slate-700">
                      {q.cert_no || '—'}
                    </td>
                    <td className="px-4 py-3 text-slate-700">{q.issuer || '—'}</td>
                    <td className="px-4 py-3 text-slate-700">
                      {q.expires_at || '长期'}
                    </td>
                    <td className="px-4 py-3">
                      {expired ? (
                        <span className="text-xs px-2 py-0.5 rounded-full bg-rose-100 text-rose-700">
                          已过期
                        </span>
                      ) : expSoon ? (
                        <span className="text-xs px-2 py-0.5 rounded-full bg-amber-100 text-amber-700">
                          即将到期
                        </span>
                      ) : (
                        <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700">
                          有效
                        </span>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
