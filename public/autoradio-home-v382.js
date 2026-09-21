(function(){
  "use strict";

  var HOME_ID="autoradioHomeV382Web";
  var STYLE_ID="autoradioHomeStyleV382";
  var SCALE_KEY="autoradio_display_scale";

  function isHome(){
    var p=(location.pathname||"/").replace(/\/+$/,"")||"/";
    return p==="/"||p==="/index.html"||p==="/index";
  }

  function go(url){ location.href=url; }

  function call(name,fallbackSelector){
    try{
      if(typeof window[name]==="function"){ window[name](); return; }
      var b=fallbackSelector?document.querySelector(fallbackSelector):null;
      if(b)b.click();
    }catch(_){}
  }

  function onlineLabel(){
    var ok=navigator.onLine!==false;
    var e=document.getElementById("autoradioNetV382");
    if(e){e.textContent=ok?"● CONNECTÉ":"● DÉCONNECTÉ";e.className="autoradioNetV382 "+(ok?"on":"off");}
    var f=document.getElementById("autoradioInternetFooterV382");
    if(f){f.textContent=ok?"🌐 Internet activé":"🌐 Internet désactivé";f.className="radioStateV382 "+(ok?"on":"off");}
  }

  function addressLabel(){
    var e=document.getElementById("autoradioAddressFooterV382");
    if(!e)return;
    var address="";
    try{address=localStorage.getItem("return_address")||""}catch(_){}
    e.textContent=address?"📍 "+address:"📍 Aucun emplacement enregistré";
    e.title=address||"Aucun emplacement enregistré";
  }

  function gpsLabel(){
    var e=document.getElementById("autoradioGpsFooterV382");
    if(!e)return;
    function set(ok){
      e.textContent=ok?"🎯 GPS activé":"🎯 GPS désactivé";
      e.className="radioStateV382 "+(ok?"on":"off");
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
    var s=document.getElementById("autoradioScaleStatusV382");
    if(s)s.textContent="Taille actuelle : "+n+" %";
    document.querySelectorAll("[data-radio-scale]").forEach(function(b){
      b.classList.toggle("active",Number(b.getAttribute("data-radio-scale"))===n);
    });
  }

  function installDisplaySetting(){
    var settings=document.getElementById("settings");
    if(!settings||document.getElementById("autoradioDisplaySettingV382"))return;
    var row=document.createElement("div");
    row.id="autoradioDisplaySettingV382";
    row.className="settingRow";
    row.innerHTML=
      '<button type="button" class="settingHead" id="autoradioDisplayHeadV382"><span>👁️ AGRANDIR L’ÉCRAN</span><span>⌄</span></button>'+
      '<div class="settingBody" id="autoradioDisplayBodyV382" style="display:none">'+
      '<button type="button" data-radio-scale="100">NORMAL — 100 %</button>'+
      '<button type="button" data-radio-scale="125">GRAND — 125 %</button>'+
      '<button type="button" data-radio-scale="150">TRÈS GRAND — 150 %</button>'+
      '<div class="settingNote" id="autoradioScaleStatusV382"></div>'+
      '<div class="settingNote">Zoom limité entre 100 % et 150 % pour éviter les bugs d’affichage.</div>'+
      '</div>';
    var first=settings.querySelector(".settingRow");
    if(first)settings.insertBefore(row,first); else settings.appendChild(row);
    var body=row.querySelector("#autoradioDisplayBodyV382");
    row.querySelector("#autoradioDisplayHeadV382").onclick=function(){
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
      body.autoradioWebHomeV382{overflow:hidden!important;background:#07111f!important}
      body.autoradioWebHomeV382 #${HOME_ID}{font-family:Arial,Helvetica,sans-serif}
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
      .radioHeadV382{
        display:grid!important;grid-template-columns:1fr auto 1fr!important;
        align-items:center!important;gap:8px!important;
      }
      .radioBrandV382{
        grid-column:2!important;display:flex!important;align-items:center!important;justify-content:center!important;gap:10px!important;
        font:950 clamp(22px,2.6vw,34px)/1 Arial!important;letter-spacing:.2px!important;
      }
      .radioBrandV382 img{width:48px!important;height:48px!important;object-fit:contain!important;border-radius:10px!important}
      .radioTopRightV382{grid-column:3!important;display:flex!important;justify-content:flex-end!important;align-items:center!important;gap:10px!important}
      .autoradioNetV382{font:950 clamp(11px,1.15vw,15px)/1 Arial!important;white-space:nowrap!important}
      .autoradioNetV382.on{color:#57e77c!important}.autoradioNetV382.off{color:#ff5665!important}
      .radioSettingsV382{
        min-width:118px!important;height:46px!important;padding:0 15px!important;border-radius:13px!important;
        border:2px solid #6e819b!important;background:#1c2d45!important;color:#fff!important;
        font:900 clamp(15px,1.6vw,20px)/1 Arial!important
      }
      .radioRow2V382{display:grid!important;grid-template-columns:1fr 1fr!important;gap:12px!important;min-height:0!important}
      .radioBottomV382{display:grid!important;grid-template-columns:1fr 1fr 1fr!important;gap:18px!important;padding:0 2.3%!important;min-height:0!important}
      .radioTileV382{
        border:0!important;border-radius:18px!important;color:#fff!important;min-width:0!important;min-height:0!important;
        height:100%!important;padding:8px 14px!important;
        display:flex!important;align-items:center!important;justify-content:center!important;gap:14px!important;
        box-shadow:0 5px 15px rgba(0,0,0,.45)!important;
        text-align:left!important;touch-action:manipulation!important;
      }
      .radioTileV382:active{transform:scale(.985)!important}
      .radioTileIconV382{
        flex:0 0 auto!important;width:72px!important;height:72px!important;border-radius:16px!important;
        display:flex!important;align-items:center!important;justify-content:center!important;
        font-size:54px!important;line-height:1!important;filter:drop-shadow(0 3px 4px #0007)!important
      }
      .radioTileIconV382 img{width:100%!important;height:100%!important;object-fit:contain!important;display:block!important}
      .radioTileTextV382{min-width:0!important;display:flex!important;flex-direction:column!important;justify-content:center!important}
      .radioTileTitleV382{font:950 clamp(19px,2.25vw,30px)/1.02 Arial!important;text-transform:uppercase!important}
      .radioTileSubV382{margin-top:5px!important;font:800 clamp(12px,1.45vw,18px)/1.12 Arial!important}
      .radioStationsV382{background:linear-gradient(145deg,#ff2424,#c90909)!important}
      .radioMarketsV382{background:linear-gradient(145deg,#17a84e,#057630)!important}
      .radioNearV382{
        background:linear-gradient(145deg,#ffbf19,#f08a00)!important;color:#101010!important;
        justify-content:center!important;text-align:center!important
      }
      .radioNearV382 .radioTileIconV382{font-size:64px!important;width:92px!important;height:82px!important}
      .radioNearV382 .radioTileTextV382{align-items:center!important}
      .radioNearV382 .radioTileTitleV382{font-size:clamp(27px,3.45vw,46px)!important;color:#070707!important}
      .radioNearV382 .radioTileSubV382{font-size:clamp(13px,1.65vw,21px)!important;color:#101010!important}
      .radioReturnV382{background:linear-gradient(145deg,#ff2228,#ca0710)!important}
      .radioAddressV382{background:linear-gradient(145deg,#168cff,#0759c6)!important}
      .radioEraseV382{background:linear-gradient(145deg,#5c6778,#303a48)!important}
      .radioBottomV382 .radioTileV382{
        flex-direction:column!important;text-align:center!important;gap:5px!important;padding:7px 8px!important
      }
      .radioBottomV382 .radioTileIconV382{width:62px!important;height:58px!important;font-size:46px!important}
      .radioBottomV382 .radioTileIconV382 img{width:56px!important;height:56px!important;object-fit:contain!important}
      .radioBottomV382 .radioTileTitleV382{font-size:clamp(14px,1.65vw,22px)!important;line-height:1.02!important}
      .radioFooterV382{
        border-top:1px solid #67758b!important;display:grid!important;grid-template-columns:1.2fr 1fr 2.4fr 1fr!important;
        align-items:center!important;gap:10px!important;padding:3px 12px 0!important;color:#c7d1df!important;
        font:800 clamp(10px,1.05vw,14px)/1.1 Arial!important;background:#050a11!important
      }
      .radioFooterV382>span{min-width:0!important;white-space:nowrap!important;overflow:hidden!important;text-overflow:ellipsis!important}
      .radioStateV382.on{color:#57e77c!important}.radioStateV382.off{color:#ff5964!important}
      #autoradioAddressFooterV382{text-align:center!important;color:#fff!important}
      #settings{z-index:2147483646!important}
      #autoradioDisplaySettingV382 .settingBody button.active{outline:4px solid #5ee684!important}
      @media(max-height:520px){
        #${HOME_ID}{grid-template-rows:46px 82px 96px minmax(96px,1fr) 28px!important;gap:7px!important}
        .radioBrandV382 img{width:40px!important;height:40px!important}
        .radioTileIconV382{width:58px!important;height:58px!important;font-size:44px!important}
        .radioBottomV382 .radioTileIconV382{width:48px!important;height:44px!important;font-size:38px!important}
      }
    `;
    (document.head||document.documentElement).appendChild(st);
  }

  function createHome(){
    if(!isHome())return;
    style();
    installDisplaySetting();
    document.body.classList.add("autoradioWebHomeV382");
    ["autoradioHomeV379","autoradioHomeV380Web","autoradioHomeV382Web"].forEach(function(id){var e=document.getElementById(id);if(e)e.remove();});
    var old=document.getElementById(HOME_ID);
    if(old)old.remove();

    var box=document.createElement("section");
    box.id=HOME_ID;
    box.innerHTML=
      '<div class="radioHeadV382">'+
        '<span></span>'+
        '<div class="radioBrandV382"><img src="/couteau-suisse-192.png?v=382" alt=""><span>COUTEAU SUISSE</span></div>'+
        '<div class="radioTopRightV382"><span id="autoradioNetV382" class="autoradioNetV382"></span><button id="radioSettingsV382" class="radioSettingsV382" type="button">⚙ Réglages</button></div>'+
      '</div>'+
      '<div class="radioRow2V382">'+
        '<button id="radioStationsV382" class="radioTileV382 radioStationsV382" type="button"><span class="radioTileIconV382"><img src="/autoradio-icon-station-v382.svg?v=382" alt=""></span><span class="radioTileTextV382"><span class="radioTileTitleV382">Stations essence</span><span class="radioTileSubV382">À moins de 15 km</span></span></button>'+
        '<button id="radioMarketsV382" class="radioTileV382 radioMarketsV382" type="button"><span class="radioTileIconV382"><img src="/autoradio-icon-market-v382.svg?v=382" alt=""></span><span class="radioTileTextV382"><span class="radioTileTitleV382">Marchés</span><span class="radioTileSubV382">Foire, brocante, marchés de toute la France / Belgique</span></span></button>'+
      '</div>'+
      '<button id="radioNearV382" class="radioTileV382 radioNearV382" type="button"><span class="radioTileIconV382"><img src="/autoradio-icon-map-v382.svg?v=382" alt=""></span><span class="radioTileTextV382"><span class="radioTileTitleV382">Marchés à -150 km</span><span class="radioTileSubV382">Foire, brocante, marché, marché de voyageurs, marché de Noël</span></span></button>'+
      '<div class="radioBottomV382">'+
        '<button id="radioReturnV382" class="radioTileV382 radioReturnV382" type="button"><span class="radioTileIconV382"><img src="/autoradio-icon-return-v382.svg?v=382" alt=""></span><span class="radioTileTextV382"><span class="radioTileTitleV382">Retourner sur la place</span></span></button>'+
        '<button id="radioAddressV382" class="radioTileV382 radioAddressV382" type="button"><span class="radioTileIconV382"><img src="/address-button.png?v=382" alt=""></span><span class="radioTileTextV382"><span class="radioTileTitleV382">Carnet d’adresses</span></span></button>'+
        '<button id="radioEraseV382" class="radioTileV382 radioEraseV382" type="button"><span class="radioTileIconV382"><img src="/autoradio-icon-trash-v382.svg?v=382" alt=""></span><span class="radioTileTextV382"><span class="radioTileTitleV382">Effacer l’emplacement</span></span></button>'+
      '</div>'+
      '<div class="radioFooterV382"><span>🚐 Couteau Suisse — Version Autoradio</span><span id="autoradioInternetFooterV382" class="radioStateV382"></span><span id="autoradioAddressFooterV382">📍 Aucun emplacement enregistré</span><span id="autoradioGpsFooterV382" class="radioStateV382"></span></div>';

    document.body.appendChild(box);
    box.querySelector("#radioSettingsV382").onclick=function(){ call("toggleSettings","#settings"); };
    box.querySelector("#radioStationsV382").onclick=function(){ go("/stations-carburant.html"); };
    box.querySelector("#radioMarketsV382").onclick=function(){ go("/choix-marches-final.html"); };
    box.querySelector("#radioNearV382").onclick=function(){ go("/nearby-markets.html?radius=150"); };
    box.querySelector("#radioReturnV382").onclick=function(){ call("returnPlace",".returnPlaceTrafic");setTimeout(addressLabel,500);setTimeout(addressLabel,2200); };
    box.querySelector("#radioAddressV382").onclick=function(){ call("openSavedAddressBook","#homeAddressBookBtn"); };
    box.querySelector("#radioEraseV382").onclick=function(){ if(confirm("Êtes-vous sûr de vouloir effacer l’emplacement enregistré ?")){call("clearReturnPlace",".eraseTile");setTimeout(addressLabel,100);} };
    applyScale(getScale());
    onlineLabel();
    addressLabel();
    gpsLabel();
  }

  window.addEventListener("online",onlineLabel);
  window.addEventListener("offline",onlineLabel);
  window.addEventListener("storage",addressLabel);
  window.addEventListener("carplay-return-place-saved",addressLabel);
  if(!window.__autoradioGpsTimerV382)window.__autoradioGpsTimerV382=setInterval(function(){if(isHome())gpsLabel();},60000);

  if(document.readyState==="loading"){
    document.addEventListener("DOMContentLoaded",function(){createHome();installDisplaySetting();},{once:true});
  }else{
    createHome();installDisplaySetting();
  }

  // Certaines anciennes versions injectent encore leur accueil après DOMContentLoaded.
  // On réapplique une seule fois l'accueil autoradio validé sans observateur permanent.
  setTimeout(function(){if(isHome()&&!document.getElementById(HOME_ID))createHome();},900);
})();
