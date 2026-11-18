const test = require('node:test')
const assert = require('node:assert/strict')
const { CONTRACT, ROUTES, measurementBlockers, productionFirstExceptionBlockers } = require('./navigation-performance-verifier')

test('readiness requires the three actual destinations and rejects an over-budget observation', () => {
  const expected = {commit:'a'.repeat(40), deploymentId:'dpl_demo'}
  const sample = {
    environment:'production', commit:expected.commit, deployment_id:expected.deploymentId,
    browser_context:'existing_user_chrome', existing_tab_id:'existing', new_tabs:0, new_browser_contexts:0,
    attested_at:new Date().toISOString(), no_business_writes:true,
    observations:ROUTES.map(route => ({url:'https://sales.cyanlog.icu'+route,from_user_navigation:true,
      content_ready:true,ready_marker:'scoped list or confirmed empty state',elapsed_ms:2800})),
  }
  assert.deepEqual(measurementBlockers(sample, expected), [])
  for (const change of [{elapsed_ms:3001}, {content_ready:false}, {from_user_navigation:false}, {url:'https://example.com/tenders'}]) {
    assert.ok(measurementBlockers({...sample, observations:[{...sample.observations[0],...change},...sample.observations.slice(1)]},expected).length)
  }
})

test('production-first navigation authority is limited to the named product tree and read-only release', () => {
  const sha = 'a'.repeat(40)
  const approval = {target:'WP77',type:'final_production_release_authorization',state:'approved',source:'user_explicit',
    preview_status:'not_passed',preview_order_exception:true,code_release_authorized:true, database_write_authorized:false,
    production_database_write_authorized:false,carrier_calls_authorized:false, approved_candidate:sha,approved_product_tree:sha,rollback_commit:sha}
  const input = {approval,activeId:'WP77',contractVersion:CONTRACT,productTree:sha,candidateIsAncestor:true,
    changedPaths:['governance/runtime-state/active-task.json']}
  assert.deepEqual(productionFirstExceptionBlockers(input), [])
  for (const change of [{activeId:'WP35'},{candidateIsAncestor:false},{productTree:'b'.repeat(40)},
    {changedPaths:['product-truth/product-code/middleware.ts']},{approval:{...approval,preview_order_exception:false}},
    {approval:{...approval,production_database_write_authorized:true}}])
    assert.ok(productionFirstExceptionBlockers({...input,...change}).length)
})
