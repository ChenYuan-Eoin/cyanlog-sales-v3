import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { HomeIcon, ArrowLeftIcon } from 'lucide-react'

export default function NotFoundPage() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-slate-50 px-4">
      <div className="text-center">
        {/* 404 数字 */}
        <h1 className="text-9xl font-bold tracking-tight text-slate-200">404</h1>

        {/* 错误信息 */}
        <div className="mt-4">
          <h2 className="text-2xl font-semibold text-slate-900">页面未找到</h2>
          <p className="mt-2 text-slate-600">
            抱歉，您访问的页面不存在或已被移除
          </p>
        </div>

        {/* 操作按钮 */}
        <div className="mt-8 flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
          <Button
            variant="outline"
            onClick={() => window.history.back()}
            className="w-full sm:w-auto"
          >
            <ArrowLeftIcon className="mr-2 h-4 w-4" />
            返回上一页
          </Button>
          <Link
            href="/"
            className="inline-flex h-10 items-center justify-center rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-slate-800 w-full sm:w-auto"
          >
            <HomeIcon className="mr-2 h-4 w-4" />
            回到首页
          </Link>
        </div>
      </div>

      {/* 帮助链接 */}
      <div className="mt-12 text-sm text-slate-500">
        遇到问题？请联系管理员或
        <Link href="/" className="ml-1 text-blue-600 hover:text-blue-700">
          查看帮助文档
        </Link>
      </div>
    </div>
  )
}
