(function(){'use strict';
function start(){
  const host=document.querySelector('.wrap');if(!host)return;
  const box=document.createElement('section');box.className='box';box.hidden=true;
  const style=document.createElement('style');
  style.textContent='.market-big strong{display:block;font-size:clamp(56px,12vw,88px);line-height:1.1;color:#ffa500}.market-big span{display:block;font-weight:900}.market-section{margin-top:28px;padding-top:16px;border-top:2px solid #ffa500}.market-progress{width:100%;height:25px;accent-color:#ffa500}';
  box.innerHTML='<h2>📊 Marchés dans l’application</h2><div class="card market-big" data-app></div><p class="note" data-catalog></p><div class="card market-big" data-official></div><p class="note" data-date></p><div class="card market-big" data-recovered></div><progress class="market-progress" data-progress max="100"></progress><p class="note" data-fraction></p><div class="market-section"><h2>📥 Téléchargés, à importer</h2><div class="card market-big" data-pending></div><button type="button" class="refresh" data-import>IMPORTER DANS LES MARCHÉS</button><p class="note" role="status" data-message></p></div><div class="market-section"><h2>🔄 Téléchargement</h2><p class="note" role="status" data-live></p><button type="button" class="refresh" data-run>TÉLÉCHARGER LA SUITE</button><p class="note" data-runmessage></p></div>';
  box.prepend(style);host.insertBefore(box,host.children[1]||null);
  const el=k=>box.querySelector('[data-'+k+']');
  const fmt=n=>new Intl.NumberFormat('fr-FR').format(Number(n)||0);
  const date=n=>n?new Date(n).toLocaleString('fr-FR',{timeZone:'Europe/Paris'}):'à vérifier';
  let importing=false,loading=false;
  const token=()=>document.getElementById('secret')?.value||localStorage.getItem('carplay_admin_token')||'';
  async function api(path,data){
    const response=await fetch(path,{method:data?'POST':'GET',headers:{authorization:'Bearer '+token(),...(data?{'content-type':'application/json'}:{})},...(data?{body:JSON.stringify(data)}:{}),cache:'no-store'});
    const result=await response.json();if(!response.ok||!result.ok)throw Error(result.error||'Erreur de chargement');return result;
  }
  function card(key,number,label){
    const target=el(key);target.replaceChildren();
    const strong=document.createElement('strong'),span=document.createElement('span');
    strong.textContent=fmt(number);span.textContent=label;target.append(strong,span);
  }
  async function update(){
    if(!token()||loading)return;loading=true;
    try{
      const d=await api('/api/admin/market-source-counts');box.hidden=false;
      card('app',d.applicationTotal,'MARCHÉS DANS L’APPLICATION');
      el('catalog').textContent='Catalogue intégré et marchés importés, après rapprochement des doublons. Un marché présent plusieurs jours compte une seule fois.';
      card('official',d.official.total,'MARCHÉS AU TOTAL SUR JOURS-DE-MARCHÉ');
      el('date').textContent='Total annoncé par Jours-de-Marché · vérifié le '+date(d.official.verifiedAt);
      card('recovered',d.downloadedTotal,'MARCHÉS RÉCUPÉRÉS');
      const pct=d.official.total?100*d.downloadedTotal/d.official.total:0;
      el('progress').value=Math.min(100,pct);
      el('fraction').textContent=fmt(d.downloadedTotal)+' / '+fmt(d.official.total)+' · '+pct.toLocaleString('fr-FR',{maximumFractionDigits:1})+' % · '+fmt(d.importedSourceTotal)+' déjà importés.';
      card('pending',d.pendingMarkets,'MARCHÉS EN ATTENTE D’IMPORTATION');
      el('import').disabled=importing||!d.staging.count;
      const r=d.joursDeMarche.recent?.[0],s=d.staging;
      el('live').textContent=s.running
        ?'Téléchargement en cours · département '+s.area+' · '+fmt(s.pages)+' pages parcourues'
        :(d.joursDeMarche.progressive?'Téléchargement automatique actif.':'Téléchargement en pause.')+(r?'\nDernier passage : département '+r.area+' · '+date(r.last_check_at):'');
      el('live').style.whiteSpace='pre-line';
      el('message').textContent='';
    }catch(e){
      if(!box.hidden)el('message').textContent='Actualisation impossible : '+e.message;
    }finally{loading=false;}
  }
  el('import').onclick=async()=>{
    if(importing)return;importing=true;el('import').disabled=true;const cutoff=Date.now();let count=0;
    try{
      let d;do{
        d=await api('/api/admin/markets/jdm-stage',{cutoff});count+=d.imported;
        el('message').textContent=fmt(count)+' fiches importées · '+fmt(d.remaining)+' restantes…';
        if(d.remaining&&!d.imported)throw Error('Une fiche reste à vérifier. Les autres importations sont conservées.');
      }while(d.remaining);
      el('message').textContent='✅ Importation terminée. Le téléchargement reprend à la suite.';
    }catch(e){el('message').textContent='Importation interrompue : '+e.message+' Tu peux réessayer.';}
    finally{importing=false;await update();}
  };
  el('run').onclick=async()=>{
    el('run').disabled=true;el('runmessage').textContent='Téléchargement du prochain lot…';
    try{await api('/api/admin/markets/jdm-refresh',{});el('runmessage').textContent='✅ Lot traité. Les nouvelles fiches sont prêtes à importer.';}
    catch(e){el('runmessage').textContent='Téléchargement interrompu : '+e.message;}
    finally{el('run').disabled=false;await update();}
  };
  update();setInterval(update,15000);document.addEventListener('visibilitychange',()=>{if(!document.hidden)update();});
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});else start();
})();