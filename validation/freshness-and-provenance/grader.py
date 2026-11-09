"""Revised lexical guard. Narrow temporal contract, not entailment or an independent eval."""
import re,unicodedata

def denies_validity_start(text):
    normalized=''.join(c for c in unicodedata.normalize('NFKD',text.lower()) if not unicodedata.combining(c))
    for clause in re.split(r'[.;\n]',normalized):
        negative=re.search(r'nao\s+(?:ha|informa|consta|fornece|e possivel confirmar)|nao.*?confirmar',clause)
        if not negative:continue
        tail=clause[negative.start():]
        if not re.search(r'data|vigencia|inicio|aplic',tail):continue
        end=bool(re.search(r'\bfim\b|\btermino\b|encerramento|data final',tail))
        start=bool(re.search(r'\binicio\b|inicial|\bdesde\b|comeco',tail))
        if not end or start:return True
    return False
