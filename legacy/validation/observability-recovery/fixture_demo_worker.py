"""Controlled HTTP/effect worker for regression only: no LangGraph or LLM claim."""
import json,os,sys,urllib.request
c=json.loads(sys.stdin.buffer.read().decode('utf-8'))
def call(path,**extra):
    raw=json.dumps({'job':c['job'],**extra}).encode()
    with urllib.request.urlopen(urllib.request.Request(c['api']+'/internal/'+path,raw,{'content-type':'application/json','x-demo-token':c['token']}),timeout=10) as response:return json.load(response)
job=call('snapshot')
if not job['plan']:call('plan',plan={'strategy':'A3','capabilities':['sales_analysis','inventory_analysis'],'reason':'Controlled transport regression, no real model invoked.'})
if not job['review']:call('review',report={'january_revenue':10000,'february_revenue':8000,'revenue_drop_pct':20,'january_stockouts':0,'february_stockouts':0,'causal_proof':False,'summary':'Controlled fixture, not semantic quality evidence.','action':'Register a fixture-only local proposal for API regression.','hypotheses':[],'cited_sources':['sales-january','sales-february','inventory']})
job=call('snapshot')
if not job['approval']:print(json.dumps({'completed':False}));sys.exit(0)
receipt=call('effect',hash=job['review']['hash'])
if c.get('crash_after_effect'):os._exit(88)
print(json.dumps({'completed':True,'receipt':receipt['id']}))
