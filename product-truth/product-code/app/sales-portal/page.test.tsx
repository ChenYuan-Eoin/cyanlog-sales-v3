import React from 'react'
import {afterEach,beforeEach,expect,it,vi} from 'vitest'
const m=vi.hoisted(()=>({settings:vi.fn(),profile:vi.fn(),options:vi.fn(),redirect:vi.fn()}))
vi.mock('next/headers',()=>({headers:async()=>new Headers()}))
vi.mock('next/navigation',()=>({redirect:m.redirect}))
vi.mock('@/lib/shipping/runtime-config',()=>({resolvePublicShippingOrgId:async()=>'org-one'}))
vi.mock('@/lib/shipping/wecom-settings',()=>({readWecomSettings:m.settings}))
vi.mock('@/lib/shipping/wecom-session',()=>({getWecomSession:m.profile,wecomProfileDto:(value:unknown)=>value}))
vi.mock('@/lib/shipping/intake-options',()=>({loadPublicIntakeOptions:m.options}))
vi.mock('./portal',()=>({default:()=>null}))
import Page from './page'
beforeEach(()=>{vi.stubGlobal('React',React);vi.clearAllMocks();m.settings.mockResolvedValue({order_check_mode:1,directory_synced_at:'2026-10-10',denied_message:'无权访问'});m.profile.mockResolvedValue(null);m.options.mockResolvedValue({requireVerification:true,services:[]});m.redirect.mockImplementation((path:string)=>{throw new Error('REDIRECT:'+path)})})
afterEach(()=>vi.unstubAllGlobals())
it('redirects an unauthenticated visitor before the form can be returned',async()=>{await expect(Page({searchParams:Promise.resolve({})})).rejects.toThrow('REDIRECT:/api/shipping/public/wecom/authorize')})
it('does not accept a session belonging to another organization',async()=>{m.profile.mockResolvedValue({orgId:'foreign'});await expect(Page({searchParams:Promise.resolve({})})).rejects.toThrow('REDIRECT:')})
it('renders the portal only after the server verifies a member',async()=>{m.profile.mockResolvedValue({id:'staff',orgId:'org-one'});const result=await Page({searchParams:Promise.resolve({})});expect(result.props.initialEmployee).toMatchObject({id:'staff'});expect(m.redirect).not.toHaveBeenCalled()})
it('keeps access failures out of the portal instead of opening anonymous access',async()=>{m.settings.mockRejectedValue(new Error('database failed'));const result=await Page({searchParams:Promise.resolve({})});expect(result.props.initialEmployee).toBeUndefined();expect(m.redirect).not.toHaveBeenCalled()})
