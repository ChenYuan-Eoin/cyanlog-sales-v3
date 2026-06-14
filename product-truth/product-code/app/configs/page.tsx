// configs/page.tsx - Server Component Shell
// 静态渲染骨架，TTFB < 200ms；数据在客户端按需加载

import ConfigsClient from './ConfigsClient'

export default function ConfigsPage() {
  return <ConfigsClient />
}
