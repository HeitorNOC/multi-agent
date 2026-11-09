"""Own enterprise adapter over public AgentScope types; LLM is deterministic."""
import asyncio,json,sys
from pathlib import Path
sys.path.insert(0,str(Path.cwd()/'vendor/agentscope-audit/tests'))
from utils import MockModel
from agentscope.agent import Agent,InjectionConfig
from agentscope.model import ChatResponse
from agentscope.message import TextBlock,ToolCallBlock,UserMsg
from agentscope.tool import ToolBase,ToolChunk,Toolkit
from agentscope.pipeline import TeamMember,TeamPipeline
from agentscope.permission import PermissionBehavior,PermissionDecision

class KnowledgeTool(ToolBase):
    name='enterprise_knowledge'
    description='Read an authorized synthetic enterprise document'
    input_schema={'type':'object','properties':{'doc_id':{'type':'string'}},'required':['doc_id']}
    is_concurrency_safe=True
    is_read_only=True
    def __init__(self,company,scopes): super().__init__();self.company=company;self.scopes=frozenset(scopes);self.reads=[];self.attempts=0
    async def check_read_only(self,tool_input):
        # Protected reads must not use the generic read-only auto-allow path.
        return False
    async def check_permissions(self,tool_input,context):
        allowed=tool_input.get("doc_id") in ("sales-A","campaign-A") and "knowledge:read" in self.scopes and self.company=="A"
        return PermissionDecision(behavior=PermissionBehavior.ALLOW if allowed else PermissionBehavior.DENY,message="own enterprise policy")
    async def call(self,doc_id):
        self.attempts+=1
        docs={'sales-A':('A','Sales dropped 20 percent'),'campaign-A':('A','Campaign paused'),'private-B':('B','Confidential B')}
        company,text=docs[doc_id]
        if company!=self.company or 'knowledge:read' not in self.scopes:raise PermissionError('server-side knowledge denied')
        self.reads.append(doc_id)
        return ToolChunk(content=[TextBlock(text=text)],metadata={'source_id':doc_id,'version':1,'company_id':company})

def text(value):return [ChatResponse(content=[TextBlock(text=value)],is_last=True,usage=None)]
def call(id,name,input):return [ChatResponse(content=[ToolCallBlock(id=id,name=name,input=json.dumps(input))],is_last=True,usage=None)]
def agent(name,tools=()):return Agent(name=name,system_prompt='Synthetic capability test',model=MockModel(),toolkit=Toolkit(tools=list(tools)),injection_config=InjectionConfig(inject_runtime_state=False))
async def main():
    sales_tool=KnowledgeTool('A',['knowledge:read']);campaign_tool=KnowledgeTool('A',['knowledge:read'])
    sales=agent('sales_analysis',[sales_tool]);campaign=agent('campaign_analysis',[campaign_tool]);chief=agent('chief_of_staff')
    # The own layer chooses capabilities and assembles the team; roles aren't a fixed organogram.
    sales.model.set_responses([call('s1','enterprise_knowledge',{'doc_id':'sales-A'}),text('Sales evidence retrieved')])
    campaign.model.set_responses([call('c1','enterprise_knowledge',{'doc_id':'campaign-A'}),text('Campaign evidence retrieved')])
    chief.model.set_responses([call('d1','TeamAssign',{'member':'sales_analysis','prompt':'Read sales evidence'}),call('d2','TeamAssign',{'member':'campaign_analysis','prompt':'Read campaign evidence'}),text('Synthetic review completed')])
    team=TeamPipeline(chief,[TeamMember(agent=sales,description='sales capability'),TeamMember(agent=campaign,description='campaign capability')])
    events=[event async for event in team.reply_stream(UserMsg(name='human',content='Explain synthetic sales decline'))]
    assert sales_tool.reads==['sales-A'] and campaign_tool.reads==['campaign-A']
    for denied_tool,denied_doc in [(KnowledgeTool('A',['knowledge:read']),'private-B'),(KnowledgeTool('A',[]),'sales-A')]:
        blocked=agent('blocked',[denied_tool])
        blocked.model.set_responses([call('deny','enterprise_knowledge',{'doc_id':denied_doc}),text('Denied by policy')])
        blocked_events=[event async for event in blocked.reply_stream(UserMsg(name='human',content='attempt forbidden document'))]
        assert denied_tool.attempts==0,'permission hook did not prevent execution'
    for tool,doc in [(sales_tool,'private-B'),(KnowledgeTool('A',[]),'sales-A')]:
        try:await tool.call(doc)
        except PermissionError:pass
        else:raise AssertionError('unauthorized knowledge accepted')
    evidence={'result':'PASS','real_engine':'AgentScope TeamPipeline','own_layer':'outside upstream repository; capability-based composition and synthetic knowledge policy','event_count':len(events),'specialists':2,'authorized_reads':sales_tool.reads+campaign_tool.reads,'cross_company':'DENIED before call by SDK permission hook + own server policy','scope_missing':'DENIED before call by SDK permission hook + own server policy','model':'MockModel; no provider call','limits':'No full application, durable business ledger, budgets, LightRAG or deployment qualified'}
    Path('validation/agentscope/evidence/own-layer.json').write_text(json.dumps(evidence,indent=2));print(json.dumps(evidence))
if __name__ == '__main__':
    asyncio.run(main())
