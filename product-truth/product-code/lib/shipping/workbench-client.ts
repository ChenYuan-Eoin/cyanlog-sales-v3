export type ShippingWorkbenchRequest = <T>(url: string, init?: RequestInit) => Promise<T>

export const shippingWorkbenchRequest: ShippingWorkbenchRequest = async <T>(url: string, init?: RequestInit) => {
  const response = await fetch(url, { ...init, cache: 'no-store', headers: init?.body ? { 'Content-Type': 'application/json', ...init.headers } : init?.headers })
  const data = await response.json()
  if (!response.ok) throw new Error(data.error || '操作暂未完成')
  return data as T
}

export type ShippingSimulation = {
  request: ShippingWorkbenchRequest
  sampleText: string
  onReset: () => void
}
