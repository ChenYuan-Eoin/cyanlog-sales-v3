// lib/rag/evaluator.ts
// RAG评估器 — 端到端评估流水线

import { calculateRecall, calculatePrecision, calculateF1, calculateFaithfulness, calculateRelevance, calculateTaskAccuracy } from './metrics'

/**
 * 评估样本
 */
export interface EvalSample {
  id: string
  question: string
  /** 黄金答案 */
  goldenAnswer: string
  /** 相关的文档ID列表 */
  relevantDocIds: string[]
  /** 模型生成的答案 */
  modelAnswer: string
  /** 检索到的文档内容 */
  retrievedContents: string[]
  /** 检索到的文档ID */
  retrievedDocIds: string[]
}

/**
 * 评估结果
 */
export interface EvalResult {
  sampleId: string
  recall: number
  precision: number
  f1: number
  faithfulness: number
  relevance: number
}

/**
 * 评估器
 */
export class RAGEvaluator {
  /**
   * 评估单个样本
   */
  evaluateSample(sample: EvalSample): EvalResult {
    // 计算检索指标
    const retrievedRelevant = sample.retrievedDocIds.filter((id) => sample.relevantDocIds.includes(id)).length

    const recall = calculateRecall(retrievedRelevant, sample.relevantDocIds.length)
    const precision = calculatePrecision(retrievedRelevant, sample.retrievedDocIds.length)
    const f1 = calculateF1(precision, recall)

    // 计算答案指标
    const faithfulness = calculateFaithfulness(sample.modelAnswer, sample.retrievedContents)
    const relevance = calculateRelevance(sample.question, sample.modelAnswer)

    return {
      sampleId: sample.id,
      recall,
      precision,
      f1,
      faithfulness,
      relevance,
    }
  }

  /**
   * 评估整个数据集
   */
  evaluateDataset(samples: EvalSample[]): {
    aggregate: {
      avgRecall: number
      avgPrecision: number
      avgF1: number
      avgFaithfulness: number
      avgRelevance: number
      taskAccuracy: number
    }
    details: EvalResult[]
  } {
    const results = samples.map((s) => this.evaluateSample(s))
    const total = results.length

    if (total === 0) {
      return {
        aggregate: {
          avgRecall: 0,
          avgPrecision: 0,
          avgF1: 0,
          avgFaithfulness: 0,
          avgRelevance: 0,
          taskAccuracy: 0,
        },
        details: [],
      }
    }

    const sum = results.reduce(
      (acc, r) => ({
        recall: acc.recall + r.recall,
        precision: acc.precision + r.precision,
        f1: acc.f1 + r.f1,
        faithfulness: acc.faithfulness + r.faithfulness,
        relevance: acc.relevance + r.relevance,
      }),
      { recall: 0, precision: 0, f1: 0, faithfulness: 0, relevance: 0 }
    )

    // 任务准确率：所有指标都>=0.7的样本比例
    const completed = results.filter(
      (r) => r.recall >= 0.7 && r.precision >= 0.7 && r.faithfulness >= 0.7
    ).length
    const taskAccuracy = calculateTaskAccuracy(completed, total)

    return {
      aggregate: {
        avgRecall: sum.recall / total,
        avgPrecision: sum.precision / total,
        avgF1: sum.f1 / total,
        avgFaithfulness: sum.faithfulness / total,
        avgRelevance: sum.relevance / total,
        taskAccuracy,
      },
      details: results,
    }
  }
}
