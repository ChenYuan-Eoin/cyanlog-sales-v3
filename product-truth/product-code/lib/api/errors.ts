// API 统一错误码体系
// 规范：code 格式为 {领域}{类型}{序号}，如 A001 = Auth领域错误第1号

export interface ApiError {
  code: string
  message: string
  status: number
  details?: Record<string, unknown>
}

// 错误码定义
export const ErrorCodes = {
  // Auth (Axxx)
  UNAUTHORIZED: { code: 'A001', message: '未登录或登录已过期', status: 401 },
  FORBIDDEN: { code: 'A002', message: '无权限访问该资源', status: 403 },
  TOKEN_EXPIRED: { code: 'A003', message: '会话已过期，请重新登录', status: 401 },

  // Validation (Vxxx)
  VALIDATION_ERROR: { code: 'V001', message: '请求参数验证失败', status: 400 },
  INVALID_JSON: { code: 'V002', message: '请求格式不是有效的JSON', status: 400 },
  MISSING_FIELD: { code: 'V003', message: '必填字段缺失', status: 400 },

  // Resource (Rxxx)
  NOT_FOUND: { code: 'R001', message: '请求的资源不存在', status: 404 },
  DUPLICATE_KEY: { code: 'R002', message: '资源已存在，请勿重复创建', status: 409 },
  CONFLICT: { code: 'R003', message: '资源状态冲突，无法执行操作', status: 409 },

  // Organization (Oxxx)
  NO_ORG: { code: 'O001', message: '未选择组织，请先加入或创建组织', status: 400 },
  ORG_NOT_FOUND: { code: 'O002', message: '组织不存在或无权访问', status: 404 },

  // Database & Server (Sxxx)
  DB_ERROR: { code: 'S001', message: '数据库操作失败', status: 500 },
  INTERNAL_ERROR: { code: 'S002', message: '服务器内部错误', status: 500 },
  SERVICE_UNAVAILABLE: { code: 'S003', message: '服务暂时不可用，请稍后重试', status: 503 },

  // Business Logic (Bxxx)
  BUSINESS_RULE_VIOLATION: { code: 'B001', message: '违反业务规则', status: 400 },
  QUOTE_NOT_CONFIRMED: { code: 'B002', message: '报价状态不允许引用', status: 400 },
  CONTRACT_CREATE_FAILED: { code: 'B003', message: '合同创建失败', status: 500 },

} as const

export type ErrorCodeKey = keyof typeof ErrorCodes

// 创建错误对象
export function createApiError(
  key: ErrorCodeKey,
  customMessage?: string,
  details?: Record<string, unknown>
): ApiError {
  const def = ErrorCodes[key]
  return {
    code: def.code,
    message: customMessage || def.message,
    status: def.status,
    details,
  }
}

// HTTP 状态码映射（用于未知错误）
export const HttpStatusMessages: Record<number, string> = {
  400: '请求参数错误',
  401: '未授权',
  403: '禁止访问',
  404: '资源不存在',
  409: '资源冲突',
  422: '无法处理的实体',
  429: '请求过于频繁',
  500: '服务器内部错误',
  502: '网关错误',
  503: '服务不可用',
}
