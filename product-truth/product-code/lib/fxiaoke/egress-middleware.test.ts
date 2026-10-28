// @vitest-environment node
import { expect, it } from 'vitest'
import { NextRequest } from 'next/server'
import { middleware } from '../../middleware'
it('exempts only the exact machine endpoint from session login; adjacent organization APIs stay protected',async () => {
  const origin='https://sales.cyanlog.icu'
  const worker=await middleware(new NextRequest(`${origin}/api/admin/organization-sources/fxiaoke/egress`,{method:'POST'}))
  expect(worker.headers.get('x-middleware-next')).toBe('1')
  for(const path of ['/api/admin/organization-sources/fxiaoke','/api/admin/organization-sources/fxiaoke/egress/other']) {
    expect((await middleware(new NextRequest(`${origin}${path}`))).status).toBe(401)
  }
})
