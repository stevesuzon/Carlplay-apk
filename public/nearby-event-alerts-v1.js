(function(root){
  'use strict';
  const STORAGE='nearbyEventChoicesV1';
  const day=d=>Date.UTC(d.getFullYear(),d.getMonth(),d.getDate());
  function eligible(start,now){const days=(day(start)-day(now))/86400000;return Number.isFinite(days)&&days>=0&&days<=30;}
  function due(choice,start,now){
    if(!eligible(start,now))return false;
    if(!choice)return true;
    return choice.decision==='remind'&&!choice.reminderShown&&day(now)>=day(start)-7*86400000;
  }
  function choiceFor(action,reminder){return {decision:action,reminderShown:action==='remind'?!!reminder:false};}
  const api={eligible,due,choiceFor};
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(!root.document)return;
  let choices={};try{choices=JSON.parse(localStorage.getItem(STORAGE)||'{}')||{};if(typeof choices!=='object'||Array.isArray(choices))choices={};}catch(_){}
  const seen=new Set(),queue=[];let active=null,previousFocus=null;
  const dialog=document.createElement('dialog');
  dialog.setAttribute('aria-labelledby','nearbyEventTitle');
  dialog.style.cssText='max-width:460px;width:92vw;max-height:85vh;overflow:auto;background:#071725;color:white;border:3px solid #ff9b13;border-radius:24px;padding:24px;font-family:Arial,sans-serif';
  const style=document.createElement('style');style.textContent='dialog.nearbyEventAlert::backdrop{background:#000b} .nearbyEventAlert button{display:block;width:100%;padding:15px;margin-top:12px;border:0;border-radius:14px;font-size:17px;font-weight:900;color:white;background:#087ee5}.nearbyEventAlert button[data-choice="remind"]{background:#b96500}.nearbyEventAlert button[data-choice="dismissed"]{background:#34465a}';document.head.append(style);
  dialog.className='nearbyEventAlert';
  dialog.innerHTML='<h2 id="nearbyEventTitle"></h2><h3></h3><p class="eventPlace"></p><p class="eventDate"></p><p>Intéressé ?</p><button data-choice="interested">OUI, VOIR LA FICHE</button><button data-choice="remind">RAPPELER 7 JOURS AVANT</button><button data-choice="dismissed">PAS INTÉRESSÉ</button><p style="font-size:13px">Le rappel apparaît en ouvrant « Moins de 100 km » sur cet appareil.</p>';
  document.body.append(dialog);
  function persist(){try{localStorage.setItem(STORAGE,JSON.stringify(choices));}catch(_){} }
  function next(){
    if(active||!queue.length)return;
    active=queue.shift();previousFocus=document.activeElement;
    const reminder=choices[active.key]?.decision==='remind';
    dialog.querySelector('h2').textContent=reminder?'🔔 RAPPEL — ÉVÉNEMENT À VENIR':'🔔 ÉVÉNEMENT DANS LES 30 JOURS';
    dialog.querySelector('h3').textContent=active.row[2]||'Événement';
    dialog.querySelector('.eventPlace').textContent=(active.row[3]||'')+' · '+active.d.toFixed(1).replace('.',',')+' km'+(active.p.estimated?' — estimée':'');
    dialog.querySelector('.eventDate').textContent='📅 '+(active.row[4]||'');
    dialog.showModal();
  }
  function finish(action){
    if(!active)return;
    const item=active,reminder=choices[item.key]?.decision==='remind';
    choices[item.key]=choiceFor(action,reminder);persist();active=null;dialog.close();
    if(action==='interested'){
      try{
        sessionStorage.setItem('nearbyEventFicheV1:'+item.key,JSON.stringify({country:item.country,kind:item.special,row:item.row}));
        const params=new URLSearchParams({country:item.country,type:item.special,event:item.key,back:location.pathname+location.search});
        location.href='special-marches.html?'+params;
      }catch(_){queue.unshift(item);choices[item.key]=null;persist();next();}
      return;
    }
    if(previousFocus?.focus)previousFocus.focus();
    if(action==='remind'){
      const notice=document.createElement('p');notice.setAttribute('role','status');notice.textContent='✅ Rappel enregistré pour '+(item.row[2]||'cet événement')+' — 7 jours avant, en ouvrant « Moins de 100 km ».';notice.style.cssText='padding:15px;border:2px solid #ff9b13;border-radius:14px;color:white;background:#09283d';document.body.append(notice);
    }
    next();
  }
  dialog.querySelectorAll('button').forEach(button=>button.onclick=()=>finish(button.dataset.choice));
  dialog.addEventListener('cancel',event=>{event.preventDefault();active=null;dialog.close();next();});
  api.offer=function(items){for(const item of items){if(seen.has(item.key)||!due(choices[item.key],item.start,new Date()))continue;seen.add(item.key);queue.push(item);}queue.sort((a,b)=>a.start-b.start||a.d-b.d);next();};
  root.NearbyEventAlertsV1=api;
})(typeof window==='object'?window:globalThis);
