import { z } from 'zod'

const identifier = (max = 160) => z.string().trim().min(1).max(max)
const objectApiName = z.string().trim().regex(/^[A-Za-z][A-Za-z0-9_]*$/, '业务对象 API 名称格式无效').max(100)
const fieldPath = z.string().trim().regex(/^[A-Za-z_][A-Za-z0-9_]*$/, '字段路径必须是单个业务字段 API 名称').max(100)

const fieldSourceSchema = z.object({
  kind: z.literal('field'),
  path: fieldPath,
  select: z.enum(['raw', 'id', 'name']).default('raw'),
}).strict()

const literalSourceSchema = z.object({
  kind: z.literal('literal'),
  value: z.union([z.string(), z.number().finite()]),
}).strict()

export const aplValueSourceSchema = z.union([fieldSourceSchema, literalSourceSchema])
export type AplValueSource = z.infer<typeof aplValueSourceSchema>

const structuredRecipientSchema = z.object({
  kind: z.literal('fields'),
  name: aplValueSourceSchema,
  phone: aplValueSourceSchema,
  province: aplValueSourceSchema,
  city: aplValueSourceSchema,
  county: aplValueSourceSchema,
  address: aplValueSourceSchema,
}).strict()

const textRecipientSchema = z.object({
  kind: z.literal('text'),
  text: aplValueSourceSchema,
}).strict()

const shipmentMappingSchema = z.object({
  recipient: z.union([structuredRecipientSchema, textRecipientSchema]),
  cargo: aplValueSourceSchema,
  weight: aplValueSourceSchema,
  serviceId: aplValueSourceSchema.optional(),
  servicePreference: aplValueSourceSchema.optional(),
  payment: aplValueSourceSchema,
  remark: aplValueSourceSchema.optional(),
  specialRequirements: aplValueSourceSchema.optional(),
  pickupWindow: aplValueSourceSchema.optional(),
}).strict().superRefine((value, ctx) => {
  if (!value.serviceId && !value.servicePreference) {
    ctx.addIssue({ code: 'custom', path: ['service'], message: '必须配置 serviceId 或 servicePreference' })
  }
  if (value.serviceId && value.servicePreference) {
    ctx.addIssue({ code: 'custom', path: ['service'], message: 'serviceId 与 servicePreference 只能配置一个' })
  }
})

const stageMappingSchema = z.object({
  taskId: identifier().optional(),
  taskName: z.string().trim().min(1).max(200).optional(),
  stageId: identifier(),
  acceptedTaskStates: z.array(identifier(40)).min(1),
}).strict().superRefine((value, ctx) => {
  if (Boolean(value.taskId) === Boolean(value.taskName)) {
    ctx.addIssue({ code: 'custom', path: ['taskId'], message: 'taskId 与 taskName 必须且只能配置一个' })
  }
})

export const fxiaokeAplMappingSchema = z.object({
  schemaVersion: z.literal('1.0'),
  enterpriseId: identifier(120),
  workflow: z.object({
    objectApiName,
    acceptedInstanceStates: z.array(identifier(40)).min(1),
    stages: z.array(stageMappingSchema).min(1),
  }).strict(),
  applicant: z.object({
    objectApiName,
    employeeId: aplValueSourceSchema,
    name: aplValueSourceSchema,
    phone: aplValueSourceSchema,
    departmentId: aplValueSourceSchema.optional(),
    departmentName: aplValueSourceSchema,
  }).strict(),
  rootObject: z.object({
    objectApiName,
    customerId: aplValueSourceSchema,
    customerName: aplValueSourceSchema,
    revisionId: aplValueSourceSchema,
  }).strict(),
  shipmentDetailObject: z.object({
    objectApiName,
    parentRecordId: aplValueSourceSchema,
    shipment: shipmentMappingSchema,
  }).strict(),
}).strict().superRefine((value, ctx) => {
  if (value.rootObject.objectApiName !== value.workflow.objectApiName) {
    ctx.addIssue({ code: 'custom', path: ['rootObject', 'objectApiName'], message: '根业务对象必须与审批对象一致' })
  }
  const taskKeys = new Set<string>()
  const stageIds = new Set<string>()
  for (const [index, stage] of value.workflow.stages.entries()) {
    const taskKey = stage.taskId ? `id:${stage.taskId}` : `name:${stage.taskName}`
    if (taskKeys.has(taskKey)) ctx.addIssue({ code: 'custom', path: ['workflow', 'stages', index, 'taskId'], message: '任务映射不能重复' })
    if (stageIds.has(stage.stageId)) ctx.addIssue({ code: 'custom', path: ['workflow', 'stages', index, 'stageId'], message: '阶段映射不能重复' })
    taskKeys.add(taskKey)
    stageIds.add(stage.stageId)
  }
})

export type FxiaokeAplMapping = z.infer<typeof fxiaokeAplMappingSchema>

export const fxiaokeAplEndpointSchema = z.object({
  baseUrl: z.string().url().refine(value => new URL(value).protocol === 'https:', 'APL 网关必须使用 HTTPS'),
  clientId: z.string().trim().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/, '客户端 ID 格式无效'),
  preflightPath: z.literal('/api/shipping/crm/preflight').default('/api/shipping/crm/preflight'),
  createPath: z.literal('/api/shipping/crm/orders').default('/api/shipping/crm/orders'),
  timeoutMs: z.number().int().min(1000).max(120_000).default(15_000),
  preflightRetryCount: z.number().int().min(0).max(3).default(1),
  createRetryCount: z.number().int().min(0).max(3).default(1),
}).strict()

export type FxiaokeAplEndpoint = z.infer<typeof fxiaokeAplEndpointSchema>

export const aplInvocationSourceSchema = z.object({
  workflowInstanceId: identifier(),
  recordId: identifier(),
  shipmentDetailId: identifier(),
  taskId: identifier(),
}).strict()

export type AplInvocationSource = z.infer<typeof aplInvocationSourceSchema>

export const aplWorkflowInstanceSchema = z.object({
  instanceId: identifier(),
  workflowName: z.string().max(200).optional(),
  state: identifier(40),
  applicantId: identifier(),
}).strict()

export const aplWorkflowTaskSchema = z.object({
  taskId: identifier().optional(),
  name: z.string().max(200).optional(),
  state: identifier(40),
  applicantId: identifier(),
  apiName: objectApiName,
  dataId: identifier(),
  candidateIds: z.array(identifier()).optional(),
  processIds: z.array(z.unknown()).optional(),
  activityInstanceIds: z.union([z.string(), z.array(z.string())]).optional(),
}).passthrough()

export type AplWorkflowInstance = z.infer<typeof aplWorkflowInstanceSchema>
export type AplWorkflowTask = z.infer<typeof aplWorkflowTaskSchema>

export type AplHttpRequest = {
  method: 'POST'
  url: string
  pathname: string
  headers: Record<string, string>
  rawBody: string
  timeoutMs: number
  retryCount: number
}

export type AplHttpResult = {
  statusCode: number
  content: unknown
}

export interface FxiaokeAplRuntime {
  findInstances(input: {
    objectApiName: string
    dataId: string
    state: 'in_progress' | 'pass' | 'cancel' | 'error'
    pageSize: 100
    pageNumber: number
  }): Promise<unknown> | unknown
  findTask(taskId: string, notGetData: true): Promise<unknown> | unknown
  findObject(input: { objectApiName: string; id: string; fields: string[] }): Promise<Record<string, unknown>> | Record<string, unknown>
  executeHttp(request: AplHttpRequest): Promise<AplHttpResult> | AplHttpResult
  hmacSha256Hex(secret: string, data: string): Promise<string> | string
  nowSeconds?(): number
}

export type AplContractErrorCode =
  | 'APL_CONFIG_INVALID'
  | 'APL_SOURCE_INVALID'
  | 'APL_WORKFLOW_NOT_FOUND'
  | 'APL_WORKFLOW_AMBIGUOUS'
  | 'APL_WORKFLOW_STATE_INVALID'
  | 'APL_TASK_ID_MISMATCH'
  | 'APL_TASK_APPLICANT_MISMATCH'
  | 'APL_TASK_RECORD_MISMATCH'
  | 'APL_STAGE_MAPPING_MISSING'
  | 'APL_OBJECT_MISMATCH'
  | 'APL_MAPPING_FIELD_MISSING'
  | 'APL_MAPPING_VALUE_INVALID'
  | 'APL_ADDRESS_INVALID'
  | 'APL_SIGNATURE_INVALID'
  | 'APL_HTTP_BODY_INVALID'
  | 'APL_HTTP_PREFLIGHT_FAILED'
  | 'APL_HTTP_CREATE_FAILED'
  | 'APL_RESPONSE_INVALID'

export class FxiaokeAplContractError extends Error {
  constructor(
    public code: AplContractErrorCode,
    message: string,
    public details: Record<string, unknown> = {},
  ) {
    super(message)
    this.name = 'FxiaokeAplContractError'
  }
}
