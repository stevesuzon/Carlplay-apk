(function(){
  if(localStorage.getItem('carplay_admin_here')!=='1')return;
  const secret=localStorage.getItem('carplay_admin_secret')||'';if(!secret)return;
  const style=document.createElement('style');style.textContent='#adminApprovalOverlay{position:fixed;inset:0;z-index:999999;background:rgba(0,0,0,.84);display:none;align-items:center;justify-content:center;padding:18px}#adminApprovalCard{width:min(560px,100%);max-height:94vh;overflow:auto;background:#0c1119;color:#fff;border:4px solid #f39b19;border-radius:24px;padding:22px;text-align:center;font:900 18px Arial}#adminApprovalCard h2{color:#f39b19}#adminApprovalActions{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:18px}#adminApprovalActions button{min-height:62px;border:0;border-radius:14px;color:#fff;font-size:20px;font-weight:900}#adminApprovalReview{grid-column:1/-1;background:#087ee5}#adminApprovalYes{background:#158347}#adminApprovalNo{background:#b52f38}#adminApprovalCount{display:inline-block;margin:0 0 12px;padding:7px 11px;border-radius:10px;background:#f39b19;color:#111;font-weight:1000}';document.head.appendChild(style);
  const box=document.createElement('div');box.id='adminApprovalOverlay';box.innerHTML='<div id="adminApprovalCard"><h2>🔔 NOUVELLE DEMANDE À VALIDER</h2><div id="adminApprovalCount">0 demande</div><div id="adminApprovalText"></div><div id="adminApprovalActions"><button id="adminApprovalReview">👁️ OUVRIR LES DEMANDES</button><button id="adminApprovalYes">OUI</button><button id="adminApprovalNo">NON</button></div></div>';document.body.appendChild(box);
  let current=null,busy=false;const safe=v=>String(v||'').replace(/[<>&]/g,'');
  function goAdmin(){location.href='/admin.html#gpsPermissionBox'}
  function review(){
    if(!current)return;
    if(current.source!=='gps'){goAdmin();return}
    const marketKey=String(current.market_key||''),marketName=String(current.market_name||'Marché'),back=location.pathname+location.search+location.hash;
    try{localStorage.setItem('verify_form_payload',JSON.stringify({key:marketKey,name:marketName,values:{}}));localStorage.setItem('carplay_admin_review_request',String(current.id||''))}catch(e){}
    location.href='/verification-v9.html?mk='+encodeURIComponent(marketKey)+'&n='+encodeURIComponent(marketName)+'&adminReview=1&back='+encodeURIComponent(back);
  }
  async function decide(approve){if(!current||current.source!=='gps'||busy)return;busy=true;try{const r=await fetch('/api/admin/gps-unlock-requests',{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+secret},body:JSON.stringify({id:current.id,approve:approve})});if(r.ok){box.style.display='none';current=null}}finally{busy=false;setTimeout(load,300)}}
  document.getElementById('adminApprovalReview').onclick=review;document.getElementById('adminApprovalYes').onclick=()=>decide(true);document.getElementById('adminApprovalNo').onclick=()=>decide(false);
  function contestItems(c){const out=[];function add(list,type){(list||[]).forEach(x=>out.push({source:'contest',id:x.id,type:type,name:((x.first_name||'')+' '+(x.last_name||'')).trim()||'Utilisateur',email:x.email||'',created:Number(x.created_at||0),raw:x}))}add(c.reviews,'Fiche marché / concours');add(c.mushrooms,'Fiche Champignons');add(c.reports,'Bug / problème / idée');add(c.communes,'Changement de commune');add(c.alerts,'Alerte concours');return out}
  async function load(){if(current||busy)return;try{
    const headers={authorization:'Bearer '+secret};const res=await Promise.all([
      fetch('/api/admin/gps-unlock-requests',{headers,cache:'no-store'}).then(async r=>r.ok?r.json():{requests:[]}),
      fetch('/api/admin/contest',{headers,cache:'no-store'}).then(async r=>r.ok?r.json():{}),
      fetch('/api/admin/app-messages',{headers,cache:'no-store'}).then(async r=>r.ok?r.json():{messages:[]})
    ]);
    const items=[];(res[0].requests||[]).forEach(x=>items.push({source:'gps',id:x.id,type:'Modification marché',name:x.requester_name||'Utilisateur',email:x.requester_email||'',created:Number(x.requested_at||0),raw:x}));items.push(...contestItems(res[1]||{}));(res[2].messages||[]).forEach(x=>items.push({source:'message',id:x.id,type:x.kind||'Message',name:((x.first_name||'')+' '+(x.last_name||'')).trim()||'Utilisateur',email:x.email||'',created:Number(x.created_at||0),raw:x}));
    items.sort((a,b)=>b.created-a.created);if(!items.length)return;const top=items[0],sig=top.source+':'+top.id,last=localStorage.getItem('carplay_admin_last_pending_notice')||'';if(sig===last)return;localStorage.setItem('carplay_admin_last_pending_notice',sig);current=top.source==='gps'?Object.assign({source:'gps'},top.raw):top;
    document.getElementById('adminApprovalCount').textContent=items.length+' demande'+(items.length>1?'s':'')+' en attente';
    const yes=document.getElementById('adminApprovalYes'),no=document.getElementById('adminApprovalNo'),reviewBtn=document.getElementById('adminApprovalReview');
    if(top.source==='gps'){const x=top.raw,actions={time:"modifier l’horaire",count:"modifier le nombre de commerçants",draw:"modifier le tirage au sort",welcome:"modifier l’humeur du placier",placer:"modifier le responsable",clientModel:"modifier le modèle de clients",exists:"signaler que le marché n’existe pas ce jour",photo:"remplacer la photo",gps:"modifier le point GPS"},action=actions[x.scope]||"modifier la fiche";document.getElementById('adminApprovalText').textContent=safe(top.name)+(top.email?' — '+safe(top.email):'')+' veut '+action+' du marché '+safe(x.market_name||'Marché')+'.';reviewBtn.textContent='👁️ CONSULTER LA FICHE';yes.style.display='block';no.style.display='block'}else{document.getElementById('adminApprovalText').textContent=safe(top.name)+(top.email?' — '+safe(top.email):'')+' a envoyé : '+safe(top.type)+'. Ouvrez les demandes pour voir la fiche complète et la valider.';reviewBtn.textContent='👁️ OUVRIR LES DEMANDES';yes.style.display='none';no.style.display='none'}
    box.style.display='flex'
  }catch(e){}}
  box.addEventListener('click',function(e){if(e.target===box){box.style.display='none';current=null}});
  load();setInterval(load,3000);
})();
