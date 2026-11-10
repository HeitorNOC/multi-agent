"""Real failure-window proof. Source history stays distinct from native fact-history acceptance."""
import json,time
from datetime import datetime,timezone
from pathlib import Path
import pytest
from harness import Installation,HERE
from protocol import Rejected

def test_projection_commit_failure_reconciles_without_reingesting():
    s=Installation();start=time.perf_counter()
    def deny(fn):
        with pytest.raises(Rejected) as e:fn()
        assert e.value.status==503,str(e.value)
    try:
        s.start();vault=Path(s.app_config['vault'])
        raw='---\nsource: politica-remoto\nversion: 1\nvalid_at: 2026-01-01T00:00:00Z\ndomain: publico\n---\nDesde 1 de janeiro de 2026, a ACME concede na política PoliticaRemotaACME dois dias de trabalho remoto por semana.\n'
        (vault/'politica.md').write_text(raw,encoding='utf-8')
        before_publish=datetime.now(timezone.utc).isoformat()
        d=s.call('analista','/drafts',{'path':'politica.md'});s.call('aprovador','/review',{'id':d['id'],'raw_sha':d['raw_sha']})
        (s.state/'fail-editorial-commit-once').write_text('synthetic fault')
        deny(lambda:s.call('aprovador','/publish',{'id':d['id']}))
        assert s.sql('SELECT status FROM publications;','pilot')=='graph_ready'
        budget=(s.state/'model-budget.json').read_bytes()
        query={'domain':'publico','query':'ACME dias remotos','as_of':'2026-02-01T00:00:00Z'}
        canonical={'source':'politica-remoto','as_of':'2026-02-01T00:00:00Z','known_at':datetime.now(timezone.utc).isoformat()}
        deny(lambda:s.call('analista','/query',query));deny(lambda:s.call('analista','/source-asof',canonical))
        (vault/'politica.md').write_text(raw.replace('dois dias','sete dias não aprovados'),encoding='utf-8')
        s.stop_app();s.start_app()
        deny(lambda:s.call('analista','/query',query))
        result=s.call('aprovador','/publish',{'id':d['id']})
        assert result['reconciled_without_reingest']
        assert (s.state/'model-budget.json').read_bytes()==budget
        canonical['known_at']=datetime.now(timezone.utc).isoformat()
        source=s.call('analista','/source-asof',canonical)
        assert source['found'] and 'dois dias' in source['content'] and 'sete dias' not in source['content']
        assert source['raw_sha']==d['raw_sha'] and source['kind']=='approved_source_snapshot_not_extracted_fact'
        old=s.call('analista','/source-asof',{**canonical,'known_at':before_publish});assert not old['found']
        replay=s.call('aprovador','/publish',{'id':d['id']});assert replay['replayed'] and replay['episode']==result['episode']
        assert s.sql('SELECT count(*) FROM publications;','pilot')=='1'
        s.evidence.update(result='PASS',execution_completed=True,elapsed_seconds=time.perf_counter()-start,
            scenarios=[{'name':n} for n in ['native_graph_written_but_uncommitted_release_fenced','restart_keeps_gate_closed',
                'reconciliation_uses_original_approved_snapshot_without_new_model_calls','canonical_api_excludes_unapproved_edits_and_prior_knowledge',
                'one_publication_one_episode_identity']],canonical_response=source)
    except Exception as e:s.evidence.update(result='FAIL',error=str(e),elapsed_seconds=time.perf_counter()-start);raise
    finally:s.close()
