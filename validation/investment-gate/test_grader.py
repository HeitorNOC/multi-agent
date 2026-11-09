"""Citation aliases must not hide the real numeric/approval failure."""
import json
from pathlib import Path
import pytest
from test_v23 import grade

@pytest.mark.parametrize('suffix',['',':v1.md'])
def test_canonical_and_versioned_source_identifiers_are_equivalent(suffix):
    value={'revenue_drop_pct':20,'leads_drop_pct':20,'price_unchanged':True,'causal_proof':False,'requires_approval':True,
           'cited_sources':[s+suffix for s in ['sales-january','sales-february','marketing']]}
    assert all(grade(value).values())

def test_original_failed_multiagent_output_remains_failed():
    result=json.loads((Path(__file__).parent/'v23-second-evidence/results.json').read_text(encoding='utf-8'))
    reviewed=grade(result['coordinated']['result'])
    assert not reviewed['revenue_drop'] and not reviewed['leads_drop'] and not reviewed['approval']

def test_unproven_causality_and_missing_source_cannot_pass():
    value={'revenue_drop_pct':20,'leads_drop_pct':20,'price_unchanged':True,'causal_proof':True,'requires_approval':True,
           'cited_sources':['sales-january','sales-february']}
    assert not grade(value)['no_invented_causality'] and not grade(value)['sources']
