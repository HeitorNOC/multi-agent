import sys,asyncio,json,faulthandler
from pathlib import Path
faulthandler.dump_traceback_later(30)
sys.path.insert(0,str(Path.cwd()/'vendor/opencompany-zeenie/server'))
from pydantic import BaseModel
from services.plugin import ActionNode,Operation,NodeContext
from services.node_registry import registered_node_classes
class Params(BaseModel):
    company_id:str
    query:str
class Output(BaseModel):
    source_id:str
    content:str
class EnterpriseKnowledgeNode(ActionNode):
    type='enterpriseKnowledgeProbe'
    display_name='Enterprise Knowledge Probe'
    group=('tool',)
    Params=Params
    Output=Output
    @Operation('query')
    async def query(self,ctx:NodeContext,params:Params)->Output:
        if params.company_id != ctx.raw.get('trusted_company_id'):
            raise PermissionError('company mismatch')
        return Output(source_id='synthetic-sales-v1',content='Sales dropped 20 percent')
async def main():
    node=EnterpriseKnowledgeNode()
    ctx=NodeContext.from_legacy('probe',node.type,{'user_id':'synthetic-user','trusted_company_id':'A'})
    value=await node.execute('probe',{'company_id':'A','query':'sales'},ctx)
    assert node.type in registered_node_classes()
    assert value.get('success') is True,value
    denied=await node.execute('probe',{'company_id':'B','query':'private'},ctx)
    assert denied.get('success') is False,denied
    evidence={'registered':True,'result':value,'cross_company':denied,'scope':'actual OpenCompany ActionNode execute and registry, explicit module import outside clone; no full app or Temporal worker qualified'}
    Path('validation/opencompany/evidence/own-layer.json').write_text(json.dumps(evidence,indent=2))
    print(json.dumps(evidence))
asyncio.run(main())
