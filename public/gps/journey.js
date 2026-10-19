(() => {
  'use strict';
  const $=id=>document.getElementById(id),key='gps-resume-v6',dialog=$('journeyDialog');let approved=false,leaving=false,resolver=null,lastRoute=null;
  function persist(force=false){
    if(leaving)return;const state=window.couteauGps?.getState();if(!state?.active||!state.route?.points?.length||!state.destination)return;
    if(!force&&state.route===lastRoute)return;
    try{localStorage.setItem(key,JSON.stringify({...state,at:Date.now()}));lastRoute=state.route;}catch{}
  }
  function clear(){try{localStorage.removeItem(key);sessionStorage.removeItem('gps-session-v37');}catch{}lastRoute=null;}
  function ask({title,address,description,dimensions='',yes,no}){
    if(resolver)resolver(false);
    $('journeyTitle').textContent=title;$('journeyAddress').textContent=address||'';$('journeyDescription').textContent=description;$('journeyDimensions').textContent=dimensions;$('journeyDimensions').hidden=!dimensions;
    $('journeyYes').textContent=yes;$('journeyNo').textContent=no;dialog.hidden=false;document.body.classList.add('gps-dialog-open');$('journeyYes').focus();
    return new Promise(resolve=>{resolver=resolve;});
  }
  function answer(value){const done=resolver;resolver=null;dialog.hidden=true;document.body.classList.remove('gps-dialog-open');done?.(value);}
  $('journeyYes').addEventListener('click',()=>answer(true));$('journeyNo').addEventListener('click',()=>answer(false));
  dialog.addEventListener('keydown',event=>{if(event.key==='Escape'){event.preventDefault();answer(false);}if(event.key==='Tab'){event.preventDefault();(document.activeElement===$('journeyYes')?$('journeyNo'):$('journeyYes')).focus();}});
  $('confirmGps').addEventListener('click',async event=>{
    if(approved){approved=false;return;}let selected;try{selected=window.couteauGpsPlanner.getSelection();}catch{return;}
    const p=selected.profile;if(p.trailer==='none'||p.travelMode==='pedestrian')return;
    event.stopImmediatePropagation();event.preventDefault();
    const ok=await ask({title:'Vous êtes en mode poids lourd',address:selected.destination?.name,description:'Le trajet sera calculé pour votre convoi, avec les restrictions connues de hauteur, largeur et poids. Respectez les panneaux sur place.',dimensions:`Gabarit enregistré : ${p.length} m de long · ${p.width} m de large · ${p.height} m de haut · ${Number(p.weight)/1000} t.`,yes:'OK',no:'Changer'});
    if(ok){approved=true;$('confirmGps').click();}else $('confirmGps').focus();
  },true);
  function guard(){if(history.state?.couteauGpsGuard)return;history.pushState({...history.state,couteauGpsGuard:true},'',location.href);}
  window.addEventListener('couteau-gps-state',event=>{if(event.detail?.arrived){clear();return;}if(event.detail?.active){guard();queueMicrotask(()=>persist());}});
  window.addEventListener('popstate',()=>{if(!leaving&&window.couteauGps?.getState().active)guard();});
  document.addEventListener('click',event=>{
    const link=event.target.closest('a.gps-return,.planner-head a');if(!link)return;
    event.preventDefault();persist(true);leaving=true;window.couteauGps?.stop();location.assign('/');
  },true);
  let edge=false;
  document.addEventListener('touchstart',event=>{edge=!!window.couteauGps?.getState().active&&event.touches.length===1&&!!event.target.closest('.map')&&(event.touches[0].clientX<24||event.touches[0].clientX>innerWidth-24);if(edge&&event.cancelable)event.preventDefault();},{passive:false,capture:true});
  document.addEventListener('touchmove',event=>{if(edge&&event.cancelable)event.preventDefault();},{passive:false,capture:true});
  document.addEventListener('touchend',()=>{edge=false;},{passive:true});
  $('gpsZoomIn').addEventListener('click',()=>window.couteauGps?.zoom(1));$('gpsZoomOut').addEventListener('click',()=>window.couteauGps?.zoom(-1));
  window.addEventListener('pagehide',()=>persist(true));document.addEventListener('visibilitychange',()=>{if(document.hidden)persist(true);});setInterval(()=>persist(),10000);
  let saved;try{saved=JSON.parse(localStorage.getItem(key)||sessionStorage.getItem('gps-session-v37')||'null');}catch{}
  const explicitDestination=window.gpsExplicitDestination||new URLSearchParams(location.search||location.hash.slice(1)).has('destination');
  if(!explicitDestination&&saved?.active&&saved.destination&&Number.isFinite(saved.destination.lat)&&Number.isFinite(saved.destination.lon)&&saved.profile){
    void ask({title:'Voulez-vous reprendre le trajet ?',address:saved.destination.name||saved.destination.address||'Destination enregistrée',description:'Le guidage reprendra depuis votre position actuelle avec les mêmes choix de véhicule et de route.',yes:'Oui, reprendre',no:'Non, nouvelle adresse'}).then(ok=>{
      if(ok){window.couteauGpsPlanner.restore(saved);approved=true;$('confirmGps').click();}
      else{clear();window.couteauGpsPlanner.open();}
    });
  }
})();
