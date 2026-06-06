// lib/multimodal/document.ts
// 文档多模态解析 — 文本+图像联合理解
// 合同文档可能有扫描件（图像）+ 文本，需要联合理解

import { analyzeVision } from './vision'

export interface DocumentPage {
  /** 页码 */
  pageNumber: number
  /** 文本内容（OCR提取） */
  text: string
  /** 图像数据（如果有） */
  imageBase64?: string
  /** 视觉元素 */
  visualElements: Array<{
    type: 'stamp' | 'signature' | 'handwriting' | 'table' | 'chart'
    location: string
    content: string
  }>
}

export interface MultimodalDocument {
  /** 文档总页数 */
  totalPages: number
  /** 各页内容 */
  pages: DocumentPage[]
  /** 合并后的完整文本 */
  fullText: string
  /** 检测到的视觉元素汇总 */
  allVisualElements: DocumentPage['visualElements']
}

/**
 * 多模态文档解析器
 * 为什么需要多模态解析？
 * - 扫描件合同：图像是主要信息载体，OCR只能提取文本，无法理解印章/签名
 * - 混合文档：既有文本又有图像，需要联合理解
 * - 表格合同：OCR可能破坏表格结构，需要视觉理解辅助
 */
export async function parseMultimodalDocument(
  pages: Array<{ text: string; imageBase64?: string }>
): Promise<MultimodalDocument> {
  const documentPages: DocumentPage[] = []
  const allVisualElements: DocumentPage['visualElements'] = []

  for (let i = 0; i < pages.length; i++) {
    const page = pages[i]
    const visualElements: DocumentPage['visualElements'] = []

    // 如果有图像，进行视觉分析
    if (page.imageBase64) {
      try {
        const visionResult = await analyzeVision(page.imageBase64)
        visualElements.push(...visionResult.elements.map((e) => ({
          type: e.type,
          location: e.location,
          content: e.content,
        })))
      } catch (err) {
        console.warn(`[Multimodal] Vision analysis failed for page ${i + 1}:`, err)
      }
    }

    documentPages.push({
      pageNumber: i + 1,
      text: page.text,
      imageBase64: page.imageBase64,
      visualElements,
    })

    allVisualElements.push(...visualElements)
  }

  // 合并完整文本
  const fullText = documentPages.map((p) => p.text).join('\n\n')

  return {
    totalPages: pages.length,
    pages: documentPages,
    fullText,
    allVisualElements,
  }
}

/**
 * 提取文档中的关键视觉信息
 * 多模态理解的结果怎么用于合同审核？
 * - 印章检测：验证合同是否盖章
 * - 签名检测：验证是否有手写签名
 * - 表格检测：提取表格中的关键数据
 */
export function extractVisualInsights(document: MultimodalDocument): {
  hasStamp: boolean
  hasSignature: boolean
  hasHandwriting: boolean
  tables: Array<{ page: number; content: string }>
} {
  const stamps = document.allVisualElements.filter((e) => e.type === 'stamp')
  const signatures = document.allVisualElements.filter((e) => e.type === 'signature')
  const handwriting = document.allVisualElements.filter((e) => e.type === 'handwriting')
  const tables = document.allVisualElements.filter((e) => e.type === 'table')

  return {
    hasStamp: stamps.length > 0,
    hasSignature: signatures.length > 0,
    hasHandwriting: handwriting.length > 0,
    tables: tables.map((t) => ({
      page: document.pages.findIndex((p) => p.visualElements.includes(t)) + 1,
      content: t.content,
    })),
  }
}
