# ADR-002: JWT与数据库Token双轨存储

## 状态
已采纳 (2026-05-21)

## 背景 (Context)

销售管理系统需要认证机制，核心需求：

1. **强制下线能力**：
   - 员工离职需要立即吊销其所有会话
   - 安全事件响应需要紧急冻结可疑账号
   - 单纯JWT（无状态）无法支持"立即吊销"语义

2. **Token过期管理**：
   - 长期不过期的Token是安全风险
   - 短期Token用户体验差（频繁重新登录）
   - 需要平衡安全与体验

3. **跨设备多端登录**：
   - 用户可能在PC、平板、手机同时登录
   - 需要支持单点登出（不踢其他设备）
   - 设备粒度的Token管理

4. **审计与追踪**：
   - 监管要求记录关键操作的实际执行人
   - 需要追溯"哪个Token在哪台设备执行了什么"
   - 纯JWT无法记录设备指纹和IP

## 决策 (Decision)

采用**PostgreSQL有状态Token + 无状态JWT签名**双轨方案：

```
┌──────────────────────────────────────────────────┐
│ 客户端提交 Bearer Token                            │
│     ↓                                             │
│ middleware.ts 验证流程:                            │
│   1. SELECT FROM auth_tokens WHERE token=?       │
│   2. 检查 expires_at > NOW()                      │
│   3. 检查 is_revoked = false                      │
│   4. 透传 x-user-id, x-user-roles 给下游          │
└──────────────────────────────────────────────────┘
```

### 表结构
```sql
CREATE TABLE auth_tokens (
  id UUID PRIMARY KEY,
  token TEXT NOT NULL UNIQUE,  -- 完整Token字符串
  user_id UUID NOT NULL REFERENCES users(id),
  device_fingerprint TEXT,
  ip_address INET,
  user_agent TEXT,
  expires_at TIMESTAMPTZ NOT NULL,
  is_revoked BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

### Token生命周期
| 阶段 | 时长 | 处理方式 |
|------|------|----------|
| 短期Token | 7天 | 一次性登录颁发 |
| 续签 | 7天×N | 用户活跃时自动续签 |
| 强制下线 | 即时 | UPDATE is_revoked=true WHERE user_id=? |
| 自动清理 | 30天 | 定时任务清理过期+已吊销 |

## 影响 (Consequences)

### 正面影响
- ✅ **强制下线能力**：DB标记is_rev revoked即可，下次请求立即拒绝
- ✅ **完整审计**：device/IP/UserAgent可追溯
- ✅ **多端隔离**：每个设备独立Token，独立吊销
- ✅ **过期可观测**：SQL查询实时统计活跃会话数

### 负面影响
- ⚠️ **每次请求DB查询**：增加10-20ms延迟
- ⚠️ **数据库压力**：高并发场景下auth_tokens表是热点
- ⚠️ **冷启动依赖**：DB故障 = 全部用户无法登录

## 备选方案 (Alternatives Considered)

### 备选A：纯JWT（无状态）
- 实现最简单，无DB依赖
- 但**无法强制吊销**（致命缺陷）
- 只能等Token自然过期
- **否决原因**：安全需求无法满足

### 备选B：Redis Token存储
- 内存读取，~1ms延迟
- 但增加Redis依赖
- 持久化需要AOF/RDB策略
- 集群一致性挑战
- **否决原因**：增加基础设施复杂度，与现有PostgreSQL同库部署冲突

### 备选C：JWT短期 + Refresh Token
- JWT 5分钟 + Refresh 30天
- 但需要JWT密钥管理（密钥泄露=全部Token失效）
- Refresh Token仍需存储，依然面临吊销问题
- **否决原因**：复杂度未降低，问题仍存在

### 备选D：Session Cookie
- 浏览器自动携带
- 但移动端、API集成场景Cookie管理复杂
- CSRF攻击面增加
- **否决原因**：不适合多端+第三方集成场景

## 实施细节 (Implementation)

### Token生成
```typescript
const token = randomBytes(32).toString('base64url')
// 不使用JWT，因为不需要无状态解析
// 简化服务端逻辑，统一查询数据库
```

### 吊销流程
```typescript
// 强制下线某用户所有会话
UPDATE auth_tokens
SET is_revoked = true
WHERE user_id = ? AND is_revoked = false
```

### 性能优化
- 在 `auth_tokens(token)` 上建UNIQUE INDEX
- 用户活跃会话数查询使用部分索引 `WHERE is_revoked = false`
- 定期VACUUM清理过期+已吊销记录

## 验证标准 (Validation)

| 指标 | 目标值 |
|------|--------|
| 认证查询延迟 | <20ms (P95) |
| 强制下线生效时间 | <1s |
| Token泄露应急吊销 | 100%成功 |
| 多端登录支持 | 同一用户最多5设备 |

## 参考 (References)

- 代码实现：`middleware.ts`
- 登录API：`app/api/auth/login/route.ts`
- Token清理：`scripts/cleanup-expired-tokens.ts`
