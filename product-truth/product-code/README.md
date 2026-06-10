# Cyanlog Sales V3

生产验收地址：`https://sales.cyanlog.icu/`

## 当前范围

- 组织级鉴权与路由拦截
- 配置中心：价盘、合同规则、模型配置
- 报价中心：结构化报价、阶梯价自动算价
- 合同中心：上传、审核、导出

## 环境变量

本地只维护 `.env.local`，生产以 Vercel 环境变量为准。

必需变量：

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`

检查方式：

```bash
npm run env:check
vercel env ls production
```

本地同步生产环境推荐用：

```bash
vercel env pull .vercel/.env.development.local
```

不要把真实密钥写进仓库文件、截图或文档。`.env.local` 和 `.vercel` 已在 `.gitignore` 中排除。

## 常用命令

```bash
npm run env:check
npm run test:run
npm run build
npm run db:seed
```

## 生产排查顺序

1. `vercel inspect <deployment-url>`
2. `vercel logs <deployment-url>`
3. `npm run env:check`
4. 检查 `sales.cyanlog.icu` 的真实接口响应，不先相信本地缓存或浏览器插件报错

## 已知运维约束

- `auth_tokens` 是服务端托管表，生产必须只允许服务端访问
- 中间件依赖 `SUPABASE_SERVICE_ROLE_KEY`，不能回退到匿名 key
- 线上是否“挂了”，先用 `curl -I https://sales.cyanlog.icu` 和 `vercel inspect` 交叉确认
