// Centralized Error Handling
// REQ: F003, F005

export enum ErrorCode {
  // Auth errors
  UNAUTHORIZED = 'UNAUTHORIZED',
  AUTH_FAILED = 'AUTH_FAILED',
  TOKEN_EXPIRED = 'TOKEN_EXPIRED',
  EMAIL_EXISTS = 'EMAIL_EXISTS',
  PHONE_EXISTS = 'PHONE_EXISTS',

  // Validation errors
  VALIDATION_ERROR = 'VALIDATION_ERROR',
  INVALID_ID = 'INVALID_ID',
  INVALID_PAGINATION = 'INVALID_PAGINATION',
  MISSING_FILE = 'MISSING_FILE',
  INVALID_FILE_TYPE = 'INVALID_FILE_TYPE',
  FILE_TOO_LARGE = 'FILE_TOO_LARGE',

  // Resource errors
  NOT_FOUND = 'NOT_FOUND',
  ALREADY_EXISTS = 'ALREADY_EXISTS',
  CONCURRENT_UPDATE = 'CONCURRENT_UPDATE',

  // Business logic errors
  QUOTE_CONFIRMED = 'QUOTE_CONFIRMED',
  ALREADY_IN_PROGRESS = 'ALREADY_IN_PROGRESS',
  ALREADY_COMPLETED = 'ALREADY_COMPLETED',
  INVALID_STATUS = 'INVALID_STATUS',
  RECENT_REVIEW_EXISTS = 'RECENT_REVIEW_EXISTS',

  // Database errors
  DB_ERROR = 'DB_ERROR',
  UPLOAD_FAILED = 'UPLOAD_FAILED',
  TOKEN_CREATE_FAILED = 'TOKEN_CREATE_FAILED',
  USER_CREATE_FAILED = 'USER_CREATE_FAILED',
  REVIEW_CREATE_FAILED = 'REVIEW_CREATE_FAILED',

  // System errors
  INTERNAL_ERROR = 'INTERNAL_ERROR',
}

export interface AppError {
  message: string
  code: ErrorCode
  status: number
  details?: Record<string, unknown>
}

// Error to HTTP status mapping
export const errorStatusMap: Record<ErrorCode, number> = {
  [ErrorCode.UNAUTHORIZED]: 401,
  [ErrorCode.AUTH_FAILED]: 401,
  [ErrorCode.TOKEN_EXPIRED]: 401,

  [ErrorCode.VALIDATION_ERROR]: 400,
  [ErrorCode.INVALID_ID]: 400,
  [ErrorCode.INVALID_PAGINATION]: 400,
  [ErrorCode.MISSING_FILE]: 400,
  [ErrorCode.INVALID_FILE_TYPE]: 400,
  [ErrorCode.FILE_TOO_LARGE]: 400,
  [ErrorCode.INVALID_STATUS]: 400,

  [ErrorCode.NOT_FOUND]: 404,

  [ErrorCode.EMAIL_EXISTS]: 409,
  [ErrorCode.PHONE_EXISTS]: 409,
  [ErrorCode.ALREADY_EXISTS]: 409,
  [ErrorCode.CONCURRENT_UPDATE]: 409,
  [ErrorCode.QUOTE_CONFIRMED]: 409,
  [ErrorCode.ALREADY_IN_PROGRESS]: 409,
  [ErrorCode.ALREADY_COMPLETED]: 409,
  [ErrorCode.RECENT_REVIEW_EXISTS]: 409,

  [ErrorCode.DB_ERROR]: 500,
  [ErrorCode.UPLOAD_FAILED]: 500,
  [ErrorCode.TOKEN_CREATE_FAILED]: 500,
  [ErrorCode.USER_CREATE_FAILED]: 500,
  [ErrorCode.REVIEW_CREATE_FAILED]: 500,
  [ErrorCode.INTERNAL_ERROR]: 500,
}

// Structured logging
export function logError(context: string, error: unknown, extra?: Record<string, unknown>) {
  const timestamp = new Date().toISOString()
  const errorObj = error instanceof Error ? error : new Error(String(error))

  console.error(JSON.stringify({
    timestamp,
    level: 'ERROR',
    context,
    message: errorObj.message,
    stack: process.env.NODE_ENV === 'development' ? errorObj.stack : undefined,
    ...extra,
  }))
}

export function logInfo(context: string, message: string, extra?: Record<string, unknown>) {
  console.info(JSON.stringify({
    timestamp: new Date().toISOString(),
    level: 'INFO',
    context,
    message,
    ...extra,
  }))
}

export function logWarn(context: string, message: string, extra?: Record<string, unknown>) {
  console.warn(JSON.stringify({
    timestamp: new Date().toISOString(),
    level: 'WARN',
    context,
    message,
    ...extra,
  }))
}
