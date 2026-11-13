// @vitest-environment node
import { expect, it } from 'vitest'
import { NextRequest } from 'next/server'
import { GET, POST } from './orders/route'
import { GET as optionsGET } from './options/route'

it('retires anonymous shipment creation and the organization-wide public list', async () => {
  const request = new NextRequest('https://sales.cyanlog.icu/api/shipping/public/orders', {
    method: 'POST', headers: { origin: 'https://sales.cyanlog.icu' }, body: '{}',
  })
  for (const response of [await POST(request), await GET()]) {
    expect(response.status).toBe(410)
    expect(await response.json()).toMatchObject({ code: 'AUTHENTICATED_INTAKE_REQUIRED' })
    expect(response.headers.get('cache-control')).toBe('no-store')
  }
})

it('retires anonymous disclosure of the organization sender and service settings', async () => {
  const response = await optionsGET()
  expect(response.status).toBe(410)
  expect(await response.json()).toMatchObject({ code: 'AUTHENTICATED_INTAKE_REQUIRED' })
})
