"""Selected directors delegate to selected specialists in nested native LangGraph graphs."""
import asyncio,json,operator,os,pathlib,sys,urllib.request,urllib.error
from typing import TypedDict,Annotated
from langgraph.graph import StateGraph,START,END
from langgraph.types import Send,Command,interrupt
from langgraph.checkpoint.postgres.aio import AsyncPostgresSaver
if sys.platform=='win32':asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())
CATALOG=json.loads(pathlib.Path(__file__).with_name('catalog.json').read_text(encoding='utf-8'))
AGENTS={a['id']:a for a in CATALOG['agents']}
class State(TypedDict,total=False):
    plan:dict
    department_reports:Annotated[list[dict],operator.add]
    review:dict
    receipt:dict
class Department(TypedDict,total=False):
    team:dict
    agent:str
    findings:Annotated[list[dict],operator.add]
    department_reports:Annotated[list[dict],operator.add]
def request(url,token,data):
    try:
        with urllib.request.urlopen(urllib.request.Request(url,json.dumps(data,ensure_ascii=False).encode(),{'content-type':'application/json','x-demo-token':token}),timeout=360) as res:return json.load(res)
    except urllib.error.HTTPError as error:raise RuntimeError(error.read().decode('utf-8')) from error
async def main(c):
    async def local(path,**extra):return await asyncio.to_thread(request,c['api']+'/internal/'+path,c['token'],{'job':c['job'],**extra})
    async def backend(action,**extra):return await asyncio.to_thread(request,c['backend']+'/rpc',c['token'],{'action':action,'job':c['job'],**extra})
    async def log(node,**detail):await local('event',node=node,detail=detail)
    async def llm(slot,prompt):return json.loads((await backend('llm',slot=slot,prompt=prompt))['text'])
    async def sources(agent):return await backend('retrieve',agent=agent)
    async def cos(state):
        await log('chief_of_staff',message='Escolhendo uma equipe a partir do catálogo completo de 21 agentes.')
        catalog=[{k:a[k] for k in ['id','title','kind','domain','parent','focus']} for a in CATALOG['agents']]
        prompt='Você é Chief of Staff do Grupo Aurora fictício. Pedido: '+c['goal']+'. Catálogo completo: '+json.dumps(catalog,ensure_ascii=False)+'. Escolha APENAS as diretorias e especialistas necessários. Agentes não selecionados não executarão nada. Diretores coordenam seus especialistas reais em subgrafos; não são somente rótulos. Cada time tem um diretor e um ou dois de seus próprios especialistas; máximo quatro times e oito agentes totais, com mínimo suficiente. Não convoque RH ou direção executiva por padrão. Não amplie escopo de um incidente para campanha ou vice-versa. Justifique todos os agentes deixados de fora. Return valid JSON only: strategy (A2 if one team, A3 if multiple teams), reason:string, teams:[{lead:catalog ID,specialists:[catalog IDs],reason:string}], not_selected:[{id:every unselected catalog ID,reason:string}], requires_approval:true. Escreva razões em português. Planeje sem executar ação externa.'
        p=await llm('plan',prompt);return {'plan':await local('plan',plan=p)}
    def dispatch(state):return [Send('department',{'team':team}) for team in state['plan']['teams']]
    def specialists(state):return [Send('specialist',{'agent':a,'team':state['team']}) for a in state['team']['specialists']]
    async def specialist(state):
        agent=state['agent'];meta=AGENTS[agent];await log('specialist_started',capability=agent,parent=meta['parent'])
        evidence=await sources(agent)
        value=await llm('agent:'+agent,'Você é '+meta['title']+', capacidade '+meta['focus']+'. Pedido: '+c['goal']+'. Fontes vigentes recuperadas pelo LightRAG: '+json.dumps(evidence,ensure_ascii=False)+'. Retorne JSON: agent, facts:[{claim:string,value:number or boolean or string,unit:string,sources:[source IDs]}], calculations:[{expression,result,source_ids}], risks:[string], unknowns:[string], recommendation:string. Português. Calcule dependências entre documentos quando necessário; explique fórmula e unidades. Diferencie saldo físico de livre, oportunidade de compromisso, teto de orçamento de caixa, política vigente de revogada, suspeita de exfiltração confirmada. Não invente fonte, prazo, causa ou autorização. Somente assessoramento.')
        await log('specialist_completed',capability=agent,parent=meta['parent'],sources=[x['source'] for x in evidence],output=value)
        return {'findings':[{'agent':agent,'output':value}]}
    async def director(state):
        agent=state['team']['lead'];meta=AGENTS[agent];await log('director_started',capability=agent,children=state['team']['specialists'])
        evidence=await sources(agent)
        value=await llm('agent:'+agent,'Você é '+meta['title']+', responsável por '+meta['focus']+'. Pedido: '+c['goal']+'. Evidência própria vigente: '+json.dumps(evidence,ensure_ascii=False)+'. Retornos dos seus especialistas: '+json.dumps(state['findings'],ensure_ascii=False)+'. Retorne JSON: agent, facts:[{claim,value,unit,sources:[source IDs]}], risks:[string], conditions:[string], recommendation:string, disagreements:[string]. Consolide e verifique a contribuição dos especialistas. Português. Não trate projeção como confirmado nem aprove ação. Registre dependências de outras áreas e ausência de prova. Citações devem ser IDs exatos fornecidos.')
        await log('director_completed',capability=agent,children=state['team']['specialists'],output=value)
        return {'department_reports':[{'lead':agent,'specialists':state['team']['specialists'],'output':value}]}
    async def synthesize(state):
        await log('synthesis',departments=len(state['department_reports']))
        scenario=next(s for s in CATALOG['scenarios'] if s['goal']==c['goal'])
        keys='available_stock_units, combined_demand_units, shortfall_units, discount_margin_pct, minimum_margin_pct, cash_headroom_brl, requested_budget_brl, cash_gap_brl, inbound_confirmed, carbon_claim_supported' if scenario['id']=='campaign' else 'potential_records, confirmed_exfiltration, response_sla_minutes, minutes_elapsed, minutes_remaining'
        value=await llm('synthesis','Você é Chief of Staff. Pedido: '+c['goal']+'. Relatórios das diretorias selecionadas: '+json.dumps(state['department_reports'],ensure_ascii=False)+'. Produza decisão integrada, não uma aprovação. Return JSON: summary:string, facts:[{key,value:number or boolean,unit:string,label:string,sources:[exact source IDs]}], risks:[string], conditions:[string], cited_sources:[exact IDs], action:string, requires_approval:true. Os facts devem incluir as chaves '+keys+'. Calcule a partir das fontes recebidas; se faltar evidência, declare desconhecido sem inventar. Margens percentuais com duas casas decimais. Informe claramente se a proposta original é viável nas condições atuais, o que está bloqueado e um plano condicionado revisável. Para incidente, prazo é interno fictício, sem conclusão legal real. Não confundir autorizar checklist no quadro local com executar campanha, conter incidente ou notificar terceiros. Tudo em português.')
        return {'review':await local('review',report=value)}
    async def approval(state):
        interrupt({'hash':state['review']['hash'],'payload':state['review']['payload'],'approval_required':True});return {}
    async def effect(state):
        receipt=await local('effect',hash=state['review']['hash'])
        if c.get('crash_after_effect'):os._exit(88)
        return {'receipt':receipt}
    sub=StateGraph(Department);sub.add_node('specialist',specialist);sub.add_node('director_review',director)
    sub.add_conditional_edges(START,specialists,['specialist']);sub.add_edge('specialist','director_review');sub.add_edge('director_review',END)
    async with AsyncPostgresSaver.from_conn_string(c['dsn']) as saver:
        await saver.setup();builder=StateGraph(State)
        builder.add_node('chief_of_staff',cos);builder.add_node('department',sub.compile());builder.add_node('synthesis',synthesize);builder.add_node('approval',approval);builder.add_node('effect',effect)
        builder.add_edge(START,'chief_of_staff');builder.add_conditional_edges('chief_of_staff',dispatch,['department']);builder.add_edge('department','synthesis');builder.add_edge('synthesis','approval');builder.add_edge('approval','effect');builder.add_edge('effect',END)
        graph=builder.compile(checkpointer=saver);cfg={'configurable':{'thread_id':'aurora:'+c['job']}}
        snap=await graph.aget_state(cfg);job=await local('snapshot');await log('checkpoint_loaded',next=list(snap.next),process=os.getpid(),has_state=bool(snap.values))
        value={} if not snap.values else None
        if any(t.interrupts for t in snap.tasks) and job['approval']:value=Command(resume={'hash':job['review']['hash']})
        await graph.ainvoke(value,cfg,durability='sync');snap=await graph.aget_state(cfg)
        await log('checkpoint_saved',next=list(snap.next),completed=bool(snap.values.get('receipt')))
        print(json.dumps({'completed':bool(snap.values.get('receipt')),'next':list(snap.next)}),flush=True)
if __name__=='__main__':
    # Node writes UTF-8 bytes. Windows' locale decoder can corrupt accented goals.
    try:asyncio.run(main(json.loads(sys.stdin.buffer.read().decode('utf-8'))))
    except BaseException:
        import traceback
        with pathlib.Path(__file__).with_name('.state').joinpath('worker-errors.log').open('a',encoding='utf-8') as output:traceback.print_exc(file=output)
        raise
