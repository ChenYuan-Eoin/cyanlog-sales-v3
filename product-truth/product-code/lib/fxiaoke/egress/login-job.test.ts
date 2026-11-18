// @vitest-environment node
import { expect, it, vi } from 'vitest'
import { executeLoginJob, readLoginReply, validLoginJob, type LoginJob } from './login-job'

const job: LoginJob = { kind: 'employee_login_v1', credentials: {
  appId: 'app', appSecret: 'example-secret', apiUserId: '100', permanentCode: 'example-permanent',
  expectedEa: 'tenant', expectedCorpId: 'FSCID_one',
}, code: 'one-time-test', redirectUrl: 'https://sales.cyanlog.icu/api/auth/fxiaoke/callback' }

it('restricts login jobs to the fixed callback and rejects added fields', () => {
  expect(validLoginJob(job)).toBe(true)
  expect(validLoginJob({ ...job, redirectUrl: 'https://example.org' })).toBe(false)
  expect(validLoginJob({ ...job, url: 'https://example.org' })).toBe(false)
})

it('rejects a different company before looking up the employee and omits credentials from the result', async () => {
  const request = vi.fn().mockResolvedValue(Response.json({ errorCode: 0, corpId: 'FSCID_two',
    accessToken: 'example-sensitive-token', openUserId: 'FSUID_subject', expiresIn: 7200 }))
  const result = await executeLoginJob(job, request, 1500)
  expect(result).toEqual({ status: 403, body: JSON.stringify({ stage: 'enterprise_verification', code: 'CROSS_ENTERPRISE_IDENTITY' }) })
  expect(request).toHaveBeenCalledTimes(1)
})

it('rejects inconsistent subjects and disabled employees at the website response boundary', async () => {
  const profile = { externalSubject: 'FSUID_subject', directoryUserId: '10', phone: null, employeeNumber: null,
    displayName: '测试', status: 'active', loginDisabled: false, deleted: false, lifeStatus: null }
  for (const change of [{ externalSubject: 'FSUID_other' }, { status: 'disabled' }, { loginDisabled: true }, { deleted: true }]) {
    const response = Response.json({ corpId: 'FSCID_one', openUserId: 'FSUID_subject', profile: { ...profile, ...change } })
    await expect(readLoginReply(response, job.credentials, vi.fn())).rejects.toMatchObject({code: 'INVALID_RESPONSE'})
  }
})
