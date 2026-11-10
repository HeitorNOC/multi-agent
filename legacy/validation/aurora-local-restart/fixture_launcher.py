"""Run the actual launcher with the closed synthetic native provider."""
from pathlib import Path
import os
import runpy
import sys

ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
from apps.aurora.ops.local_engine import LocalEngine

if not os.environ.get("AURORA_TEST_PYTHON"):
    os.environ["AURORA_EMBEDDING_PYTHON"] = str(ROOT / "validation/decision-qualification/.embedding-venv/Scripts/python.exe")
    os.environ["AURORA_EMBEDDING_WEIGHTS"] = str(ROOT / "validation/decision-qualification/.models/faf4aa4225822f3bc6376869cb1164e8e3feedd0")
service=LocalEngine.service


def controlled_service(self,args,config):
    if args[1:] == ["-m", "apps.aurora.runtime.services.native"]:
        path=Path(config['model_slots_path']).parent
        config={**config,'fixture_calls':str(path/'fixture-dispatches.jsonl'),
                'fixture_drop':str(path/'fixture-drop'),'fixture_hold':str(path/'fixture-hold'),
                'fixture_stages':str(path/'fixture-stages.log')}
        args=[args[0],str(ROOT/'validation/aurora-host-restore/fixture_native.py'),"--aurora-app"]
    return service(self,args,config)


LocalEngine.service=controlled_service
runpy.run_path(str(ROOT/'demo-enterprise/start.py'),run_name='__main__')
