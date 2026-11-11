'use client'

import { useState } from 'react'
import Link from 'next/link'
import { logoutClientSession } from '@/lib/session-client'

export default function PendingAccessPage() {
  const [signingOut, setSigningOut] = useState(false)

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
      <section className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
        <h1 className="text-xl font-semibold text-slate-900">纷享登录成功</h1>
        <p className="mt-3 text-sm leading-6 text-slate-600">
          你的纷享身份已关联到 ICU。当前尚未分配 ICU 业务角色，因此暂时不能查看或操作业务数据。
          请联系组织管理员分配权限。
        </p>
        <div className="mt-6 flex flex-wrap gap-3">
          <Link className="rounded-lg bg-slate-900 px-4 py-2 text-sm text-white" href="/">
            重新检查权限
          </Link>
          <button
            type="button"
            disabled={signingOut}
            className="rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-700 disabled:opacity-50"
            onClick={async () => {
              setSigningOut(true)
              await logoutClientSession()
              window.location.assign('/login')
            }}
          >
            {signingOut ? '正在退出…' : '退出登录'}
          </button>
        </div>
      </section>
    </main>
  )
}
