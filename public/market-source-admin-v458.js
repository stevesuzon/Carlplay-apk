(function(){'use strict';
function start(){
  const host=document.querySelector('.wrap');if(!host)return;
  const box=document.createElement('section');box.className='box';box.style.display='none';
  const title=document.createElement('h2');title.textContent='📊 Marchés ajoutés';
  const bundled=document.createElement('div');bundled.className='card';bundled.style.marginBottom='10px';
  bundled.innerHTML='<strong>5 338</strong><span>Marchés du catalogue intégré : France 4 699 · Belgique 639</span>';
  const total=document.createElement('div');total.className='card';
  const source=document.createElement('div');source.className='card';source.style.marginTop='10px';
  const detail=document.createElement('p');detail.className='note';
  const status=document.createElement('p');status.className='note';status.style.whiteSpace='pre-line';status.style.color='#ffd36c';
  const run=document.createElement('button');run.type='button';run.className='refresh';run.style.marginTop='10px';run.textContent='🔄 RÉCUPÉRER JOURS-DE-MARCHÉ MAINTENANT';
  const runStatus=document.createElement('div');runStatus.style.marginTop='9px';runStatus.style.padding='10px';runStatus.style.borderRadius='11px';runStatus.style.background='#000';runStatus.style.textAlign='center';runStatus.style.fontWeight='900';runStatus.style.display='none';
  box.append(title,bundled,total,source,detail,status,run,runStatus);host.insertBefore(box,host.children[1]||null);
  const fmt=n=>new Intl.NumberFormat('fr-FR').format(Number(n)||0);
  const when=ms=>{const n=Number(ms||0);if(!n)return'jamais';try{return new Date(n).toLocaleString('fr-FR',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'})}catch(_){return'—'}};
  function token(){return (document.getElementById('secret')||{}).value||localStorage.getItem('carplay_admin_token')||''}
  async function update(){
    const t=token();if(!t)return;
    try{
      const response=await fetch('/api/admin/market-source-counts',{headers:{authorization:'Bearer '+t},cache:'no-store'});
      if(!response.ok)return;
      const data=await response.json();if(!data.ok)return;
      box.style.display='block';total.innerHTML='';source.innerHTML='';
      const n=document.createElement('strong');n.textContent=fmt(data.totalMarkets);
      const label=document.createElement('span');label.textContent='Fiches de marchés dans la base dynamique';total.append(n,label);
      const j=document.createElement('strong');j.textContent=fmt(data.fromMarketWebsite);
      const from=document.createElement('span');from.textContent='Marchés issus de Jours-de-Marché';source.append(j,from);
      detail.textContent=(data.departments||[]).map(r=>'Département '+r.area+' : '+fmt(r.n)).join(' · ')||'Aucun marché importé depuis cette source pour le moment.';
      const recent=data.joursDeMarche&&data.joursDeMarche.recent||[];
      if(recent.length){
        const r=recent[0];
        status.textContent='Dernier passage Jours-de-Marché : département '+(r.area||'—')+' · '+when(r.last_check_at)+'\n'+(r.last_message||'')+' · en attente : '+fmt(data.joursDeMarche.due);
      }else{
        status.textContent='Jours-de-Marché : aucun passage enregistré pour le moment. Le système automatique est activé progressivement.';
      }
    }catch(_){}
  }
  run.onclick=async()=>{
    const t=token();if(!t)return;
    run.disabled=true;runStatus.style.display='block';runStatus.textContent='Récupération douce en cours…';
    try{
      const r=await fetch('/api/admin/markets/jdm-refresh',{method:'POST',headers:{authorization:'Bearer '+t,'content-type':'application/json'},body:'{}',cache:'no-store'});
      const j=await r.json().catch(()=>({}));
      if(!r.ok||!j.ok)throw new Error(j.error||'Erreur');
      const rows=Array.isArray(j.results)?j.results:[];
      const added=rows.reduce((s,x)=>s+Number(x&&x.count||0),0);
      runStatus.textContent='✅ Passage terminé : '+fmt(added)+' fiche(s) traitée(s). Le compteur se met à jour.';
      await update();
    }catch(e){
      runStatus.textContent='❌ Impossible de lancer la récupération : '+(e&&e.message||'erreur');
    }finally{run.disabled=false}
  };
  update();setInterval(update,60000);document.addEventListener('visibilitychange',()=>{if(!document.hidden)update()});
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});else start()
})();