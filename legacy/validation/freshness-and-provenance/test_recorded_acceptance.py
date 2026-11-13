import json
from pathlib import Path
import pytest
from grader import denies_validity_start
ROWS=json.loads((Path(__file__).parent/'evidence/acceptance.json').read_text(encoding='utf-8'))
@pytest.mark.parametrize('row',ROWS,ids=[r['case'] for r in ROWS])
def test_saved_response_with_start_end_distinction(row):
    checks={**row['checks'],'no_missing_date_claim':not denies_validity_start(row['answer'])}
    assert all(checks.values()),checks
