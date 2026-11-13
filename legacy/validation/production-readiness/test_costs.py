from decimal import Decimal
import json
from pathlib import Path
import pytest
from costs import Usage,normalize_openai,normalize_anthropic,price,CARDS,forecast


def test_openai_cache_lifetimes_and_reasoning_not_doubled():
    u=normalize_openai({'input_tokens':12000,'input_tokens_details':{'cached_tokens':4000,'cache_write_tokens':7000,'cache_write_tokens_details':{'ttl_30m_tokens':3000,'ttl_12h_tokens':4000}},'output_tokens':1000,'output_tokens_details':{'reasoning_tokens':600}})
    assert u==Usage(1000,4000,3000,4000,1000)
    assert price(u,CARDS['openai:gpt-6.1-sol'])==Decimal('.0399')


def test_anthropic_input_is_not_total_input():
    u=normalize_anthropic({'input_tokens':1000,'cache_read_input_tokens':4000,'cache_creation_input_tokens':7000,'cache_creation':{'ephemeral_5m_input_tokens':3000,'ephemeral_1h_input_tokens':4000},'output_tokens':1000})
    assert u==Usage(1000,4000,3000,4000,1000)
    assert price(u,CARDS['anthropic:claude-sonnet-5-5'])==Decimal('.0359')


@pytest.mark.parametrize('u',[
 {'input_tokens':100,'input_tokens_details':{'cached_tokens':101},'output_tokens':1},
 {'input_tokens':100,'input_tokens_details':{'cache_write_tokens':100},'output_tokens':1},
 {'input_tokens':100,'input_tokens_details':{'cache_write_tokens':100,'cache_write_tokens_details':{'ttl_30m_tokens':99}},'output_tokens':1},
 {'input_tokens':100,'output_tokens':1,'output_tokens_details':{'reasoning_tokens':2}},
])
def test_ambiguous_or_invalid_usage_is_not_invented_zero_cost(u):
    with pytest.raises(ValueError):normalize_openai(u)


def test_projections_are_labeled_and_reproducible():
    result=forecast();assert result['type'].startswith('ESTIMATE')
    large=result['scenarios'][1]
    assert Decimal(large['models']['openai:gpt-6.1-sol']['monthly_task_tokens_usd'])==Decimal(57600)
    assert Decimal(large['models']['openai:gpt-6.1-sol']['initial_extraction_tokens_usd'])==Decimal(32000)
    Path('validation/production-readiness/evidence/cost-estimates.json').write_text(json.dumps(result,indent=2),encoding='utf-8')


def test_unmodeled_provider_cache_category_must_not_be_free():
    with pytest.raises(ValueError):price(Usage(0,0,100,0,0),CARDS['google:gemini-3.5-flash-lite'])
