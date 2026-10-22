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
# Cloudflare may omit the optional sourcemap after a secrets update.
if 'index.js.map' not in modules:expected.pop('index.js.map',None)
for name,sha in expected.items():
    if hashlib.sha256(modules.get(name,b'')).hexdigest()!=sha:raise SystemExit('Live source changed: '+name+'. Review the newer version before deployment.')
if set(modules)!=set(expected):raise SystemExit('Live module inventory changed. Review required.')
original=dict(modules)
core=modules['index.js'].decode()
def replace_once(old,new):
    global core
    if core.count(old)!=1:raise SystemExit('Brand patch no longer matches reviewed live core: '+old[:80])
    core=core.replace(old,new)
replace_once('const ORIGIN = "https://carplay-telephone.appli-suzon.workers.dev", PRODUCT = "couteau-suisse-365", PRICE = 1499;', 'const PRODUCT = "couteau-suisse-365", PRICE = 1499;')
replace_once('async function checkout(request, env) {', '''async function checkout(request, env) {
    const requestedOrigin = new URL(request.url).origin;
    const ORIGIN = ["https://couteau-suisse.appli-suzon.workers.dev", "https://carplay-telephone.appli-suzon.workers.dev"].includes(requestedOrigin) ? requestedOrigin : "https://couteau-suisse.appli-suzon.workers.dev";''')
replace_once('success_url: ORIGIN + "/payment.html?order=" + order.id,', '"branding_settings[display_name]": "Couteau Suisse",\n      success_url: ORIGIN + "/payment.html?order=" + order.id,')
modules['index.js']=core.encode()
modules['access-policy.mjs']=(ROOT/'access-policy.mjs').read_bytes()
modules['recovery-v2.mjs']=(ROOT/'recovery-v2.mjs').read_bytes()
# Syntax-check every changed JavaScript module before uploading.
for name in ['index.js','access-policy.mjs','recovery-v2.mjs']:
    target=pathlib.Path('/tmp')/('validate-'+name+'.mjs');target.write_bytes(modules[name]);subprocess.run(['node','--check',str(target)],check=True)
def upload(parts, target=None, metadata=None):
    boundary='----access-'+uuid.uuid4().hex
    body=bytearray()
    def part(name,content,typ,filename=None):
        body.extend(('--'+boundary+'\r\nContent-Disposition: form-data; name="'+name+'"'+('; filename="'+filename+'"' if filename else '')+'\r\nContent-Type: '+typ+'\r\n\r\n').encode());body.extend(content);body.extend(b'\r\n')
    part('metadata',json.dumps(metadata or {'main_module':'index.js'}).encode(),'application/json')
    for name,content in parts.items():part(name,content,'application/source-map' if name.endswith('.map') else 'application/javascript+module',name)
    body.extend(('--'+boundary+'--\r\n').encode())
    data,_=call(target or BASE+'/content',bytes(body),{'Content-Type':'multipart/form-data; boundary='+boundary},'PUT')
    result=json.loads(data)
    if not result.get('success'):raise RuntimeError('Cloudflare deployment rejected: '+json.dumps(result.get('errors')))
    print('Worker content deployed; configuration, bindings, assets and GPS module preserved.')
PUBLIC_BASE=BASE.rsplit('/',1)[0]+'/couteau-suisse'
proxy=(ROOT/'public-entry.mjs').read_bytes()
# Refuse to overwrite another application at the new public address.
try:
    prior,_=call(PUBLIC_BASE)
    if proxy not in prior:raise SystemExit('Public Worker already exists with different source; review required.')
except urllib.error.HTTPError as e:
    if e.code!=404:raise
upload(modules)
try:
    upload({'index.js':proxy},PUBLIC_BASE,{'main_module':'index.js','compatibility_date':'2026-08-01','bindings':[{'type':'service','name':'APPLICATION','service':'carplay-telephone'}]})
    result,_=call(PUBLIC_BASE+'/subdomain',json.dumps({'enabled':True,'previews_enabled':False}).encode(),{'Content-Type':'application/json'},'POST')
    if not json.loads(result).get('success'):raise RuntimeError('Could not enable public domain')
    for path,marker in [('/index.html','access-entry-20261021-onboarding.js'),('/admin.html','SUPPRIMER ET BLOQUER DÉFINITIVEMENT'),('/subscription-web.js','accessSubscriptionEntry')]:
        text=subprocess.check_output(['curl','--location','--fail','--silent','--show-error','--retry','3','--max-time','45','-H','Cache-Control: no-cache','https://carplay-telephone.appli-suzon.workers.dev'+path]).decode()
        if marker not in text:raise RuntimeError('Missing rollout marker on '+path)
    for path,marker in [('/index.html','Couteau Suisse'),('/top-ui.js','COUTEAU SUISSE'),('/license-ui.js','COUTEAU SUISSE'),('/manifest.webmanifest','Couteau Suisse'),('/api/payment-config','1499')]:
        text=subprocess.check_output(['curl','--location','--fail','--silent','--show-error','--retry','3','--max-time','30','https://couteau-suisse.appli-suzon.workers.dev'+path]).decode()
        if marker not in text:raise RuntimeError('Missing public brand marker on '+path)
    print('Both entry points, brand, manifest, administration and payment configuration verified.')
except Exception:
    upload(original)
    print('Verification failed: original live Worker restored.')
    raise
