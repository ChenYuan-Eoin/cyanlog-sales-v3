export default function Home() {
  return (
    <main className="min-h-screen bg-slate-50 text-slate-950">
      <div className="mx-auto flex max-w-7xl flex-col gap-8 px-6 py-10 lg:px-8">
        <header className="flex flex-col gap-4 border-b border-slate-200 pb-6 md:flex-row md:items-end md:justify-between">
          <div className="space-y-3">
            <div className="inline-flex w-fit items-center rounded-md border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-700">
              cyanlog-sales-v3
            </div>
            <div className="space-y-1">
              <h1 className="text-3xl font-semibold tracking-tight">销售报价工作台</h1>
              <p className="max-w-2xl text-sm text-slate-600">
                本地开发环境已初始化，下一步可直接接入 Supabase、Vercel 与 GitHub 发布流程。
              </p>
            </div>
          </div>
          <div className="flex gap-3">
            <button className="inline-flex h-10 items-center justify-center rounded-md bg-slate-900 px-4 text-sm font-medium text-white">
              新建报价
            </button>
            <button className="inline-flex h-10 items-center justify-center rounded-md border border-slate-200 bg-white px-4 text-sm font-medium text-slate-700">
              导入文档
            </button>
          </div>
        </header>

        <section className="grid gap-6 lg:grid-cols-[1.4fr_0.8fr]">
          <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="space-y-1">
              <h2 className="text-base font-semibold text-slate-900">客户询盘</h2>
              <p className="text-sm text-slate-600">用于验证基础布局、表单样式和开发服务链路是否正常。</p>
            </div>
            <div className="mt-6 grid gap-6">
              <div className="grid gap-3">
                <div className="grid grid-cols-3 rounded-lg bg-slate-100 p-1 text-sm">
                  <div className="rounded-md bg-white px-3 py-2 text-center font-medium text-slate-900 shadow-sm">线索</div>
                  <div className="px-3 py-2 text-center text-slate-500">报价</div>
                  <div className="px-3 py-2 text-center text-slate-500">备注</div>
                </div>
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                <input className="h-10 rounded-md border border-slate-200 px-3 text-sm outline-none ring-0" placeholder="客户名称" />
                <input className="h-10 rounded-md border border-slate-200 px-3 text-sm outline-none ring-0" placeholder="联系人 / 邮箱" />
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                <input className="h-10 rounded-md border border-slate-200 px-3 text-sm outline-none ring-0" placeholder="国家 / 区域" />
                <input className="h-10 rounded-md border border-slate-200 px-3 text-sm outline-none ring-0" placeholder="产品型号" />
              </div>
              <textarea
                className="min-h-36 rounded-md border border-slate-200 px-3 py-2 text-sm outline-none ring-0"
                placeholder="记录客户需求、交付说明、价格假设与风险提示"
              />
            </div>
          </section>

          <div className="grid gap-6">
            <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
              <div className="space-y-1">
                <h2 className="text-base font-semibold text-slate-900">环境状态</h2>
                <p className="text-sm text-slate-600">便于核对部署前置项。</p>
              </div>
              <div className="mt-5 space-y-3 text-sm text-slate-600">
                <div className="flex items-center justify-between">
                  <span>Next.js 应用</span>
                  <span className="rounded-md bg-slate-900 px-2 py-1 text-xs font-medium text-white">Ready</span>
                </div>
                <div className="flex items-center justify-between">
                  <span>基础页面</span>
                  <span className="rounded-md bg-slate-900 px-2 py-1 text-xs font-medium text-white">Ready</span>
                </div>
                <div className="flex items-center justify-between">
                  <span>Supabase 环境变量</span>
                  <span className="rounded-md border border-slate-200 bg-white px-2 py-1 text-xs font-medium text-slate-700">Ready</span>
                </div>
                <div className="flex items-center justify-between">
                  <span>Vercel 绑定</span>
                  <span className="rounded-md border border-slate-200 bg-white px-2 py-1 text-xs font-medium text-slate-700">Pending</span>
                </div>
              </div>
            </section>

            <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
              <div className="space-y-1">
                <h2 className="text-base font-semibold text-slate-900">下一步</h2>
                <p className="text-sm text-slate-600">完成账号绑定后可直接部署。</p>
              </div>
              <div className="mt-5 space-y-3 text-sm text-slate-600">
                <p>1. 选择或新建 Supabase 项目并写入 `.env.local`。</p>
                <p>2. 初始化 Git 仓库并推送到 GitHub。</p>
                <p>3. 登录 Vercel，导入仓库并同步环境变量。</p>
              </div>
            </section>
          </div>
        </section>
      </div>
    </main>
  );
}
