// API 统一响应格式
// 所有 API 响应必须遵循此格式

import { NextResponse } from 'next/server'
import type { ApiError } from './errors'

// 成功响应结构
export interface SuccessResponse<T> {
  success: true
  data: T
  meta?: {
    total?: number
    limit?: number
    offset?: number
    hasMore?: boolean
    [key: string]: unknown
  }
}

// 错误响应结构
export interface ErrorResponse {
  success: false
  error: {
    code: string
    message: string
    details?: Record<string, unknown>
  }
}

export type ApiResponse<T> = SuccessResponse<T> | ErrorResponse

/**
 * 创建成功响应
 * @param data 响应数据
 * @param meta 分页等元数据
 * @param status HTTP 状态码（默认200）
 */
export function successResponse<T>(
  data: T,
  meta?: SuccessResponse<T>['meta'],
  status = 200
): NextResponse<SuccessResponse<T>> {
  return NextResponse.json(
    {
      success: true,
      data,
      ...(meta && { meta }),
    },
    {
      status,
      headers: {
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Content-Type': 'application/json',
      },
    }
  )
}

/**
 * 创建错误响应
 * @param error ApiError 对象
 * @param status HTTP 状态码（可选，默认使用 error.status）
 */
export function errorResponse(
  error: ApiError,
  status?: number
): NextResponse<ErrorResponse> {
  return NextResponse.json(
    {
      success: false,
      error: {
        code: error.code,
        message: error.message,
        ...(error.details && { details: error.details }),
      },
    },
    {
      status: status || error.status,
      headers: {
        'Content-Type': 'application/json',
      },
    }
  )
}

/**
 * 创建分页成功响应
 * @param items 列表数据
 * @param total 总数
 * @param limit 每页限制
 * @param offset 偏移量
 */
export function paginatedResponse<T>(
  items: T[],
  total: number,
  limit: number,
  offset: number
): NextResponse<SuccessResponse<T[]>> {
  return successResponse(items, {
    total,
    limit,
    offset,
    hasMore: total > offset + items.length,
  })
}

/**
 * 创建创建成功响应（201）
 * @param data 创建的资源
 */
export function createdResponse<T>(data: T): NextResponse<SuccessResponse<T>> {
  return successResponse(data, undefined, 201)
}

/**
 * 创建无内容响应（204）- 用于删除成功
 */
export function noContentResponse(): NextResponse<null> {
  return new NextResponse(null, { status: 204 })
}
