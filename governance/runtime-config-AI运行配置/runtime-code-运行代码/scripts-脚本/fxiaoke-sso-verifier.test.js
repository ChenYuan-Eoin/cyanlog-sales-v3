const test = require('node:test');
const assert = require('node:assert/strict');
const v = require('./fxiaoke-sso-verifier');

const expected = {
  commit: 'a'.repeat(40),
  deploymentId: 'dpl_SSOSelftest',
  now: Date.parse('2026-10-29T03:00:00Z')
};
const ids = {
  admin: '11111111-1111-4111-8111-111111111111',
  ordinary: '22222222-2222-4222-8222-222222222222',
  org: '33333333-3333-4333-8333-333333333333'
};
const attachment = [{ path: 'evidence.json', sha256: 'b'.repeat(64) }];

test('Preview SSO evidence requires stable mapping and complete denial coverage', () => {
  const payload = {
    contract_version: v.CONTRACT,
    environment: 'preview',
    source: 'preview_api_and_existing_chrome_operator',
    commit: expected.commit,
    deployment_id: expected.deploymentId,
    origin: 'https://preview.example.invalid',
    actions: v.PREVIEW_ACTIONS,
    provider_visible: true,
    authorization_start_redirect: true,
    admin_login_success: true,
    ordinary_login_success: true,
    session_issued: true,
    state_server_consumed: true,
    session_cookie_http_only: true,
    state_cookie_http_only: true,
    state_cookie_same_site: 'lax',
    state_cookie_secure: true,
    state_cookie_max_age_seconds: 300,
    invalid_state_status: 302,
    replayed_state_status: 302,
    cross_enterprise_status: 302,
    unmapped_identity_status: 302,
    identity_match_method: 'stable_mapping',
    name_matching_used: false,
    silent_phone_autolink_used: false,
    cross_tenant_session_created: false,
    admin_user_id: ids.admin,
    ordinary_user_id: ids.ordinary,
    org_id: ids.org,
    admin_org_id: ids.org,
    ordinary_org_id: ids.org,
    admin_role_codes: ['SUPER_ADMIN'],
    ordinary_role_codes: ['SALES'],
    attachments: attachment
  };
  assert.deepEqual(v.previewBlockers(payload, expected), []);
  for (const patch of [
    { name_matching_used: true },
    { identity_match_method: 'name' },
    { silent_phone_autolink_used: true },
    { state_server_consumed: false },
    { state_cookie_same_site: 'none' },
    { replayed_state_status: 200 },
    { cross_enterprise_status: 200 },
    { admin_role_codes: ['ADMIN'] },
    { ordinary_role_codes: ['SUPER_ADMIN'] },
    { attachments: [] }
  ]) {
    assert.notEqual(v.previewBlockers({ ...payload, ...patch }, expected).length, 0);
  }
});

test('Production operator cannot turn a code-only or incomplete login path into acceptance', () => {
  const operator = {
    contract_version: v.CONTRACT,
    commit: expected.commit,
    deployment_id: expected.deploymentId,
    environment: 'production',
    url: v.ORIGIN + '/login',
    attestation_type: 'trusted_operator_browser',
    trust_boundary: 'operator_attestation_not_machine_proof',
    attestation_method: 'codex_chrome_control_existing_session',
    attested_by: 'operator',
    attested_at: '2026-10-29T03:00:00Z',
    browser_context: 'existing_user_chrome',
    existing_tab_id: 'tab-1',
    new_tabs: 0,
    new_browser_contexts: 0,
    result: 'pass',
    actions: v.PRODUCTION_ACTIONS,
    admin_login_success: true,
    ordinary_login_success: true,
    session_issued: true,
    admin_role_verified: true,
    employee_role_verified: true,
    admin_corp_matches: true,
    ordinary_corp_matches: true,
    tenant_isolation_verified: true,
    invalid_state_rejected: true,
    replayed_state_rejected: true,
    replayed_code_rejected: true,
    cross_enterprise_rejected: true,
    unmapped_identity_rejected: true,
    disabled_identity_rejected: true,
    identity_conflict_rejected: true,
    password_recovery_removed: true,
    name_matching_used: false,
    cross_tenant_session_created: false,
    identity_match_method: 'stable_mapping',
    silent_phone_autolink_used: false,
    admin_user_id: ids.admin,
    ordinary_user_id: ids.ordinary,
    org_id: ids.org,
    admin_role_codes: ['SUPER_ADMIN'],
    ordinary_role_codes: ['SALES'],
    attachments: attachment
  };
  assert.deepEqual(v.productionOperatorBlockers(operator, expected), []);
  for (const patch of [
    { ordinary_login_success: false },
    { password_recovery_removed: false },
    { name_matching_used: true },
    { replayed_state_rejected: false },
    { ordinary_role_codes: ['SUPER_ADMIN'] },
    { url: 'https://preview.example.invalid/login' }
  ]) {
    assert.notEqual(v.productionOperatorBlockers({ ...operator, ...patch }, expected).length, 0);
  }
});

test('Production-first exception accepts only the scoped F003 SSO product tree and write boundaries', () => {
  const approval = {
    type: 'final_production_release_authorization',
    source: 'user_explicit',
    state: 'approved',
    code_release_authorized: true,
    production_database_write_authorized: true,
    carrier_calls_authorized: false,
    account_merge_execution_authorized: false,
    phone_history_migration_authorized: false,
    password_removal_authorized: false,
    preview_order_exception: true,
    preview_status: 'not_passed',
    approved_candidate: 'b'.repeat(40),
    approved_product_tree: 'c'.repeat(40),
    rollback_commit: 'd'.repeat(40),
    authorized_migrations: [{ path: 'supabase/migrations/sso.sql', sha256: 'e'.repeat(64) }]
  };
  const input = {
    approval,
    activeId: 'WP94',
    contractVersion: v.CONTRACT,
    productTree: 'c'.repeat(40),
    candidateIsAncestor: true,
    changedPaths: ['governance/runtime-state/demand-inbox.jsonl']
  };
  assert.deepEqual(v.productionFirstExceptionBlockers(input), []);
  assert.deepEqual(v.productionFirstExceptionBlockers({
    ...input,
    changedPaths: [
      'product-truth/product-code/app/api/admin/users/[id]/identity-binding/route.ts',
      'product-truth/product-code/app/api/auth/fxiaoke/start/route.test.ts',
      'product-truth/product-code/lib/auth/oauth-state.ts',
      'product-truth/product-code/lib/auth/oauth-state.test.ts',
      'product-truth/product-code/lib/auth/session-response.ts',
      'product-truth/product-code/lib/auth/session-response.test.ts',
      'product-truth/product-code/lib/fxiaoke/admin-binding-migration.test.ts',
      'product-truth/product-code/supabase/migrations/20261030110000_fix_fxiaoke_identity_binding_uuid.sql'
    ]
  }), []);
  assert.deepEqual(v.productionFirstExceptionBlockers({
    ...input,
    approval: { ...approval, production_database_write_authorized: false }
  }), []);
  assert.deepEqual(v.productionFirstExceptionBlockers({
    ...input,
    approval: { ...approval, production_database_write_authorized: false, authorized_migrations: [] }
  }), []);
  for (const patch of [
    { activeId: 'WP82' },
    { productTree: 'f'.repeat(40) },
    { candidateIsAncestor: false },
    { changedPaths: ['product-truth/product-code/app/login/page.tsx'] },
    { approval: { ...approval, account_merge_execution_authorized: true } },
    { approval: { ...approval, phone_history_migration_authorized: true } },
    { approval: { ...approval, authorized_migrations: [] } }
  ]) {
    assert.notEqual(v.productionFirstExceptionBlockers({ ...input, ...patch }).length, 0);
  }
});

test('controlled Production verifier rejects an invalid-state redirect that does not fail closed', async () => {
  const fs = require('fs');
  const os = require('os');
  const path = require('path');
  const crypto = require('crypto');
  const runtime = fs.mkdtempSync(path.join(os.tmpdir(), 'fxiaoke-sso-verifier-'));
  try {
    const digest = value => crypto.createHash('sha256').update(value).digest('hex');
    const evidence = Buffer.from('operator screenshot');
    fs.writeFileSync(path.join(runtime, 'evidence.png'), evidence);
    const operator = {
      contract_version: v.CONTRACT,
      commit: expected.commit,
      deployment_id: expected.deploymentId,
      environment: 'production',
      url: v.ORIGIN + '/login',
      attestation_type: 'trusted_operator_browser',
      trust_boundary: 'operator_attestation_not_machine_proof',
      attestation_method: 'codex_chrome_control_existing_session',
      attested_by: 'operator',
      attested_at: new Date().toISOString(),
      browser_context: 'existing_user_chrome',
      existing_tab_id: 'tab-1',
      new_tabs: 0,
      new_browser_contexts: 0,
      result: 'pass',
      actions: v.PRODUCTION_ACTIONS,
      admin_login_success: true,
      ordinary_login_success: true,
      session_issued: true,
      admin_role_verified: true,
      employee_role_verified: true,
      admin_corp_matches: true,
      ordinary_corp_matches: true,
      tenant_isolation_verified: true,
      invalid_state_rejected: true,
      replayed_state_rejected: true,
      replayed_code_rejected: true,
      cross_enterprise_rejected: true,
      unmapped_identity_rejected: true,
      disabled_identity_rejected: true,
      identity_conflict_rejected: true,
      password_recovery_removed: true,
      name_matching_used: false,
      cross_tenant_session_created: false,
      identity_match_method: 'stable_mapping',
      silent_phone_autolink_used: false,
      admin_user_id: ids.admin,
      ordinary_user_id: ids.ordinary,
      org_id: ids.org,
      admin_role_codes: ['SUPER_ADMIN'],
      ordinary_role_codes: ['SALES'],
      attachments: [{ path: 'evidence.png', sha256: digest(evidence) }]
    };
    const original = Buffer.from(JSON.stringify(operator));
    fs.writeFileSync(path.join(runtime, 'operator.json'), original);
    const envelope = { artifact_path: 'operator.json', sha256: digest(original), payload: operator };
    const responses = [
      new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }),
      new Response('', { status: 302, headers: { location: 'https://open.fxiaoke.com/oauth2.0/authorize?appId=x' } }),
      new Response('', { status: 302, headers: { location: `${v.ORIGIN}/` } })
    ];
    const request = async () => responses.shift();
    await assert.rejects(
      v.verify({ runtime, operator: envelope, commit: expected.commit, deploymentId: expected.deploymentId, request }),
      /invalid state did not fail closed/
    );
  } finally {
    fs.rmSync(runtime, { recursive: true, force: true });
  }
});

test('controlled Production verifier records four fail-closed public probes without fabricating denial credentials', async () => {
  const fs = require('fs');
  const os = require('os');
  const path = require('path');
  const crypto = require('crypto');
  const runtime = fs.mkdtempSync(path.join(os.tmpdir(), 'fxiaoke-sso-verifier-success-'));
  try {
    const digest = value => crypto.createHash('sha256').update(value).digest('hex');
    const evidence = Buffer.from('operator screenshot');
    fs.writeFileSync(path.join(runtime, 'evidence.png'), evidence);
    const operator = {
      contract_version: v.CONTRACT,
      commit: expected.commit,
      deployment_id: expected.deploymentId,
      environment: 'production',
      url: v.ORIGIN + '/login',
      attestation_type: 'trusted_operator_browser',
      trust_boundary: 'operator_attestation_not_machine_proof',
      attestation_method: 'codex_chrome_control_existing_session',
      attested_by: 'operator',
      attested_at: new Date().toISOString(),
      browser_context: 'existing_user_chrome',
      existing_tab_id: 'tab-1',
      new_tabs: 0,
      new_browser_contexts: 0,
      result: 'pass',
      actions: v.PRODUCTION_ACTIONS,
      admin_login_success: true,
      ordinary_login_success: true,
      session_issued: true,
      admin_role_verified: true,
      employee_role_verified: true,
      admin_corp_matches: true,
      ordinary_corp_matches: true,
      tenant_isolation_verified: true,
      invalid_state_rejected: true,
      replayed_state_rejected: true,
      replayed_code_rejected: true,
      cross_enterprise_rejected: true,
      unmapped_identity_rejected: true,
      disabled_identity_rejected: true,
      identity_conflict_rejected: true,
      password_recovery_removed: true,
      name_matching_used: false,
      cross_tenant_session_created: false,
      identity_match_method: 'stable_mapping',
      silent_phone_autolink_used: false,
      admin_user_id: ids.admin,
      ordinary_user_id: ids.ordinary,
      org_id: ids.org,
      admin_role_codes: ['SUPER_ADMIN'],
      ordinary_role_codes: ['SALES'],
      attachments: [{ path: 'evidence.png', sha256: digest(evidence) }]
    };
    const original = Buffer.from(JSON.stringify(operator));
    fs.writeFileSync(path.join(runtime, 'operator.json'), original);
    const envelope = { artifact_path: 'operator.json', sha256: digest(original), payload: operator };
    const responses = [
      new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }),
      new Response('', { status: 302, headers: {
        location: 'https://open.fxiaoke.com/oauth2.0/authorize?appId=x',
        'set-cookie': 'fxiaoke_oauth_state=redacted; Path=/api/auth/fxiaoke/callback; HttpOnly; Secure; SameSite=lax; Max-Age=300'
      } }),
      new Response('', { status: 302, headers: { location: `${v.ORIGIN}/login?sso_error=SSO_STATE_INVALID` } }),
      new Response('', { status: 404 })
    ];
    const request = async () => responses.shift();
    const section = await v.verify({
      runtime,
      operator: envelope,
      commit: expected.commit,
      deploymentId: expected.deploymentId,
      request
    });
    assert.deepEqual(section.verifier.payload.probes.map(probe => [probe.name, probe.status]), [
      ['providers', 200],
      ['start', 302],
      ['invalid-state', 302],
      ['password-login', 404]
    ]);
    assert.equal(section.fxiaoke_sso_denials.payload.invalid_state_error_code, 'SSO_STATE_INVALID');
    assert.equal(section.fxiaoke_sso_denials.payload.password_login_removed, true);
    assert.equal(section.verifier.payload.state_cookie_http_only, true);
    assert.equal(section.verifier.payload.state_cookie_secure, true);
    assert.equal(section.verifier.payload.source_operator_sha256, envelope.sha256);
  } finally {
    fs.rmSync(runtime, { recursive: true, force: true });
  }
});

test('member UI contract accepts only scoped existing-IAB read-only observations and keeps full SSO independent', () => {
  const member = v.forContract('f003-org-member-ui-v1');
  assert.equal(v.forContract(v.CONTRACT), v);
  const payload = {
    contract_version: member.CONTRACT, commit: expected.commit, deployment_id: expected.deploymentId,
    environment: 'production', url: 'https://sales.cyanlog.icu/configs?tab=org-structure',
    source: 'trusted_existing_iab_operator', attestation_type: 'trusted_operator_browser',
    trust_boundary: 'operator_attestation_not_machine_proof', attestation_method: 'codex_iab_control_existing_session',
    browser_context: 'existing_user_iab', existing_tab_id: 'existing-1', new_tabs: 0, new_browser_contexts: 0,
    attested_by: 'operator', attested_at: '2026-10-29T03:00:00Z', result: 'pass',
    no_business_writes: true, carrier_calls: false, full_sso_acceptance: false,
    actions: member.PRODUCTION_ACTIONS,
    observations: member.PRODUCTION_ACTIONS.map(action => ({ action, result: 'pass', detail: 'Observed actual member page behavior.' })),
    active_members_only_by_default: true, departed_not_first_login: true, historical_records_queryable: true,
    manual_member_controls_preserved: true, directory_lifecycle_controls_absent: true, employee_login_link_visible: true,
    attachments: attachment,
  };
  assert.deepEqual(member.productionOperatorBlockers(payload, expected), []);
  for (const patch of [{full_sso_acceptance: true}, {no_business_writes:false}, {browser_context:'new_context'}, {departed_not_first_login:false}, {actions:[]}]) {
    assert.ok(member.productionOperatorBlockers({...payload,...patch},expected).length > 0);
  }
  assert.ok(v.productionOperatorBlockers(payload,expected).length > 0);
});

test('member verifier checks real probe results and binds existing-session observations without writing business data', async () => {
  const fs = require('fs'), os = require('os'), path = require('path'), crypto = require('crypto');
  const member = v.forContract('f003-org-member-ui-v1'), runtime = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'member-proof-')));
  const hash = x => crypto.createHash('sha256').update(x).digest('hex');
  try {
    const raw = Buffer.from('member page observation'); fs.writeFileSync(path.join(runtime, 'raw.txt'), raw);
    const payload = {
      contract_version: member.CONTRACT, commit: expected.commit, deployment_id: expected.deploymentId,
      environment:'production',url:'https://sales.cyanlog.icu/configs?tab=org-structure',source:'trusted_existing_iab_operator',
      attestation_type:'trusted_operator_browser',trust_boundary:'operator_attestation_not_machine_proof',
      attestation_method:'codex_iab_control_existing_session',browser_context:'existing_user_iab',existing_tab_id:'1',
      new_tabs:0,new_browser_contexts:0,attested_by:'operator',attested_at:new Date().toISOString(),result:'pass',
      no_business_writes:true,carrier_calls:false,full_sso_acceptance:false,actions:member.PRODUCTION_ACTIONS,
      observations:member.PRODUCTION_ACTIONS.map(action=>({action,result:'pass',detail:'Observed current member page behavior.'})),
      active_members_only_by_default:true,departed_not_first_login:true,historical_records_queryable:true,
      manual_member_controls_preserved:true,directory_lifecycle_controls_absent:true,employee_login_link_visible:true,
      attachments:[{path:'raw.txt',sha256:hash(raw)}],
    };
    const data=Buffer.from(JSON.stringify(payload));fs.writeFileSync(path.join(runtime,'operator.json'),data);
    const operator={artifact_path:'operator.json',sha256:hash(data),payload};let calls=[];
    const request=async (url,options)=>{calls.push({url,options});return url.endsWith('/api/auth/providers')
      ? new Response(JSON.stringify({providers:[{id:'fxiaoke',startUrl:'/api/auth/fxiaoke/start'}]}),{status:200})
      : new Response('',{status:307,headers:{location:'/login'}});};
    const section=await member.verify({runtime,operator,commit:expected.commit,deploymentId:expected.deploymentId,request});
    assert.deepEqual(member.productionBlockers(section,expected),[]);
    assert.deepEqual(calls.map(x=>[x.options.method,x.options.credentials]),[['GET','omit'],['GET','omit']]);
    await assert.rejects(()=>member.verify({runtime,operator,commit:expected.commit,deploymentId:expected.deploymentId,request:async()=>new Response('{}',{status:200})}),/probes incomplete/);
  } finally {fs.rmSync(runtime,{recursive:true,force:true});}
});
