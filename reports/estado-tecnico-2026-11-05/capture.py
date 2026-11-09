"""Read-only snapshot for handoff. Never copies .state, tokens or connection strings."""
import datetime,hashlib,json,pathlib,subprocess,urllib.request,xml.etree.ElementTree as ET
HERE=pathlib.Path(__file__).resolve().parent;ROOT=HERE.parents[1]
def run(args):
    p=subprocess.run(args,cwd=ROOT,text=True,encoding='utf-8',errors='replace',capture_output=True,timeout=20)
    return {'exit_code':p.returncode,'stdout':p.stdout.strip(),'stderr':p.stderr.strip()}
def read(path):return json.loads((ROOT/path).read_text(encoding='utf-8'))
out={'captured_at_utc':datetime.datetime.now(datetime.timezone.utc).isoformat(),'new_model_calls':0,'new_e2e_runs':0,
     'root_git':run(['git','rev-parse','--show-toplevel']),'vendor':{},'live':{},'manifest_checks':{},'junit':[]}
for name in ['langgraph','lightrag','paperclip','graphiti-audit','opencompany-zeenie','openagents-audit','eigent-audit','agentscope-audit']:
    path='vendor/'+name
    out['vendor'][name]={'head':run(['git','-C',path,'rev-parse','HEAD']),
        'last_commit':run(['git','-C',path,'log','-1','--format=%H%n%cI%n%s']),
        'tracked_changes':run(['git','-C',path,'status','--porcelain','--untracked-files=no'])}
for name in ['demo','demo-enterprise']:
    try:
        active=read(name+'/.state/active.json')
        with urllib.request.urlopen(active['url']+'/api/state',timeout=8) as response:data=json.load(response)
        runtime=data['runtime']
        out['live'][name]={'reachable':True,'url':active['url'],'phase':runtime['phase'],'sources':len(runtime['sources']),
           'catalog':len(runtime.get('catalog',[])),'usage':runtime['usage'],
           'jobs':[{'id':j['id'],'status':j['status'],'worker_active':j['worker_active'],
                    'selected':j['plan']['capabilities'] if j['plan'] else [],'approval':j['approval'],
                    'receipt_id':j['receipt']['id'] if j['receipt'] else None,'simulated':j['receipt']['simulated'] if j['receipt'] else None,
                    'events':len(j['events'])} for j in data['jobs']]}
    except Exception as error:out['live'][name]={'reachable':False,'error_type':type(error).__name__}
    manifest=read(name+'/evidence/source-manifest.json');mismatches=[];missing=[]
    for path,digest in manifest.items():
        p=(ROOT/name/path) if name=='demo' else ROOT/path
        if not p.exists():missing.append(path)
        elif hashlib.sha256(p.read_bytes()).hexdigest()!=digest:mismatches.append(path)
    out['manifest_checks'][name]={'files':len(manifest),'mismatches':mismatches,'missing':missing}
for directory in (ROOT/'validation').iterdir():
    if not directory.is_dir() or directory.name.startswith('.') or directory.name in ['uv-cache','python']:continue
    for file in directory.glob('*.xml'):
        try:
            tree=ET.parse(file).getroot();suites=[tree] if tree.tag=='testsuite' else list(tree.iter('testsuite'))
            out['junit'].append({'path':file.relative_to(ROOT).as_posix(),
                **{k:sum(int(s.attrib.get(k,0)) for s in suites) for k in ['tests','failures','errors','skipped']},
                'seconds':sum(float(s.attrib.get('time',0)) for s in suites)})
        except (ET.ParseError,ValueError):pass
out['versions']=read('validation/detached-inference/environment.json')
(HERE/'snapshot.json').write_text(json.dumps(out,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps({k:out[k] for k in ['captured_at_utc','root_git','live','manifest_checks']},ensure_ascii=False,indent=2))
