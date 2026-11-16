import { z } from 'zod'
import { canonicalJson } from './canonical-json'
import {
  aplInvocationSourceSchema,
  FxiaokeAplContractError,
  fxiaokeAplEndpointSchema,
  fxiaokeAplMappingSchema,
  type AplContractErrorCode,
  type AplInvocationSource,
  type FxiaokeAplEndpoint,
  type FxiaokeAplMapping,
  type FxiaokeAplRuntime,
} from './contracts'
import { resolveAplIntake } from './resolve'
import { buildAplHttpRequest } from './signature'

const eventSchema = z.object({
  enterpriseId: z.string(),
  workflowInstanceId: z.string(),
  objectApiName: z.string(),
  recordId: z.string(),
  shipmentDetailId: z.string(),
  taskId: z.string(),
  stageId: z.string(),
  revisionId: z.string(),
}).strict()

const missingSchema = z.array(z.object({
  field: z.string(),
  message: z.string(),
  issue: z.string(),
}).passthrough())

const preflightResponseSchema = z.object({
  ready: z.boolean(),
  event: eventSchema,
  eventKey: z.string(),
  normalized: z.unknown().nullable(),
  missing: missingSchema,
}).passthrough()

const receiptResponseSchema = z.object({
  event: eventSchema,
  accepted: z.literal(true),
  created: z.boolean(),
  eventKey: z.string(),
  orderId: z.string().uuid(),
  orderNo: z.string().min(1),
  status: z.literal('awaiting_confirmation'),
  waybill: z.null(),
  nextAction: z.literal('operator_confirmation'),
}).strict()

export type AplContractResult =
  | {
      status: 'preflight_ready'
      source: ReturnType<typeof publicSource>
      preflight: z.infer<typeof preflightResponseSchema>
      attempts: number
    }
  | {
      status: 'preflight_blocked'
      source: ReturnType<typeof publicSource>
      preflight: z.infer<typeof preflightResponseSchema>
      attempts: number
    }
  | {
      status: 'created'
      source: ReturnType<typeof publicSource>
      preflight: z.infer<typeof preflightResponseSchema>
      receipt: z.infer<typeof receiptResponseSchema>
      attempts: number
    }
  | {
      status: 'error'
      code: AplContractErrorCode | 'APL_UNEXPECTED_ERROR'
      message: string
      stage: 'configuration' | 'resolve' | 'preflight' | 'create'
      retryable: boolean
      details: Record<string, unknown>
    }

function publicSource(source: AplInvocationSource, resolved: Awaited<ReturnType<typeof resolveAplIntake>>) {
  return {
    workflowInstanceId: source.workflowInstanceId,
    recordId: source.recordId,
    shipmentDetailId: source.shipmentDetailId,
    taskId: source.taskId,
    stageId: resolved.payload.event.stageId,
    revisionId: resolved.payload.event.revisionId,
    applicantId: resolved.applicantId,
    customerId: resolved.payload.customer.accountId,
  }
}

function responseContent(value: unknown): unknown {
  if (typeof value !== 'string') return value
  try {
    return JSON.parse(value)
  } catch {
    return value
  }
}

function retryableStatus(statusCode: number) {
  return statusCode === 429 || statusCode >= 500
}

async function callEndpoint(args: {
  runtime: FxiaokeAplRuntime
  endpoint: FxiaokeAplEndpoint
  secret: string
  pathname: '/api/shipping/crm/preflight' | '/api/shipping/crm/orders'
  rawBody: string
  retries: number
  expectedStatus: 200 | 202
  stage: 'preflight' | 'create'
}): Promise<{ content: unknown; attempts: number }> {
  let lastError: unknown
  for (let attempt = 1; attempt <= args.retries + 1; attempt += 1) {
    const timestamp = String(args.runtime.nowSeconds?.() ?? Math.floor(Date.now() / 1000))
    try {
      let request
      try {
        request = await buildAplHttpRequest({
          endpoint: args.endpoint,
          secret: args.secret,
          pathname: args.pathname,
          rawBody: args.rawBody,
          retryCount: 0,
          timestamp,
          hmacSha256Hex: args.runtime.hmacSha256Hex.bind(args.runtime),
        })
      } catch (error) {
        throw new FxiaokeAplContractError('APL_SIGNATURE_INVALID', 'APL 请求签名失败', {
          cause: error instanceof Error ? error.message : String(error),
        })
      }
      const response = await args.runtime.executeHttp(request)
      if (response.statusCode === args.expectedStatus) return { content: responseContent(response.content), attempts: attempt }
      lastError = new FxiaokeAplContractError(
        args.stage === 'preflight' ? 'APL_HTTP_PREFLIGHT_FAILED' : 'APL_HTTP_CREATE_FAILED',
        args.stage === 'preflight' ? 'ICU 预检调用失败' : 'ICU 受理调用失败',
        {
          statusCode: response.statusCode,
          response: responseContent(response.content),
          attempt,
          retryable: retryableStatus(response.statusCode),
        },
      )
      if (!retryableStatus(response.statusCode)) throw lastError
    } catch (error) {
      if (error instanceof FxiaokeAplContractError && error.code === 'APL_SIGNATURE_INVALID') throw error
      if (error instanceof FxiaokeAplContractError && !retryableStatus(Number(error.details.statusCode))) throw error
      lastError = error
    }
  }
  throw lastError
}

function sameEvent(actual: z.infer<typeof eventSchema>, expected: z.infer<typeof eventSchema>) {
  return Object.keys(expected).every(key => actual[key as keyof typeof actual] === expected[key as keyof typeof expected])
}

function errorResult(error: unknown, stage: Extract<AplContractResult, { status: 'error' }>['stage']): AplContractResult {
  if (error instanceof FxiaokeAplContractError) {
    return {
      status: 'error',
      code: error.code,
      message: error.message,
      stage,
      retryable: error.details.retryable === true,
      details: error.details,
    }
  }
  return {
    status: 'error',
    code: 'APL_UNEXPECTED_ERROR',
    message: error instanceof Error ? error.message : 'APL 合同执行失败',
    stage,
    retryable: stage === 'preflight' || stage === 'create',
    details: {},
  }
}

/**
 * Runs the reusable APL contract. Create mode always performs the read-only
 * preflight first and only calls the create endpoint when it is ready.
 */
export async function runFxiaokeAplContract(args: {
  runtime: FxiaokeAplRuntime
  mapping: FxiaokeAplMapping
  endpoint: FxiaokeAplEndpoint
  secret: string
  source: AplInvocationSource
  mode: 'preflight' | 'create'
}): Promise<AplContractResult> {
  const mappingResult = fxiaokeAplMappingSchema.safeParse(args.mapping)
  const endpointResult = fxiaokeAplEndpointSchema.safeParse(args.endpoint)
  const sourceResult = aplInvocationSourceSchema.safeParse(args.source)
  if (!mappingResult.success || !endpointResult.success || !sourceResult.success || args.secret.length < 32) {
    return errorResult(new FxiaokeAplContractError('APL_CONFIG_INVALID', 'APL 合同配置无效', {
      mapping: mappingResult.success ? undefined : mappingResult.error.issues,
      endpoint: endpointResult.success ? undefined : endpointResult.error.issues,
      source: sourceResult.success ? undefined : sourceResult.error.issues,
      secretLength: args.secret.length,
    }), 'configuration')
  }

  let resolved: Awaited<ReturnType<typeof resolveAplIntake>>
  try {
    resolved = await resolveAplIntake({ runtime: args.runtime, mapping: mappingResult.data, source: sourceResult.data })
  } catch (error) {
    return errorResult(error, 'resolve')
  }
  const source = publicSource(sourceResult.data, resolved)
  const rawBody = canonicalJson(resolved.payload)
  const expectedEvent = eventSchema.parse(resolved.payload.event)

  let preflightCall: Awaited<ReturnType<typeof callEndpoint>>
  try {
    preflightCall = await callEndpoint({
      runtime: args.runtime,
      endpoint: endpointResult.data,
      secret: args.secret,
      pathname: endpointResult.data.preflightPath,
      rawBody,
      retries: endpointResult.data.preflightRetryCount,
      expectedStatus: 200,
      stage: 'preflight',
    })
  } catch (error) {
    return errorResult(error, 'preflight')
  }
  const preflightParsed = preflightResponseSchema.safeParse(preflightCall.content)
  if (!preflightParsed.success || !preflightParsed.data.eventKey || !sameEvent(preflightParsed.data.event, expectedEvent)) {
    return errorResult(new FxiaokeAplContractError('APL_RESPONSE_INVALID', 'ICU 预检响应与已签名来源身份不一致', {
      issues: preflightParsed.success ? [] : preflightParsed.error.issues,
    }), 'preflight')
  }
  const preflight = preflightParsed.data
  if (!preflight.ready || preflight.missing.length > 0 || preflight.normalized === null) {
    return { status: 'preflight_blocked', source, preflight, attempts: preflightCall.attempts }
  }
  if (args.mode === 'preflight') {
    return { status: 'preflight_ready', source, preflight, attempts: preflightCall.attempts }
  }

  let createCall: Awaited<ReturnType<typeof callEndpoint>>
  try {
    createCall = await callEndpoint({
      runtime: args.runtime,
      endpoint: endpointResult.data,
      secret: args.secret,
      pathname: endpointResult.data.createPath,
      rawBody,
      retries: endpointResult.data.createRetryCount,
      expectedStatus: 202,
      stage: 'create',
    })
  } catch (error) {
    return errorResult(error, 'create')
  }
  const receiptParsed = receiptResponseSchema.safeParse(createCall.content)
  if (!receiptParsed.success || receiptParsed.data.eventKey !== preflight.eventKey || !sameEvent(receiptParsed.data.event, expectedEvent)) {
    return errorResult(new FxiaokeAplContractError('APL_RESPONSE_INVALID', 'ICU 受理响应与预检事件不一致', {
      issues: receiptParsed.success ? [] : receiptParsed.error.issues,
    }), 'create')
  }
  return {
    status: 'created',
    source,
    preflight,
    receipt: receiptParsed.data,
    attempts: preflightCall.attempts + createCall.attempts,
  }
}
