# ADR-010: PaddleOCR本地OCR服务

## 状态
已采纳 (2026-05-21)

## 背景 (Context)

销售管理系统需要OCR处理招标文件，关键需求：

1. **中文支持**：
   - 销售合同/招标文件以中文为主
   - 包含表格、印章、手写签名
   - 英文混合场景

2. **数据合规**：
   - 合同/标书是商业机密
   - 不能上传到第三方云OCR
   - 必须在自有环境处理

3. **成本敏感**：
   - 文档量大（月均100+份）
   - 云OCR按调用收费，成本高
   - 自建OCR一次投入长期使用

4. **精度要求**：
   - 关键字段（金额、日期、甲方乙方）必须100%准确
   - 表格结构需保留

## 决策 (Decision)

采用**PaddleOCR (PaddlePaddle) 自建OCR服务**：

### 服务架构
```
┌─────────────────────────────────────────┐
│  Next.js API Route                      │
│  app/api/contracts/upload              │
│  ↓                                       │
│  文件存储到 Supabase Storage            │
│  ↓                                       │
│  创建 ocr_results 记录 (status=pending) │
│  ↓                                       │
│  触发后台OCR任务 (Vercel Cron)            │
│  ↓                                       │
│  Supabase Edge Function: ocr-processor  │
│  调用 PaddleOCR HTTP API                 │
│  ↓                                       │
│  解析结果回写 ocr_results               │
└─────────────────────────────────────────┘
```

### PaddleOCR选型
| OCR服务 | 中文精度 | 自建成本 | 维护难度 |
|---------|---------|---------|---------|
| **PaddleOCR** | ⭐⭐⭐⭐⭐ | 一次性部署 | 中（Python） |
| Tesseract | ⭐⭐ | 0 | 高（训练） |
| 阿里云OCR | ⭐⭐⭐⭐ | 按调用计费 | 低（云） |
| 百度OCR | ⭐⭐⭐⭐ | 按调用计费 | 低（云） |
| GPT-4V | ⭐⭐⭐⭐⭐ | 按token计费 | 低 |

### 关键功能
- **文本识别**：印刷体、手写体
- **版面分析**：保留段落、表格结构
- **字段抽取**：正则提取金额、日期、甲方乙方
- **置信度输出**：每个字段标记可信度

## 影响 (Consequences)

### 正面影响
- ✅ **中文最优**：PaddleOCR中文场景SOTA
- ✅ **数据合规**：完全本地处理
- ✅ **长期成本低**：一次部署无限调用
- ✅ **可定制**：可针对合同模板微调

### 负面影响
- ⚠️ **部署复杂**：需要Python环境+GPU可选
- ⚠️ **冷启动慢**：模型加载~10秒
- ⚠️ **维护成本**：需要Python工程师
- ⚠️ **表格识别**：复杂表格准确率仍有限

## 备选方案 (Alternatives Considered)

### 备选A：Tesseract
- 免费开源
- 但**中文识别精度差**
- 需要自己训练中文模型
- **否决原因**：中文场景不适合

### 备选B：阿里云OCR/百度OCR
- 中文精度高
- 但**数据出境问题**（合同机密）
- 长期成本高
- **否决原因**：合规风险

### 备选C：GPT-4V
- 理解能力强
- 但**成本极高**（$0.01/1K tokens）
- 仍需出境
- **否决原因**：成本+合规

### 备选D：自训练模型
- 完全控制
- 但**需要标注数据+GPU算力**
- 周期长
- **否决原因**：投入产出比低

## 实施细节 (Implementation)

### PaddleOCR HTTP服务
```python
# 启动PaddleOCR服务
from paddleocr import PaddleOCR
from fastapi import FastAPI, UploadFile

app = FastAPI()
ocr = PaddleOCR(use_angle_cls=True, lang='ch')

@app.post('/ocr')
async def recognize(file: UploadFile):
    image = await file.read()
    result = ocr.ocr(image, cls=True)
    return {'regions': parse_result(result)}
```

### Edge Function调用
```typescript
// supabase/functions/ocr-processor/index.ts
Deno.serve(async (req) => {
  const { fileUrl } = await req.json()
  const response = await fetch(process.env.PADDLEOCR_URL + '/ocr', {
    method: 'POST',
    body: await fetch(fileUrl).then(r => r.body),
  })
  const result = await response.json()
  // 回写ocr_results表
  await supabase.from('ocr_results').update({...}).eq('id', ocrId)
})
```

### 字段抽取
```typescript
// lib/ocr/tender-parser.ts
function extractTenderInfo(text: string): TenderKeyInfo {
  return {
    tenderNo: extractByRegex(text, /招标编号[：:]\s*([A-Z0-9-]+)/),
    budget: extractByRegex(text, /预算[：:]\s*([\d,.]+元)/),
    deadline: extractByRegex(text, /截止[：:]\s*(\d{4}-\d{2}-\d{2})/),
    purchaser: extractByRegex(text, /采购人[：:]\s*([^\n]+)/),
  }
}
```

## 验证标准 (Validation)

| 指标 | 目标值 |
|------|--------|
| 文本识别准确率 | >95% |
| 关键字段准确率 | >99% |
| 单页处理时间 | <2s |
| 单份合同（10页）处理 | <20s |

## 参考 (References)

- PaddleOCR官方：https://github.com/PaddlePaddle/PaddleOCR
- 项目代码：`lib/ocr/paddleocr.ts`
- 项目代码：`lib/ocr/tender-parser.ts`
- Edge Function：`supabase/functions/ocr-processor/`
