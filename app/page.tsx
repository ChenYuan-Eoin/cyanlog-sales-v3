import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";

export default function Home() {
  return (
    <main className="min-h-screen bg-slate-50 text-slate-950">
      <div className="mx-auto flex max-w-7xl flex-col gap-8 px-6 py-10 lg:px-8">
        <header className="flex flex-col gap-4 border-b border-slate-200 pb-6 md:flex-row md:items-end md:justify-between">
          <div className="space-y-3">
            <Badge variant="secondary">cyanlog-sales-v3</Badge>
            <div className="space-y-1">
              <h1 className="text-3xl font-semibold tracking-tight">销售报价工作台</h1>
              <p className="max-w-2xl text-sm text-slate-600">
                本地开发环境已初始化，下一步可直接接入 Supabase、Vercel 与 GitHub 发布流程。
              </p>
            </div>
          </div>
          <div className="flex gap-3">
            <Button>新建报价</Button>
            <Button variant="outline">导入文档</Button>
          </div>
        </header>

        <section className="grid gap-6 lg:grid-cols-[1.4fr_0.8fr]">
          <Card className="border-slate-200 shadow-sm">
            <CardHeader>
              <CardTitle>客户询盘</CardTitle>
              <CardDescription>用于验证 shadcn、表单组件与基础布局是否正常。</CardDescription>
            </CardHeader>
            <CardContent>
              <Tabs defaultValue="lead" className="w-full">
                <TabsList className="grid w-full grid-cols-3">
                  <TabsTrigger value="lead">线索</TabsTrigger>
                  <TabsTrigger value="quote">报价</TabsTrigger>
                  <TabsTrigger value="notes">备注</TabsTrigger>
                </TabsList>
                <TabsContent value="lead" className="mt-6 space-y-4">
                  <div className="grid gap-4 md:grid-cols-2">
                    <Input placeholder="客户名称" />
                    <Input placeholder="联系人 / 邮箱" />
                  </div>
                  <div className="grid gap-4 md:grid-cols-2">
                    <Input placeholder="国家 / 区域" />
                    <Input placeholder="产品型号" />
                  </div>
                </TabsContent>
                <TabsContent value="quote" className="mt-6 space-y-4">
                  <div className="grid gap-4 md:grid-cols-3">
                    <Input placeholder="币种" />
                    <Input placeholder="目标毛利率" />
                    <Input placeholder="付款条件" />
                  </div>
                  <Textarea placeholder="报价条款、包装要求、交付说明" className="min-h-32" />
                </TabsContent>
                <TabsContent value="notes" className="mt-6">
                  <Textarea placeholder="记录客户沟通、风险提示、审批备注" className="min-h-40" />
                </TabsContent>
              </Tabs>
            </CardContent>
          </Card>

          <div className="grid gap-6">
            <Card className="border-slate-200 shadow-sm">
              <CardHeader>
                <CardTitle>环境状态</CardTitle>
                <CardDescription>便于核对部署前置项。</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3 text-sm text-slate-600">
                <div className="flex items-center justify-between">
                  <span>Next.js 应用</span>
                  <Badge>Ready</Badge>
                </div>
                <div className="flex items-center justify-between">
                  <span>shadcn/ui</span>
                  <Badge>Ready</Badge>
                </div>
                <div className="flex items-center justify-between">
                  <span>Supabase 环境变量</span>
                  <Badge variant="outline">Pending</Badge>
                </div>
                <div className="flex items-center justify-between">
                  <span>Vercel 绑定</span>
                  <Badge variant="outline">Pending</Badge>
                </div>
              </CardContent>
            </Card>

            <Card className="border-slate-200 shadow-sm">
              <CardHeader>
                <CardTitle>下一步</CardTitle>
                <CardDescription>完成账号绑定后可直接部署。</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3 text-sm text-slate-600">
                <p>1. 选择或新建 Supabase 项目并写入 `.env.local`。</p>
                <p>2. 初始化 Git 仓库并推送到 GitHub。</p>
                <p>3. 登录 Vercel，导入仓库并同步环境变量。</p>
              </CardContent>
            </Card>
          </div>
        </section>
      </div>
    </main>
  );
}
