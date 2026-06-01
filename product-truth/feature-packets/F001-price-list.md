# Feature Packet: F001-价盘管理

**Created**: 2026-06-01  
**REQ ID**: F001  
**Status**: in_progress  
**Parent**: 报价中心

---

## 1. 单元定义

**目标**: 建立产品目录和价格体系，支撑报价编制时的价格自动计算

**边界**:
- 产品分类管理（层级分类）
- 产品基础信息管理
- 产品价格管理（基础价、折扣策略）
- 价格历史版本记录

**本轮不做什么**:
- 不实现复杂的折扣策略引擎（F004）
- 不做供应商价格管理
- 不做价格审批流程

---

## 2. 双锚点

### 业务锚点
- 产品分类：一级分类（如：软件、硬件、服务）
- 产品信息：名称、编码、规格、基础价
- 价格类型：基础价、成本价、最低售价

### 视觉锚点
- 参考 configs 页面的 Tabs + Card 布局
- 左侧分类树 / 右侧产品列表
- 表格展示，操作按钮（编辑/删除）

---

## 3. 涉及文件

**新建**:
- `app/products/page.tsx` - 产品目录页
- `app/api/products/route.ts` - 产品列表/创建 API
- `app/api/products/[id]/route.ts` - 产品详情/更新/删除 API
- `app/api/categories/route.ts` - 产品分类 API

**修改**:
- `app/quotes/new/page.tsx` - 引用产品选择

---

## 4. 数据模型

```sql
-- 产品分类
CREATE TABLE product_categories (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    code VARCHAR(50) UNIQUE NOT NULL,
    parent_id UUID REFERENCES product_categories(id),
    sort_order INT DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- 产品
CREATE TABLE products (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    code VARCHAR(50) UNIQUE NOT NULL,
    category_id UUID REFERENCES product_categories(id),
    specification TEXT,
    unit VARCHAR(50),
    base_price DECIMAL(15, 2) NOT NULL DEFAULT 0,
    cost_price DECIMAL(15, 2) DEFAULT 0,
    min_price DECIMAL(15, 2) DEFAULT 0,
    status VARCHAR(20) DEFAULT 'active',
    created_by UUID REFERENCES users(id),
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);
```

---

## 5. 验证记录

- [ ] 产品分类 CRUD
- [ ] 产品 CRUD
- [ ] 价格字段验证
- [ ] 报价单引用产品
