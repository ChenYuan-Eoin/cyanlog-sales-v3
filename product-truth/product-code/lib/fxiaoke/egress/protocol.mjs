// Shared server/worker contract. This is not an arbitrary HTTP proxy.
export const MAX_RESPONSE_BYTES = 1024 * 1024;
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const exactKeys = (value, keys) => plain(value) && Object.keys(value).sort().join(',') === [...keys].sort().join(',');
const identifier = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value);
const secret = value => typeof value === 'string' && value.length > 0 && value.length <= 2048 && !/[\r\n]/.test(value);
const departmentProjection = ['_id','name','parent_id','status'];
const directoryProjections = {
  DepartmentObj: [departmentProjection],
  PersonnelObj: [
    ['_id','user_id','name','data_own_department','vice_departments','status','is_pause_login','employee_number','email','phone'],
    // Transitional compatibility for the already-deployed website during the
    // atomic worker rollout. Remove only after the old Production SHA is no
    // longer eligible for traffic or rollback.
    ['_id','user_id','name','main_department','status','is_pause_login'],
  ],
};
const identityProjection = ['_id','user_id','full_name','name','phone','employee_number','status','is_pause_login','life_status','is_deleted'];
export function validRequest(input) {
  try {
    if (!exactKeys(input, ['url','headers','body']) || typeof input.body !== 'string' || input.body.length > 8192) return false;
    const url = new URL(input.url);
    if (url.origin !== 'https://open.fxiaoke.com' || url.username || url.password || url.hash) return false;
    if ([...url.searchParams.keys()].join(',') !== 'thirdTraceId' || !/^[0-9a-f-]{36}$/i.test(url.searchParams.get('thirdTraceId') || '')) return false;
    const body = JSON.parse(input.body);
    if (url.pathname === '/oauth2.0/token') {
      if (!exactKeys(input.headers, ['content-type']) || input.headers['content-type'] !== 'application/json') return false;
      if (exactKeys(body, ['appId','appSecret','permanentCode','grantType'])) {
        return identifier(body.appId) && secret(body.appSecret) && secret(body.permanentCode) && body.grantType === 'app_secret';
      }
      return exactKeys(body, ['appId','appSecret','redirectUrl','code','grantType'])
        && identifier(body.appId) && secret(body.appSecret) && secret(body.code)
        && body.grantType === 'authorization_code'
        && body.redirectUrl === 'https://sales.cyanlog.icu/api/auth/fxiaoke/callback'
        && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(url.searchParams.get('thirdTraceId'));
    }
    if (url.pathname !== '/cgi/crm/v2/data/query') return false;
    if (!exactKeys(input.headers, ['content-type','authorization','x-fs-ea','x-fs-userid'])
      || input.headers['content-type'] !== 'application/json' || !secret(input.headers.authorization)
      || !input.headers.authorization.startsWith('Bearer ') || !identifier(input.headers['x-fs-ea']) || !identifier(input.headers['x-fs-userid'])) return false;
    const previewEnvelope = exactKeys(body, ['convertUserId','returnTotalNum','data']) && body.returnTotalNum === 1;
    const identityEnvelope = exactKeys(body, ['convertUserId','data']);
    if ((!previewEnvelope && !identityEnvelope) || body.convertUserId !== false || !exactKeys(body.data, ['dataObjectApiName','search_query_info'])) return false;
    const query = body.data.search_query_info;
    const allowedProjections = directoryProjections[body.data.dataObjectApiName];
    if (
      !allowedProjections
      || !exactKeys(query, ['limit','offset','fieldProjection','filters','orders'])
      || query.limit !== 100 || !Number.isInteger(query.offset)
      || query.offset < 0 || query.offset > 5000
      || !Array.isArray(query.filters)
    ) return false;
    const hasDirectoryProjection = allowedProjections.some(fields =>
      JSON.stringify(query.fieldProjection) === JSON.stringify(fields));
    const stableOrder = Array.isArray(query.orders)
      && query.orders.length === 1
      && exactKeys(query.orders[0], ['fieldName','isAsc'])
      && query.orders[0].fieldName === '_id'
      && query.orders[0].isAsc === true;
    const firstPage = query.filters.length === 0;
    const cursorPage = query.filters.length === 1
      && exactKeys(query.filters[0], ['field_name','field_values','operator'])
      && query.filters[0].field_name === '_id'
      && query.filters[0].operator === 'GT'
      && Array.isArray(query.filters[0].field_values)
      && query.filters[0].field_values.length === 1
      && identifier(String(query.filters[0].field_values[0]));
    const isCurrentPreview = previewEnvelope
      && query.offset === 0
      && hasDirectoryProjection
      && stableOrder
      && (firstPage || cursorPage);
    const isRollbackPreview = identityEnvelope
      && query.offset % 100 === 0
      && hasDirectoryProjection
      && Array.isArray(query.orders) && query.orders.length === 0
      && firstPage;
    const isIdentityLookup = identityEnvelope
      && body.data.dataObjectApiName === 'PersonnelObj'
      && JSON.stringify(query.fieldProjection) === JSON.stringify(identityProjection)
      && Array.isArray(query.orders) && query.orders.length === 0
      && query.filters.length === 1
      && exactKeys(query.filters[0], ['field_name','field_values','operator'])
      && query.filters[0].field_name === 'user_id'
      && query.filters[0].operator === 'EQ'
      && Array.isArray(query.filters[0].field_values)
      && query.filters[0].field_values.length === 1
      && identifier(String(query.filters[0].field_values[0]));
    return isCurrentPreview || isRollbackPreview || isIdentityLookup;
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
