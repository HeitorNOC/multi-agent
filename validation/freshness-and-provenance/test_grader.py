import pytest
from grader import denies_validity_start

@pytest.mark.parametrize('text',[
 'Vigente desde 1º de janeiro de 2026; não há informação sobre o fim de sua vigência.',
 'Vigente desde 1º de janeiro de 2026; não há data de fim de vigência informada.',
 'Vigente desde 1º de março de 2026; não foi informada uma data de fim de vigência.',
 'Não há informação sobre o tamanho da equipe.',
])
def test_end_date_absence_does_not_deny_start(text):assert not denies_validity_start(text)

@pytest.mark.parametrize('text',[
 'A fonte não informa uma data de vigência; não é possível confirmar sua aplicação.',
 'Não há informação sobre o início da vigência.',
 'Não há data de início nem data de fim da vigência.',
 'Não é possível confirmar se essa informação se aplicava em 1º de fevereiro.',
])
def test_missing_start_and_application_claims_remain_rejected(text):assert denies_validity_start(text)
