import {DatabaseSync} from 'node:sqlite';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {deleteAccount,blocked,digest,withAccessPolicy,patchAsset,adminScript,entryScript} from './access-policy.mjs';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
function fixture(){
 const sql=new DatabaseSync(':memory:');
 sql.exec(`CREATE TABLE app_identities(email TEXT,device_id TEXT,email_verified_device_id TEXT);
 CREATE TABLE subscriptions(id INTEGER PRIMARY KEY,active INTEGER,code_hash TEXT,recovery_email_hash TEXT,recovery_email_mask TEXT,recovery_code_box TEXT,account_first_name TEXT,account_last_name TEXT,phone_device TEXT,autoradio_device TEXT);
 CREATE TABLE app_identity_email_links(email TEXT,token_hash TEXT);
 CREATE TABLE market_user_sanctions(email TEXT);
 INSERT INTO app_identities VALUES('test@example.com','device-a','device-a'),('appli.suzon@gmail.com','admin-device','admin-device');
 INSERT INTO subscriptions VALUES(1,1,'oldcode','hash','test@example.com','encrypted','Test','User','device-a','radio-a');
 INSERT INTO app_identity_email_links VALUES('test@example.com','token');`);
 const db={prepare(q){let params=[];return {bind(...p){params=p;return this},async first(){return sql.prepare(q).get(...params)||null},async all(){return {results:sql.prepare(q).all(...params)}},async run(){return sql.prepare(q).run(...params)}}},async batch(items){sql.exec('BEGIN');try{const r=[];for(const s of items)r.push(await s.run());sql.exec('COMMIT');return r}catch(e){sql.exec('ROLLBACK');throw e}}};return {db,sql};
}
test('delete removes identity and tokens, revokes codes and blocks normalized email on another device',async()=>{
 const {db,sql}=fixture();assert.equal((await deleteAccount(db,{email:' TEST@Example.com ',deviceId:'admin-device'})).status,200);
 assert.equal(sql.prepare('SELECT count(*) n FROM app_identities').get().n,1);
 assert.equal(sql.prepare('SELECT count(*) n FROM app_identity_email_links').get().n,0);
 const sub=sql.prepare('SELECT * FROM subscriptions').get();assert.equal(sub.active,0);assert.equal(sub.recovery_email_mask,null);assert.equal(sub.recovery_code_box,null);assert.notEqual(sub.code_hash,'oldcode');
 assert.equal(await blocked(db,{email:'TEST@example.com',deviceId:'new-device'}),true);
 assert.equal(await blocked(db,{deviceId:'radio-a'}),true);
 assert.equal(await blocked(db,{deviceId:'admin-device'}),false);
 assert.equal(await blocked(db,{email:'other@example.com',deviceId:'other'}),false);
 assert.equal((await deleteAccount(db,{email:'test@example.com'})).status,200);
});
test('admin is protected and unauthorized delete never touches database',async()=>{
 const {db}=fixture();assert.equal((await deleteAccount(db,{email:'APPLI.SUZON@gmail.com'})).status,403);
 const w=withAccessPolicy({fetch(){throw Error('unexpected')}},async()=>false);
 const r=await w.fetch(new Request('https://app/api/admin/delete-user',{method:'POST',body:'{}'}),{},{});assert.equal(r.status,401);
});
test('blocked API registration, payment and reactivation are denied; status tells clients permanent',async()=>{
 const {db}=fixture();await deleteAccount(db,{email:'test@example.com'});
 const w=withAccessPolicy({fetch(){return Response.json({ok:true})}},async()=>false);
 for(const path of ['/api/app-identity/start','/api/reactivation-request','/api/payment-checkout','/api/activate']){
 const r=await w.fetch(new Request('https://app'+path,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email:'test@example.com',deviceId:'new-device'})}),{DB:db},{});assert.equal(r.status,403,path);
 }
 const r=await w.fetch(new Request('https://app/api/sanction/status',{method:'POST',headers:{'content-type':'application/json'},body:'{"deviceId":"device-a"}'}),{DB:db},{});assert.equal((await r.json()).permanent,true);
});
test('frontend transformations compile and remove the expired trial gate',async()=>{
 for(const name of ['subscription-web.js','app-access-gate-v506.js','sanction-guard-v161.js']){
 const src=readFileSync(new URL('../../public/'+name,import.meta.url),'utf8'),out=patchAsset('/'+name,src);if(name!=='app-access-gate-v506.js')assert.notEqual(out,src,name);new vm.Script(out);
 if(name==='subscription-web.js'){assert.ok(!out.includes('ABONNEMENT REQUIS'));assert.ok(out.includes('accessSubscriptionEntry'));assert.ok(out.includes('Pour profiter de toutes les fonctionnalités'));assert.ok(out.includes('S’ABONNER'));assert.ok(out.includes('href="/payment.html"'));assert.ok(out.includes("e.key==='Escape'"));}
 if(name==='app-access-gate-v506.js'){assert.equal(out,src);assert.ok(out.includes('st&&st.verified'));}
 }
 new vm.Script(adminScript);new vm.Script(entryScript);
 const html=readFileSync(new URL('../../public/admin.html',import.meta.url),'utf8');
 const w=withAccessPolicy({fetch:async()=>new Response(html,{headers:{'content-type':'text/html'}})},async()=>true);
 const out=await (await w.fetch(new Request('https://app/admin.html'),{},{})).text();assert.ok(out.includes('onclick="deleteUserPermanently('));
 for(const script of out.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g))new vm.Script(script[1]);
});
test('admin login quota failure is explained without weakening authentication',async()=>{
 let called=0;
 const w=withAccessPolicy({fetch:async()=>{called++;throw Error("D1_ERROR: Your account has exceeded D1's free tier daily row read limit.")}},async()=>false);
 const r=await w.fetch(new Request('https://app/api/admin/login/request',{method:'POST',headers:{'content-type':'application/json'},body:'{}'}),{},{});
 assert.equal(called,1);assert.equal(r.status,503);const j=await r.json();assert.equal(j.error,'SERVEUR_BASE_QUOTA');assert.match(j.message,/heure de Paris/);assert.ok(Date.parse(j.retryAt)>Date.now());assert.equal(j.challengeId,undefined);
 const html=readFileSync(new URL('../../public/admin.html',import.meta.url),'utf8');
 const page=withAccessPolicy({fetch:async()=>new Response(html,{headers:{'content-type':'text/html'}})},async()=>false);
 assert.ok((await(await page.fetch(new Request('https://app/admin'),{},{})).text()).includes("new Error(j.message||j.error||'Envoi impossible')"));
});
