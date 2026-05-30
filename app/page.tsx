import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import Link from 'next/link'

export default function HomePage() {
  return (
    <div className="p-8">
      <h1 className="text-2xl font-bold mb-6">工作台</h1>

      {/* 待办统计 */}
      <div className="grid grid-cols-4 gap-4 mb-8">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-slate-500">
              待审核合同
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">3</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-slate-500">
              待审批报价
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">5</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-slate-500">
              本月报价
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">12</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-slate-500">
              本月合同
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">8</div>
          </CardContent>
        </Card>
      </div>

      {/* 快捷入口 */}
      <div className="mb-8">
        <h2 className="text-lg font-semibold mb-4">快捷入口</h2>
        <div className="flex gap-4">
          <Link href="/quotes/new">
            <Button size="lg">+ 新建报价</Button>
          </Link>
          <Link href="/contracts/new">
            <Button variant="outline" size="lg">上传合同</Button>
          </Link>
        </div>
      </div>

      {/* 最近访问 */}
      <div>
        <h2 className="text-lg font-semibold mb-4">最近访问</h2>
        <div className="space-y-2">
          <div className="flex items-center justify-between p-3 bg-white rounded-lg border">
            <div>
              <div className="font-medium">QT-20240524-0001</div>
              <div className="text-sm text-slate-500">XX银行 - ¥50,000</div>
            </div>
            <Badge>草稿</Badge>
          </div>
          <div className="flex items-center justify-between p-3 bg-white rounded-lg border">
            <div>
              <div className="font-medium">CT-20240523-0001</div>
              <div className="text-sm text-slate-500">XX科技 - 审核完成</div>
            </div>
            <Badge variant="secondary">审核完成</Badge>
          </div>
        </div>
      </div>
    </div>
  )
}
