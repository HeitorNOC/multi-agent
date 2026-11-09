import pathlib,sys
import numpy as np
import pytest
sys.path.insert(0,str(pathlib.Path(__file__).resolve().parents[1]/'validation/concurrent-reconciliation'))
from embedding_pooling import segments,pooled
def test_all_words_retained_with_small_windows_and_long_word_refused():
    text='SKU-AURA 14.000 unidades; 9.000 reservadas e 2.000 bloqueadas. Orion ainda não está reservado.'
    result=segments(text,lambda x:len(x.split()),limit=4)
    assert ' '.join(result).split()==text.split() and len(result)>1 and all(len(x.split())<=4 for x in result)
    with pytest.raises(ValueError):segments('x'*121,len,120)
def test_weighted_pooling_preserves_dimensions_and_normalization():
    result=pooled([[1.,0.,0.],[0.,1.,0.]],[3,1])
    assert len(result)==3 and np.linalg.norm(result)==pytest.approx(1) and result[0]/result[1]==pytest.approx(3)
    with pytest.raises(ValueError):pooled([[0.,0.]],[1])
