"""Keep a bounded recovery-only console alive for review; all cases are fictional."""
import json,pathlib
from lab import App
HERE=pathlib.Path(__file__).resolve().parent
app=App()
try:
    app.start();app.setup_cases()
    active={'url':app.url,'backend':app.backend,'token':app.token,'installation':app.lab.id,'state':app.config['state'],'reviewers_file':str(pathlib.Path(app.config['state'])/'recovery-reviewers.json')}
    (HERE/'.state/active.json').write_text(json.dumps(active,ensure_ascii=False,indent=2),encoding='utf-8')
    print(json.dumps({'url':app.url,'scope':'recuperação operacional; provedor controlado; zero LLM','reviewers_file':active['reviewers_file']},ensure_ascii=False),flush=True)
    while not app.stop.wait(1):
        if app.node.poll() is not None:break
finally:app.close()
