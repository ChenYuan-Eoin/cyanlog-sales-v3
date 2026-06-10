// lib/rag/metrics.ts
// RAG评估指标 — Recall/Precision/Faithfulness/Accuracy
// 评估是数据驱动决策的基础，没有指标的RAG就是黑盒

/**
 * 检索召回率
 * 相关文档被召回的比例
 */
export function calculateRecall(retrievedRelevant: number, totalRelevant: number): number {
  if (totalRelevant === 0) return 1.0
  return retrievedRelevant / totalRelevant
}

/**
 * 检索精确率
 * 召回文档中相关的比例
 */
export function calculatePrecision(retrievedRelevant: number, totalRetrieved: number): number {
  if (totalRetrieved === 0) return 0
  return retrievedRelevant / totalRetrieved
}

/**
 * F1分数（精确率和召回率的调和平均）
 */
export function calculateF1(precision: number, recall: number): number {
  if (precision + recall === 0) return 0
  return 2 * (precision * recall) / (precision + recall)
}

/**
 * 答案忠实度
 * 答案是否基于检索内容，不是否幻觉
 * 简化版：检查答案中的关键短语是否在检索内容中
 */
export function calculateFaithfulness(answer: string, retrievedContents: string[]): number {
  // 提取2字和3字短语
  const phrases: string[] = []
  for (let len = 2; len <= 3; len++) {
    for (let i = 0; i <= answer.length - len; i++) {
      const phrase = answer.slice(i, i + len)
      if (/[\u4e00-\u9fa5]{2,3}/.test(phrase)) {
        phrases.push(phrase)
      }
    }
  }

  if (phrases.length === 0) return 1.0

  const allContent = retrievedContents.join(' ').toLowerCase()
  const matched = phrases.filter((p) => allContent.includes(p.toLowerCase()))
  return Math.min(matched.length / phrases.length, 1.0)
}

/**
 * 答案相关性
 * 答案是否回答了问题
 * 简化版：滑窗匹配，提取2-3字短语
 */
export function calculateRelevance(question: string, answer: string): number {
  // 提取2字和3字短语
  const phrases: string[] = []
  for (let len = 2; len <= 3; len++) {
    for (let i = 0; i <= question.length - len; i++) {
      const phrase = question.slice(i, i + len)
      if (/[\u4e00-\u9fa5]{2,3}/.test(phrase)) {
        phrases.push(phrase)
      }
    }
  }

  if (phrases.length === 0) return 1.0

  const answerLower = answer.toLowerCase()
  const matched = phrases.filter((p) => answerLower.includes(p.toLowerCase()))
  return Math.min(matched.length / phrases.length, 1.0)
}

/**
 * 任务准确率
 * 多步骤任务的成功率
 */
export function calculateTaskAccuracy(completed: number, total: number): number {
  if (total === 0) return 0
  return completed / total
}
