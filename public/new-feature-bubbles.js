(function(){
  'use strict';
  var FEATURES=[{
    id:'import-document-tva-belge-v1',
    selector:'#belgiumVatImport',
    title:'Nouveau : feuille de TVA belge',
    text:'Importez ici votre feuille de TVA belge. Pour la consulter ensuite, allez dans « Mes papiers ».'
  },{
    id:'confirmation-remise-zero-tva-v1',
    selector:'#belgiumVatDone',
    title:'Protection du compteur TVA',
    text:'Si une échéance est déjà programmée, une confirmation est demandée avant de remettre le compteur à zéro.'
  },{
    id:'distance-marche-retour-place-v1',
    selector:'.distance, [data-feature="market-distance"]',
    fallbackText:[' km',' m'],
    title:'Nouveau : kilomètres',
    text:'Ce nombre indique la distance entre votre emplacement « Retourner sur la place » et ce marché.'
  }];
  function key(id){return 'carplay_feature_seen_'+id}
  function findByText(words){
    var all=document.querySelectorAll('.card .meta,.item .meta,.card .distance,.distance');
    for(var i=0;i<all.length;i++){var t=(all[i].textContent||'').trim();for(var j=0;j<words.length;j++)if(t.endsWith(words[j])&&/\d/.test(t))return all[i]}
    return null;
  }
  function show(f){
    try{if(localStorage.getItem(key(f.id))==='1')return}catch(e){}
    var target=document.querySelector(f.selector)||findByText(f.fallbackText||[]); if(!target)return;
    var b=document.createElement('div');b.setAttribute('role','status');b.innerHTML='<strong>'+f.title+'</strong><br>'+f.text;
    b.style.cssText='position:fixed;z-index:2147483647;max-width:min(330px,82vw);padding:13px 15px;border:2px solid #f39b19;border-radius:16px;background:#0b111b;color:#fff;font:800 14px/1.35 Arial,sans-serif;box-shadow:0 8px 28px #000b;opacity:0;transition:opacity .2s ease;pointer-events:none';
    document.body.appendChild(b);
    function pos(){var r=target.getBoundingClientRect(),w=b.offsetWidth,h=b.offsetHeight,left=Math.max(8,Math.min(innerWidth-w-8,r.left)),top=r.bottom+9;if(top+h>innerHeight-8)top=Math.max(8,r.top-h-9);b.style.left=left+'px';b.style.top=top+'px'}
    pos();requestAnimationFrame(function(){b.style.opacity='1'});
    try{localStorage.setItem(key(f.id),'1')}catch(e){}
    setTimeout(function(){b.style.opacity='0';setTimeout(function(){b.remove()},250)},5000);
  }
  function run(){var delay=0;FEATURES.forEach(function(f){if(!localStorage.getItem(key(f.id))){setTimeout(function(){show(f)},delay);delay+=5200}})}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',function(){setTimeout(run,500)});else setTimeout(run,500);
})();
