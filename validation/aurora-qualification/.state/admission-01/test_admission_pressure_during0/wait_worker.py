import json,sys
from urllib.request import urlopen
config=json.load(sys.stdin)
with urlopen(config['backend']+'/hold',timeout=60) as res:
    res.read()
print(json.dumps({'completed':False}),flush=True)
