export type EgressRequest = { url: string; headers: Record<string,string>; body: string }
export type EgressResult = { status: number; body: string } | { error: 'NETWORK' | 'TIMEOUT' | 'INVALID_RESPONSE' }
export const MAX_RESPONSE_BYTES: number
export function validRequest(value: unknown): value is EgressRequest
export function validResult(value: unknown): value is EgressResult
export function executeRequest(input: EgressRequest, request?: typeof fetch, timeoutMs?: number): Promise<EgressResult>
