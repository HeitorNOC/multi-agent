"""Local synthetic human authorization-code + PKCE protocol test, not corporate federation."""
import base64,hashlib,json,secrets
from http.cookiejar import CookieJar,DefaultCookiePolicy
from html.parser import HTMLParser
from urllib.request import build_opener,HTTPCookieProcessor,HTTPRedirectHandler,Request
from urllib.parse import urlencode,urlparse,parse_qs
from urllib.error import HTTPError
import jwt
from harness import http
from protocol import request,Rejected

class Form(HTMLParser):
    action=None
    def handle_starttag(self,tag,attrs):
        d=dict(attrs)
        if tag=='form' and d.get('id')=='kc-form-login':self.action=d['action']

def run(stack):
    base=stack.issuer.split('/realms/')[0]
    admin=http(base+'/realms/master/protocol/openid-connect/token',{'grant_type':'password','client_id':'admin-cli','username':'pilot-admin','password':stack.admin},form=True)['access_token']
    redirect='http://127.0.0.1:19731/callback'
    client={'clientId':'human-pilot','enabled':True,'publicClient':True,'standardFlowEnabled':True,'directAccessGrantsEnabled':False,
            'redirectUris':[redirect],'attributes':{'pkce.code.challenge.method':'S256'},'fullScopeAllowed':False,
            'protocolMappers':[{'name':'brain-audience','protocol':'openid-connect','protocolMapper':'oidc-audience-mapper','config':{'included.custom.audience':'brain-api','access.token.claim':'true'}}]}
    http(base+'/admin/realms/piloto/clients',client,admin)
    password=secrets.token_hex(20)
    user={'username':'synthetic-human','firstName':'Pessoa','lastName':'Sintetica','email':'synthetic@example.invalid','emailVerified':True,'enabled':True,
          'credentials':[{'type':'password','value':password,'temporary':False}]}
    http(base+'/admin/realms/piloto/users',user,admin)
    users=http(base+'/admin/realms/piloto/users?username=synthetic-human&exact=true',token=admin);subject=users[0]['id']
    # Enrollment is trusted governance, not caller-selected role or JWT claims.
    assert all(x in '0123456789abcdef-' for x in subject)
    stack.sql("INSERT INTO principals(id,name,role) VALUES('"+subject+"','synthetic-human','analyst');",'pilot')
    stack.sql("INSERT INTO grants SELECT '"+subject+"',id FROM sources WHERE domain='publico';",'pilot')
    class Capture(HTTPRedirectHandler):
        def redirect_request(self,req,fp,code,msg,headers,newurl):
            if newurl.startswith(redirect):return None
            return super().redirect_request(req,fp,code,msg,headers,newurl)
    def code_flow():
        verifier=secrets.token_urlsafe(40);challenge=base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).decode().rstrip('=')
        state=secrets.token_urlsafe(24);nonce=secrets.token_urlsafe(24)
        params={'client_id':'human-pilot','redirect_uri':redirect,'response_type':'code','scope':'openid','state':state,'nonce':nonce,'code_challenge':challenge,'code_challenge_method':'S256'}
        # Explicit loopback-only HTTP fixture. Do not reuse this cookie policy on a real host.
        # Secure-cookie behavior must be qualified with HTTPS in the actual deployment.
        assert urlparse(stack.issuer).hostname=='127.0.0.1'
        jar=CookieJar(policy=DefaultCookiePolicy(secure_protocols=('https','wss','http')))
        opener=build_opener(HTTPCookieProcessor(jar),Capture())
        with opener.open(stack.issuer+'/protocol/openid-connect/auth?'+urlencode(params),timeout=15) as r:html=r.read().decode()
        form=Form();form.feed(html);assert form.action
        try:opener.open(Request(form.action,urlencode({'username':'synthetic-human','password':password,'credentialId':''}).encode()),timeout=15);raise AssertionError('login did not return code')
        except HTTPError as e:
            assert e.code in (302,303),{'status':e.code,'cookies':[{'name':c.name,'secure':c.secure,'domain':c.domain,'path':c.path} for c in jar]}
            location=e.headers['Location'];assert location.startswith(redirect+'?')
            values=parse_qs(urlparse(location).query);assert values['state']==[state]
            assert values['iss']==[stack.issuer]
            return values['code'][0],verifier,nonce
    code,verifier,nonce=code_flow()
    payload={'grant_type':'authorization_code','client_id':'human-pilot','redirect_uri':redirect,'code':code,'code_verifier':verifier}
    token=http(stack.issuer+'/protocol/openid-connect/token',payload,form=True)
    keys=http(stack.issuer+'/protocol/openid-connect/certs')['keys'];header=jwt.get_unverified_header(token['id_token'])
    key=jwt.PyJWK.from_dict(next(k for k in keys if k['kid']==header['kid'])).key
    claims=jwt.decode(token['id_token'],key,algorithms=['RS256'],audience='human-pilot',issuer=stack.issuer)
    assert claims['nonce']==nonce and claims['sub']==subject
    answer=request(stack.api,'/query',token['access_token'],{'domains':['publico'],'query':'ACME vendas'})
    assert 'SIGILO_' not in json.dumps(answer)
    try:request(stack.api,'/admin/state',token['access_token'],{});raise AssertionError('human escalated')
    except Rejected as e:assert e.status==403
    try:http(stack.issuer+'/protocol/openid-connect/token',payload,form=True);raise AssertionError('code replay accepted')
    except RuntimeError as e:assert str(e).startswith('400')
    code2,verifier2,_=code_flow()
    try:http(stack.issuer+'/protocol/openid-connect/token',{**payload,'code':code2,'code_verifier':'wrong-verifier-that-is-long-enough-to-be-a-code-verifier'},form=True);raise AssertionError('wrong PKCE accepted')
    except RuntimeError as e:assert str(e).startswith('400')
    # Local principal revocation must fence even an unexpired signed human token.
    stack.sql("UPDATE principals SET enabled=FALSE WHERE id='"+subject+"';",'pilot')
    try:request(stack.api,'/query',token['access_token'],{'domains':['publico'],'query':'vendas'});raise AssertionError('disabled human accepted')
    except Rejected as e:assert e.status==403
    return {'authorization_code_pkce_s256':True,'id_token_nonce_verified':True,'local_human_query':True,'privilege_escalation_denied':True,'code_replay_denied':True,'wrong_pkce_denied':True,'local_principal_revocation_denied':True,
            'scope':'synthetic user at local Keycloak; HTTP loopback; no corporate federation MFA TLS or IdP-only immediate revocation claim'}
