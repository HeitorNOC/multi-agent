"""Optional adapter: embed all short segments, then combine normalized vectors."""
def segments(text,count_tokens,limit=120):
    words=text.split();out=[];part=[]
    for word in words:
        if count_tokens(word)>limit:raise ValueError('word exceeds safe embedding window')
        candidate=' '.join(part+[word])
        if part and count_tokens(candidate)>limit:out.append(' '.join(part));part=[word]
        else:part.append(word)
    if part:out.append(' '.join(part))
    return out or ['']
def pooled(vectors,weights):
    import numpy as np
    mean=np.average(np.asarray(vectors,dtype=np.float32),axis=0,weights=weights)
    norm=np.linalg.norm(mean)
    if not np.isfinite(norm) or norm<=0:raise ValueError('invalid pooled embedding')
    return (mean/norm).astype(np.float32).tolist()
