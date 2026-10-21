"""Code-only Cloudflare rollout: preserve the exact live GPS and asset configuration."""
import email.parser, email.policy, hashlib, json, os, pathlib, subprocess, urllib.request, uuid
ROOT=pathlib.Path(__file__).parent
BASE='https://api.cloudflare.com/client/v4/accounts/'+os.environ['CF_ACCOUNT']+'/workers/scripts/carplay-telephone'
HEADERS={'Authorization':'Bearer '+os.environ['CF_TOKEN']}
def call(url, data=None, headers=None, method=None):
    req=urllib.request.Request(url,data=data,headers={**HEADERS,**(headers or {})},method=method)
    with urllib.request.urlopen(req,timeout=90) as r:return r.read(),r.headers
raw,headers=call(BASE)
message=email.parser.BytesParser(policy=email.policy.default).parsebytes(('Content-Type: '+headers['Content-Type']+'\r\nMIME-Version: 1.0\r\n\r\n').encode()+raw)
modules={part.get_filename() or part.get_param('name',header='content-disposition'):part.get_payload(decode=True) for part in message.iter_parts()}
expected=json.loads((ROOT/'baseline.json').read_text())
for name,sha in expected.items():
    if hashlib.sha256(modules.get(name,b'')).hexdigest()!=sha:raise SystemExit('Live source changed: '+name+'. Review the newer version before deployment.')
if set(modules)!=set(expected):raise SystemExit('Live module inventory changed. Review required.')
original=dict(modules)
core=modules['index.js'].decode()
def replace_once(old,new):
    global core
    if core.count(old)!=1:raise SystemExit('Source anchor mismatch: '+old[:80])
    core=core.replace(old,new)
replace_once('var index_default = withWalkRepair(appWorker);','var index_default = withAccessPolicy(withWalkRepair(appWorker), adminAuthorized);')
replace_once('async function saveVerifiedAppIdentity(env, data, verifiedAt) {','async function saveVerifiedAppIdentity(env, data, verifiedAt) {\n  if (await blocked(env.DB, data || {})) throw new Error("COMPTE_SUPPRIME_DEFINITIVEMENT");')
replace_once('async function verifiedAppIdentityState(env, email, deviceId) {','async function verifiedAppIdentityState(env, email, deviceId) {\n  if (await blocked(env.DB, {email, deviceId})) return {verified:false, permanent:true};')
core='import {withAccessPolicy, blocked} from "./access-policy.mjs";\n'+core
modules['index.js']=core.encode()
modules['access-policy.mjs']=(ROOT/'access-policy.mjs').read_bytes()
# Syntax-check every changed JavaScript module before uploading.
for name in ['index.js','access-policy.mjs']:
    target=pathlib.Path('/tmp')/('validate-'+name+'.mjs');target.write_bytes(modules[name]);subprocess.run(['node','--check',str(target)],check=True)
def upload(parts):
    boundary='----access-'+uuid.uuid4().hex
    body=bytearray()
    def part(name,content,typ,filename=None):
        body.extend(('--'+boundary+'\r\nContent-Disposition: form-data; name="'+name+'"'+('; filename="'+filename+'"' if filename else '')+'\r\nContent-Type: '+typ+'\r\n\r\n').encode());body.extend(content);body.extend(b'\r\n')
    part('metadata',json.dumps({'main_module':'index.js'}).encode(),'application/json')
    for name,content in parts.items():part(name,content,'application/source-map' if name.endswith('.map') else 'application/javascript+module',name)
    body.extend(('--'+boundary+'--\r\n').encode())
    data,_=call(BASE+'/content',bytes(body),{'Content-Type':'multipart/form-data; boundary='+boundary},'PUT')
    result=json.loads(data)
    if not result.get('success'):raise RuntimeError('Cloudflare deployment rejected: '+json.dumps(result.get('errors')))
    print('Worker content deployed; configuration, bindings, assets and GPS module preserved.')
upload(modules)
try:
    for path,marker in [('/index.html','access-entry-20261021.js'),('/admin.html','SUPPRIMER ET BLOQUER DÉFINITIVEMENT'),('/subscription-web.js','accessSubscriptionEntry')]:
        text=subprocess.check_output(['curl','--location','--fail','--silent','--show-error','--retry','3','--max-time','45','-H','Cache-Control: no-cache','https://carplay-telephone.appli-suzon.workers.dev'+path]).decode()
        if marker not in text:raise RuntimeError('Missing rollout marker on '+path)
    print('Production entry, administration and subscription markers verified.')
except Exception:
    upload(original)
    print('Verification failed: original live Worker restored.')
    raise

