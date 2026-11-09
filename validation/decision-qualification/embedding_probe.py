"""Real multilingual pretrained embeddings, isolated from the synthetic integration index."""
import hashlib,importlib.metadata,json,os,time
from pathlib import Path
import numpy as np
from fastembed import TextEmbedding
from huggingface_hub import HfApi,snapshot_download

HERE=Path(__file__).resolve().parent
REPO='Qdrant/paraphrase-multilingual-MiniLM-L12-v2-onnx-Q'
MODEL='sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2'
QUESTIONS=[('Quantos dias posso trabalhar de casa na política atual?','politica-remoto'),
 ('Qual era o faturamento no primeiro mês de 2026?','vendas-janeiro'),
 ('Quanto foi vendido em fevereiro?','vendas-fevereiro'),
 ('Por que a campanha de aquisição foi interrompida?','campanha-fevereiro'),
 ('Qual autorização é necessária para enviar mensagens?','politica-ferramentas'),
 ('O que o comentário externo malicioso tentou ordenar?','comentario-externo')]

def main():
    started=time.perf_counter();os.environ['HF_HUB_DISABLE_TELEMETRY']='1';os.environ['HF_HUB_DISABLE_XET']='1'
    info=HfApi(token=False).model_info(REPO);revision=info.sha
    path=Path(snapshot_download(REPO,revision=revision,token=False,local_dir=HERE/'.models'/revision,
                               allow_patterns=['*.json','*.txt','model_optimized.onnx'],max_workers=2))
    # No trust_remote_code, pickle, Python model code or unpinned revision.
    model=TextEmbedding(MODEL,specific_model_path=str(path),local_files_only=True,threads=2)
    docs=[d for d in json.loads((HERE/'corpus/manifest.json').read_text(encoding='utf-8'))['generations']['g2'] if d['domain']=='publico']
    distractors=[{'id':'distractor-'+str(i),'content':f'Nota operacional sintética {i}: {topic}. Registro arquivado para consulta; nenhuma autorização financeira ou política nova.'}
                 for i,topic in enumerate(['inventário de cadeiras','manutenção de impressoras','reserva de salas','escala de limpeza','troca de luminárias','entrega de crachás']*5)]
    corpus=docs+distractors
    assert 'SIGILO_' not in json.dumps(corpus)
    t=time.perf_counter();vectors=np.array(list(model.embed([d['content'] for d in corpus])));ingest=time.perf_counter()-t
    q=np.array(list(model.query_embed([x[0] for x in QUESTIONS])))
    scores=(q/np.linalg.norm(q,axis=1,keepdims=True))@(vectors/np.linalg.norm(vectors,axis=1,keepdims=True)).T
    checks=[]
    for (question,expected),row in zip(QUESTIONS,scores):
        ids=[corpus[i]['id'] for i in np.argsort(-row)[:3]]
        checks.append({'question':question,'expected':expected,'top3':ids,'top1_correct':ids[0]==expected,'top3_correct':expected in ids})
    hashes={p.relative_to(path).as_posix():{'bytes':p.stat().st_size,'sha256':hashlib.sha256(p.read_bytes()).hexdigest()} for p in path.rglob('*') if p.is_file() and '.cache' not in p.parts}
    report={'result':'PASS_SMALL' if all(c['top3_correct'] for c in checks) else 'FAIL','model':MODEL,'artifact_repository':REPO,'revision':revision,'model_files':hashes,
            'versions':{p:importlib.metadata.version(p) for p in ['fastembed','onnxruntime','tokenizers','huggingface-hub']},
            'documents':len(corpus),'dimensions':int(vectors.shape[1]),'ingest_seconds':ingest,'elapsed_seconds':time.perf_counter()-started,
            'top1':sum(c['top1_correct'] for c in checks),'top3':sum(c['top3_correct'] for c in checks),'queries':len(checks),'checks':checks,
            'scope':'Isolated dense retrieval smoke test, authorized public corpus only. Not integrated LightRAG embedding or extraction qualification; no enterprise recall/latency estimate.'}
    (HERE/'evidence/pretrained-embedding.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
    print(json.dumps(report,ensure_ascii=False,indent=2))

if __name__=='__main__':main()
