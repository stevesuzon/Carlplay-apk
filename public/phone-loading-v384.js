(function(){
  "use strict";
  if(window.__PHONE_LOADING_V384__) return;
  window.__PHONE_LOADING_V384__=true;

  var INTERNAL_KEY="couteau_phone_internal_load_v384";
  var OVERLAY_ID="phoneLoadingV384";
  var STYLE_ID="phoneLoadingStyleV384";
  var hideTimer=0;
  var currentMode="large";

  function installStyle(){
    if(document.getElementById(STYLE_ID)) return;
    var st=document.createElement("style");
    st.id=STYLE_ID;
    st.textContent=
      "html.phoneLoadPendingV384,html.phoneLoadPendingV384 body{background:#050a11!important;}"+
      "#"+OVERLAY_ID+"{position:fixed;inset:0;z-index:2147483647;display:flex;align-items:center;justify-content:center;background:#050a11;font-family:Arial,Helvetica,sans-serif;color:#fff;transition:opacity .18s ease;touch-action:none}"+
      "#"+OVERLAY_ID+".small{background:rgba(0,0,0,.70);pointer-events:auto}"+
      "#"+OVERLAY_ID+".hide{opacity:0;pointer-events:none}"+
      "#"+OVERLAY_ID+" .phoneLoadPanelV384{display:flex;flex-direction:column;align-items:center;justify-content:center;padding:22px 24px;border-radius:26px}"+
      "#"+OVERLAY_ID+".small .phoneLoadPanelV384{width:min(260px,72vw);padding:16px 18px;background:#08121f;border:2px solid #f2a52c;box-shadow:0 12px 32px #000b}"+
      "#"+OVERLAY_ID+" .phoneLoadLogoBoxV384{position:relative;width:min(54vw,250px);height:min(54vw,250px);display:flex;align-items:center;justify-content:center}"+
      "#"+OVERLAY_ID+".small .phoneLoadLogoBoxV384{width:86px;height:86px}"+
      "#"+OVERLAY_ID+" .phoneLoadLogoV384{width:100%;height:100%;object-fit:contain;filter:drop-shadow(0 9px 14px #0009)}"+
      "#"+OVERLAY_ID+" .phoneLoadSerpetteV384{position:absolute;right:-3%;bottom:1%;width:48%;height:48%;overflow:visible;filter:drop-shadow(0 5px 5px #0008)}"+
      "#"+OVERLAY_ID+".small .phoneLoadSerpetteV384{width:50%;height:50%;right:-5%;bottom:-2%}"+
      "#"+OVERLAY_ID+" .phoneLoadBladeV384{transform-box:fill-box;transform-origin:14% 86%;animation:phoneBladeOpenV384 1.05s ease-in-out infinite alternate}"+
      "@keyframes phoneBladeOpenV384{0%{transform:rotate(17deg)}100%{transform:rotate(-48deg)}}"+
      "#"+OVERLAY_ID+" .phoneLoadTitleV384{margin-top:8px;font:950 clamp(26px,7vw,38px)/1 Arial,sans-serif;letter-spacing:.4px;text-align:center}"+
      "#"+OVERLAY_ID+".small .phoneLoadTitleV384{margin-top:5px;font-size:18px}"+
      "#"+OVERLAY_ID+" .phoneLoadTextV384{margin-top:10px;color:#f4c35e;font:900 clamp(16px,4.3vw,21px)/1.1 Arial,sans-serif}"+
      "#"+OVERLAY_ID+".small .phoneLoadTextV384{margin-top:6px;font-size:14px}"+
      "@media(prefers-reduced-motion:reduce){#"+OVERLAY_ID+" .phoneLoadBladeV384{animation-duration:1.8s}}";
    (document.head||document.documentElement).appendChild(st);
  }

  installStyle();
  document.documentElement.classList.add("phoneLoadPendingV384");

  function readInternal(){
    try{
      var v=sessionStorage.getItem(INTERNAL_KEY)==="1";
      sessionStorage.removeItem(INTERNAL_KEY);
      return v;
    }catch(_){return false}
  }

  function markInternal(){
    try{sessionStorage.setItem(INTERNAL_KEY,"1")}catch(_){}
  }

  function svgSerpette(){
    return '<svg class="phoneLoadSerpetteV384" viewBox="0 0 120 120" aria-hidden="true">'+
      '<rect x="18" y="82" width="63" height="24" rx="11" fill="#218c55" stroke="#0d5834" stroke-width="4"/>'+
      '<text x="49" y="99" text-anchor="middle" font-family="Arial" font-size="13" font-weight="900" fill="#fff">SS</text>'+
      '<g class="phoneLoadBladeV384">'+
        '<path d="M29 88 C34 59 58 21 105 15 C90 39 67 67 29 88 Z" fill="#eef2f5" stroke="#56636d" stroke-width="3"/>'+
        '<path d="M38 78 C50 56 70 33 94 25" fill="none" stroke="#ffffff" stroke-width="3" stroke-linecap="round"/>'+
      '</g>'+
      '<circle cx="29" cy="88" r="7" fill="#f1f3f5" stroke="#2e3942" stroke-width="3"/>'+
      '<circle cx="29" cy="88" r="2.5" fill="#2e3942"/>'+
    '</svg>';
  }

  function build(mode){
    var old=document.getElementById(OVERLAY_ID);
    if(old) old.remove();
    currentMode=mode==="small"?"small":"large";
    var d=document.createElement("div");
    d.id=OVERLAY_ID;
    if(currentMode==="small") d.className="small";
    d.innerHTML='<div class="phoneLoadPanelV384">'+
      '<div class="phoneLoadLogoBoxV384"><img class="phoneLoadLogoV384" src="/couteau-suisse-192.png?v=384-loader" alt="Couteau Suisse">'+svgSerpette()+'</div>'+
      '<div class="phoneLoadTitleV384">COUTEAU SUISSE</div>'+
      '<div class="phoneLoadTextV384">Chargement…</div>'+
      '</div>';
    (document.body||document.documentElement).appendChild(d);
    return d;
  }

  function show(mode){
    clearTimeout(hideTimer);
    var d=document.getElementById(OVERLAY_ID);
    if(!d || (mode==="small")!==(d.classList.contains("small"))) d=build(mode);
    d.classList.remove("hide");
    document.documentElement.classList.add("phoneLoadPendingV384");
  }

  function hide(){
    clearTimeout(hideTimer);
    hideTimer=setTimeout(function(){
      var d=document.getElementById(OVERLAY_ID);
      if(d){
        d.classList.add("hide");
        setTimeout(function(){if(d.parentNode)d.remove()},220);
      }
      document.documentElement.classList.remove("phoneLoadPendingV384");
    },260);
  }

  var initialMode=readInternal()?"small":"large";

  function boot(){
    show(initialMode);
    if(document.readyState==="complete") hide();
    else window.addEventListener("load",hide,{once:true});
    setTimeout(hide,8000);
  }

  if(document.readyState==="loading") document.addEventListener("DOMContentLoaded",boot,{once:true});
  else boot();

  document.addEventListener("click",function(ev){
    var a=ev.target&&ev.target.closest?ev.target.closest("a[href]"):null;
    if(!a)return;
    var href=a.getAttribute("href")||"";
    if(!href||href.charAt(0)==="#"||/^javascript:/i.test(href)||/^mailto:/i.test(href)||/^tel:/i.test(href))return;
    try{
      var u=new URL(a.href,location.href);
      if(u.origin!==location.origin)return;
      if(u.href===location.href)return;
      markInternal();
      show("small");
    }catch(_){}
  },true);

  document.addEventListener("submit",function(){
    markInternal();
    show("small");
  },true);

  window.addEventListener("beforeunload",function(){
    markInternal();
    show("small");
  });

  window.CouteauPhoneLoading={
    show:function(){show("small")},
    hide:hide
  };
})();