"""Real AgentScope execution, deterministic models; newline JSON IPC fixture."""
import asyncio
import contextlib
import importlib.util
import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location("enterprise_tools", ROOT / "validation/agentscope/own_layer/probe.py")
module = importlib.util.module_from_spec(spec)
# Reuse the previously verified protected tool without executing its CLI.
# That probe now guards main in the normal Python manner.
spec.loader.exec_module(module)


async def execute(request):
    if request["company_id"] != "A" or "knowledge:read" not in request["scopes"]:
        return {"status": "denied", "run_id": request["run_id"], "engine_started": False}
    sales_tool = module.KnowledgeTool(request["company_id"], request["scopes"])
    campaign_tool = module.KnowledgeTool(request["company_id"], request["scopes"])
    sales = module.agent("sales_analysis", [sales_tool])
    campaign = module.agent("campaign_analysis", [campaign_tool])
    chief = module.agent("chief_of_staff")
    sales.model.set_responses([module.call("s1", "enterprise_knowledge", {"doc_id": "sales-A"}), module.text("Sales evidence retrieved")])
    campaign.model.set_responses([module.call("c1", "enterprise_knowledge", {"doc_id": "campaign-A"}), module.text("Campaign evidence retrieved")])
    chief.model.set_responses([
        module.call("d1", "TeamAssign", {"member": "sales_analysis", "prompt": "Read authorized sales evidence"}),
        module.call("d2", "TeamAssign", {"member": "campaign_analysis", "prompt": "Read authorized campaign evidence"}),
        module.text("Synthetic synthesis: sales declined after campaign paused"),
    ])
    team = module.TeamPipeline(chief, [module.TeamMember(agent=sales, description="sales capability"), module.TeamMember(agent=campaign, description="campaign capability")])
    events = [e async for e in team.reply_stream(module.UserMsg(name="human", content=request["task"]))]
    assert sales_tool.reads == ["sales-A"] and campaign_tool.reads == ["campaign-A"]
    return {"status": "completed", "run_id": request["run_id"], "company_id": request["company_id"],
            "engine_started": True, "engine": "AgentScope TeamPipeline", "model": "deterministic MockModel",
            "selected_capabilities": ["sales_analysis", "campaign_analysis"], "strategy": "A3 bounded team fixture",
            "decision_reason": "task requires two authorized evidence domains; no external side effects",
            "event_count": len(events), "event_types": sorted({type(e).__name__ for e in events}),
            "sources": [{"source_id": d, "version": 1, "company_id": "A"} for d in sales_tool.reads + campaign_tool.reads]}


if __name__ == "__main__":
    request = json.loads(sys.stdin.readline())
    with contextlib.redirect_stdout(sys.stderr):
        result = asyncio.run(execute(request))
    print(json.dumps(result), flush=True)
