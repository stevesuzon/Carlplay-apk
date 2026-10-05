// Server-only Stripe Checkout. No card details or Stripe secrets enter browser code.
export function createStripePayments(h){
 const ORIGIN='https://carplay-telephone.appli-suzon.workers.dev',PRODUCT='couteau-suisse-365',PRICE=3000;
 const configured=env=>/^(?:sk|rk)_live_/.test(env.STRIPE_SECRET_KEY||'')&&/^whsec_/.test(env.STRIPE_WEBHOOK_SECRET||'')&&!!env.CODE_PEPPER;
 async function schema(env){await h.ensureMarketSchemaOnce(env.DB,'stripe-checkout-v1',async()=>{
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS stripe_access_orders(id TEXT PRIMARY KEY,token_hash TEXT NOT NULL,device_id TEXT NOT NULL,email TEXT NOT NULL,first_name TEXT NOT NULL,last_name TEXT NOT NULL,created_at INTEGER NOT NULL,session_id TEXT UNIQUE,checkout_url TEXT,code_hash TEXT,code_box TEXT,paid_at INTEGER,email_sent_at INTEGER,email_lease INTEGER NOT NULL DEFAULT 0)`).run();
  await env.DB.prepare('CREATE INDEX IF NOT EXISTS stripe_orders_device ON stripe_access_orders(device_id,created_at)').run();
  await env.DB.prepare('CREATE INDEX IF NOT EXISTS stripe_orders_code ON stripe_access_orders(code_hash)').run();
 });await h.ensureSubscriptionEmailColumns(env);}
 async function stripe(env,path,params,idempotency){
  const response=await fetch('https://api.stripe.com/v1/'+path,{method:params?'POST':'GET',headers:{authorization:'Bearer '+env.STRIPE_SECRET_KEY,...(params?{'content-type':'application/x-www-form-urlencoded'}:{}),...(idempotency?{'idempotency-key':idempotency}:{})},...(params?{body:new URLSearchParams(params)}:{})});
  const value=await response.json();if(!response.ok)throw Error('STRIPE_INDISPONIBLE');return value;
 }
 async function mail(env,order){
  if(!order.code_box||order.email_sent_at)return false;
  const now=Date.now(),claim=await env.DB.prepare('UPDATE stripe_access_orders SET email_lease=? WHERE id=? AND email_sent_at IS NULL AND email_lease<=?').bind(now+3600000,order.id,now).run();if(!claim.meta?.changes)return false;
  const code=await h.openRecoveryCode(order.code_box,env);if(!code)return false;
  const text='Merci pour votre paiement de 30 €. Votre code Couteau Suisse est : '+code+'.\nIl ajoute 365 jours à votre accès lors de son activation, en conservant les jours payés restants.\nOuvrez Couteau Suisse, puis Réglages > Abonnement pour l’activer avec votre nom, prénom et votre adresse e-mail.';
  const sent=await h.brevoSendHtml(env,order.email,'Votre code Couteau Suisse — 1 an',text,'<div style="font-family:Arial,sans-serif"><h2>Couteau Suisse</h2><p>Merci pour votre paiement de 30 €.</p><p>Votre code pour un an :</p><p style="font-size:32px;font-weight:bold;letter-spacing:6px">'+code+'</p><p>Activez-le dans Réglages → Abonnement. Vos jours payés restants sont conservés.</p></div>');
  if(sent)await env.DB.prepare('UPDATE stripe_access_orders SET email_sent_at=? WHERE id=?').bind(Date.now(),order.id).run();return sent;
 }
 async function fulfill(env,session){
  if(session.livemode!==true||session.payment_status!=='paid'||session.mode!=='payment'||session.amount_total!==PRICE||session.currency!=='eur'||session.metadata?.product!==PRODUCT)return null;
  const order=await env.DB.prepare('SELECT * FROM stripe_access_orders WHERE id=? AND session_id=?').bind(session.metadata?.order_id||'',session.id).first();
  if(!order||session.client_reference_id!==order.id)throw Error('PAIEMENT_INCONNU');
  if(!order.code_hash){
   for(let i=0;i<30;i++){
    const code=h.randomSubscriptionCode(),hash=await h.hashCode(code,env.CODE_PEPPER),exists=await env.DB.prepare('SELECT id FROM subscriptions WHERE code_hash=?').bind(hash).first();if(exists)continue;
    const box=await h.sealRecoveryCode(code,env),expires=new Date(Date.now()+365*86400000).toISOString();
    // D1 batches are atomic. The second concurrent delivery sees code_hash set and writes nothing.
    await env.DB.batch([
     env.DB.prepare('INSERT INTO subscriptions(code_hash,expires_at,lifetime,active,recovery_code_box,duration_days,redeemed_at) SELECT ?,?,0,1,?,365,NULL WHERE EXISTS(SELECT 1 FROM stripe_access_orders WHERE id=? AND code_hash IS NULL)').bind(hash,expires,box,order.id),
     env.DB.prepare('UPDATE stripe_access_orders SET code_hash=?,code_box=?,paid_at=? WHERE id=? AND code_hash IS NULL').bind(hash,box,Date.now(),order.id)
    ]);break;
   }
  }
  const final=await env.DB.prepare('SELECT * FROM stripe_access_orders WHERE id=?').bind(order.id).first();if(!final.code_hash)throw Error('CODE_NON_GENERE');return final;
 }
 async function signature(raw,header,secret){
  const pieces=String(header||'').split(','),ts=pieces.find(p=>p.startsWith('t='))?.slice(2),values=pieces.filter(p=>p.startsWith('v1=')).map(p=>p.slice(3));
  if(!/^\d+$/.test(ts||'')||Math.abs(Date.now()/1000-Number(ts))>300)return false;
  const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),{name:'HMAC',hash:'SHA-256'},false,['verify']);
  for(const v of values)if(/^[a-f0-9]{64}$/.test(v)&&await crypto.subtle.verify('HMAC',key,Uint8Array.from(v.match(/../g),x=>parseInt(x,16)),new TextEncoder().encode(ts+'.'+raw)))return true;
  return false;
 }
 async function checkout(request,env){
  if(!configured(env))return h.json({ok:false,error:'PAIEMENT_NON_CONFIGURE'},503);
  const data=await h.body(request),device=String(data.deviceId||'');if(!h.validDevice(device))return h.json({ok:false,error:'INSCRIPTION_REQUISE'},403);
  await h.ensureAppIdentityTables(env);
  const identity=await env.DB.prepare('SELECT email,first_name,last_name,email_verified_at,email_verified_device_id FROM app_identities WHERE device_id=? AND email_verified_at>0 ORDER BY updated_at DESC LIMIT 1').bind(device).first();
  if(!identity||!h.validEmail(identity.email)||!identity.first_name||!identity.last_name||(identity.email_verified_device_id&&identity.email_verified_device_id!==device))return h.json({ok:false,error:'EMAIL_A_CONFIRMER'},403);
  await schema(env);
  const current=await env.DB.prepare('SELECT lifetime FROM subscriptions WHERE active=1 AND recovery_email_hash=? AND lifetime=1 LIMIT 1').bind(await h.sha256Text(h.normalizeEmail(identity.email))).first();if(current)return h.json({ok:false,error:'ABONNEMENT_DEJA_A_VIE'},409);
  const token=String(data.token||'');if(!/^[a-f0-9]{64}$/.test(token))return h.json({ok:false,error:'DONNEES_INVALIDES'},400);
  const tokenHash=await h.sha256Text(token),email=h.normalizeEmail(identity.email);
  let order=await env.DB.prepare('SELECT * FROM stripe_access_orders WHERE device_id=? AND token_hash=? AND email=? AND created_at>? AND code_hash IS NULL ORDER BY created_at DESC LIMIT 1').bind(device,tokenHash,email,Date.now()-1800000).first();
  if(!order){
   const recent=await env.DB.prepare('SELECT COUNT(*) n FROM stripe_access_orders WHERE device_id=? AND created_at>?').bind(device,Date.now()-3600000).first();if(Number(recent.n)>4)return h.json({ok:false,error:'REESSAYEZ_PLUS_TARD'},429);
   order={id:crypto.randomUUID(),token_hash:tokenHash,device_id:device,email,first_name:identity.first_name,last_name:identity.last_name,created_at:Date.now()};
   await env.DB.prepare('INSERT INTO stripe_access_orders(id,token_hash,device_id,email,first_name,last_name,created_at) VALUES(?,?,?,?,?,?,?)').bind(order.id,tokenHash,device,email,order.first_name,order.last_name,order.created_at).run();
  }
  if(order.checkout_url)return h.json({ok:true,orderId:order.id,url:order.checkout_url});
  const session=await stripe(env,'checkout/sessions',{
   mode:'payment',customer_email:email,client_reference_id:order.id,'metadata[order_id]':order.id,'metadata[product]':PRODUCT,
   'payment_method_types[0]':'card','line_items[0][price_data][currency]':'eur','line_items[0][price_data][unit_amount]':String(PRICE),
   'line_items[0][price_data][product_data][name]':'Couteau Suisse — 1 an (365 jours)','line_items[0][quantity]':'1',
   success_url:ORIGIN+'/payment.html?order='+order.id,cancel_url:ORIGIN+'/payment.html?cancel=1&order='+order.id
  },'couteau-suisse-'+order.id);
  if(!/^https:\/\/checkout\.stripe\.com\//.test(session.url||''))throw Error('STRIPE_INDISPONIBLE');
  await env.DB.prepare('UPDATE stripe_access_orders SET session_id=?,checkout_url=? WHERE id=?').bind(session.id,session.url,order.id).run();return h.json({ok:true,orderId:order.id,url:session.url});
 }
 async function status(request,env,ctx){
  if(!configured(env))return h.json({ok:false,error:'PAIEMENT_NON_CONFIGURE'},503);await schema(env);const data=await h.body(request);
  const order=await env.DB.prepare('SELECT * FROM stripe_access_orders WHERE id=? AND token_hash=?').bind(String(data.orderId||''),await h.sha256Text(String(data.token||''))).first();if(!order)return h.json({ok:false,error:'COMMANDE_INTROUVABLE'},404);
  let final=order;if(!order.code_hash&&order.session_id)final=await fulfill(env,await stripe(env,'checkout/sessions/'+encodeURIComponent(order.session_id)))||order;
  if(!final.code_hash)return h.json({ok:true,paid:false});
  const task=mail(env,final);if(ctx?.waitUntil)ctx.waitUntil(task);else await task;
  return h.json({ok:true,paid:true,code:await h.openRecoveryCode(final.code_box,env),email:final.email,firstName:final.first_name,lastName:final.last_name,days:365,emailSent:!!final.email_sent_at});
 }
 async function webhook(request,env,ctx){
  if(!configured(env))return h.json({ok:false,error:'PAIEMENT_NON_CONFIGURE'},503);
  const raw=await request.text();if(!await signature(raw,request.headers.get('stripe-signature'),env.STRIPE_WEBHOOK_SECRET))return h.json({ok:false,error:'SIGNATURE_INVALIDE'},400);
  let event;try{event=JSON.parse(raw)}catch(_){return h.json({ok:false,error:'DONNEES_INVALIDES'},400);}
  if(event.type==='checkout.session.completed'||event.type==='checkout.session.async_payment_succeeded'){
   await schema(env);const final=await fulfill(env,event.data?.object||{});if(final){const task=mail(env,final);if(ctx?.waitUntil)ctx.waitUntil(task);else await task;}
  }
  return h.json({ok:true});
 }
 async function retryMail(env){if(!configured(env))return;await schema(env);const result=await env.DB.prepare('SELECT * FROM stripe_access_orders WHERE code_hash IS NOT NULL AND email_sent_at IS NULL AND email_lease<=? ORDER BY paid_at LIMIT 10').bind(Date.now()).all();for(const order of result.results||[])await mail(env,order);}
 async function owner(env,hash){try{return await env.DB.prepare('SELECT email,first_name,last_name FROM stripe_access_orders WHERE code_hash=?').bind(hash).first();}catch(e){if(/no such table/i.test(String(e.message)))return null;throw e;}}
 return {checkout,status,webhook,retryMail,signature,fulfill,owner,config:env=>h.json({ok:true,configured:configured(env),amount:PRICE,currency:'eur',days:365})};
}
