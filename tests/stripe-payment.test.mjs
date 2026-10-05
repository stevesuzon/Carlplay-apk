import assert from 'node:assert/strict';import {spawnSync} from 'node:child_process';import fs from 'node:fs';import os from 'node:os';import {webcrypto} from 'node:crypto';import {createStripePayments} from '../src/stripe-payment.mjs';
if(!globalThis.crypto)globalThis.crypto=webcrypto;
const path=os.tmpdir()+'/couteau-stripe-'+crypto.randomUUID()+'.sqlite';try{fs.unlinkSync(path)}catch(_){}
const python=`import sqlite3,json,sys
p=json.load(sys.stdin); c=sqlite3.connect(p['path']); c.row_factory=sqlite3.Row
try:
 out=[]
 for s in p['queries']:
  x=c.execute(s['sql'],s['args']); rows=[dict(r) for r in x.fetchall()] if x.description else []; out.append({'results':rows,'meta':{'changes':max(0,x.rowcount)}})
 c.commit(); print(json.dumps(out))
except Exception as e:
 c.rollback(); print(json.dumps({'error':str(e)})); sys.exit(1)
`;
function sql(queries){const r=spawnSync('python',['-c',python],{input:JSON.stringify({path,queries}),encoding:'utf8'});if(r.status)throw Error(r.stdout);return JSON.parse(r.stdout);}
const DB={prepare(sqlText){return {sql:sqlText,args:[],bind(...args){this.args=args;return this},async run(){return sql([this])[0]},async first(){return sql([this])[0].results[0]||null},async all(){return sql([this])[0]}}},async batch(q){return sql(q)}};
await DB.prepare('CREATE TABLE subscriptions(id INTEGER PRIMARY KEY,code_hash TEXT UNIQUE,expires_at TEXT,lifetime INTEGER,active INTEGER,recovery_code_box TEXT,duration_days INTEGER,redeemed_at INTEGER,recovery_email_hash TEXT)').run();
await DB.prepare('CREATE TABLE app_identities(device_id TEXT,email TEXT,first_name TEXT,last_name TEXT,email_verified_at INTEGER,email_verified_device_id TEXT,updated_at INTEGER)').run();
await DB.prepare('INSERT INTO app_identities VALUES(?,?,?,?,?,?,?)').bind('device123','test@example.com','Test','Person',1,'device123',1).run();
let n=0,mails=0,stripeCalls=[];const digest=async x=>Buffer.from(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(x))).toString('hex');
const h={json:(data,status=200)=>new Response(JSON.stringify(data),{status}),body:r=>r.json(),ensureMarketSchemaOnce:async(db,k,f)=>f(),ensureSubscriptionEmailColumns:async()=>{},ensureAppIdentityTables:async()=>{},validDevice:x=>x.length>=8,validEmail:x=>x.includes('@'),normalizeEmail:x=>x.toLowerCase(),sha256Text:digest,randomSubscriptionCode:()=>('CODE'+(++n).toString().padStart(2,'0')),hashCode:digest,sealRecoveryCode:async x=>'sealed:'+x,openRecoveryCode:async x=>x.slice(7),brevoSendHtml:async()=>{mails++;return true}};
const env={DB,STRIPE_SECRET_KEY:'sk_live_test_fixture',STRIPE_WEBHOOK_SECRET:'whsec_fixture',CODE_PEPPER:'fixture'},pay=createStripePayments(h),token='a'.repeat(64),request=data=>new Request('https://app/api',{method:'POST',body:JSON.stringify(data)});
globalThis.fetch=async(url,opts)=>{stripeCalls.push({url,opts});return new Response(JSON.stringify({id:'cs_live_1',url:'https://checkout.stripe.com/c/pay/cs_live_1'}));};
assert.equal((await pay.checkout(request({}),{...env,STRIPE_SECRET_KEY:''})).status,503);
assert.equal((await pay.checkout(request({deviceId:'unknown12',token}),env)).status,403);
const first=await (await pay.checkout(request({deviceId:'device123',token}),env)).json();assert(first.ok);assert.equal(stripeCalls.length,1);const form=new URLSearchParams(stripeCalls[0].opts.body);assert.equal(form.get('line_items[0][price_data][unit_amount]'),'3000');assert.equal(form.get('mode'),'payment');assert.equal(form.get('payment_method_types[0]'),'card');
await pay.checkout(request({deviceId:'device123',token}),env);assert.equal(stripeCalls.length,1,'reuse the checkout on retry');
const paid={id:'cs_live_1',livemode:true,payment_status:'paid',mode:'payment',amount_total:3000,currency:'eur',client_reference_id:first.orderId,metadata:{product:'couteau-suisse-365',order_id:first.orderId}};
assert.equal(await pay.fulfill(env,{...paid,payment_status:'unpaid'}),null);assert.equal(await pay.fulfill(env,{...paid,amount_total:1}),null);assert.equal(await pay.fulfill(env,{...paid,livemode:false}),null);
assert.equal((await DB.prepare('SELECT COUNT(*) n FROM subscriptions').first()).n,0);
const both=await Promise.all([pay.fulfill(env,paid),pay.fulfill(env,paid)]);assert.equal(both[0].code_hash,both[1].code_hash);assert.equal((await DB.prepare('SELECT COUNT(*) n FROM subscriptions').first()).n,1);
assert.equal((await DB.prepare('SELECT duration_days FROM subscriptions').first()).duration_days,365);
assert.equal((await pay.status(request({orderId:first.orderId,token:'wrong'}),env)).status,404);
const result=await (await pay.status(request({orderId:first.orderId,token}),env)).json();assert(result.paid);assert(result.code);assert.equal(result.email,'test@example.com');assert.equal(mails,1);
await pay.status(request({orderId:first.orderId,token}),env);assert.equal(mails,1);assert.equal((await pay.owner(env,both[0].code_hash)).email,'test@example.com');
const raw=JSON.stringify({type:'checkout.session.completed',data:{object:paid}}),timestamp=Math.floor(Date.now()/1000),key=await crypto.subtle.importKey('raw',new TextEncoder().encode(env.STRIPE_WEBHOOK_SECRET),{name:'HMAC',hash:'SHA-256'},false,['sign']),signed=Buffer.from(await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(timestamp+'.'+raw))).toString('hex');
assert(await pay.signature(raw,'t='+timestamp+',v1='+signed,env.STRIPE_WEBHOOK_SECRET));assert(!await pay.signature(raw+' ','t='+timestamp+',v1='+signed,env.STRIPE_WEBHOOK_SECRET));assert(!await pay.signature(raw,'t='+(timestamp-600)+',v1='+signed,env.STRIPE_WEBHOOK_SECRET));
assert.equal((await pay.webhook(new Request('https://app/webhook',{method:'POST',body:raw,headers:{'stripe-signature':'t='+timestamp+',v1='+signed}}),env)).status,200);assert.equal((await DB.prepare('SELECT COUNT(*) n FROM subscriptions').first()).n,1);
assert.equal((await pay.webhook(new Request('https://app/webhook',{method:'POST',body:raw}),env)).status,400);
console.log('PASS: confirmed identity, fixed price, single payment, retries, unpaid/test/wrong amounts rejected, atomic concurrent fulfillment, 365-day code, receipt token, email deduplication, signed and tampered webhooks');

const server=fs.readFileSync(new URL('../src/index.js',import.meta.url),'utf8');
const actual=new Function('createStripePayments',server.replace(/^import[^\n]+\n/,'').replace('export default','const unusedWorker=')+';return {activate,hashCode};')(createStripePayments);
await DB.prepare('ALTER TABLE subscriptions ADD COLUMN phone_device TEXT').run();
await DB.prepare('ALTER TABLE subscriptions ADD COLUMN autoradio_device TEXT').run();
await DB.prepare('ALTER TABLE subscriptions ADD COLUMN updated_at TEXT').run();
const renewalCode='ZXCVBN',renewalHash=await actual.hashCode(renewalCode,env.CODE_PEPPER),emailHash=await digest('test@example.com');
await DB.prepare('INSERT INTO subscriptions(code_hash,expires_at,lifetime,active,duration_days) VALUES(?,?,0,1,365)').bind(renewalHash,new Date(Date.now()+365*86400000).toISOString()).run();
await DB.prepare('INSERT INTO stripe_access_orders(id,token_hash,device_id,email,first_name,last_name,created_at,code_hash) VALUES(?,?,?,?,?,?,?,?)').bind('renewal-order','token','device123','test@example.com','Test','Person',Date.now(),renewalHash).run();
let denied=await actual.activate(request({code:renewalCode,email:'wrong@example.com',firstName:'Test',lastName:'Person',deviceId:'device123'}),env);assert.equal(denied.status,403);
const oldEnd=new Date(Date.now()+10*86400000).toISOString();
await DB.prepare('INSERT INTO subscriptions(code_hash,expires_at,lifetime,active,duration_days,redeemed_at,recovery_email_hash,recovery_email_mask,account_first_name,account_last_name,phone_device) VALUES(?,?,0,1,365,1,?,?,?,?,?)').bind('oldhash',oldEnd,emailHash,'test@example.com','Test','Person','device123').run();
const input={code:renewalCode,email:'test@example.com',firstName:'Test',lastName:'Person',deviceId:'device123',deviceType:'phone'};
const renewed=await (await actual.activate(request(input),env)).json();assert(renewed.ok,JSON.stringify(renewed));assert.equal(Date.parse(renewed.expiresAt),Date.parse(oldEnd)+365*86400000);
const again=await (await actual.activate(request(input),env)).json();assert(again.ok);assert.equal(again.expiresAt,renewed.expiresAt);
console.log('PASS: actual activation binds paid code to purchaser, preserves existing paid days and adds the year only once');
fs.unlinkSync(path);
