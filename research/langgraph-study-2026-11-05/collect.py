"""Public, bounded source inventory. Never imports or executes downloaded code."""
import concurrent.futures, hashlib, json, pathlib, urllib.request
ROOT = pathlib.Path(__file__).resolve().parent
REPOS = ['langchain-ai/langchain-academy', 'langchain-ai/deep_research_from_scratch', 'campusx-official/langgraph-tutorials', 'bytedance/deer-flow', 'langchain-ai/open-swe', 'langchain-ai/deepagents']
def get(url):
    req = urllib.request.Request(url, headers={'User-Agent':'enterprise-architecture-source-audit'})
    with urllib.request.urlopen(req, timeout=25) as r:
        data = r.read(5_000_001)
    if len(data)>5_000_000: raise ValueError('source exceeds capture bound')
    return data
def inventory(repo):
    base='https://api.github.com/repos/'+repo
    meta=json.loads(get(base))
    sha=json.loads(get(base+'/commits/'+meta['default_branch']))['sha']
    tree=json.loads(get(base+'/git/trees/'+sha+'?recursive=1'))
    result={'repo':repo,'sha':sha,'archived':meta['archived'],'license':(meta.get('license') or {}).get('spdx_id'),'tree_truncated':tree.get('truncated'), 'paths':[x['path'] for x in tree['tree'] if x['type']=='blob']}
    (ROOT/'inventory').mkdir(exist_ok=True)
    (ROOT/'inventory'/(repo.split('/')[1]+'.json')).write_text(json.dumps(result,indent=2),encoding='utf-8')
    print(repo,sha,'archived',meta['archived'],'files',len(result['paths']),flush=True)
    return result
def capture(item):
    inv=json.loads((ROOT/'inventory'/(item['repo'].split('/')[1]+'.json')).read_text())
    path=item['path']; url=f"https://raw.githubusercontent.com/{item['repo']}/{inv['sha']}/{path}"
    data=get(url); dest=ROOT/'sources'/item['repo'].split('/')[1]/path
    dest.parent.mkdir(parents=True,exist_ok=True); dest.write_bytes(data)
    if path.endswith('.ipynb'):
        nb=json.loads(data)
        text='\n\n'.join('CELL '+str(i)+' '+c['cell_type']+'\n'+''.join(c.get('source',[])) for i,c in enumerate(nb['cells']) if c['cell_type'] in ('markdown','code'))
        dest.with_suffix('.cells.txt').write_text(text,encoding='utf-8')
    return {**item,'commit':inv['sha'],'sha256':hashlib.sha256(data).hexdigest(),'bytes':len(data),'url':url}
if __name__=='__main__':
    import sys
    if len(sys.argv)>1 and sys.argv[1]=='capture':
        items=json.loads((ROOT/'selection.json').read_text())
        manifest=[]
        with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
            for item,result in zip(items,pool.map(capture,items)):
                manifest.append(result)
        (ROOT/'manifest.json').write_text(json.dumps(manifest,indent=2),encoding='utf-8')
        print('Captured',len(manifest),'files',flush=True)
    else:
        with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:
            for result in pool.map(inventory,REPOS): pass
