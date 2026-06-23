# 销售管理系统

> 机器可读入口: [manifest.yaml](./manifest.yaml)

## 5分钟启动

```bash
cd product-truth/product-code
pnpm install
pnpm dev
```

## 当前研发重心

**F001 价盘与阶梯价** - 配置中心正在开发

## 关键文档

| 目的 | 路径 |
|------|------|
| 需求看板 | [manifest.yaml](./manifest.yaml) |
| 需求注册表 | [product-truth/REQ_REGISTRY.yml](./product-truth/REQ_REGISTRY.yml) |
| 功能设计 | [product-truth/feature-packets/](./product-truth/feature-packets/) |
| 代码目录 | [product-truth/product-code/](./product-truth/product-code/) |
| 架构决策 | [product-truth/02-technical-truth/architecture-decisions/](./product-truth/02-technical-truth/architecture-decisions/) |

## 快速导航

- **价盘开发**: see [F001-price-list.md](./product-truth/feature-packets/F001-price-list.md)
- **合同审核设计**: see [F005-derive.md](./product-truth/feature-packets/F005-derive.md) (整合 F005-F009)
- **数据库迁移**: `product-truth/product-code/supabase/migrations/`
