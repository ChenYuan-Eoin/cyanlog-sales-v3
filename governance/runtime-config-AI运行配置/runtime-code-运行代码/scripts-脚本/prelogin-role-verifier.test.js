const {test} = require('node:test')
const assert = require('node:assert/strict')
const v = require('./prelogin-role-verifier')
const expected = {commit:'1'.repeat(40), deploymentId:'dpl_test', now:Date.now()}
function valid() {
  return {contract_version:v.CONTRACT, environment:'production', result:'pass', url:'https://sales.cyanlog.icu/configs?tab=role-access',
    commit:expected.commit, deployment_id:expected.deploymentId, attestation_type:'trusted_operator_browser',
    trust_boundary:'operator_attestation_not_machine_proof', attestation_method:'codex_chrome_control_existing_session',
    attested_by:'test', attested_at:new Date(expected.now).toISOString(), browser_context:'existing_user_chrome',
    existing_tab_id:'existing', new_tabs:0, new_browser_contexts:0, actions:[...v.ACTIONS], target_name:'刘楠楠',
    target_match_count:1, role_name:'顺丰寄件操作员', organization_member_selectable:true, role_picker_selectable:true,
    no_business_writes:true, role_saved:false, first_login_performed:false, attachments:[{path:'observation.json',sha256:'1'.repeat(64)}]}
}
test('both entry points must show one eligible employee without performing a real mutation', () => {
  assert.deepEqual(v.productionOperatorBlockers(valid(), expected), [])
  for(const delta of [{actions:[]},{role_saved:true},{first_login_performed:true},{organization_member_selectable:false},
    {role_picker_selectable:false},{target_match_count:2},{new_tabs:1},{target_name:'其他成员'},{result:'fail'},
    {url:'https://sales.cyanlog.icu/login'},{commit:'2'.repeat(40)},{attachments:[]}]){
    assert.ok(v.productionOperatorBlockers({...valid(),...delta},expected).length,JSON.stringify(delta))
  }
})
test('business evidence and migration authorization cannot be substituted by a bare website approval', () => {
  assert.ok(v.productionFirstExceptionBlockers({activeId:'WP44',contractVersion:v.CONTRACT,
    candidateIsAncestor:true,changedPaths:['product-truth/product-code/app/configs/page.tsx']}).length)
  assert.ok(v.productionBlockers({prelogin_role_eligibility:{payload:valid()}},expected).length)
})
