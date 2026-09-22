(function(){
  "use strict";

  var HOME_ID="autoradioHomeV383Web";
  var STYLE_ID="autoradioHomeStyleV383";
  var SCALE_KEY="autoradio_display_scale";

  function isHome(){
    var p=(location.pathname||"/").replace(/\/+$/,"")||"/";
    return p==="/"||p==="/index.html"||p==="/index";
  }

  function go(url){ location.href=url; }

  function iconSvg(kind){
    var common='viewBox="0 0 100 100" aria-hidden="true" focusable="false"';
    if(kind==="fuel")return '<svg '+common+'><rect x="18" y="9" width="52" height="78" rx="8" fill="#f2f4f8" stroke="#252b35" stroke-width="5"/><rect x="27" y="18" width="34" height="24" rx="3" fill="#26313f"/><path d="M33 70 C33 58 44 51 44 42 C44 51 55 58 55 70 C55 79 50 84 44 84 C38 84 33 79 33 70Z" fill="#e52525"/><path d="M71 28 C84 29 86 37 86 48 V72 C86 79 80 82 75 78" fill="none" stroke="#f2f4f8" stroke-width="7" stroke-linecap="round"/><path d="M78 23 l12 10 -5 8 -12 -11Z" fill="#f2f4f8"/></svg>';
    if(kind==="market")return '<svg '+common+'><rect x="16" y="41" width="68" height="45" rx="4" fill="#7b4b21"/><path d="M10 18 H90 L84 43 H16Z" fill="#f3f3f3"/><path d="M10 18 H26 L23 43 H16Z M42 18 H58 L59 43 H41Z M74 18 H90 L84 43 H77Z" fill="#e62828"/><rect x="23" y="52" width="22" height="14" rx="2" fill="#a8682d"/><rect x="55" y="52" width="22" height="14" rx="2" fill="#a8682d"/><circle cx="29" cy="56" r="4" fill="#e63946"/><circle cx="38" cy="57" r="4" fill="#f1c40f"/><circle cx="61" cy="56" r="4" fill="#2ecc71"/><circle cx="70" cy="57" r="4" fill="#f39c12"/><rect x="47" y="46" width="6" height="40" fill="#5c3518"/></svg>';
    if(kind==="map")return '<svg '+common+'><path d="M8 35 L33 25 L56 34 L90 22 L88 76 L59 87 L34 78 L10 87Z" fill="#eef3f7" stroke="#4f6578" stroke-width="4"/><path d="M33 25 L34 78 M56 34 L59 87" stroke="#8aa4b7" stroke-width="4"/><path d="M14 45 L29 39 M14 57 L29 51 M40 43 L52 47 M65 40 L84 33 M65 54 L83 47 M65 68 L82 61" stroke="#35a853" stroke-width="5"/><path d="M57 8 C43 8 34 18 34 31 C34 48 57 66 57 66 C57 66 80 48 80 31 C80 18 71 8 57 8Z" fill="#e5252a" stroke="#ffffff" stroke-width="4"/><circle cx="57" cy="31" r="8" fill="#ffc928"/></svg>';
    if(kind==="return")return '<svg '+common+'><path d="M50 8 C34 8 24 19 24 33 C24 52 50 70 50 70 C50 70 76 52 76 33 C76 19 66 8 50 8Z" fill="#fff"/><circle cx="50" cy="33" r="9" fill="#e61f2a"/><ellipse cx="50" cy="78" rx="34" ry="10" fill="none" stroke="#fff" stroke-width="7"/></svg>';
    if(kind==="address")return '<svg '+common+'><rect x="22" y="12" width="58" height="76" rx="10" fill="#9b5d2b" stroke="#5c3218" stroke-width="5"/><rect x="16" y="16" width="12" height="68" rx="5" fill="#71401f"/><circle cx="52" cy="42" r="13" fill="#ffd36b"/><path d="M30 75 C32 58 43 52 52 52 C62 52 73 58 74 75Z" fill="#ffd36b"/><rect x="78" y="25" width="10" height="14" rx="2" fill="#8b5cf6"/><rect x="78" y="43" width="10" height="14" rx="2" fill="#21c7a8"/><rect x="78" y="61" width="10" height="14" rx="2" fill="#ffd43b"/></svg>';
    if(kind==="trash")return '<svg '+common+'><path d="M28 28 H72 L68 86 H32Z" fill="#fff" stroke="#d6dde6" stroke-width="4"/><path d="M22 28 H78" stroke="#fff" stroke-width="8" stroke-linecap="round"/><path d="M38 19 H62" stroke="#fff" stroke-width="7" stroke-linecap="round"/><path d="M43 40 V73 M57 40 V73" stroke="#667382" stroke-width="5" stroke-linecap="round"/></svg>';
    return "";
  }

  function call(name,fallbackSelector){
    try{
      if(typeof window[name]==="function"){ window[name](); return; }
      var b=fallbackSelector?document.querySelector(fallbackSelector):null;
      if(b)b.click();
    }catch(_){}
  }

  function onlineLabel(){
    var ok=navigator.onLine!==false;
    var e=document.getElementById("autoradioNetV383");
    if(e){e.textContent=ok?"● CONNECTÉ":"● DÉCONNECTÉ";e.className="autoradioNetV383 "+(ok?"on":"off");}
    var f=document.getElementById("autoradioInternetFooterV383");
    if(f){f.textContent=ok?"🌐 Internet activé":"🌐 Internet désactivé";f.className="radioStateV383 "+(ok?"on":"off");}
  }

  function addressLabel(){
    var e=document.getElementById("autoradioAddressFooterV383");
    if(!e)return;
    var address="";
    try{address=localStorage.getItem("return_address")||""}catch(_){}
    e.textContent=address?"📍 "+address:"📍 Aucun emplacement enregistré";
    e.title=address||"Aucun emplacement enregistré";
  }

  function gpsLabel(){
    var e=document.getElementById("autoradioGpsFooterV383");
    if(!e)return;
    function set(ok){
      e.textContent=ok?"🎯 GPS activé":"🎯 GPS désactivé";
      e.className="radioStateV383 "+(ok?"on":"off");
    }
    if(!navigator.geolocation){set(false);return;}
    navigator.geolocation.getCurrentPosition(function(){set(true);},function(){set(false);},{enableHighAccuracy:false,timeout:4500,maximumAge:60000});
  }

  function getScale(){
    var n=parseInt(localStorage.getItem(SCALE_KEY)||"100",10);
    return n===125||n===150?n:100;
  }

  function applyScale(n){
    n=n===125||n===150?n:100;
    localStorage.setItem(SCALE_KEY,String(n));
    document.documentElement.style.setProperty("--autoradio-user-scale",String(n/100));
    var m=document.querySelector('meta[name="viewport"]');
    if(!m){m=document.createElement("meta");m.name="viewport";(document.head||document.documentElement).appendChild(m);}
    m.setAttribute("content","width=device-width,initial-scale="+(n/100)+",minimum-scale=1,maximum-scale=1.5,user-scalable=yes");
    var s=document.getElementById("autoradioScaleStatusV383");
    if(s)s.textContent="Taille actuelle : "+n+" %";
    document.querySelectorAll("[data-radio-scale]").forEach(function(b){
      b.classList.toggle("active",Number(b.getAttribute("data-radio-scale"))===n);
    });
  }

  function installDisplaySetting(){
    var settings=document.getElementById("settings");
    if(!settings||document.getElementById("autoradioDisplaySettingV383"))return;
    var row=document.createElement("div");
    row.id="autoradioDisplaySettingV383";
    row.className="settingRow";
    row.innerHTML=
      '<button type="button" class="settingHead" id="autoradioDisplayHeadV383"><span>👁️ AGRANDIR L’ÉCRAN</span><span>⌄</span></button>'+
      '<div class="settingBody" id="autoradioDisplayBodyV383" style="display:none">'+
      '<button type="button" data-radio-scale="100">NORMAL — 100 %</button>'+
      '<button type="button" data-radio-scale="125">GRAND — 125 %</button>'+
      '<button type="button" data-radio-scale="150">TRÈS GRAND — 150 %</button>'+
      '<div class="settingNote" id="autoradioScaleStatusV383"></div>'+
      '<div class="settingNote">Zoom limité entre 100 % et 150 % pour éviter les bugs d’affichage.</div>'+
      '</div>';
    var first=settings.querySelector(".settingRow");
    if(first)settings.insertBefore(row,first); else settings.appendChild(row);
    var body=row.querySelector("#autoradioDisplayBodyV383");
    row.querySelector("#autoradioDisplayHeadV383").onclick=function(){
      body.style.display=body.style.display==="block"?"none":"block";
    };
    row.querySelectorAll("[data-radio-scale]").forEach(function(b){
      b.onclick=function(){ applyScale(Number(this.getAttribute("data-radio-scale"))); };
    });
    applyScale(getScale());
  }

  function style(){
    if(document.getElementById(STYLE_ID))return;
    var st=document.createElement("style");
    st.id=STYLE_ID;
    st.textContent=`
      :root{--autoradio-user-scale:1}
      body.autoradioWebHomeV383{overflow:hidden!important;background:#07111f!important}
      body.autoradioWebHomeV383 #${HOME_ID}{font-family:Arial,Helvetica,sans-serif}
      #${HOME_ID}{
        position:fixed!important;inset:0!important;z-index:2147482000!important;
        box-sizing:border-box!important;padding:8px 12px 9px!important;
        background:linear-gradient(180deg,#0a1527 0%,#07101d 100%)!important;
        display:grid!important;
        grid-template-rows:54px minmax(88px,.9fr) minmax(108px,1.08fr) minmax(118px,1.18fr) 32px!important;
        gap:9px!important;color:#fff!important;overflow:hidden!important;
        transform-origin:top left!important;
      }
      #${HOME_ID} *{box-sizing:border-box!important}
      .radioHeadV383{
        display:grid!important;grid-template-columns:1fr auto 1fr!important;
        align-items:center!important;gap:8px!important;
      }
      .radioBrandV383{
        grid-column:2!important;display:flex!important;align-items:center!important;justify-content:center!important;gap:10px!important;
        font:950 clamp(22px,2.6vw,34px)/1 Arial!important;letter-spacing:.2px!important;
      }
      .radioBrandV383 img{width:48px!important;height:48px!important;object-fit:contain!important;border-radius:10px!important}
      .radioTopRightV383{grid-column:3!important;display:flex!important;justify-content:flex-end!important;align-items:center!important;gap:10px!important}
      .autoradioNetV383{font:950 clamp(11px,1.15vw,15px)/1 Arial!important;white-space:nowrap!important}
      .autoradioNetV383.on{color:#57e77c!important}.autoradioNetV383.off{color:#ff5665!important}
      .radioSettingsV383{
        min-width:118px!important;height:46px!important;padding:0 15px!important;border-radius:13px!important;
        border:2px solid #6e819b!important;background:#1c2d45!important;color:#fff!important;
        font:900 clamp(15px,1.6vw,20px)/1 Arial!important
      }
      .radioRow2V383{display:grid!important;grid-template-columns:1fr 1fr!important;gap:12px!important;min-height:0!important}
      .radioBottomV383{display:grid!important;grid-template-columns:1fr 1fr 1fr!important;gap:18px!important;padding:0 2.3%!important;min-height:0!important}
      .radioTileV383{
        border:0!important;border-radius:18px!important;color:#fff!important;min-width:0!important;min-height:0!important;
        height:100%!important;padding:8px 14px!important;
        display:flex!important;align-items:center!important;justify-content:center!important;gap:14px!important;
        box-shadow:0 5px 15px rgba(0,0,0,.45)!important;
        text-align:left!important;touch-action:manipulation!important;
      }
      .radioTileV383:active{transform:scale(.985)!important}
      .radioTileIconV383{
        flex:0 0 auto!important;width:82px!important;height:82px!important;border-radius:16px!important;
        display:flex!important;align-items:center!important;justify-content:center!important;
        font-size:54px!important;line-height:1!important;filter:drop-shadow(0 3px 4px #0007)!important
      }
      .radioTileIconV383 svg{display:block!important;width:100%!important;height:100%!important}
      .radioTileTextV383{min-width:0!important;display:flex!important;flex-direction:column!important;justify-content:center!important}
      .radioTileTitleV383{font:950 clamp(19px,2.25vw,30px)/1.02 Arial!important;text-transform:uppercase!important}
      .radioTileSubV383{margin-top:5px!important;font:800 clamp(12px,1.45vw,18px)/1.12 Arial!important}
      .radioStationsV383{background:linear-gradient(145deg,#ff2424,#c90909)!important}
      .radioMarketsV383{background:linear-gradient(145deg,#17a84e,#057630)!important}
      .radioNearV383{
        background:linear-gradient(145deg,#ffbf19,#f08a00)!important;color:#101010!important;
        justify-content:center!important;text-align:center!important
      }
      .radioNearV383 .radioTileIconV383{width:112px!important;height:92px!important}
      .radioNearV383 .radioTileTextV383{align-items:center!important}
      .radioNearV383 .radioTileTitleV383{font-size:clamp(27px,3.45vw,46px)!important;color:#070707!important}
      .radioNearV383 .radioTileSubV383{font-size:clamp(13px,1.65vw,21px)!important;color:#101010!important}
      .radioReturnV383{background:linear-gradient(145deg,#ff2228,#ca0710)!important}
      .radioAddressV383{background:linear-gradient(145deg,#168cff,#0759c6)!important}
      .radioEraseV383{background:linear-gradient(145deg,#5c6778,#303a48)!important}
      .radioBottomV383 .radioTileV383{
        flex-direction:column!important;text-align:center!important;gap:5px!important;padding:7px 8px!important
      }
      .radioBottomV383 .radioTileIconV383{width:72px!important;height:66px!important}
      .radioBottomV383 .radioTileIconV383 img,.radioBottomV383 .radioTileIconV383 svg{width:100%!important;height:100%!important;object-fit:contain!important}
      .radioBottomV383 .radioTileTitleV383{font-size:clamp(14px,1.65vw,22px)!important;line-height:1.02!important}
      .radioFooterV383{
        border-top:1px solid #67758b!important;display:grid!important;grid-template-columns:1.2fr 1fr 2.4fr 1fr!important;
        align-items:center!important;gap:10px!important;padding:3px 12px 0!important;color:#c7d1df!important;
        font:800 clamp(10px,1.05vw,14px)/1.1 Arial!important;background:#050a11!important
      }
      .radioFooterV383>span{min-width:0!important;white-space:nowrap!important;overflow:hidden!important;text-overflow:ellipsis!important}
      .radioStateV383.on{color:#57e77c!important}.radioStateV383.off{color:#ff5964!important}
      #autoradioAddressFooterV383{text-align:center!important;color:#fff!important}
      #settings{z-index:2147483646!important}
      #autoradioDisplaySettingV383 .settingBody button.active{outline:4px solid #5ee684!important}
      @media(max-height:520px){
        #${HOME_ID}{grid-template-rows:46px 82px 96px minmax(96px,1fr) 28px!important;gap:7px!important}
        .radioBrandV383 img{width:40px!important;height:40px!important}
        .radioTileIconV383{width:62px!important;height:62px!important}
        .radioBottomV383 .radioTileIconV383{width:52px!important;height:48px!important}
      }
    `;
    (document.head||document.documentElement).appendChild(st);
  }

  function createHome(){
    if(!isHome())return;
    style();
    installDisplaySetting();
    document.body.classList.add("autoradioWebHomeV383");
    try{
      ["connectedUsersBadge","fuelStationsQuickBtn","fuelStationsQuickStyle","fuelStationsQuickPosition"].forEach(function(id){var e=document.getElementById(id);if(e)e.remove();});
      var settings=document.getElementById("settings");
      if(settings&&settings.parentElement!==document.body)document.body.appendChild(settings);
      var wrap=document.querySelector(".wrap");
      if(wrap)wrap.remove();
    }catch(_){};
    ["autoradioHomeV379","autoradioHomeV380Web","autoradioHomeV383Web"].forEach(function(id){var e=document.getElementById(id);if(e)e.remove();});
    var old=document.getElementById(HOME_ID);
    if(old)old.remove();

    var box=document.createElement("section");
    box.id=HOME_ID;
    box.innerHTML=
      '<div class="radioHeadV383">'+
        '<span></span>'+
        '<div class="radioBrandV383"><img src="/couteau-suisse-192.png?v=383" alt=""><span>COUTEAU SUISSE</span></div>'+
        '<div class="radioTopRightV383"><span id="autoradioNetV383" class="autoradioNetV383"></span><button id="radioSettingsV383" class="radioSettingsV383" type="button">⚙ Réglages</button></div>'+
      '</div>'+
      '<div class="radioRow2V383">'+
        '<button id="radioStationsV383" class="radioTileV383 radioStationsV383" type="button"><span class="radioTileIconV383">'+iconSvg("fuel")+'</span><span class="radioTileTextV383"><span class="radioTileTitleV383">Stations essence</span><span class="radioTileSubV383">À moins de 15 km</span></span></button>'+
        '<button id="radioMarketsV383" class="radioTileV383 radioMarketsV383" type="button"><span class="radioTileIconV383">'+iconSvg("market")+'</span><span class="radioTileTextV383"><span class="radioTileTitleV383">Marchés</span><span class="radioTileSubV383">Tous les marchés près de chez vous</span></span></button>'+
      '</div>'+
      '<button id="radioNearV383" class="radioTileV383 radioNearV383" type="button"><span class="radioTileIconV383">'+iconSvg("map")+'</span><span class="radioTileTextV383"><span class="radioTileTitleV383">Marchés à -150 km</span><span class="radioTileSubV383">Foire, brocante, marché, marché de voyageurs, marché de Noël</span></span></button>'+
      '<div class="radioBottomV383">'+
        '<button id="radioReturnV383" class="radioTileV383 radioReturnV383" type="button"><span class="radioTileIconV383">'+iconSvg("return")+'</span><span class="radioTileTextV383"><span class="radioTileTitleV383">Retourner sur la place</span></span></button>'+
        '<button id="radioAddressV383" class="radioTileV383 radioAddressV383" type="button"><span class="radioTileIconV383">'+iconSvg("address")+'</span><span class="radioTileTextV383"><span class="radioTileTitleV383">Carnet d’adresses</span></span></button>'+
        '<button id="radioEraseV383" class="radioTileV383 radioEraseV383" type="button"><span class="radioTileIconV383">'+iconSvg("trash")+'</span><span class="radioTileTextV383"><span class="radioTileTitleV383">Effacer l’emplacement</span></span></button>'+
      '</div>'+
      '<div class="radioFooterV383"><span>🚐 Couteau Suisse — Version Autoradio</span><span id="autoradioInternetFooterV383" class="radioStateV383"></span><span id="autoradioAddressFooterV383">📍 Aucun emplacement enregistré</span><span id="autoradioGpsFooterV383" class="radioStateV383"></span></div>';

    document.body.appendChild(box);
    document.documentElement.classList.add("autoradio-home-ready-v383");
    box.querySelector("#radioSettingsV383").onclick=function(){ call("toggleSettings","#settings"); };
    box.querySelector("#radioStationsV383").onclick=function(){ go("/stations-carburant.html"); };
    box.querySelector("#radioMarketsV383").onclick=function(){ go("/choix-marches-final.html"); };
    box.querySelector("#radioNearV383").onclick=function(){ go("/nearby-markets.html?radius=150"); };
    box.querySelector("#radioReturnV383").onclick=function(){ call("returnPlace",".returnPlaceTrafic");setTimeout(addressLabel,500);setTimeout(addressLabel,2200); };
    box.querySelector("#radioAddressV383").onclick=function(){ call("openSavedAddressBook","#homeAddressBookBtn"); };
    box.querySelector("#radioEraseV383").onclick=function(){ if(confirm("Êtes-vous sûr de vouloir effacer l’emplacement enregistré ?")){call("clearReturnPlace",".eraseTile");setTimeout(addressLabel,100);} };
    applyScale(getScale());
    onlineLabel();
    addressLabel();
    gpsLabel();
  }

  window.addEventListener("online",onlineLabel);
  window.addEventListener("offline",onlineLabel);
  window.addEventListener("storage",addressLabel);
  window.addEventListener("carplay-return-place-saved",addressLabel);
  if(!window.__autoradioGpsTimerV383)window.__autoradioGpsTimerV383=setInterval(function(){if(isHome())gpsLabel();},60000);

  if(document.readyState==="loading"){
    document.addEventListener("DOMContentLoaded",function(){createHome();installDisplaySetting();},{once:true});
  }else{
    createHome();installDisplaySetting();
  }

  // Certaines anciennes versions injectent encore leur accueil après DOMContentLoaded.
  // On réapplique une seule fois l'accueil autoradio validé sans observateur permanent.
  setTimeout(function(){if(isHome()&&!document.getElementById(HOME_ID))createHome();},900);
})();
