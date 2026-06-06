# ADR-009: Supabase Storage文件存储

## 状态
已采纳 (2026-05-21)

## 背景 (Context)

销售管理系统需要存储多种文件：

1. **文件类型**：
   - 合同PDF/Word（最大50MB）
   - 招标文件扫描件
   - 头像、Logo
   - 生成的审核报告Word/PDF

2. **访问模式**：
   - 上传：浏览器直接上传或经服务端转发
   - 下载：经服务端鉴权后返回URL
   - 预览：图片直接展示，PDF在线预览
   - 私有访问：仅指定用户可访问

3. **集成约束**：
   - 已有Supabase依赖
   - Vercel部署，不适合持久化文件系统
   - 国内访问速度要求

## 决策 (Decision)

采用**Supabase Storage + RLS Bucket策略**：

### Bucket设计
| Bucket | 用途 | 访问策略 | 大小限制 |
|--------|------|----------|----------|
| `contracts` | 合同文件 | 私有+RLS | 50MB |
| `tenders` | 招标文件 | 私有+RLS | 50MB |
| `avatars` | 头像 | 公开+CDN | 2MB |
| `exports` | 生成的报告 | 私有+短期签名URL | 20MB |
| `public` | 公开素材 | 公开 | 5MB |

### 访问模式
```typescript
// 1. 上传（服务端转发）
const { data, error } = await supabaseAdmin.storage
  .from('contracts')
  .upload(`contracts/${id}/${filename}`, file, {
    contentType: file.type,
    cacheControl: '3600',
    upsert: false,
  })

// 2. 下载（经服务端鉴权）
const { data } = await supabaseAdmin.storage
  .from('contracts')
  .createSignedUrl(path, 3600) // 1小时签名URL

// 3. 公开文件直接URL
const { data } = supabase.storage
  .from('avatars')
  .getPublicUrl(path)
```

### 关键约束
- 单文件限制：50MB
- 支持格式：PDF, Word, JPG, PNG
- 文件名：`UUID/sanitized-name`避免冲突
- 病毒扫描：上传时调用ClamAV异步扫描

## 影响 (Consequences)

### 正面影响
- ✅ **零运维**：Supabase托管
- ✅ **与DB集成**：可与PostgreSQL事务
- ✅ **CDN支持**：Supabase CDN加速
- ✅ **签名URL**：支持临时访问
- ✅ **RLS策略**：声明式权限

### 负面影响
- ⚠️ **供应商锁定**：迁移到S3需要适配
- ⚠️ **网络依赖**：上传下载走外网
- ⚠️ **大文件成本**：50MB×1000用户=50GB

## 备选方案 (Alternatives Considered)

### 备选A：AWS S3
- 行业标准
- 但**增加AWS账号依赖**
- 国内访问速度慢
- 需自己管理权限
- **否决原因**：Supabase已提供等效能力

### 备选B：Vercel Blob
- 与Vercel集成好
- 但**额外费用**
- 缺少与PostgreSQL的事务集成
- **否决原因**：功能重叠

### 备选C：自建MinIO
- 完全控制
- 但**自运维负担**
- 备份/扩容/监控都需要
- **否决原因**：增加运维成本

### 备选D：本地文件系统
- 简单
- 但**Vercel无持久化存储**
- 容器重启文件丢失
- **否决原因**：不可行

## 实施细节 (Implementation)

### 文件命名规范
```typescript
function generateFilePath(userId: string, originalName: string) {
  const fileId = uuidv4()
  const safeName = sanitizeFileName(originalName)
  return `${userId}/${fileId}/${safeName}`
}
```

### 病毒扫描流程
```typescript
// 上传后触发扫描
async function scanFile(bucket: string, path: string) {
  const { data } = await supabaseAdmin.storage.from(bucket).download(path)
  const scanResult = await clamscan.scan(data)
  if (scanResult.infected) {
    await supabaseAdmin.storage.from(bucket).remove([path])
    throw new Error('文件包含恶意内容')
  }
}
```

### 临时URL生成
```typescript
// 生成的报告，设置1小时过期
const { data } = await supabaseAdmin.storage
  .from('exports')
  .createSignedUrl(path, 3600)
return data.signedUrl
```

## 验证标准 (Validation)

| 指标 | 目标值 |
|------|--------|
| 上传成功率 | >99% |
| 签名URL生成延迟 | <100ms |
| 存储成本 | <$50/月（10GB） |
| 恶意文件检测率 | 100% |

## 参考 (References)

- Supabase Storage文档：https://supabase.com/docs/guides/storage
- 项目代码：`app/api/contracts/route.ts`（合同上传）
- 项目代码：`app/api/contracts/[id]/export/route.ts`（报告生成）
