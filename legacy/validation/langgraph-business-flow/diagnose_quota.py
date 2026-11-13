"""Reproduce concurrent quota errors on consistent copies, never original evidence."""
import concurrent.futures
import json
from pathlib import Path
import sqlite3
import sys

from test_flow import HERE, Lab, Rejected, request

lab = Lab()
source_id = json.loads((HERE/'evidence/results.json').read_text(encoding='utf-8'))['installation']
source = HERE/'.state'/source_id
for name in ['business.sqlite','canonical.sqlite']:
    with sqlite3.connect('file:'+str(source/name)+'?mode=ro',uri=True) as original:
        with sqlite3.connect(lab.state/name) as copy:
            original.backup(copy)
principals = [{'id':name,'role':role,'installation':lab.id,'sources':[],'token':lab.tokens[name]}
              for name,role in [('owner','finance'),('board','board'),('worker','worker')]]
config = {'installation':lab.id,'db':str(lab.state/'business.sqlite'),'editorial':str(lab.state/'canonical.sqlite'),
          'vault':str(lab.state/'unused-vault'),'editorialKey':lab.secret,'principals':principals,
          'budget':64,'provider':'http://127.0.0.1:1','providerKey':lab.provider_key,'leaseMs':60000}
results = {'source_installation':source_id,'copy_installation':lab.id}
try:
    urls = [lab.service(['node',str(HERE/'business.ts')],config)[1] for _ in range(2)]
    def attempt(index):
        try:
            request(urls[index%2],lab.tokens['owner'],{'action':'create','capabilities':['policy_lookup'],'execute':True,'maxUnits':3})
            return {'status':200}
        except Rejected as error:
            return {'status':error.status,'error':str(error)}
    with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
        results['requests'] = list(pool.map(attempt,range(48)))
finally:
    lab.cleanup()
results['service_errors'] = [(lab.state/f'service-{i}.log').read_text(encoding='utf-8') for i in range(2)]
destination = Path(sys.argv[1])
destination.write_text(json.dumps(results,indent=2),encoding='utf-8')
print(json.dumps({'statuses':{str(s):sum(r['status']==s for r in results['requests']) for s in {r['status'] for r in results['requests']}},
                  'service_errors':results['service_errors']}))
