// lib/multimodal/vision.ts
// 视觉理解 — 印章检测、签名识别、手写批注
// 多模态不是只有OCR文本，还要理解图像中的视觉信息
// 实现：基于云端多模态模型（Claude Vision/GPT-4V），降级到纯文本OCR

import { createOpenAI } from '@ai-sdk/openai'
import { generateText } from 'ai'

export interface VisionAnalysisResult {
  /** 检测到的视觉元素 */
  elements: Array<{
    type: 'stamp' | 'signature' | 'handwriting' | 'table' | 'chart'
    /** 元素位置描述 */
    location: string
    /** 识别内容 */
    content: string
    /** 置信度 0-1 */
    confidence: number
  }>
  /** 整体描述 */
  description: string
  /** 使用的模型 */
  provider: string
  /** 是否降级 */
  degraded: boolean
}

/**
 * 视觉分析器 — 分析合同文档中的图像元素
 * 为什么需要视觉理解？
 * - 印章真伪验证（OCR只能出文本，无法理解印章）
 * - 签名识别（手写签名 vs 打印签名）
 * - 表格结构（OCR可能破坏表格结构）
 */
export async function analyzeVision(
  imageBase64: string
): Promise<VisionAnalysisResult> {
  // 尝试云端多模态模型
  try {
    const result = await tryCloudVision(imageBase64)
    return result
  } catch (err) {
    console.warn('[Vision] Cloud vision failed:', err instanceof Error ? err.message : err)
  }

  // 降级：返回提示信息，建议人工复核
  return {
    elements: [],
    description: '视觉分析服务暂时不可用，建议人工复核印章、签名等视觉元素',
    provider: 'manual-fallback',
    degraded: true,
  }
}

/**
 * 尝试云端多模态模型
 */
async function tryCloudVision(imageBase64: string): Promise<VisionAnalysisResult> {
  const gatewayUrl = process.env.AI_GATEWAY_URL
  const gatewayKey = process.env.AI_GATEWAY_API_KEY

  if (!gatewayUrl || !gatewayKey) {
    throw new Error('AI Gateway not configured')
  }

  const gateway = createOpenAI({
    baseURL: gatewayUrl,
    apiKey: gatewayKey,
  })

  const result = await generateText({
    model: gateway('claude-sonnet-4-6-vision'), // 多模态模型
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: `分析这份合同文档的图片，识别以下视觉元素：
1. 印章（公司公章、合同章）—— 位置、文字内容
2. 签名（手写签名 vs 打印签名）—— 位置、类型
3. 手写批注 —— 位置、内容
4. 表格 —— 行列结构
5. 图表 —— 类型、数据

请以JSON格式返回：
{
  "elements": [
    {
      "type": "stamp|signature|handwriting|table|chart",
      "location": "描述位置",
      "content": "识别内容",
      "confidence": 0.95
    }
  ],
  "description": "整体描述"
}`,
          },
          {
            type: 'image',
            image: imageBase64,
          },
        ],
      },
    ],
    maxOutputTokens: 4000,
    temperature: 0.3,
  })

  // 解析输出
  try {
    const jsonMatch = result.text.match(/\{[\s\S]*\}/)
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0])
      return {
        elements: parsed.elements || [],
        description: parsed.description || '',
        provider: 'cloud-vision',
        degraded: false,
      }
    }
  } catch {
    // 解析失败
  }

  // 返回原始文本作为描述
  return {
    elements: [],
    description: result.text,
    provider: 'cloud-vision',
    degraded: false,
  }
}

/**
 * 印章真伪检测 — 简化版
 * 真正的印章检测需要图像处理（颜色分析、形状分析、纹理分析）
 * 这里用多模态模型做初步检测，实际应用需要专门的印章检测模型
 */
export async function detectStamp(
  imageBase64: string
): Promise<{
  hasStamp: boolean
  stampText?: string
  confidence: number
}> {
  const result = await analyzeVision(imageBase64)
  const stamps = result.elements.filter((e) => e.type === 'stamp')

  if (stamps.length === 0) {
    return { hasStamp: false, confidence: 0.9 }
  }

  return {
    hasStamp: true,
    stampText: stamps[0].content,
    confidence: stamps[0].confidence,
  }
}

/**
 * 签名检测
 */
export async function detectSignature(
  imageBase64: string
): Promise<{
  hasSignature: boolean
  signatureType?: 'handwritten' | 'printed'
  confidence: number
}> {
  const result = await analyzeVision(imageBase64)
  const signatures = result.elements.filter((e) => e.type === 'signature')

  if (signatures.length === 0) {
    return { hasSignature: false, confidence: 0.9 }
  }

  return {
    hasSignature: true,
    signatureType: signatures[0].content.includes('手写') ? 'handwritten' : 'printed',
    confidence: signatures[0].confidence,
  }
}
