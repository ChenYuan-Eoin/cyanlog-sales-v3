export type ShippingWorkbenchRequest = <T>(url: string, init?: RequestInit) => Promise<T>

type RequestStage = 'validation' | 'provider_rejected' | 'provider_unreachable' | 'provider_http_error' | 'provider_invalid_response' | 'client_network_error' | 'client_invalid_response'
const serverStages = new Set<RequestStage>(['validation', 'provider_rejected', 'provider_unreachable', 'provider_http_error', 'provider_invalid_response'])

export class ShippingWorkbenchRequestError extends Error {
  constructor(message: string, public readonly status?: number, public readonly requestStage?: RequestStage) {
    super(message)
    this.name = 'ShippingWorkbenchRequestError'
  }
}

export function isDefinitiveShippingRejection(error: unknown): boolean {
  if (!(error instanceof ShippingWorkbenchRequestError)) return false
  if (error.requestStage === 'validation' || error.requestStage === 'provider_rejected') return true
  if (error.requestStage) return false
  return error.status !== undefined && [400, 401, 403, 413, 422].includes(error.status)
}

export const shippingWorkbenchRequest: ShippingWorkbenchRequest = async <T>(url: string, init?: RequestInit) => {
  let response: Response
  try { response = await fetch(url, { ...init, cache: 'no-store', headers: init?.body ? { 'Content-Type': 'application/json', ...init.headers } : init?.headers }) }
  catch { throw new ShippingWorkbenchRequestError('网络中断，无法确认请求结果。', undefined, 'client_network_error') }
  let data: unknown
  try { data = await response.json() }
  catch { throw new ShippingWorkbenchRequestError('服务响应无法识别，无法确认请求结果。', response.status, 'client_invalid_response') }
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new ShippingWorkbenchRequestError('服务响应不完整，无法确认请求结果。', response.status, 'client_invalid_response')
  const body = data as Record<string, unknown>
  if (!response.ok) {
    if (typeof body.error !== 'string' || !body.error.trim() || (body.requestStage !== undefined && !serverStages.has(body.requestStage as RequestStage))) {
      throw new ShippingWorkbenchRequestError('服务响应不完整，无法确认请求结果。', response.status, 'client_invalid_response')
    }
    throw new ShippingWorkbenchRequestError(body.error, response.status, body.requestStage as RequestStage | undefined)
  }
  if ('error' in body) throw new ShippingWorkbenchRequestError('服务响应状态不一致，无法确认请求结果。', response.status, 'client_invalid_response')
  return data as T
}

export type ShippingSimulation = {
  request: ShippingWorkbenchRequest
  sampleText: string
  onReset: () => void
}
