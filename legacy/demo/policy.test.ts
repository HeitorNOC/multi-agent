import test from 'node:test';import assert from 'node:assert/strict';
import {validatePlan,reviewable,authorize} from './policy.ts';
const report={january_revenue:10000,february_revenue:8000,revenue_drop_pct:20,january_stockouts:0,february_stockouts:0,causal_proof:false,summary:'Queda observada sem causa estabelecida.',action:'Investigar a queda de pedidos com a equipe comercial.',hypotheses:[],cited_sources:['sales-january','sales-february','inventory'],requires_approval:false};
test('modelo não amplia equipe nem dispensa aprovação',()=>{
 assert.throws(()=>validatePlan({strategy:'A3',capabilities:['sales_analysis','inventory_analysis','admin'],reason:'Razão suficientemente longa'}));
 assert.throws(()=>validatePlan({strategy:'A3',capabilities:['sales_analysis','sales_analysis'],reason:'Razão suficientemente longa'}));
 const result=validatePlan({strategy:'A3',capabilities:['sales_analysis','inventory_analysis'],reason:'Análise transversal de vendas e estoque',requires_approval:false});assert.equal(result.requires_approval,true);
});
test('aprovação ausente, hash alterado e conteúdo adulterado bloqueiam efeito',()=>{
 const review=reviewable('job',report);assert.equal(review.requires_approval,true);
 assert.throws(()=>authorize(review,null,review.hash));assert.throws(()=>authorize(review,review.hash,'alterado'));
 authorize(review,review.hash,review.hash);
 assert.throws(()=>authorize({...review,payload:{...review.payload,recipient:'externo'}},review.hash,review.hash));
});
test('fato errado, causalidade inventada ou fonte desconhecida bloqueiam a proposta',()=>{
 assert.throws(()=>reviewable('job',{...report,february_revenue:9000}));
 assert.throws(()=>reviewable('job',{...report,causal_proof:true}));
 assert.throws(()=>reviewable('job',{...report,cited_sources:[...report.cited_sources,'fonte-secreta']}));
});
