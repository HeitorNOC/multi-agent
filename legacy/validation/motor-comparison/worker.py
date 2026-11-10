"""Comparable real engines. Models, billing and email provider are fixtures."""
import asyncio
import contextlib
import importlib.util
import json
import os
from pathlib import Path
import sys
from protocol import Client

ROOT=Path(__file__).resolve().parents[2]


async def langgraph(config, client):
    from typing import TypedDict
    from langgraph.graph import StateGraph,START,END
    from langgraph.types import interrupt,Command
    from langgraph.checkpoint.sqlite.aio import AsyncSqliteSaver
    class State(TypedDict, total=False):
        run:str
        sales:dict
        campaign:dict
        plan:str
        outcome:dict
    async def chief(s):return {'run':config['run']}
    async def sales(s):return {'sales':await client.call('/knowledge',{'company':config['company'],'capability':'sales'})}
    async def campaign(s):
        if config.get('model_failure'):raise RuntimeError('synthetic campaign model provider failure')
        return {'campaign':await client.call('/knowledge',{'company':config['company'],'capability':'campaign'})}
    async def approval(s):
        result=await client.call('/analysis',{})
        interrupt({'run':config['run'],'plan':result['plan'],'operation':'email-v1'})
        return {'plan':result['plan']}
    async def effect(s):return {'outcome':await client.call('/effect',{})}
    async with AsyncSqliteSaver.from_conn_string(config['checkpoint']) as saver:
        builder=StateGraph(State)
        for name,fn in [('chief',chief),('sales',sales),('campaign',campaign),('approval',approval),('effect',effect)]:builder.add_node(name,fn)
        for a,b in [(START,'chief'),('chief','sales'),('sales','campaign'),('campaign','approval'),('approval','effect'),('effect',END)]:builder.add_edge(a,b)
        graph=builder.compile(checkpointer=saver)
        options={'configurable':{'thread_id':config['company']+':'+config['run']}}
        snapshot=await graph.aget_state(options)
        value=None if snapshot.values else {'run':config['run']}
        if config['phase']=='act' and any(getattr(task,'interrupts',()) for task in snapshot.tasks):
            value=Command(resume={'host_requested_resume':True})
        kwargs={'interrupt_after':['sales']} if config.get('crash_after_sales') else {}
        await graph.ainvoke(value,options,**kwargs)
        if config.get('crash_after_sales'):
            print('native_checkpoint_after_sales',file=sys.stderr,flush=True);os._exit(71)
        snapshot=await graph.aget_state(options)
        return {'native_checkpoint_next':list(snapshot.next),'native_checkpoint_tasks':len(snapshot.tasks)}


async def agentscope(config, client):
    spec=importlib.util.spec_from_file_location('agent_fixture',ROOT/'validation/agentscope/own_layer/probe.py')
    module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
    class KnowledgeTool(module.ToolBase):
        name='enterprise_knowledge'
        description='Read authorized evidence through the enterprise Knowledge API'
        input_schema={'type':'object','properties':{},'additionalProperties':False}
        is_concurrency_safe=True
        is_read_only=True
        def __init__(self,capability):super().__init__();self.capability=capability
        async def check_read_only(self,tool_input):return False
        async def check_permissions(self,tool_input,context):return module.PermissionDecision(behavior=module.PermissionBehavior.ALLOW,message='Knowledge API independently authorizes every read')
        async def call(self):
            result=await client.call('/knowledge',{'company':config['company'],'capability':self.capability})
            if config.get('crash_after_sales') and self.capability=='sales':
                print('own_finding_persisted_after_sales',file=sys.stderr,flush=True);os._exit(71)
            return module.ToolChunk(content=[module.TextBlock(text=json.dumps(result))])
    class EffectTool(module.ToolBase):
        name='approved_email'
        description='Execute only the current server-approved synthetic email'
        input_schema={'type':'object','properties':{},'additionalProperties':False}
        is_read_only=False
        is_concurrency_safe=False
        async def check_permissions(self,tool_input,context):return module.PermissionDecision(behavior=module.PermissionBehavior.ALLOW,message='enterprise server is authoritative for approval and budget')
        async def call(self):
            result=await client.call('/effect',{})
            return module.ToolChunk(content=[module.TextBlock(text=json.dumps({'status':result['state']}))])
    if config['phase']=='act':
        reviewer=module.agent('approved_action_executor',[EffectTool()])
        reviewer.model.set_responses([module.call('effect','approved_email',{}),module.text('Synthetic action reconciled')])
        events=[e async for e in reviewer.reply_stream(module.UserMsg(name='host',content='Execute the current approved action'))]
    else:
        sales=module.agent('sales_analysis',[KnowledgeTool('sales')]);campaign=module.agent('campaign_analysis',[KnowledgeTool('campaign')]);chief=module.agent('chief_of_staff')
        for agent in (sales,campaign):agent.model.set_responses([module.call('read','enterprise_knowledge',{}),module.text('Authorized evidence reviewed')])
        if config.get('model_failure'):campaign.model.set_responses([RuntimeError('synthetic campaign model provider failure')])
        chief.model.set_responses([module.call('delegate-sales','TeamAssign',{'member':'sales_analysis','prompt':'Review sales evidence'}),module.call('delegate-campaign','TeamAssign',{'member':'campaign_analysis','prompt':'Review campaign evidence'}),module.text('Evidence supports a proposed synthetic email, subject to human approval')])
        team=module.TeamPipeline(chief,[module.TeamMember(agent=sales,description='sales capability'),module.TeamMember(agent=campaign,description='campaign capability')])
        events=[e async for e in team.reply_stream(module.UserMsg(name='host',content='Explain sales decline and propose an action'))]
        await client.call('/analysis',{})
    return {'sdk_events':len(events),'recovery':'own durable findings + reconstruct team; no native TeamPipeline checkpoint used'}


async def main(config):
    client=Client(config)
    status=await client.call('/begin',{})
    if status['state']=='completed':return {'engine':config['engine'],'state':'completed','replayed_from_own_result':True}
    info=await (langgraph(config,client) if config['engine']=='langgraph' else agentscope(config,client))
    final=await client.call('/status')
    expected='completed' if config['phase']=='act' else 'waiting_approval'
    if final['state']!=expected:raise RuntimeError('engine did not reach '+expected+': '+final['state'])
    return {'engine':config['engine'],'state':final['state'],**info}


if __name__=='__main__':
    config=json.loads(sys.stdin.readline())
    with contextlib.redirect_stdout(sys.stderr):result=asyncio.run(main(config))
    print(json.dumps(result),flush=True)
