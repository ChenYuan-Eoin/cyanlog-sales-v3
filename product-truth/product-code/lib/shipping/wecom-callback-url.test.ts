import { expect, it } from 'vitest'
import { wecomApplicationCallbackUrl } from './wecom-callback-url'
it('supports the configured application domain without project-specific constants',()=>{expect(wecomApplicationCallbackUrl('shipping.company.example')).toBe('https://shipping.company.example/api/shipping/public/wecom/callback')})
it.each(['https://evil.example','good.example/redirect','good.example@evil.example','127.0.0.1','localhost','foo.local','foo.example?target=evil.example','foo.example:443'])('rejects malformed or local redirect domain %s',domain=>{expect(()=>wecomApplicationCallbackUrl(domain)).toThrow()})
