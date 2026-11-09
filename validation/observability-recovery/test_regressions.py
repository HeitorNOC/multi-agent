"""Run prior contracts while preserving all historical exports in their original paths."""
import pathlib,sys
HERE=pathlib.Path(__file__).resolve().parent;ROOT=HERE.parents[1]
sys.path.insert(0,str(ROOT/'validation/detached-inference'))
import test_detached as detached
sys.path.insert(0,str(ROOT/'validation/governed-recovery'))
import test_recovery as governed

def test_existing_detached_contract(monkeypatch):
    original=detached.DetachedLab
    class Lab(original):
        def __init__(self):
            super().__init__();self.state=HERE/'.state'/self.id;self.state.mkdir(parents=True)
            self.evidence_dir=HERE/'detached-regression-evidence';self.evidence_dir.mkdir(exist_ok=True)
    monkeypatch.setattr(detached,'DetachedLab',Lab)
    detached.test_detached_read_fencing_renewal_revocation_and_recovery()

def test_existing_governed_create_and_effect_contract(monkeypatch):
    target=HERE/'governed-regression-evidence';target.mkdir(exist_ok=True);monkeypatch.setenv('QUALIFICATION_EVIDENCE_DIR',str(target))
    governed.test_two_reviewers_reopen_without_replay_or_budget_refund()
