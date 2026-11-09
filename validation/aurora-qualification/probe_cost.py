"""One explicit, synthetic Codex transport probe. Keep raw CLI logs private."""
import argparse
from decimal import Decimal
import json
from pathlib import Path
import shutil
import sys

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent/'concurrent-reconciliation'))
from codex_provider import CodexProvider


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--one-call', action='store_true', required=True)
    args = parser.parse_args()
    private = HERE/'.state'/'codex-probe'
    private.mkdir(parents=True, exist_ok=False)
    logs = private/'usage'
    cwd = private/'empty-workdir'
    logs.mkdir()
    cwd.mkdir()
    shutil.copyfile(HERE.parent/'concurrent-reconciliation/provider.schema.json', private/'provider.schema.json')
    config = {'model_name':'gpt-6.1-terra','model_budget':str(private/'unused'),
              'model_cwd':str(cwd),'evidence':str(logs),'instance':'aurora-qualification-one-call'}
    result = {'model':config['model_name'],'attempt_limit':1,'account_mode':'ChatGPT CLI',
              'invoiced_usd':None,'completed':False,'usage':None}
    try:
        answer = CodexProvider(config).run(
            'Cenário fictício. O depósito de teste tem 7 caixas. Retorne apenas {"caixas":7}.',
            'Use apenas o enunciado sintético. Responda em JSON. Não use ferramentas.', [],
            {'id':'qualification-cost-probe','number':1})
        result['completed'] = json.loads(answer) == {'caixas':7}
    except Exception as error:
        result['failure'] = type(error).__name__
    trace = logs/'model-calls.jsonl'
    if trace.exists():
        record = json.loads(trace.read_text(encoding='utf-8'))
        result.update(seconds=round(record['seconds'],3),exit_code=record['exit_code'],
                      unexpected_tool_events=record['unexpected_tool_events'])
        if len(record['usage'])==1:
            usage = record['usage'][0]
            result['usage'] = usage
            cached = usage['cached_input_tokens']
            uncached = usage['input_tokens'] - cached
            output = usage['output_tokens']
            if min(cached,uncached,output)>=0:
                result['hypothetical_standard_api_usd'] = str((Decimal(uncached)+Decimal(cached)*Decimal('.05')+Decimal(output)*5)/1_000_000)
                result['hypothetical_standard_codex_credits'] = str((Decimal(uncached)*25+Decimal(cached)*Decimal('1.25')+Decimal(output)*125)/1_000_000)
    (HERE/'cost-probe.json').write_text(json.dumps(result,indent=2),encoding='utf-8')
    print(json.dumps(result))
    return 0 if result['completed'] else 1


if __name__=='__main__':
    sys.exit(main())
