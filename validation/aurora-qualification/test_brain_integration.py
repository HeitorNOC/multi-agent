"""Repeat the native-brain restore contract with real stores and a controlled model."""
from pathlib import Path
import sys
import time
from uuid import uuid4

HERE = Path(__file__).resolve().parent
sys.path.insert(0,str(HERE.parent/'brain-recovery'))
import test_brain as baseline


def test_local_brain_integrations_and_cold_restore(monkeypatch):
    evidence = HERE/'evidence'/('brain-'+uuid4().hex[:12])

    class LocalBrain(baseline.BrainLab):
        def __init__(self):
            super().__init__()
            self.evidence_dir=evidence
            self.evidence['scope']='real native LightRAG/ONNX/PostgreSQL/Neo4j; deterministic LLM; no external model'

        def service(self,args,config):
            if Path(args[1])==baseline.HERE/'native.py':
                args=[args[0],str(HERE/'fixture_brain.py'),*args[2:]]
            return super().service(args,config)

        def restore_brain(self,bundle):
            start=time.perf_counter()
            super().restore_brain(bundle)
            self.evidence['restore_seconds']=round(time.perf_counter()-start,3)

    monkeypatch.setattr(baseline,'BrainLab',LocalBrain)
    monkeypatch.delenv('BRAIN_DETACHED_PROFILE',raising=False)
    baseline.test_native_brain_release_and_joint_restore()
