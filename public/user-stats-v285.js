(function(){
  'use strict';
  var BADGE_ID='totalUsersBadge';
  var COUNT_ID='totalUsersCountV285';
  var DELTA_ID='newUsers15DaysV285';

  function deviceId(){
    var v='';
    try{v=localStorage.getItem('carplay_device_id')||''}catch(_){}
    if(!v){
      v=(crypto.randomUUID?crypto.randomUUID():'dev-'+Date.now()+'-'+Math.random().toString(36).slice(2));
      try{localStorage.setItem('carplay_device_id',v)}catch(_){}
    }
    return v;
  }
  function platform(){
    return /iphone|ipad|ipod/i.test(navigator.userAgent)?'ios':(/android/i.test(navigator.userAgent)?'android':'web');
  }
  function ensureBadge(){
    var badge=document.getElementById(BADGE_ID);
    if(badge)return badge;
    badge=document.createElement('div');
    badge.id=BADGE_ID;
    badge.setAttribute('aria-live','polite');
    badge.innerHTML='<div class="totalUsersLine"><strong id="'+COUNT_ID+'">—</strong> utilisateurs</div><div id="'+DELTA_ID+'" class="newUsersLine" hidden></div>';
    document.body.appendChild(badge);
    var style=document.createElement('style');
    style.id='userStatsV285Style';
    style.textContent='\n#totalUsersBadge{position:fixed;top:8px;z-index:9999;font-family:Arial,sans-serif;font-size:11px;font-weight:800;color:#e7edf7;background:rgba(0,0,0,.28);border:1px solid rgba(157,112,255,.38);border-radius:10px;padding:4px 7px;backdrop-filter:blur(3px);-webkit-backdrop-filter:blur(3px);pointer-events:none;opacity:.92;line-height:1.2;max-width:calc(100vw - 130px)}\n#totalUsersBadge .totalUsersLine{white-space:nowrap;color:#d9c9ff}#totalUsersBadge .totalUsersLine strong{color:#fff;font-size:12px}#totalUsersBadge .newUsersLine{margin-top:2px;color:#48dc7a;font-size:9.5px;font-weight:900;white-space:normal}body.house-measure-open #totalUsersBadge{display:none!important}@media(max-width:390px){#totalUsersBadge{font-size:10px;padding:4px 6px;max-width:calc(100vw - 122px)}#totalUsersBadge .totalUsersLine strong{font-size:11px}#totalUsersBadge .newUsersLine{font-size:9px}}';
    document.head.appendChild(style);
    positionBadge();
    return badge;
  }
  function positionBadge(){
    var badge=document.getElementById(BADGE_ID),connected=document.getElementById('connectedUsersBadge');
    if(!badge)return;
    var left=118;
    if(connected){var r=connected.getBoundingClientRect();left=Math.ceil(r.right+6)}
    badge.style.left=left+'px';
    try{window.dispatchEvent(new Event('carplay-user-stats-positioned'))}catch(_){}
  }
  function fmt(n){
    n=Math.max(0,Number(n||0));
    try{return n.toLocaleString('fr-FR')}catch(_){return String(n)}
  }
  async function registerVisit(){
    try{
      await fetch('/api/installations',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({deviceId:deviceId(),platform:platform()}),cache:'no-store',keepalive:true});
    }catch(_){}
  }
  async function loadStats(){
    ensureBadge();
    try{
      var r=await fetch('/api/user-stats',{cache:'no-store'}),j=await r.json();
      if(!r.ok||!j||!j.ok)throw 0;
      var count=document.getElementById(COUNT_ID),delta=document.getElementById(DELTA_ID);
      if(count)count.textContent=fmt(j.total);
      if(delta){
        if(j.show15DayGrowth){
          var n=Math.max(0,Number(j.new15Days||0));
          delta.textContent='+'+fmt(n)+' utilisateur'+(n>1?'s':'')+' en plus depuis 15 jours';
          delta.hidden=false;
        }else{
          delta.hidden=true;
          delta.textContent='';
        }
      }
      positionBadge();
    }catch(_){}
  }
  async function sync(){await registerVisit();await loadStats()}
  function start(){
    ensureBadge();
    sync();
    setInterval(function(){if(!document.hidden)loadStats()},300000);
    addEventListener('online',sync);
    addEventListener('resize',positionBadge);
    if(window.ResizeObserver){var c=document.getElementById('connectedUsersBadge');if(c)new ResizeObserver(positionBadge).observe(c)}
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start);else start();
})();
