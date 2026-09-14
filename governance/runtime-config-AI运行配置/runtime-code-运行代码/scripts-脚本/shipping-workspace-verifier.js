// Read-only production checks. Never creates an order or changes account permissions.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const PROJECT = 'wfawwhphfqqwfwrrkogy';
const ORIGIN = 'https://sales.cyanlog.icu';
const TABLES = ['contract_ai_chats','contract_comparisons','contract_items','contract_signatures','contract_risk_cards','contract_template_params','contract_rule_snapshots','contract_risk_card_fixes','contract_rules_v2','contract_drafts','contract_comparison_diffs','shipping_requests','shipping_contacts','shipping_outbound_imports'];
const hash = value => crypto.createHash('sha256').update(value).digest('hex');

async function verify({ commit, deploymentId, runtime, operator, tables, token, sfPartner, sfCheckWord, ownerId, waybill }) {
  if (!/^[0-9a-f]{40}$/.test(commit) || !/^dpl_/.test(deploymentId)) throw Error('Exact production commit and deployment required');
  if (!/^[0-9a-f-]{36}$/.test(ownerId) || !/^SF[0-9]{10,15}$/.test(waybill)) throw Error('Owner and known personal waybill required');
  if (!token || !sfPartner || !sfCheckWord) throw Error('Missing read-only verifier credentials');
  // UI observations remain an operator attestation, never presented as a machine login proof.
  const ui = operator?.payload;
  if (ui?.commit !== commit || ui?.deployment_id !== deploymentId || ui?.origin !== ORIGIN || ui?.source !== 'trusted_existing_chrome_operator') throw Error('Current existing-Chrome attestation required');
  for (const key of ['address_book_usable','form_editable','production_submission_disabled','owner_can_read','foreign_waybill_denied']) if (ui[key] !== true) throw Error('Missing operator observation: '+key);
  if (!['sender_cash','recipient','sender_monthly'].every(x=>ui.payment_choices?.includes(x))) throw Error('Payment controls not observed');
  const out=path.join(runtime,'production-runtime-verifier',commit);fs.mkdirSync(out,{recursive:true,mode:0o700});
  const raw=[];
  function save(name,data){const f=path.join(out,name+'.json');fs.writeFileSync(f,JSON.stringify(data),{mode:0o600});const item={path:path.relative(runtime,f),sha256:hash(fs.readFileSync(f))};raw.push(item);return item;}
  async function getJson(url,options={}){const r=await fetch(url,{...options,signal:AbortSignal.timeout(20000)});const d=await r.json();if(!r.ok)throw Error('Read-only verifier request failed: '+r.status);return d;}
  async function query(sql){return getJson(`https://api.supabase.com/v1/projects/${PROJECT}/database/query`,{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({query:sql})});}
  const names=tables || TABLES;
  if (!names.every(t=>/^[a-z_]+$/.test(t)) || !['shipping_contacts','shipping_requests','shipping_outbound_imports'].every(t=>names.includes(t))) throw Error('Invalid scoped security catalog');
  const sqlNames=names.map(t=>"'"+t+"'").join(',');
  const catalog=await query(`select c.relname,c.relrowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname in (${sqlNames})`);
  save('catalog',catalog);if(catalog.length!==names.length)throw Error('Security catalog does not match expected tables');
  const rls=catalog.map(x=>({table:x.relname,enabled:x.relrowsecurity}));save('rls',rls);if(rls.some(x=>!x.enabled))throw Error('RLS disabled');
  const acl=await query(`select c.relname,has_table_privilege('anon',c.oid,'SELECT,INSERT,UPDATE,DELETE') as anon_access,has_table_privilege('authenticated',c.oid,'SELECT,INSERT,UPDATE,DELETE') as client_access,has_table_privilege('service_role',c.oid,'SELECT') as service_read from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname in (${sqlNames})`);
  save('acl',acl);if(acl.some(x=>x.anon_access||x.client_access||!x.service_read))throw Error('Private table ACL mismatch');
  const rpc=await query("select p.oid::regprocedure::text as signature,has_function_privilege('anon',p.oid,'EXECUTE') as anon_execute,has_function_privilege('authenticated',p.oid,'EXECUTE') as client_execute from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('exec_sql','claim_contract_analysis_job')");
  save('rpc',rpc);if(rpc.length<2||rpc.some(x=>x.anon_execute||x.client_execute))throw Error('Protected RPC permissions mismatch');
  const advisor=await getJson(`https://api.supabase.com/v1/projects/${PROJECT}/advisors/security`,{headers:{Authorization:'Bearer '+token}});
  save('advisor',advisor);
  const relevant=(advisor.lints||[]).filter(x=>names.includes(x.metadata?.name)&&x.level==='ERROR');if(relevant.length)throw Error('Scoped security advisor errors remain');
  const apiChecks={};
  for(const route of ['/shipping','/api/shipping/orders','/api/shipping/contacts']){const r=await fetch(ORIGIN+route,{redirect:'manual',signal:AbortSignal.timeout(20000)});const body=await r.text();apiChecks[route]={status:r.status,body};}
  save('anon',apiChecks);if(apiChecks['/shipping'].status!==200||apiChecks['/api/shipping/orders'].status!==401||apiChecks['/api/shipping/contacts'].status!==401)throw Error('Production public/private API boundary failed');
  const records=await query(`select waybill,verification_suffix from public.shipping_outbound_imports where created_by='${ownerId}' order by source_rank`);
  const contacts=await query(`select count(*)::int as total from public.shipping_contacts where created_by='${ownerId}'`);
  save('service_role',{source:'management_database_read',records:records.map(x=>({waybill:x.waybill})),contacts});
  const target=records.find(x=>x.waybill===waybill);if(!target||!contacts[0]?.total)throw Error('Personal address book or outbound record missing');
  const timestamp=Date.now().toString(),message=JSON.stringify({language:'0',trackingType:'1',trackingNumber:[waybill],methodType:'1',checkPhoneNo:target.verification_suffix});
  const msgDigest=crypto.createHash('md5').update(new URLSearchParams({v:message+timestamp+sfCheckWord}).toString().slice(2)).digest('base64');
  const supplier=await getJson('https://sfapi.sf-express.com/std/service',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded;charset=UTF-8'},body:new URLSearchParams({partnerID:sfPartner,requestID:crypto.randomUUID(),serviceCode:'EXP_RECE_SEARCH_ROUTES',timestamp,msgData:message,msgDigest})});
  save('supplier',supplier);const business=typeof supplier.apiResultData==='string'?JSON.parse(supplier.apiResultData):supplier.apiResultData;
  const route=business?.msgData?.routeResps?.find(x=>x.mailNo===waybill);
  if(supplier.apiResultCode!=='A1000'||![true,'true'].includes(business?.success)||!route?.routes?.length)throw Error('Production tracking did not return matching events');
  const originEvidence={commit,deployment_id:deploymentId,environment:'production',origin:ORIGIN};
  const attach=[...raw,{path:operator.artifact_path,sha256:operator.sha256}];
  function envelope(name,payload){const full={...originEvidence,...payload,attachments:attach};const f=path.join(out,name+'.json');fs.writeFileSync(f,JSON.stringify(full),{mode:0o600});return{artifact_path:path.relative(runtime,f),sha256:hash(fs.readFileSync(f)),payload:full};}
  return {
    security_gate:envelope('security-gate',{source:'live_production_database_verifier',gate_id:'SECURITY-P0-RLS-PRODUCTION',status:'passed',production_project_ref:PROJECT,checks:Object.fromEntries(['catalog','rls','acl','rpc','advisor','anon','service_role'].map(x=>[x,true]))}),
    verifier:envelope('verifier',{source:'live_production_runtime_verifier',operator_observations_are_attested:true}),
    shipping_workspace:envelope('workspace',{source:'production_database',page_accessible:true,address_book_usable:ui.address_book_usable,form_editable:ui.form_editable,payment_choices:ui.payment_choices,production_submission_disabled:ui.production_submission_disabled,outbound_count:records.length}),
    shipping_tracking:envelope('tracking',{source:'production_api',success:true,waybill,event_count:route.routes.length,endpoint:'https://sfapi.sf-express.com/std/service'}),
    shipping_access:envelope('access',{source:'production_api',anonymous_orders_denied:true,anonymous_contacts_denied:true,owner_can_read:ui.owner_can_read,foreign_waybill_denied:ui.foreign_waybill_denied,operator_observations_are_attested:true})
  };
}
module.exports={verify};
