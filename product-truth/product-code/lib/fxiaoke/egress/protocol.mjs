// Shared server/worker contract. This is not an arbitrary HTTP proxy.
export const MAX_RESPONSE_BYTES = 1024 * 1024;
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const exactKeys = (value, keys) => plain(value) && Object.keys(value).sort().join(',') === [...keys].sort().join(',');
const identifier = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value);
const secret = value => typeof value === 'string' && value.length > 0 && value.length <= 2048 && !/[\r\n]/.test(value);
const projections = {
  DepartmentObj: ['_id','name','parent_id','status'],
  PersonnelObj: ['_id','user_id','name','main_department','status','is_pause_login'],
};
export function validRequest(input) {
  try {
    if (!exactKeys(input, ['url','headers','body']) || typeof input.body !== 'string' || input.body.length > 8192) return false;
    const url = new URL(input.url);
    if (url.origin !== 'https://open.fxiaoke.com' || url.username || url.password || url.hash) return false;
    if ([...url.searchParams.keys()].join(',') !== 'thirdTraceId' || !/^[0-9a-f-]{36}$/i.test(url.searchParams.get('thirdTraceId') || '')) return false;
    const body = JSON.parse(input.body);
    if (url.pathname === '/oauth2.0/token') {
      return exactKeys(input.headers, ['content-type']) && input.headers['content-type'] === 'application/json'
        && exactKeys(body, ['appId','appSecret','permanentCode','grantType'])
        && identifier(body.appId) && secret(body.appSecret) && secret(body.permanentCode) && body.grantType === 'app_secret';
    }
    if (url.pathname !== '/cgi/crm/v2/data/query') return false;
    if (!exactKeys(input.headers, ['content-type','authorization','x-fs-ea','x-fs-userid'])
      || input.headers['content-type'] !== 'application/json' || !secret(input.headers.authorization)
      || !input.headers.authorization.startsWith('Bearer ') || !identifier(input.headers['x-fs-ea']) || !identifier(input.headers['x-fs-userid'])) return false;
    if (!exactKeys(body, ['convertUserId','data']) || body.convertUserId !== false || !exactKeys(body.data, ['dataObjectApiName','search_query_info'])) return false;
    const query = body.data.search_query_info;
    const fields = projections[body.data.dataObjectApiName];
    return !!fields && exactKeys(query, ['limit','offset','fieldProjection','filters'])
      && query.limit === 100 && Number.isInteger(query.offset) && query.offset >= 0 && query.offset <= 5000 && query.offset % 100 === 0
      && JSON.stringify(query.fieldProjection) === JSON.stringify(fields) && Array.isArray(query.filters) && query.filters.length === 0;
  } catch { return false; }
}
export function validResult(value) {
  if (exactKeys(value, ['error'])) return ['NETWORK','TIMEOUT','INVALID_RESPONSE'].includes(value.error);
  return exactKeys(value, ['status','body']) && Number.isInteger(value.status) && value.status >= 200 && value.status <= 599
    && typeof value.body === 'string' && Buffer.byteLength(value.body, 'utf8') <= MAX_RESPONSE_BYTES;
}
export async function executeRequest(input, request = fetch, timeoutMs = 12000) {
  if (!validRequest(input)) return { error: 'INVALID_RESPONSE' };
  try {
    const response = await request(input.url, {
      method: 'POST', headers: input.headers, body: input.body, redirect: 'error',
      cache: 'no-store', signal: AbortSignal.timeout(timeoutMs),
    });
    if (Number(response.headers.get('content-length')) > MAX_RESPONSE_BYTES) {
      await response.body?.cancel(); return { error: 'INVALID_RESPONSE' };
    }
    const reader = response.body?.getReader();
    const chunks = []; let length = 0;
    if (reader) {
      while (true) {
        const part = await reader.read(); if (part.done) break;
        length += part.value.byteLength;
        if (length > MAX_RESPONSE_BYTES) { await reader.cancel(); return { error: 'INVALID_RESPONSE' }; }
        chunks.push(Buffer.from(part.value));
      }
    }
    return { status: response.status, body: Buffer.concat(chunks).toString('utf8') };
  } catch (error) {
    return { error: ['TimeoutError','AbortError'].includes(error?.name) ? 'TIMEOUT' : 'NETWORK' };
  }
}
