"""Redirect prior regression exports without changing their behavior or old files."""
import importlib.util,pathlib,sys
HERE=pathlib.Path(__file__).resolve().parent;ROOT=HERE.parents[1]
spec=importlib.util.spec_from_file_location('prior_observability_regressions',ROOT/'validation/observability-recovery/test_regressions.py')
prior=importlib.util.module_from_spec(spec);spec.loader.exec_module(prior)

def test_detached_contract_with_isolated_exports(monkeypatch):
    monkeypatch.setattr(prior,'HERE',HERE)
    prior.test_existing_detached_contract(monkeypatch)

def test_governed_contract_with_isolated_exports(monkeypatch):
    monkeypatch.setattr(prior,'HERE',HERE)
    prior.test_existing_governed_create_and_effect_contract(monkeypatch)
