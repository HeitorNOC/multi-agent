"""Separate OS client process. Makes reservations only; never invokes a model."""
import json,sys,uuid
from urllib.error import HTTPError
from authority_client import request
def main(c):
    rows=[]
    for _ in range(10):
        id=str(uuid.uuid4())
        try:rows.append({'granted':True,**request(c,action='reserve_call',scope='stress',id=id)['reservation']})
        except HTTPError as e:
            if e.code!=409:raise
            rows.append({'granted':False,'id':id,'status':e.code})
    print(json.dumps(rows))
if __name__=='__main__':main(json.loads(sys.stdin.readline()))
