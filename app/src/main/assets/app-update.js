(function(){
  var UPDATE_ID='2026-08-27-marches-gps-1';
  var DETAILS=[
    'Nouvelle notification de mise à jour des marchés',
    'Affichage pendant 4 secondes',
    'Appui sur la notification = détail de la mise à jour',
    'Appui à côté = fermeture immédiate',
    'Navigation vers les marchés améliorée pour éviter les boutiques portant le mot « marché »',
    'Melesse : destination forcée vers Place de l’Église'
  ];
  try{if(localStorage.getItem('carplayUpdateSeen')===UPDATE_ID)return;}catch(e){}
  function ready(fn){if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',fn);else fn();}
  ready(function(){
    var style=document.createElement('style');
    style.textContent='.cpUpdateToast{position:fixed;left:50%;top:18px;transform:translateX(-50%);z-index:99998;max-width:92vw;background:#0b1626;color:#fff;border:3px solid #ff9f1a;border-radius:18px;padding:14px 18px;font:900 18px Arial,sans-serif;box-shadow:0 8px 26px #0009;cursor:pointer;text-align:center}.cpUpdateBack{display:none;position:fixed;inset:0;z-index:99999;background:rgba(0,0,0,.72);padding:18px}.cpUpdateModal{max-width:620px;margin:10vh auto 0;background:#101d30;color:#fff;border:3px solid #ff9f1a;border-radius:22px;padding:20px;font-family:Arial,sans-serif}.cpUpdateModal h2{margin:0 0 14px;font-size:27px}.cpUpdateModal ul{margin:0;padding-left:24px;font-size:18px;line-height:1.55}.cpUpdateModal .hint{margin-top:16px;font-size:14px;color:#d7dce5}@media(max-width:600px){.cpUpdateToast{top:10px;font-size:16px;padding:12px 14px}.cpUpdateModal{margin-top:8vh}.cpUpdateModal h2{font-size:23px}.cpUpdateModal ul{font-size:17px}}';
    document.head.appendChild(style);
    var toast=document.createElement('div');toast.className='cpUpdateToast';toast.textContent='🛒 Nouveaux marchés / mise à jour disponible';
    var back=document.createElement('div');back.className='cpUpdateBack';
    var modal=document.createElement('div');modal.className='cpUpdateModal';
    modal.innerHTML='<h2>Ce qui a été fait</h2><ul>'+DETAILS.map(function(x){return '<li>'+x+'</li>';}).join('')+'</ul><div class="hint">Appuyez à côté de cette bulle pour fermer.</div>';
    back.appendChild(modal);document.body.appendChild(back);document.body.appendChild(toast);
    try{localStorage.setItem('carplayUpdateSeen',UPDATE_ID);}catch(e){}
    var timer=setTimeout(function(){if(toast.parentNode)toast.remove();},4000);
    toast.addEventListener('click',function(ev){ev.stopPropagation();clearTimeout(timer);toast.remove();back.style.display='block';});
    back.addEventListener('click',function(ev){if(ev.target===back)back.style.display='none';});
    modal.addEventListener('click',function(ev){ev.stopPropagation();});
  });
})();