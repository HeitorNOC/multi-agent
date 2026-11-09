"""Real journaled ingestion/hybrid retrieval; extraction/embedding are fixtures."""
import importlib.util
import json
from pathlib import Path
import sys
import numpy as np
import pytest
from lightrag import LightRAG,QueryParam
from lightrag.utils import EmbeddingFunc,Tokenizer

ROOT=Path.cwd()
HERE=ROOT/'validation/production-readiness'
spec=importlib.util.spec_from_file_location('tokenizer_fixture',ROOT/'poc/runtime.py')
fixture=importlib.util.module_from_spec(spec);spec.loader.exec_module(fixture)


async def embedding(texts,**kwargs):return np.ones((len(texts),8),dtype=float)
async def llm(*args,**kwargs):raise AssertionError('no paid or generated extraction allowed in this fixture')


def chunks(tokenizer,content,*args,**kwargs):
    return [{'tokens':len(content),'content':content,'chunk_order_index':0}]


async def build(root,workspace,docs):
    rag=LightRAG(working_dir=str(root),workspace=workspace,llm_model_func=llm,
                 embedding_func=EmbeddingFunc(embedding_dim=8,max_token_size=8192,func=embedding),
                 tokenizer=Tokenizer('fixture-char',fixture.CharTokenizer()),chunking_func=chunks,
                 max_parallel_insert=1,vector_db_storage_cls_kwargs={'cosine_better_than_threshold':-1.0})
    await rag.initialize_storages()
    async def extraction(chunkmap,*args,**kwargs):
        result=[]
        for id,data in chunkmap.items():
            content=data['content'];file_path=data.get('file_path','fixture.md')
            nodes={name:[{'entity_name':name,'entity_type':'organization','description':content,
                         'source_id':id,'file_path':file_path,'timestamp':1}] for name in ('ACME','SALES')}
            edges={('ACME','SALES'):[{'src_id':'ACME','tgt_id':'SALES','description':content,'keywords':'revenue','weight':1.,'source_id':id,'file_path':file_path,'timestamp':1}]}
            result.append((nodes,edges))
        return result
    rag._process_extract_entities=extraction
    for doc_id,text,path in docs:await rag.ainsert(text,ids=[doc_id],file_paths=[path])
    return rag


async def query(rag):
    return await rag.aquery_data('ACME sales revenue',QueryParam(mode='hybrid',hl_keywords=['revenue'],ll_keywords=['ACME'],enable_rerank=False,top_k=5,chunk_top_k=5,max_total_tokens=16000))


PUBLIC=('public-v1','ACME SALES revenue 100; approved marketing report','public-v1.md')
SECRET=('finance-v1','ACME SALES acquisition SECRET_FINANCE_RESTRICTED','finance-v1.md')


@pytest.mark.asyncio
async def test_hybrid_and_shared_graph_leak_characterization(tmp_path):
    rag=await build(tmp_path,'mixed',[PUBLIC,SECRET])
    try:
        result=await query(rag)
        assert result['status']=='success'
        data=result['data'];assert data['entities'] and data['relationships'] and data['chunks']
        # Deliberately unprotected positive control: chunk post-filtering cannot unmerge a graph.
        post_filtered={**data,'chunks':[x for x in data['chunks'] if x['file_path']=='public-v1.md']}
        leaked='SECRET_FINANCE_RESTRICTED' in json.dumps(post_filtered)
        assert leaked,'fixture must characterize graph contamination, not silently claim ACL'
        (HERE/'evidence/brain-shared-graph.json').write_text(json.dumps({'result':'RISK CONFIRMED','engine':'real LightRAG hybrid + journaled ainsert','extraction':'deterministic fixture','entities':len(data['entities']),'relationships':len(data['relationships']),'chunks':len(data['chunks']),'secret_remains_after_only_filtering_chunks':leaked,'required':'pre-retrieval authorization of graph/vector/cache partitions or proven source-aware retrieval, not only post-filtered citations'},indent=2))
    finally:await rag.finalize_storages()


@pytest.mark.asyncio
async def test_authorized_partitions_and_revocation_before_cache(tmp_path):
    public=await build(tmp_path,'A-public',[PUBLIC]);secret=await build(tmp_path,'A-finance',[SECRET])
    grants={'reader':{'public'},'finance':{'public','finance'}}
    partitions={'public':public,'finance':secret};cache={};epoch=1;calls=0
    async def protected(principal,requested):
        nonlocal calls
        # Trusted server grant resolution on every query, before cache lookup or graph access.
        if not requested <= grants[principal]:raise PermissionError('partition ACL denied')
        key=(principal,epoch,tuple(sorted(requested)))
        if key not in cache:
            cache[key]=[await query(partitions[name]) for name in sorted(requested)];calls+=len(requested)
        return cache[key]
    try:
        result=await protected('reader',{'public'});assert 'SECRET_FINANCE' not in json.dumps(result)
        before=calls
        with pytest.raises(PermissionError):await protected('reader',{'finance'})
        assert calls==before
        authorized=await protected('finance',{'public','finance'});assert 'SECRET_FINANCE' in json.dumps(authorized)
        grants['finance']={'public'};epoch+=1;before=calls
        with pytest.raises(PermissionError):await protected('finance',{'finance'})
        assert calls==before
        after=await protected('finance',{'public'});assert 'SECRET_FINANCE' not in json.dumps(after)
        (HERE/'evidence/brain-acl.json').write_text(json.dumps({'result':'PASS','partitioned_hybrid_queries':calls,'reader_excludes_finance':True,'revoke_checked_before_cached_result':True,'authority':'own test wrapper, not native LightRAG document ACL','scope':'logical partitions behind one brain API; no production identity or multi-node cache certified'},indent=2))
    finally:await public.finalize_storages();await secret.finalize_storages()


@pytest.mark.asyncio
async def test_journaled_delete_removes_graph_sources(tmp_path):
    rag=await build(tmp_path,'delete-proof',[PUBLIC])
    try:
        assert (await query(rag))['data']['entities']
        anchors=await rag.full_entities.get_by_id('public-v1');assert anchors
        deleted=await rag.adelete_by_doc_id('public-v1')
        row=await rag.doc_status.get_by_id('public-v1');assert row is None
        result=await query(rag)
        assert 'approved marketing report' not in json.dumps(result)
        (HERE/'evidence/brain-delete.json').write_text(json.dumps({'result':'PASS','journal_anchors_present':True,'delete_result':str(deleted),'document_absent':True,'deleted_source_absent_in_hybrid':True,'limit':'file/NetworkX backend; not power-loss or all external stores'},indent=2))
    finally:await rag.finalize_storages()
