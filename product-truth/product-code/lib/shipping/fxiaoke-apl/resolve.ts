import { crmIntakeBodySchema, type CrmIntakePayload } from '../crm-intake'
import { parseShippingText, prepareBatchRecipient } from '../batch-text'
import type { Contact } from '../types'
import {
  aplInvocationSourceSchema,
  aplWorkflowInstanceSchema,
  aplWorkflowTaskSchema,
  FxiaokeAplContractError,
  fxiaokeAplMappingSchema,
  type AplInvocationSource,
  type AplValueSource,
  type AplWorkflowInstance,
  type AplWorkflowTask,
  type FxiaokeAplMapping,
  type FxiaokeAplRuntime,
} from './contracts'

type ObjectRecord = Record<string, unknown>

export type ResolvedAplIntake = {
  payload: CrmIntakePayload
  applicantId: string
  workflow: AplWorkflowInstance
  task: AplWorkflowTask
}

function unwrapFxEnvelope(value: unknown, label: string): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new FxiaokeAplContractError('APL_RESPONSE_INVALID', `${label} 返回结构无效`)
  }
  const record = value as Record<string, unknown>
  if (record.isError === true) {
    throw new FxiaokeAplContractError('APL_RESPONSE_INVALID', `${label} 调用失败`, {
      errorCode: record.errorCode,
      message: record.message,
    })
  }
  if (!('data' in record)) {
    throw new FxiaokeAplContractError('APL_RESPONSE_INVALID', `${label} 缺少 data`)
  }
  return record.data
}

function parseInstancePage(value: unknown): { total: number; instances: AplWorkflowInstance[] } {
  const data = unwrapFxEnvelope(value, 'Fx.bpm.findInstances')
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new FxiaokeAplContractError('APL_RESPONSE_INVALID', '审批实例返回结构无效')
  }
  const queryResult = (data as Record<string, unknown>).QueryResult
  if (!queryResult || typeof queryResult !== 'object' || Array.isArray(queryResult)) {
    throw new FxiaokeAplContractError('APL_RESPONSE_INVALID', '审批实例缺少 QueryResult')
  }
  const total = (queryResult as Record<string, unknown>).total
  const dateList = (queryResult as Record<string, unknown>).dateList
  if (!Number.isInteger(total) || Number(total) < 0 || !Array.isArray(dateList)) {
    throw new FxiaokeAplContractError('APL_RESPONSE_INVALID', '审批实例列表缺失')
  }
  return {
    total: Number(total),
    instances: dateList.map((item, index) => {
      const parsed = aplWorkflowInstanceSchema.safeParse(item)
      if (!parsed.success) {
        throw new FxiaokeAplContractError('APL_RESPONSE_INVALID', `审批实例第 ${index + 1} 条结构无效`)
      }
      return parsed.data
    }),
  }
}

function parseTask(value: unknown): AplWorkflowTask {
  const data = unwrapFxEnvelope(value, 'Fx.bpm.findTask')
  const parsed = aplWorkflowTaskSchema.safeParse(data)
  if (!parsed.success) {
    throw new FxiaokeAplContractError('APL_RESPONSE_INVALID', '审批任务返回结构无效')
  }
  return parsed.data
}

function pathFields(source: AplValueSource | undefined): string[] {
  return source?.kind === 'field' ? [source.path] : []
}

function sourceFields(mapping: FxiaokeAplMapping): Record<'applicant' | 'root' | 'detail', string[]> {
  const { applicant, rootObject, shipmentDetailObject } = mapping
  const shipment = shipmentDetailObject.shipment
  const recipient = shipment.recipient
  return {
    applicant: [...new Set([
      '_id',
      ...pathFields(applicant.employeeId),
      ...pathFields(applicant.name),
      ...pathFields(applicant.phone),
      ...pathFields(applicant.departmentId),
      ...pathFields(applicant.departmentName),
    ])],
    root: [...new Set([
      '_id',
      ...pathFields(rootObject.customerId),
      ...pathFields(rootObject.customerName),
      ...pathFields(rootObject.revisionId),
    ])],
    detail: [...new Set([
      '_id',
      ...pathFields(shipmentDetailObject.parentRecordId),
      ...pathFields(recipient.kind === 'fields' ? recipient.name : recipient.text),
      ...pathFields(recipient.kind === 'fields' ? recipient.phone : undefined),
      ...pathFields(recipient.kind === 'fields' ? recipient.province : undefined),
      ...pathFields(recipient.kind === 'fields' ? recipient.city : undefined),
      ...pathFields(recipient.kind === 'fields' ? recipient.county : undefined),
      ...pathFields(recipient.kind === 'fields' ? recipient.address : undefined),
      ...pathFields(shipment.cargo),
      ...pathFields(shipment.weight),
      ...pathFields(shipment.serviceId),
      ...pathFields(shipment.servicePreference),
      ...pathFields(shipment.payment),
      ...pathFields(shipment.remark),
      ...pathFields(shipment.specialRequirements),
      ...pathFields(shipment.pickupWindow),
    ])],
  }
}

function scalar(value: unknown, field: string): string | number {
  if ((typeof value === 'string' && value.trim()) || (typeof value === 'number' && Number.isFinite(value))) return value
  throw new FxiaokeAplContractError('APL_MAPPING_FIELD_MISSING', `字段 ${field} 缺失或不是标量`, { field })
}

function selectedReference(value: unknown, select: 'id' | 'name', field: string): string {
  if (typeof value === 'string' && value.trim() && select === 'id') return value
  const items = Array.isArray(value) ? value : [value]
  if (items.length !== 1 || !items[0] || typeof items[0] !== 'object' || Array.isArray(items[0])) {
    throw new FxiaokeAplContractError('APL_MAPPING_VALUE_INVALID', `字段 ${field} 的关联值必须唯一`, { field })
  }
  const record = items[0] as Record<string, unknown>
  const candidate = select === 'id' ? record._id ?? record.id : record.name
  if (typeof candidate !== 'string' || !candidate.trim()) {
    throw new FxiaokeAplContractError('APL_MAPPING_FIELD_MISSING', `字段 ${field} 缺少 ${select}`, { field })
  }
  return candidate
}

function valueOf(source: AplValueSource, record: ObjectRecord, label: string): string | number {
  if (source.kind === 'literal') return source.value
  if (!Object.prototype.hasOwnProperty.call(record, source.path)) {
    throw new FxiaokeAplContractError('APL_MAPPING_FIELD_MISSING', `字段 ${source.path} 未由 ${label} 返回`, { field: source.path })
  }
  const raw = record[source.path]
  if (source.select === 'id' || source.select === 'name') return selectedReference(raw, source.select, source.path)
  return scalar(raw, source.path)
}

function stringOf(source: AplValueSource, record: ObjectRecord, label: string) {
  const value = valueOf(source, record, label)
  if (typeof value !== 'string') {
    throw new FxiaokeAplContractError('APL_MAPPING_VALUE_INVALID', `${label} 字段必须是字符串`, { field: source.kind === 'field' ? source.path : label })
  }
  return value
}

function objectId(record: ObjectRecord, expected: string, label: string) {
  if (record._id !== expected) {
    throw new FxiaokeAplContractError('APL_OBJECT_MISMATCH', `${label} 返回了非指定记录`, { expected, actual: record._id })
  }
}

function contactFromText(text: string): Contact {
  const rows = parseShippingText(text)
  if (rows.length !== 1) {
    throw new FxiaokeAplContractError('APL_ADDRESS_INVALID', '收件地址文本必须恰好解析为一票')
  }
  const prepared = prepareBatchRecipient(rows[0])
  if (prepared.errors.length) {
    throw new FxiaokeAplContractError('APL_ADDRESS_INVALID', '收件地址文本未通过系统地址校验', {
      errors: prepared.errors,
      fieldErrors: prepared.fieldErrors,
    })
  }
  return prepared.recipient
}

function mappedRecipient(mapping: FxiaokeAplMapping['shipmentDetailObject']['shipment']['recipient'], detail: ObjectRecord): Contact {
  if (mapping.kind === 'text') return contactFromText(stringOf(mapping.text, detail, 'shipment.recipient.text'))
  return {
    name: stringOf(mapping.name, detail, 'shipment.recipient.name'),
    phone: stringOf(mapping.phone, detail, 'shipment.recipient.phone'),
    province: stringOf(mapping.province, detail, 'shipment.recipient.province'),
    city: stringOf(mapping.city, detail, 'shipment.recipient.city'),
    county: stringOf(mapping.county, detail, 'shipment.recipient.county'),
    address: stringOf(mapping.address, detail, 'shipment.recipient.address'),
  }
}

function mappedShipment(mapping: FxiaokeAplMapping['shipmentDetailObject']['shipment'], detail: ObjectRecord): CrmIntakePayload['shipment'] {
  const weight = valueOf(mapping.weight, detail, 'shipment.weight')
  const serviceId = mapping.serviceId ? valueOf(mapping.serviceId, detail, 'shipment.serviceId') : undefined
  const servicePreference = mapping.servicePreference ? valueOf(mapping.servicePreference, detail, 'shipment.servicePreference') : undefined
  return {
    recipient: mappedRecipient(mapping.recipient, detail),
    cargo: stringOf(mapping.cargo, detail, 'shipment.cargo'),
    weight: typeof weight === 'number' ? weight : Number(weight),
    ...(serviceId !== undefined ? { serviceId: typeof serviceId === 'number' ? serviceId : Number(serviceId) } : {}),
    ...(servicePreference !== undefined ? { servicePreference: String(servicePreference) as 'standard' | 'urgent' } : {}),
    payment: stringOf(mapping.payment, detail, 'shipment.payment') as CrmIntakePayload['shipment']['payment'],
    remark: mapping.remark ? stringOf(mapping.remark, detail, 'shipment.remark') : '',
    ...(mapping.specialRequirements ? { specialRequirements: stringOf(mapping.specialRequirements, detail, 'shipment.specialRequirements') } : {}),
    ...(mapping.pickupWindow ? { pickupWindow: stringOf(mapping.pickupWindow, detail, 'shipment.pickupWindow') } : {}),
  }
}

export async function resolveAplIntake(args: {
  runtime: FxiaokeAplRuntime
  mapping: FxiaokeAplMapping
  source: AplInvocationSource
}): Promise<ResolvedAplIntake> {
  const mappingResult = fxiaokeAplMappingSchema.safeParse(args.mapping)
  if (!mappingResult.success) {
    throw new FxiaokeAplContractError('APL_CONFIG_INVALID', '纷享 APL 字段映射配置无效', { issues: mappingResult.error.issues })
  }
  const sourceResult = aplInvocationSourceSchema.safeParse(args.source)
  if (!sourceResult.success) {
    throw new FxiaokeAplContractError('APL_SOURCE_INVALID', '纷享 APL 来源身份不完整', { issues: sourceResult.error.issues })
  }
  const mapping = mappingResult.data
  const source = sourceResult.data

  const taskPromise = Promise.resolve(args.runtime.findTask(source.taskId, true)).then(
    value => ({ ok: true as const, value }),
    error => ({ ok: false as const, error }),
  )
  const matches: AplWorkflowInstance[] = []
  const queriedStates: Array<'in_progress' | 'pass' | 'cancel' | 'error'> = ['in_progress', 'pass', 'cancel', 'error']
  for (const state of queriedStates) {
    let pageNumber = 1
    while (matches.length === 0) {
      const response = await args.runtime.findInstances({
        objectApiName: mapping.workflow.objectApiName,
        dataId: source.recordId,
        state,
        pageSize: 100,
        pageNumber,
      })
      const page = parseInstancePage(response)
      matches.push(...page.instances.filter(instance => instance.instanceId === source.workflowInstanceId))
      if (matches.length > 0 || page.instances.length === 0 || pageNumber * 100 >= page.total) break
      pageNumber += 1
    }
    if (matches.length > 0) break
  }
  if (matches.length === 0) {
    throw new FxiaokeAplContractError('APL_WORKFLOW_NOT_FOUND', '指定的审批流程实例不存在', { workflowInstanceId: source.workflowInstanceId })
  }
  if (matches.length !== 1) {
    throw new FxiaokeAplContractError('APL_WORKFLOW_AMBIGUOUS', '指定审批流程实例不唯一', { workflowInstanceId: source.workflowInstanceId })
  }
  const workflow = matches[0]
  if (!mapping.workflow.acceptedInstanceStates.includes(workflow.state)) {
    throw new FxiaokeAplContractError('APL_WORKFLOW_STATE_INVALID', '审批流程状态不在核准阶段内', { state: workflow.state })
  }
  if (workflow.applicantId === '-10000') {
    throw new FxiaokeAplContractError('APL_TASK_APPLICANT_MISMATCH', '后台系统身份不能作为业务申请人')
  }

  const taskOutcome = await taskPromise
  if (!taskOutcome.ok) throw taskOutcome.error
  const task = parseTask(taskOutcome.value)
  if (task.taskId !== undefined && task.taskId !== source.taskId) {
    throw new FxiaokeAplContractError('APL_TASK_ID_MISMATCH', '审批任务返回了非指定任务', {
      expectedTaskId: source.taskId,
      actualTaskId: task.taskId,
    })
  }
  if (task.apiName !== mapping.workflow.objectApiName || task.dataId !== source.recordId) {
    throw new FxiaokeAplContractError('APL_TASK_RECORD_MISMATCH', '审批任务与指定业务记录不一致', {
      expectedObjectApiName: mapping.workflow.objectApiName,
      actualObjectApiName: task.apiName,
      expectedRecordId: source.recordId,
      actualRecordId: task.dataId,
    })
  }
  if (task.applicantId !== workflow.applicantId) {
    throw new FxiaokeAplContractError('APL_TASK_APPLICANT_MISMATCH', '审批实例与任务的真实申请人不一致')
  }
  const stages = mapping.workflow.stages.filter(item => item.taskId
    ? item.taskId === source.taskId
    : Boolean(item.taskName && task.name && item.taskName === task.name))
  if (stages.length !== 1) {
    throw new FxiaokeAplContractError('APL_STAGE_MAPPING_MISSING', '指定任务没有唯一核准的阶段映射', {
      taskId: source.taskId,
      taskName: task.name,
      matches: stages.length,
    })
  }
  const stage = stages[0]
  if (!stage.acceptedTaskStates.includes(task.state)) {
    throw new FxiaokeAplContractError('APL_WORKFLOW_STATE_INVALID', '审批任务状态不在核准阶段内', { state: task.state })
  }

  const fields = sourceFields(mapping)
  const [rootRecord, applicantRecord, detailRecord] = await Promise.all([
    args.runtime.findObject({ objectApiName: mapping.rootObject.objectApiName, id: source.recordId, fields: fields.root }),
    args.runtime.findObject({ objectApiName: mapping.applicant.objectApiName, id: workflow.applicantId, fields: fields.applicant }),
    args.runtime.findObject({ objectApiName: mapping.shipmentDetailObject.objectApiName, id: source.shipmentDetailId, fields: fields.detail }),
  ])
  objectId(rootRecord, source.recordId, '根业务对象')
  objectId(applicantRecord, workflow.applicantId, '申请人对象')
  objectId(detailRecord, source.shipmentDetailId, '寄件明细对象')

  const parentRecordId = valueOf(mapping.shipmentDetailObject.parentRecordId, detailRecord, 'shipmentDetail.parentRecordId')
  if (String(parentRecordId) !== source.recordId) {
    throw new FxiaokeAplContractError('APL_OBJECT_MISMATCH', '寄件明细不属于指定审批业务记录')
  }
  const employeeId = stringOf(mapping.applicant.employeeId, applicantRecord, 'applicant.employeeId')
  if (employeeId !== workflow.applicantId) {
    throw new FxiaokeAplContractError('APL_TASK_APPLICANT_MISMATCH', '申请人对象与审批实例申请人不一致')
  }

  const payload = {
    event: {
      enterpriseId: mapping.enterpriseId,
      workflowInstanceId: workflow.instanceId,
      objectApiName: mapping.workflow.objectApiName,
      recordId: source.recordId,
      shipmentDetailId: source.shipmentDetailId,
      taskId: source.taskId,
      stageId: stage.stageId,
      revisionId: String(valueOf(mapping.rootObject.revisionId, rootRecord, 'rootObject.revisionId')),
    },
    applicant: {
      employeeId,
      name: stringOf(mapping.applicant.name, applicantRecord, 'applicant.name'),
      phone: stringOf(mapping.applicant.phone, applicantRecord, 'applicant.phone'),
      ...(mapping.applicant.departmentId ? { departmentId: stringOf(mapping.applicant.departmentId, applicantRecord, 'applicant.departmentId') } : {}),
      departmentName: stringOf(mapping.applicant.departmentName, applicantRecord, 'applicant.departmentName'),
    },
    customer: {
      accountId: String(valueOf(mapping.rootObject.customerId, rootRecord, 'rootObject.customerId')),
      name: stringOf(mapping.rootObject.customerName, rootRecord, 'rootObject.customerName'),
    },
    shipment: mappedShipment(mapping.shipmentDetailObject.shipment, detailRecord),
  }
  const parsed = crmIntakeBodySchema.safeParse(payload)
  if (!parsed.success) {
    throw new FxiaokeAplContractError('APL_MAPPING_VALUE_INVALID', '映射结果未通过 ICU 寄件请求校验', {
      issues: parsed.error.issues.map(issue => ({ path: issue.path.join('.'), message: issue.message })),
    })
  }
  return { payload: parsed.data, applicantId: workflow.applicantId, workflow, task }
}
