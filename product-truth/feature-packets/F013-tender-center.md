# Feature Packet: F013-标书中心

**Created**: 2026-06-01  
**REQ ID**: F013  
**Status**: in_progress  
**Parent**: 标书中心

---

## 1. 单元定义

**目标**: 提供标书生成和管理功能

**功能范围**:
- 标书模板管理
- 标书内容生成（基于模板填充）
- 标书导出（Word/PDF）
- 标书历史版本

**本轮不做什么**:
- 不做复杂的模板编辑器
- 不实现在线协作编辑
- 不做智能内容生成（AI）

---

## 2. 涉及文件

**新建**:
- `app/tenders/page.tsx` - 标书列表
- `app/tenders/new/page.tsx` - 创建标书
- `app/api/tenders/route.ts` - 标书 API
- `app/api/tenders/[id]/route.ts` - 标书详情 API
- `lib/tender/templates.ts` - 标书模板

---

## 3. 数据模型

```typescript
interface Tender {
  id: string
  name: string
  projectName: string
  tenderNo: string
  template: string
  content: Record<string, string>
  status: 'draft' | 'completed'
  createdBy: string
  createdAt: string
}
```
