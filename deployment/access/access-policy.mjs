// Access policy 2026-10-21. Wraps the live Worker; preserves assets and GPS modules.
export const VERSION = 'access-20261022-move-notice';
const ADMIN = 'appli.suzon@gmail.com';
const norm = value => String(value || '').trim().toLowerCase();
const reply = (value, status = 200) => Response.json(value, {status, headers:{'cache-control':'no-store'}});
export async function digest(value) {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))), b=>b.toString(16).padStart(2,'0')).join('');
}
const schemas = new WeakMap();
async function schema(db) {
  if (!schemas.has(db)) schemas.set(db, db.batch([
    db.prepare('CREATE TABLE IF NOT EXISTS app_permanent_blocks (email_hash TEXT PRIMARY KEY, created_at INTEGER NOT NULL)'),
    db.prepare('CREATE TABLE IF NOT EXISTS app_revoked_devices (device_hash TEXT PRIMARY KEY, created_at INTEGER NOT NULL)')
  ]).catch(e=>{schemas.delete(db);throw e}));
  await schemas.get(db);
}
export async function blocked(db, data) {
  await schema(db);
  const emails = [data.email,data.recoveryEmail,data.newEmail].map(norm).filter(Boolean);
  for (const email of emails) if(await db.prepare('SELECT 1 FROM app_permanent_blocks WHERE email_hash=?').bind(await digest(email)).first()) return true;
  const device = String(data.deviceId||data.device_id||'').trim();
  return !!(device && await db.prepare('SELECT 1 FROM app_revoked_devices WHERE device_hash=?').bind(await digest(device)).first());
}
export async function deleteAccount(db, data) {
  const email = norm(data.email);
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))return reply({ok:false,error:'EMAIL_INVALIDE'},400);
  if(email===ADMIN)return reply({ok:false,error:'ADMIN_NON_SUPPRIMABLE'},403);
  await schema(db);
  const hash=await digest(email), now=Date.now();
  const identities=(await db.prepare('SELECT * FROM app_identities WHERE lower(trim(email))=?').bind(email).all()).results||[];
  const subs=(await db.prepare("SELECT * FROM subscriptions WHERE lower(trim(COALESCE(recovery_email_mask,'')))=? OR recovery_email_hash=?").bind(email,hash).all()).results||[];
  if(!identities.length&&!subs.length){
    const old=await db.prepare('SELECT 1 FROM app_permanent_blocks WHERE email_hash=?').bind(hash).first();
    return old?reply({ok:true,permanent:true}):reply({ok:false,error:'UTILISATEUR_INTROUVABLE'},404);
  }
  // Resolve devices exclusively from server rows, never the submitted device or subscription ID.
  const devices=[...new Set([...identities.flatMap(r=>[r.device_id,r.email_verified_device_id]),...subs.flatMap(r=>[r.phone_device,r.autoradio_device])].filter(Boolean))];
  const adminRows=(await db.prepare('SELECT device_id,email_verified_device_id FROM app_identities WHERE lower(email)=?').bind(ADMIN).all()).results||[];
  const adminSubs=(await db.prepare('SELECT phone_device,autoradio_device FROM subscriptions WHERE lower(recovery_email_mask)=?').bind(ADMIN).all()).results||[];
  const protectedDevices=new Set([...adminRows.flatMap(r=>[r.device_id,r.email_verified_device_id]),...adminSubs.flatMap(r=>[r.phone_device,r.autoradio_device])].filter(Boolean));
  const statements=[db.prepare('INSERT OR IGNORE INTO app_permanent_blocks(email_hash,created_at) VALUES(?,?)').bind(hash,now)];
  for(const d of devices)if(!protectedDevices.has(d))statements.push(db.prepare('INSERT OR IGNORE INTO app_revoked_devices(device_hash,created_at) VALUES(?,?)').bind(await digest(d),now));
  // Delete identity/session/challenge records. Keep accounting subscription IDs, but erase
  // their personal fields, revoke entitlement and rotate the activation secret.
  const tables=new Set(((await db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all()).results||[]).map(r=>r.name));
  for(const table of ['app_identity_email_links','subscription_email_challenges','email_identity_challenges','admin_direct_messages','market_user_sanctions','app_identities']) {
    if(tables.has(table))statements.push(db.prepare(`DELETE FROM ${table} WHERE lower(trim(email))=?`).bind(email));
  }
  for(const s of subs){
    statements.push(db.prepare("UPDATE subscriptions SET active=0,code_hash=?,recovery_email_hash=NULL,recovery_email_mask=NULL,recovery_code_box=NULL,account_first_name='',account_last_name='',phone_device=NULL,autoradio_device=NULL WHERE id=?").bind(await digest(crypto.randomUUID()),s.id));
    for(const table of ['contest_participants','contest_results','app_messages']) if(tables.has(table))statements.push(db.prepare(`DELETE FROM ${table} WHERE subscription_id=?`).bind(s.id));
  }
  await db.batch(statements); // D1 batch is atomic: revocation and erasure succeed together.
  return reply({ok:true,permanent:true});
}
export function patchAsset(path, text) {
  if(path==='/stripe-payment-v1.js')return paymentScript;
  if(path==='/subscription-web.js') {
    text=text.replace(/<a href="https:\/\/www\.snapchat\.com\/add\/steve_suzon"[^>]*>Pour commander un code[\s\S]*?<\/a>/g,'');
    text=text.replaceAll('PAYER 30 € — 1 AN','PRENDRE / RENOUVELER L’ABONNEMENT');
    text=text.replace(/  function lockModal\(feature\) \{[\s\S]*?\n  function addLock\(target, text\) \{/, `  function lockModal() {
    if(document.getElementById('subscriptionGate'))return;
    var previous=document.activeElement,box=document.createElement('div');box.id='subscriptionGate';
    box.innerHTML='<div class="sub-card" role="dialog" aria-modal="true" aria-labelledby="subscriptionPromptTitle"><button class="sub-close" type="button" aria-label="Fermer">×</button><h1 id="subscriptionPromptTitle">TOUTES LES FONCTIONNALITÉS</h1><p style="font:700 19px/1.5 Arial;margin:20px 0">Pour profiter de toutes les fonctionnalités de Couteau Suisse, abonnez-vous.</p><a href="/payment.html" style="display:block;padding:18px;border-radius:14px;background:#f39b19;color:#07111f;text-decoration:none;text-align:center;font:900 21px Arial">S’ABONNER</a><button id="closeSubscriptionGate" type="button" style="width:100%;padding:15px;margin-top:12px;border:0;border-radius:14px;background:#293448;color:white;font:bold 17px Arial">PLUS TARD</button></div>';
    function close(){box.remove();document.removeEventListener('keydown',key);if(previous&&previous.focus)previous.focus()}
    function key(e){if(e.key==='Escape'){e.preventDefault();close()}if(e.key==='Tab'){var items=box.querySelectorAll('button,a[href]'),first=items[0],last=items[items.length-1];if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus()}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus()}}}
    box.querySelector('.sub-close').onclick=close;box.querySelector('#closeSubscriptionGate').onclick=close;
    document.documentElement.appendChild(box);document.addEventListener('keydown',key);box.querySelector('a').focus();
  }
  function addLock(target, text) {`);
    // Entry is free; paid features still lead to subscription from inside the app.
    text=text.replace('"#settings,.gear,#directArticle', '"#accessSubscriptionEntry,#settings,.gear,#directArticle');
    text=text.replace('if (blocked.some(function(k){return p.indexOf(k)!==-1;})) lockModal("Cette fonction");','if (blocked.some(function(k){return p.indexOf(k)!==-1;})) location.replace("/index.html?subscription=1");');
  }
  // Keep the original identity gate: confirmed accounts enter without a paid subscription.
  if(path==='/sanction-guard-v161.js') {
    text=text.replace('if(!r.ok||!j.ok)return;',`if(j.permanent){
      makeOverlay(false);
      var box=document.getElementById('carplayBanOverlay');
      if(!box)box=overlay;
      if(box)box.innerHTML='<div style="padding:30px;color:white;text-align:center;font:700 22px Arial">COMPTE SUPPRIMÉ<br><br>Cette adresse e-mail est définitivement bloquée.</div>';
      ['carplay_shared_subscription','carplay_app_identity_v240','carplay_identity_email_verified_v304','carplay_paid_activated'].forEach(function(k){localStorage.removeItem(k)});
      return;
    }
    if(!r.ok||!j.ok)return;`);
  }
  return text;
}
export const adminScript = `
async function deleteUserPermanently(index){
 const u=adminUsers[Number(index)];if(!u||u.isAdmin||!u.email)return;
 if(!confirm('Supprimer le compte de '+u.email+' et bloquer définitivement cette adresse ? Cette action ne peut pas être annulée avec Débannir.'))return;
 const typed=prompt('Pour confirmer, recopiez l’adresse e-mail :');if(!typed||typed.trim().toLowerCase()!==u.email.trim().toLowerCase())return;
 allUsersStatus.style.display='block';allUsersStatus.textContent='Suppression…';
 try{const r=await fetch('/api/admin/delete-user',{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+secret.value},body:JSON.stringify({email:u.email})}),j=await r.json();if(!r.ok||!j.ok)throw Error(j.error||'Suppression impossible');await loadAllUsers();allUsersStatus.textContent='Compte supprimé. Cette adresse ne pourra plus se reconnecter ni se réinscrire.'}catch(e){allUsersStatus.textContent=e.message}
}
`;
export const entryScript = `(()=>{
function boot(){
 if(!['/','/index.html'].includes(location.pathname))return;
 if(!document.getElementById('accessSubscriptionEntry')){
 const b=document.createElement('button');b.id='accessSubscriptionEntry';b.textContent='MON ABONNEMENT';b.style.cssText='position:fixed;bottom:18px;left:50%;transform:translateX(-50%);z-index:20000;padding:14px 24px;border:2px solid #ffd166;border-radius:14px;background:#132844;color:white;font:bold 16px Arial';
 b.onclick=open;document.body.appendChild(b);
 }
 if(new URLSearchParams(location.search).get('subscription')==='1')open();
}
function open(){location.href='/payment.html'}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot);else boot();
})();`;
export const PUBLIC_ORIGIN='https://couteau-suisse.appli-suzon.workers.dev';
export function brandAsset(text, origin) {
  // Preserve legacy storage keys, events and globals used by installed apps.
  text=text.replaceAll('CARPLAY TRAVAILLE','COUTEAU SUISSE').replaceAll('CarPlay Travaille','Couteau Suisse');
  if(origin===PUBLIC_ORIGIN)text=text.replaceAll('https://carplay-telephone.appli-suzon.workers.dev',PUBLIC_ORIGIN);
  return text;
}
export const LEGACY_ORIGIN='https://carplay-telephone.appli-suzon.workers.dev';
export function addressNotice(url, installation=false) {
  const ref=url.searchParams.get('ref');
  const query=ref?'&ref='+encodeURIComponent(ref.slice(0,500)):'';
  const target=installation?PUBLIC_ORIGIN+'/?installation=1'+query:PUBLIC_ORIGIN+'/installer.html?migration=1'+query;
  const html=`<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta name="theme-color" content="#07111e"><meta name="referrer" content="no-referrer"><title>Couteau Suisse — ${installation?'Installation':'Nouvelle adresse'}</title>
  ${installation?'<link rel="manifest" href="/manifest.webmanifest"><meta name="apple-mobile-web-app-title" content="Couteau Suisse"><link rel="apple-touch-icon" href="/couteau-suisse-v283-180.png">':''}
  <style>*{box-sizing:border-box}body{margin:0;background:#07111e;color:#fff;font-family:system-ui,-apple-system,Arial,sans-serif;padding:24px 16px;padding-top:max(24px,env(safe-area-inset-top));padding-bottom:max(24px,env(safe-area-inset-bottom))}main{max-width:620px;margin:0 auto;border:3px solid #f59e0b;border-radius:28px;padding:clamp(20px,5vw,36px)}header{text-align:center}.logo{width:80px;height:80px;border-radius:19px}h1{font-size:clamp(28px,7vw,40px);line-height:1.15;margin:16px 0;color:#ffb52e}h2{font-size:21px;line-height:1.3;margin:0 0 12px}p,li{font-size:18px;line-height:1.55}.saved{background:#0f3028;border:1px solid #3cbb86;border-radius:18px;padding:18px;margin:24px 0}.saved strong{color:#85efb6}.saved p{margin:8px 0 0}.button{display:flex;align-items:center;justify-content:center;min-height:76px;background:#f59e0b;color:#10151c;border-radius:18px;padding:20px 14px;text-decoration:none;text-align:center;font-size:22px;font-weight:850;line-height:1.25}.button:focus-visible{outline:3px solid #fff;outline-offset:5px}.url{text-align:center;color:#b9c9db;overflow-wrap:anywhere;font-size:15px}.guide{margin-top:28px}.guide section{background:#142438;border-radius:16px;padding:18px;margin:14px 0}.guide ol{padding-left:24px;margin:8px 0}.guide li{margin:8px 0}.note{color:#c2cfdd;font-size:16px}</style></head><body><main>
  <header><img class="logo" src="${PUBLIC_ORIGIN}/couteau-suisse-v283-180.png" alt=""><h1>${installation?'BIENVENUE SUR COUTEAU SUISSE':'COUTEAU SUISSE A CHANGÉ D’ADRESSE'}</h1><p>${installation?'Vous êtes au bon endroit. Ajoutez le nouveau lien à votre écran d’accueil.':'L’application est maintenant disponible uniquement sur son nouveau lien.'}</p></header>
  <div class="saved"><strong>VOTRE COMPTE EST CONSERVÉ</strong><p>Votre compte et votre abonnement restent valables. Vous n’avez pas à repayer un abonnement en cours.</p><p>Si une connexion est demandée, utilisez <b>la même adresse e-mail</b> que d’habitude et confirmez l’e-mail reçu.</p></div>
  <a class="button" href="${target}">${installation?'OUVRIR COUTEAU SUISSE':'OUVRIR LE NOUVEAU LIEN'}</a><p class="url">couteau-suisse.appli-suzon.workers.dev</p>
  <div class="guide"><h2>AJOUTER À L’ÉCRAN D’ACCUEIL</h2>${installation?'':'<p>Après avoir ouvert le nouveau lien :</p>'}<section><h2>Sur iPhone / iPad</h2><ol><li>Ouvrez le nouveau lien dans <b>Safari</b>.</li><li>Appuyez sur <b>Partager</b> (le carré avec la flèche vers le haut).</li><li>Choisissez <b>Sur l’écran d’accueil</b>, puis <b>Ajouter</b>.</li></ol></section><section><h2>Sur Android</h2><ol><li>Ouvrez le nouveau lien dans <b>Chrome</b>.</li><li>Appuyez sur le menu <b>⋮</b>.</li><li>Choisissez <b>Installer l’application</b> ou <b>Ajouter à l’écran d’accueil</b>, puis confirmez.</li></ol></section><p class="note">Ensuite, utilisez la nouvelle icône Couteau Suisse pour ouvrir l’application.</p></div>
  </main></body></html>`;
  return new Response(html,{headers:{'content-type':'text/html;charset=utf-8','cache-control':'no-store','x-access-policy':VERSION}});
}
export function withAccessPolicy(worker, authorized) {
  return {...worker, async fetch(request,env,ctx){
    const url=new URL(request.url),path=url.pathname;
    try {
      // Leave backend callbacks operational; retire every old application page.
      const legacy=url.origin===LEGACY_ORIGIN;
      if(request.method==='GET'&&legacy&&!path.startsWith('/api/')&&(request.mode==='navigate'||request.headers.get('accept')?.includes('text/html')||/\.html$/.test(path)||!path.split('/').pop().includes('.')))return addressNotice(url);
      if(request.method==='GET'&&url.origin===PUBLIC_ORIGIN&&['/installer.html','/installer'].includes(path)&&url.searchParams.get('migration')==='1')return addressNotice(url,true);
      // Cached old HTML also loads this uncached entry script.
      if(legacy&&path==='/access-entry-20261021-onboarding.js')return new Response('location.replace("/");',{headers:{'content-type':'application/javascript','cache-control':'no-store'}});
      if(path==='/api/payment-eligibility'&&request.method==='POST'){
        const data=await request.json(),device=String(data.deviceId||'');
        if(!device||device.length>200)return reply({ok:false,error:'INSCRIPTION_REQUISE'},403);
        const identity=await env.DB.prepare('SELECT email,email_verified_device_id FROM app_identities WHERE device_id=? AND email_verified_at>0 ORDER BY updated_at DESC LIMIT 1').bind(device).first();
        if(!identity||(identity.email_verified_device_id&&identity.email_verified_device_id!==device))return reply({ok:false,error:'EMAIL_A_CONFIRMER'},403);
        const lifetime=await env.DB.prepare('SELECT id FROM subscriptions WHERE active=1 AND lifetime=1 AND recovery_email_hash=? LIMIT 1').bind(await digest(norm(identity.email))).first();
        return reply({ok:true,lifetime:!!lifetime});
      }
      if(path==='/api/admin/market-access')return reply({ok:true,admin:await authorized(request,env)});
      if(path==='/api/admin/market-remove'){
        if(request.method!=='POST')return reply({ok:false},405);
        if(!await authorized(request,env))return reply({ok:false,error:'CONNEXION_ADMINISTRATEUR_REQUISE'},401);
        const data=await request.json(),key=String(data.marketKey||'');
        if(!/^(fr|be|special)\|/.test(key)||key.length>480)return reply({ok:false,error:'MARCHE_INVALIDE'},400);
        await env.DB.prepare('CREATE TABLE IF NOT EXISTS market_duplicate_decisions (market_key TEXT PRIMARY KEY, action TEXT NOT NULL, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)').run();
        await env.DB.prepare("INSERT INTO market_duplicate_decisions(market_key,action,updated_at) VALUES(?,'deleted',CURRENT_TIMESTAMP) ON CONFLICT(market_key) DO UPDATE SET action='deleted',updated_at=CURRENT_TIMESTAMP").bind(key).run();
        return reply({ok:true});
      }
      if(path==='/api/admin/delete-user'){
        if(request.method!=='POST')return reply({ok:false,error:'METHODE_INVALIDE'},405);
        if(!await authorized(request,env))return reply({ok:false,error:'NON_AUTORISE'},401);
        return await deleteAccount(env.DB,await request.json());
      }
      if(path.startsWith('/api/')&&!path.startsWith('/api/admin/')&&path!=='/api/stripe-webhook'&&env.DB){
        let data=Object.fromEntries(url.searchParams);
        if(request.method==='POST'&&(request.headers.get('content-type')||'').includes('application/json'))data={...data,...await request.clone().json().catch(()=>({}))};
        if((data.email||data.recoveryEmail||data.newEmail||data.deviceId||data.device_id)&&await blocked(env.DB,data))return reply({ok:path==='/api/sanction/status',error:'COMPTE_SUPPRIME_DEFINITIVEMENT',permanent:true,appBanned:true,verified:false,reactivationRequested:false},path==='/api/sanction/status'?200:403);
      }
      if(path==='/market-admin-20261022.js')return new Response(marketScript,{headers:{'content-type':'application/javascript;charset=utf-8','cache-control':'no-store'}});
      if(path==='/access-entry-20261021-onboarding.js')return new Response(entryScript,{headers:{'content-type':'application/javascript;charset=utf-8','cache-control':'no-store'}});
      let response=await worker.fetch(request,env,ctx);
      if(path==='/api/referral/create'&&response.ok){
        const data=await response.json();
        if(data.url){const shared=new URL(data.url);if(['https://carplay-telephone.appli-suzon.workers.dev',PUBLIC_ORIGIN].includes(shared.origin))data.url=PUBLIC_ORIGIN+shared.pathname+shared.search+shared.hash;}
        return reply(data);
      }
      if(request.method!=='GET'||!response.ok)return response;
      const isAdmin=path==='/admin.html'||path==='/admin';
      const isScript=['/stripe-payment-v1.js','/subscription-web.js','/app-access-gate-v506.js','/app-access-gate-v240.js','/sanction-guard-v161.js'].includes(path);
      const isHtml=(response.headers.get('content-type')||'').includes('text/html');
      if(legacy&&isHtml&&!path.startsWith('/api/'))return addressNotice(url);
      const isBrandAsset=/\.(?:js|webmanifest)$/.test(path)&&!path.startsWith('/api/');
      if(!isScript&&!isHtml&&!isBrandAsset)return response;
      let text=await response.text();
      if(isScript)text=patchAsset(path,text);
      text=brandAsset(text,url.origin);
      if(isAdmin){
        text=text.replace("+action+'</div>'",`+action+(u.isAdmin?'':'<button class="banBtn" style="background:#9c1728" onclick="deleteUserPermanently('+i+')">SUPPRIMER ET BLOQUER DÉFINITIVEMENT</button>')+'</div>'`);
        text=text.replace("new Error(j.error||'Envoi impossible')","new Error(j.message||j.error||'Envoi impossible')");
        text=text.replace('</body>','<script>'+adminScript+'</script></body>');
      }else if(isHtml){
        // Unique URL breaks legacy service-worker caches without disturbing GPS scripts.
        text=text.replace(/(stripe-payment-v1|subscription-web|app-access-gate-v506|app-access-gate-v240|sanction-guard-v161)\.js(?:\?[^"'\s<>]*)?/g,'$1.js?access=20261022-payment2');
        text=text.replace(/(top-ui|license-ui|referral-v232)\.js(?:\?[^"'\s<>]*)?/g,'$1.js?brand=20261022');
        text=text.replace('</body>','<script src="/access-entry-20261021-onboarding.js"></script><script src="/market-admin-20261022.js"></script></body>');
      }
      const headers=new Headers(response.headers);headers.set('cache-control','no-store');headers.delete('content-length');headers.delete('etag');headers.set('x-access-policy',VERSION);
      return new Response(text,{status:response.status,headers});
    }catch(e){
      console.error('access-policy',e);
      const detail=String(e&&e.message||e||'');
      if(/daily row read limit|daily row write limit/i.test(detail)){
        const now=new Date(),retryAt=new Date(Date.UTC(now.getUTCFullYear(),now.getUTCMonth(),now.getUTCDate()+1,0,0,5));
        const when=new Intl.DateTimeFormat('fr-FR',{timeZone:'Europe/Paris',hour:'2-digit',minute:'2-digit'}).format(retryAt);
        return reply({ok:false,error:'SERVEUR_BASE_QUOTA',message:'La limite quotidienne de la base de données est atteinte. Réessayez après '+when+' (heure de Paris). Votre compte est conservé.',retryAt:retryAt.toISOString()},503);
      }
      return reply({ok:false,error:'ACCES_INDISPONIBLE',message:'Connexion momentanément indisponible. Réessayez dans quelques instants.'},503)
    }
  }};
}

export const marketScript = "(()=>{'use strict';\nlet admin=false,decisions={},started=false,scheduled=false;\nconst token=()=>localStorage.getItem('carplay_admin_token')||localStorage.getItem('carplay_admin_secret')||'';\nasync function init(){if(started)return;started=true;try{const [a,d]=await Promise.all([fetch('/api/admin/market-access',{headers:{authorization:'Bearer '+token()},cache:'no-store'}).then(r=>r.json()),fetch('/api/market-duplicate-decisions',{cache:'no-store'}).then(r=>r.json())]);admin=a.admin===true;decisions=d.decisions||{};decorate();}catch(_){started=false;}}\nfunction decorate(){\nfor(const link of document.querySelectorAll('article a[href*=\"verification-v9\"]')){\nconst card=link.closest('article'),url=new URL(link.href),key=url.searchParams.get('mk');if(!key)continue;\nif(!started){init();return;}\nif(decisions[key]==='deleted'){card.style.setProperty('display','none','important');continue;}\nif(!admin||card.querySelector('.adminMarketRemove'))continue;\nlink.textContent='MODIFIER';\nconst b=document.createElement('button');b.type='button';b.className='adminMarketRemove';b.textContent='EFFACER LE MARCHÉ';b.style.cssText='padding:14px;border:2px solid #ff637a;border-radius:12px;background:#83192c;color:white;font-weight:900;margin-top:8px';\nb.onclick=async()=>{if(!confirm('Effacer ce marché pour tous les utilisateurs ?\\n'+(url.searchParams.get('n')||'')))return;b.disabled=true;try{const r=await fetch('/api/admin/market-remove',{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+token()},body:JSON.stringify({marketKey:key})}),j=await r.json();if(!r.ok||!j.ok)throw Error(j.error||'Suppression impossible');decisions[key]='deleted';if(window.MarketDedupV511)window.MarketDedupV511.setDecision(key,'deleted');card.style.setProperty('display','none','important');}catch(e){alert(e.message);b.disabled=false;}};\n(link.parentElement.classList.contains('actions')?link.parentElement:card).appendChild(b);\n}}\nfunction scan(){if(scheduled)return;scheduled=true;setTimeout(()=>{scheduled=false;decorate()},80)}\nfunction boot(){new MutationObserver(scan).observe(document.body,{childList:true,subtree:true});decorate();}\nif(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot);else boot();\n})();\n";

export const paymentScript = "(function(){'use strict';\nconst $=id=>document.getElementById(id),params=new URLSearchParams(location.search),orderId=params.get('order'),deviceId=localStorage.getItem('carplay_device_id')||'';let purchase=null,busy=false;\nfunction stored(key){try{return JSON.parse(localStorage.getItem(key)||'{}')}catch(_){return {}}}\nlet token=localStorage.getItem('couteau_stripe_checkout_token_v1');if(!/^[a-f0-9]{64}$/.test(token||'')){token=Array.from(crypto.getRandomValues(new Uint8Array(32)),v=>v.toString(16).padStart(2,'0')).join('');localStorage.setItem('couteau_stripe_checkout_token_v1',token);}\nconst errors={PAIEMENT_NON_CONFIGURE:'Le paiement en ligne n’est pas encore disponible.',EMAIL_A_CONFIRMER:'Confirmez votre adresse e-mail dans l’application avant de payer.',INSCRIPTION_REQUISE:'Inscrivez-vous dans l’application avant de payer.',ABONNEMENT_DEJA_A_VIE:'Vous avez déjà un accès à vie : vous n’avez rien à payer.',COMMANDE_INTROUVABLE:'Retrouvez votre code dans votre e-mail. Vous pouvez aussi revenir sur le téléphone utilisé pour le paiement.',REESSAYEZ_PLUS_TARD:'Veuillez réessayer un peu plus tard.'};\nasync function api(url,data){\n const controller=new AbortController();let timer;\n const work=(async()=>{const r=await fetch(url+'?payment=20261022&request='+Date.now(),{method:data?'POST':'GET',headers:data?{'content-type':'application/json'}:{},...(data?{body:JSON.stringify(data)}:{}),cache:'no-store',signal:controller.signal});const j=await r.json();if(!r.ok||!j.ok)throw Error(errors[j.error]||j.message||'La vérification est indisponible. Veuillez réessayer.');return j;})();\n try{return await Promise.race([work,new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(Error('La connexion prend trop de temps. Réessayez : aucune nouvelle commande ne sera créée pour cette tentative.'));},20000);})]);}finally{clearTimeout(timer);}\n}\nasync function check(){if(busy)return;busy=true;$('retry').hidden=true;$('message').textContent='Vérification du paiement…';try{const j=await api('/api/payment-status',{orderId,token});if(!j.paid){$('message').textContent='Paiement en attente de confirmation. Si vous avez payé, vérifiez à nouveau dans quelques secondes.';$('retry').hidden=false;return;}purchase=j;$('offer').hidden=true;$('receipt').hidden=false;$('code').textContent=j.code;$('email').textContent=j.emailSent?'Code envoyé à '+j.email:'Votre code est aussi prévu par e-mail à '+j.email+'. Conservez-le dès maintenant.';$('message').textContent='Activation de votre abonnement…';busy=false;await $('activate').onclick();}catch(e){$('message').textContent=e.message;$('retry').hidden=false;}finally{busy=false;}}\n$('retry').onclick=check;\n$('pay').onclick=async()=>{if(busy)return;busy=true;$('pay').disabled=true;$('message').textContent='Ouverture du paiement sécurisé…';try{const j=await api('/api/payment-checkout',{deviceId,token});localStorage.setItem('couteau_stripe_order_v1',j.orderId);\nif(!/^https:\\/\\/checkout\\.stripe\\.com\\//.test(j.url||''))throw Error('Adresse de paiement indisponible. Réessayez.');\nconst link=document.createElement('a');link.href=j.url;link.className='button';link.textContent='OUVRIR LE PAIEMENT — APPLE PAY / CARTE';link.rel='noopener';$('message').textContent='La page Stripe va s’ouvrir. Si elle reste ici, appuyez sur le lien ci-dessous.';$('message').appendChild(link);location.assign(j.url);}catch(e){$('message').textContent=e.message;busy=false;$('pay').disabled=false;}};\n$('activate').onclick=async()=>{if(!purchase||busy)return;busy=true;$('activate').disabled=true;try{const j=await api('/api/activate',{code:purchase.code,email:purchase.email,firstName:purchase.firstName,lastName:purchase.lastName,deviceId,deviceType:'phone'});j.code=purchase.code;j.email=purchase.email;localStorage.setItem('carplay_shared_subscription',JSON.stringify(j));localStorage.setItem('carplay_paid_activated','1');localStorage.setItem('carplay_recovery_email',purchase.email);$('message').textContent='✅ Votre année d’accès est activée.';$('activate').hidden=true;}catch(e){$('message').textContent=e.message;$('activate').disabled=false;}finally{busy=false;}};\nconst identity=stored('carplay_app_identity_v240'),fallback=stored('carplay_shared_subscription');$('identity').textContent=identity.email||fallback.email||'';\nasync function eligibility(){try{const e=await api('/api/payment-eligibility',{deviceId});if(e.lifetime){$('pay').hidden=true;$('message').textContent='✅ Votre abonnement est déjà actif à vie. Vous n’avez rien à payer.';}}catch(e){$('message').textContent=e.message;}}\nif(orderId&&!params.has('cancel')){$('offer').hidden=true;check();}else{api('/api/payment-config').then(async j=>{$('pay').disabled=!j.configured;$('message').textContent=j.configured?(params.has('cancel')?'Paiement interrompu. Si vous avez déjà payé, vérifiez votre e-mail.':'Appuyez sur PAYER pour ouvrir Stripe. Apple Pay sera proposé sur la page suivante si votre appareil est compatible.'):'Le paiement en ligne n’est pas encore disponible.';if(j.configured)await eligibility();}).catch(e=>{$('message').textContent=e.message;});}\n})();\n";
