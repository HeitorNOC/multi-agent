"""Read-only public repository metadata; downloaded sources are never executed."""
import concurrent.futures,datetime,hashlib,json,pathlib,urllib.request
ROOT=pathlib.Path(__file__).resolve().parent
REPOS=['langchain-ai/langgraph','HKUDS/LightRAG','keycloak/keycloak','openfga/openfga','BerriAI/litellm','google/gvisor']
def get(url):
    req=urllib.request.Request(url,headers={'User-Agent':'enterprise-component-reuse-audit'})
    with urllib.request.urlopen(req,timeout=25) as res: data=res.read(5_000_001)
    if len(data)>5_000_000: raise ValueError('capture limit')
    return data
def collect(repo):
    api='https://api.github.com/repos/'+repo
    meta=json.loads(get(api)); commit=json.loads(get(api+'/commits/'+meta['default_branch']))
    result={'repository':repo,'captured_at_utc':datetime.datetime.now(datetime.timezone.utc).isoformat(),'url':meta['html_url'],'stars':meta['stargazers_count'],'forks':meta['forks_count'],'open_issues_and_prs':meta['open_issues_count'],'archived':meta['archived'],'pushed_at':meta['pushed_at'],'license':(meta.get('license') or {}).get('spdx_id'),'default_branch':meta['default_branch'],'head_sha':commit['sha'],'head_committed_at':commit['commit']['committer']['date'],'files':[]}
    folder=ROOT/'sources'/repo.replace('/','__'); folder.mkdir(parents=True,exist_ok=True)
    for path in ['README.md','LICENSE']:
        url=f"https://raw.githubusercontent.com/{repo}/{commit['sha']}/{path}"
        try:
            data=get(url); (folder/path).write_bytes(data)
            result['files'].append({'path':path,'url':url,'sha256':hashlib.sha256(data).hexdigest()})
        except Exception as error: result['files'].append({'path':path,'error':str(error)})
    print(repo,result['stars'],result['forks'],result['head_sha'],flush=True)
    return result
if __name__=='__main__':
    results=[]
    with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:
        futures={pool.submit(collect,repo):repo for repo in REPOS}
        for future in concurrent.futures.as_completed(futures):
            try: results.append(future.result())
            except Exception as error: results.append({'repository':futures[future],'error':str(error)})
    (ROOT/'repositories.json').write_text(json.dumps(results,indent=2),encoding='utf-8')
