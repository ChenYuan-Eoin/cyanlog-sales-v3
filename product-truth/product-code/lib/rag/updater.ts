// lib/rag/updater.ts
// RAG动态更新 — 知识库变更监听
// 知识库不是静态的，新法规、新案例要能自动索引

import { globalIndexer, type IndexTask } from './indexer'
import { supabaseAdmin } from '@/lib/supabase'

/**
 * 知识库变更监听器
 * 实时更新 vs 批量更新
 * 实时：用户体验好，成本高
 * 批量：成本低，但有延迟
 * 折中：增量更新 + 定时全量校对
 */
export class KnowledgeWatcher {
  private watchedTables: string[]

  constructor(tables: string[] = ['contracts', 'rules', 'case_library', 'tech_documents']) {
    this.watchedTables = tables
  }

  /**
   * 处理文档更新
   */
  async handleDocumentChange(
    table: string,
    recordId: string
  ): Promise<void> {
    // 1. 读取文档
    const { data, error } = await supabaseAdmin
      .from(table)
      .select('*')
      .eq('id', recordId)
      .single()

    if (error || !data) {
      console.warn(`[KnowledgeWatcher] Failed to fetch ${table}:${recordId}:`, error)
      return
    }

    // 2. 提取文本
    const content = this.extractContent(data)
    if (!content) return

    // 3. 索引
    await globalIndexer.index({
      entityType: this.mapTableToEntityType(table),
      entityId: recordId,
      content,
      metadata: { source: table, updatedAt: new Date().toISOString() },
    })
  }

  /**
   * 提取文档内容
   */
  private extractContent(record: Record<string, unknown>): string | null {
    // 优先级：content > text > name + description
    if (typeof record.content === 'string') return record.content
    if (typeof record.text === 'string') return record.text
    if (typeof record.parsed_text === 'string') return record.parsed_text
    if (typeof record.body === 'string') return record.body

    // 拼接其他字段
    const parts: string[] = []
    if (record.name) parts.push(String(record.name))
    if (record.title) parts.push(String(record.title))
    if (record.description) parts.push(String(record.description))
    if (record.summary) parts.push(String(record.summary))

    return parts.length > 0 ? parts.join('\n') : null
  }

  /**
   * 映射表名到实体类型
   */
  private mapTableToEntityType(table: string): IndexTask['entityType'] {
    const map: Record<string, IndexTask['entityType']> = {
      contracts: 'contract',
      rules: 'rule',
      case_library: 'knowledge',
      tech_documents: 'knowledge',
    }
    return map[table] || 'knowledge'
  }
}

/**
 * 全局知识库监听器
 */
export const globalKnowledgeWatcher = new KnowledgeWatcher()
