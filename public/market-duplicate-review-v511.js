(function(){
  'use strict';
  var api=window.MarketDedupV511,entries=[],selected=null,trigger=null,busy=false;
  function el(id){return document.getElementById(id)}
  function esc(x){return String(x==null?'':x).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]})}
  function norm(x){return String(x||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase()}
  function state(x){return api.decisions()[x.id]||'pending'}
  function label(s){return {pending:'Doublon à vérifier',restored:'Marché remis',deleted:'Effacement confirmé'}[s]||'À vérifier'}
  function render(){
    var q=norm(el('search').value),day=el('day').value,filter=el('state').value;
    var shown=entries.filter(function(x){return (!day||x.row[4]===day)&&(filter==='all'||state(x)===filter)&&(!q||norm([x.row[2],x.row[3],x.row[8]].join(' ')).includes(q))});
    el('status').textContent=shown.length+' fiche(s) — '+entries.length+' au total';
    el('list').innerHTML=shown.map(function(x){return '<article class="card"><h2>'+esc(x.row[3])+'</h2><b>'+esc(x.row[2])+'</b><p>'+esc(x.row[4])+' · '+esc(x.row[5]||'Horaire à vérifier')+'<br>'+esc(x.row[8]||'Adresse à vérifier')+'</p><p>'+esc(label(state(x)))+'</p><button data-id="'+esc(x.id)+'">VÉRIFIER CETTE FICHE</button></article>'}).join('')||'<p>Aucune fiche dans cette sélection.</p>';
  }
  function info(row,title,country){
    var url='/verification-v9.html?'+new URLSearchParams({k:'marketVerifyV9:'+country+':'+[row[0],row[1],row[2],row[3],row[4],row[5],row[8]||''].join('|'),n:row[2]||'',t:row[5]||'',c:row[7]||'',mk:api.key(country,row),country:country,lat:row[10]==null?'':row[10],lon:row[11]==null?'':row[11],back:'/removed-markets.html'});
    var sources=(Array.isArray(row[9])?row[9]:[]).filter(function(u){return /^https?:\/\//i.test(u)}).map(function(u,i){return '<a href="'+esc(u)+'" target="_blank" rel="noopener">Source '+(i+1)+'</a>'}).join(' · ');
    return '<section><h3>'+esc(title)+'</h3><dl><dt>Nom</dt><dd>'+esc(row[2])+'</dd><dt>Ville / département</dt><dd>'+esc(row[3])+' · '+esc(row[0])+'</dd><dt>Jour / horaires</dt><dd>'+esc(row[4])+' · '+esc(row[5]||'À vérifier')+'</dd><dt>Adresse</dt><dd>'+esc(row[8]||'À vérifier')+'</dd><dt>Position</dt><dd>'+esc(row[10]!=null&&row[11]!=null?row[10]+', '+row[11]:'GPS à vérifier')+'</dd></dl><p>'+sources+'</p><a href="'+esc(url)+'">OUVRIR LA FICHE COMPLÈTE</a></section>';
  }
  function open(id,button){selected=entries.find(function(x){return x.id===id});if(!selected)return;trigger=button;el('comparison').innerHTML=info(selected.row,'Fiche masquée',selected.country)+info(selected.kept,'Marché conservé',selected.country);el('actionStatus').textContent=label(state(selected));el('detail').hidden=false;el('close').focus()}
  function close(){if(busy)return;el('detail').hidden=true;if(trigger&&trigger.isConnected)trigger.focus()}
  async function choose(action){
    if(!selected||busy)return;
    if(action==='deleted'&&!confirm('Effacer cette fiche : '+selected.row[2]+' ('+selected.row[4]+') ? Le marché conservé restera affiché.'))return;
    var token=localStorage.getItem('carplay_admin_token')||localStorage.getItem('carplay_admin_secret')||'';
    busy=true;['restore','delete','pending','close'].forEach(function(id){el(id).disabled=true});el('actionStatus').textContent='Enregistrement…';
    try{var r=await fetch('/api/market-duplicates/decisions',{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+token},body:JSON.stringify({marketKey:selected.id,action:action})}),j=await r.json();if(!r.ok||!j.ok){if(r.status===401){el('actionStatus').innerHTML='Connecte-toi à ton compte administrateur pour enregistrer ce choix. <a href="/admin.html">Ouvrir Administration</a>';return;}throw Error(j.error||'Enregistrement impossible')}
      api.remember(selected.country,selected.row,selected.kept);api.setDecision(selected.id,action);el('actionStatus').textContent='✅ '+label(action)+'. Le marché conservé reste disponible.';render();
    }catch(e){el('actionStatus').textContent='Impossible d’enregistrer. Vérifie Internet puis réessaie.'}finally{busy=false;['restore','delete','pending','close'].forEach(function(id){el(id).disabled=false})}
  }
  el('list').addEventListener('click',function(e){var b=e.target.closest('button[data-id]');if(b)open(b.dataset.id,b)});
  el('close').onclick=close;el('restore').onclick=function(){choose('restored')};el('delete').onclick=function(){choose('deleted')};el('pending').onclick=function(){choose('pending')};
  ['search','day','state'].forEach(function(id){el(id).addEventListener(id==='search'?'input':'change',render)});
  document.addEventListener('keydown',function(e){if(el('detail').hidden)return;if(e.key==='Escape')close();if(e.key==='Tab'){var nodes=Array.from(el('detail').querySelectorAll('button:not([disabled]),a')),first=nodes[0],last=nodes[nodes.length-1];if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus()}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus()}}});
  async function load(){try{if(window.CouteauUserDataReady)await window.CouteauUserDataReady;await api.ready;var r=await fetch('/market-duplicate-catalog-v511.json',{cache:'no-cache'});if(!r.ok)throw 0;var manifest=await r.json(),map=new Map(manifest.map(function(x){return [x.id,x]}));Object.values(api.archive()).forEach(function(x){map.set(x.id,x)});entries=Array.from(map.values()).sort(function(a,b){return a.row[3].localeCompare(b.row[3],'fr')||a.row[4].localeCompare(b.row[4],'fr')});render()}catch(e){el('status').textContent='Impossible de charger la liste. Vérifie Internet puis rouvre cette page.'}}
  load();
})();
