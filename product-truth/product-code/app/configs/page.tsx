/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires */
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'

export default function ConfigsPage() {
  const localModelUrl = process.env.LOCAL_MODEL_URL || '未配置'
  const cloudModelName = process.env.CLOUD_MODEL_NAME || '未配置'

  return (
    <div className="p-8">
      <h1 className="text-2xl font-bold mb-6">配置中心</h1>

      <Tabs defaultValue="rules">
        <TabsList>
          <TabsTrigger value="rules">合同审核规则</TabsTrigger>
          <TabsTrigger value="tax">税率规则</TabsTrigger>
          <TabsTrigger value="approval">审批权限</TabsTrigger>
          <TabsTrigger value="ai">AI配置</TabsTrigger>
        </TabsList>

        <TabsContent value="rules" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle>合同审核规则</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <div className="flex items-center justify-between p-4 bg-slate-50 rounded-lg">
                  <div>
                    <div className="font-medium">付款账期检查</div>
                    <div className="text-sm text-slate-500">账期超过90天触发红灯</div>
                  </div>
                  <Button variant="outline" size="sm">编辑</Button>
                </div>
                <div className="flex items-center justify-between p-4 bg-slate-50 rounded-lg">
                  <div>
                    <div className="font-medium">违约金比例检查</div>
                    <div className="text-sm text-slate-500">违约金超过5%触发黄灯</div>
                  </div>
                  <Button variant="outline" size="sm">编辑</Button>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="tax" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle>税率规则</CardTitle>
            </CardHeader>
            <CardContent>
              <table className="w-full">
                <thead>
                  <tr className="border-b text-sm text-slate-500">
                    <th className="text-left py-3 px-4">地区</th>
                    <th className="text-left py-3 px-4">商品类型</th>
                    <th className="text-left py-3 px-4">税率</th>
                    <th className="text-left py-3 px-4">操作</th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="border-b">
                    <td className="py-3 px-4">中国大陆</td>
                    <td className="py-3 px-4">软件服务</td>
                    <td className="py-3 px-4">6%</td>
                    <td className="py-3 px-4">
                      <Button variant="outline" size="sm">编辑</Button>
                    </td>
                  </tr>
                </tbody>
              </table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="approval" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle>审批权限配置</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <div className="flex items-center justify-between p-4 bg-slate-50 rounded-lg">
                  <div>
                    <div className="font-medium">销售</div>
                    <div className="text-sm text-slate-500">最大折扣率: 5%</div>
                  </div>
                  <Button variant="outline" size="sm">编辑</Button>
                </div>
                <div className="flex items-center justify-between p-4 bg-slate-50 rounded-lg">
                  <div>
                    <div className="font-medium">销售经理</div>
                    <div className="text-sm text-slate-500">最大折扣率: 10%</div>
                  </div>
                  <Button variant="outline" size="sm">编辑</Button>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="ai" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle>AI模型配置</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <div className="flex items-center justify-between p-4 bg-slate-50 rounded-lg">
                  <div>
                    <div className="font-medium">本地模型</div>
                    <div className="text-sm text-slate-500">{localModelUrl}</div>
                  </div>
                  <Button variant="outline" size="sm">测试连接</Button>
                </div>
                <div className="flex items-center justify-between p-4 bg-slate-50 rounded-lg">
                  <div>
                    <div className="font-medium">云端备用</div>
                    <div className="text-sm text-slate-500">{cloudModelName}</div>
                  </div>
                  <Button variant="outline" size="sm">配置</Button>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  )
}
