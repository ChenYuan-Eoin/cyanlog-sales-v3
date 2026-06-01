# Feature Packet: F008-OCR招标文件解析

**Created**: 2026-06-01  
**REQ ID**: F008  
**Status**: in_progress  
**Parent**: 合同审核

---

## 1. 单元定义

**目标**: 对招标文件进行 OCR 识别，提取关键信息

**功能范围**:
- PDF/图片格式的招标文件上传
- OCR 文字识别
- 关键信息提取（招标编号、金额、截止日期等）
- 结构化数据存储

**本轮不做什么**:
- 不实现自动投标准备
- 不实现标书生成（F013）
- 不实现复杂表格识别

---

## 2. 技术方案

**OCR 选型**:
- PaddleOCR（开源，中文支持好）
- 或调用云端 OCR API（如阿里云、腾讯云）

**实现方式**:
- API Route 接收文件上传
- 调用 OCR 服务进行识别
- 解析结果存储到数据库

---

## 3. 涉及文件

**新建**:
- `app/api/tenders/ocr/route.ts` - OCR 识别 API
- `lib/ocr/paddle.ts` - PaddleOCR 封装
- `app/tenders/ocr/page.tsx` - OCR 上传页面

---

## 4. 数据结构

```typescript
interface OCResult {
  tenderId: string
  originalFile: string
  extractedText: string
  keyInfo: {
    tenderNo?: string
    tenderName?: string
    budget?: number
    deadline?: string
    publisher?: string
    contact?: string
  }
  confidence: number
  status: 'pending' | 'completed' | 'failed'
}
```
