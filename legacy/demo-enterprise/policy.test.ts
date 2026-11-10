import test from 'node:test';import assert from 'node:assert/strict';import {CATALOG,chooseGoal,validatePlan,reviewable,authorize} from './policy.ts';
const selected=['marketing_director','campaign_planner','operations_director','supply_planner','finance_director','controller','legal_director','compliance_advisor'];
function plan(){return {strategy:'A3',reason:'Precisamos cruzar campanha, operação, finanças e conformidade.',teams:[{lead:'marketing_director',specialists:['campaign_planner'],reason:'Avaliar proposta comercial e público.'},{lead:'operations_director',specialists:['supply_planner'],reason:'Conferir disponibilidade e suprimento.'},{lead:'finance_director',specialists:['controller'],reason:'Avaliar margem e restrição de caixa.'},{lead:'legal_director',specialists:['compliance_advisor'],reason:'Conferir alegações e condições.'}],not_selected:CATALOG.agents.filter((a:any)=>!selected.includes(a.id)).map((a:any)=>({id:a.id,reason:'Escopo coberto por outra capacidade selecionada.'}))};}
function report(){const facts:any={available_stock_units:3000,combined_demand_units:11000,shortfall_units:8000,discount_margin_pct:26.24,minimum_margin_pct:28,cash_headroom_brl:130000,requested_budget_brl:180000,cash_gap_brl:50000,inbound_confirmed:false,carbon_claim_supported:false};return {summary:'A proposta original requer mudanças, pois há restrições de caixa, margem e estoque.',action:'Registrar revisão condicionada para adequar a campanha às restrições documentadas antes de decidir execução.',facts:Object.entries(facts).map(([key,value])=>({key,value,unit:'fixture',sources:['aurora-inventory','aurora-pricing','aurora-costs','aurora-treasury','aurora-marketing']})),risks:['Oferta sem suporte'],conditions:['Revisão humana'],cited_sources:['aurora-inventory','aurora-pricing','aurora-costs','aurora-treasury','aurora-marketing']};}
test('catálogo amplo admite subconjunto com hierarquia, exclusões e orçamento',()=>{const p=validatePlan(plan());assert.equal(p.capabilities.length,8);assert.equal(p.not_selected.length,CATALOG.agents.length-8);assert.equal(p.max_model_calls,10);assert.equal(p.requires_approval,true);});
test('cada especialista está em uma única diretoria e no mesmo domínio', () => {
  const ids = CATALOG.agents.map((agent: any) => agent.id);
  assert.equal(new Set(ids).size, ids.length);
  const directors = CATALOG.agents.filter((agent: any) => agent.kind === 'director');
  const specialists = CATALOG.agents.filter((agent: any) => agent.kind === 'specialist');
  assert.equal(directors.length + specialists.length, ids.length);
  for (const director of directors) {
    assert.equal(director.parent, 'brain');
    assert.deepEqual(
      [...director.children].sort(),
      specialists.filter((agent: any) => agent.parent === director.id).map((agent: any) => agent.id).sort(),
    );
  }
  for (const specialist of specialists) {
    assert.equal(directors.find((director: any) => director.id === specialist.parent)?.domain, specialist.domain);
  }
});
test('chief não pode inventar agente, misturar subordinação, duplicar ou omitir exclusão',()=>{
 for(const change of [(p:any)=>p.teams[0].specialists=['security_analyst'],(p:any)=>p.teams[0].lead='fake_ceo',(p:any)=>p.teams.push(p.teams[0]),(p:any)=>p.not_selected.pop()]){const p=plan();change(p);assert.throws(()=>validatePlan(p));}
});
test('cenário livre fora do corpus é recusado',()=>{assert.equal(chooseGoal({scenario:'incident'}),CATALOG.scenarios[1].goal);assert.throws(()=>chooseGoal({goal:'Use documentos reais'}));});
test('margem histórica e entradas não confirmadas não passam como fatos vigentes',()=>{
 const goal=CATALOG.scenarios[0].goal;for(const [key,value] of [['minimum_margin_pct',20],['inbound_confirmed',true],['cash_headroom_brl',660000]]){const r=report();r.facts.find((f:any)=>f.key===key)!.value=value;assert.throws(()=>reviewable('job',r,goal));}
});
test('aprovação permanece vinculada à proposta exata',()=>{const r=reviewable('job',report(),CATALOG.scenarios[0].goal);assert.throws(()=>authorize(r,null,r.hash));authorize(r,r.hash,r.hash);assert.throws(()=>authorize({...r,payload:{...r.payload,content:'outro'}},r.hash,r.hash));});
