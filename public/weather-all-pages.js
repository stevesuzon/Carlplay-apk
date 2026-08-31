(function () {

  var style = document.createElement("style");
  style.textContent = "#weatherBubble{position:fixed;z-index:2147483000;top:max(4px,env(safe-area-inset-top));left:50%;right:auto;transform:translateX(-50%);box-sizing:border-box;width:auto;max-width:calc(100vw - 20px);min-width:280px;padding:7px 13px;border-radius:18px;border:2px solid #f39b19;background:rgba(5,10,18,.96);color:#fff;text-align:center;font:900 15px/1.15 Arial;box-shadow:0 5px 14px #0008;overflow:hidden;transition:opacity .18s ease,transform .18s ease}#weatherBubble .weatherMain{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}#weatherBubble .weatherDay{margin-top:3px;font-size:12px;color:#fff}body:not(.homePage){padding-top:62px!important}body.settings-open #weatherBubble{display:none!important}body.weatherScrolled #weatherBubble{opacity:0!important;pointer-events:none!important;transform:translate(-50%,-90px)!important}@media(max-width:720px){#weatherBubble{top:max(3px,env(safe-area-inset-top));max-width:calc(100vw - 18px);min-width:0;width:auto;padding:6px 10px;font-size:12px}#weatherBubble .weatherDay{font-size:10px}}"+
  "#dangerWeatherOverlay{position:fixed;inset:0;z-index:2147483646;background:rgba(0,0,0,.72);display:flex;align-items:center;justify-content:center;padding:18px;font-family:Arial,sans-serif}#dangerWeatherOverlay[hidden]{display:none!important}#dangerWeatherCard{width:min(680px,94vw);border-radius:28px;padding:25px 22px;text-align:center;color:#fff;box-shadow:0 15px 50px #000;border:4px solid #ffb000;background:linear-gradient(145deg,#3b1700,#c45a00)}#dangerWeatherOverlay.level2 #dangerWeatherCard{border-color:#ff4b32;background:linear-gradient(145deg,#410000,#b51515)}#dangerWeatherOverlay.level3 #dangerWeatherCard{border-color:#fff;background:linear-gradient(145deg,#210000,#840000);box-shadow:0 0 0 6px #ff1e1e,0 18px 55px #000}#dangerWeatherTitle{font-size:clamp(30px,7vw,52px);font-weight:1000;line-height:1.02;margin:0 0 13px}#dangerWeatherSpeed{font-size:clamp(38px,10vw,74px);font-weight:1000;margin:8px 0}#dangerWeatherText{font-size:clamp(19px,4vw,28px);font-weight:900;line-height:1.25}#dangerWeatherSub{margin-top:14px;font-size:14px;font-weight:800;opacity:.9}#dangerWeatherHint{margin-top:18px;font-size:13px;font-weight:800;opacity:.8}";
  document.head.appendChild(style);

  var bubble = document.getElementById("weatherBubble");
  if (!bubble) {
    bubble = document.createElement("div");
    bubble.id = "weatherBubble";
    document.body.appendChild(bubble);
  }
  bubble.dataset.weather = bubble.dataset.weather || localStorage.getItem("last_weather_text") || "🌤️ MÉTÉO — EN ATTENTE INTERNET/GPS";

  var overlay=document.createElement('div');overlay.id='dangerWeatherOverlay';overlay.hidden=true;
  overlay.innerHTML='<div id="dangerWeatherCard"><div id="dangerWeatherTitle"></div><div id="dangerWeatherSpeed"></div><div id="dangerWeatherText"></div><div id="dangerWeatherSub"></div><div id="dangerWeatherHint">Touchez à côté de cette alerte pour la fermer.</div></div>';
  document.body.appendChild(overlay);
  overlay.addEventListener('click',function(e){if(e.target===overlay){overlay.hidden=true;overlay.className='';}});
  document.getElementById('dangerWeatherCard').addEventListener('click',function(e){e.stopPropagation();});

  function render() {
    var n = new Date();
    var jour = n.toLocaleDateString("fr-FR", {weekday:"long"}).toUpperCase();
    var court = String(n.getDate()).padStart(2,"0") + "/" + String(n.getMonth()+1).padStart(2,"0") + "/" + String(n.getFullYear()).slice(-2);
    bubble.innerHTML = '<div class="weatherMain">' + bubble.dataset.weather + '</div><div class="weatherDay">' + jour + ' / ' + court + '</div>';
  }

  function message(percent, code) {
    percent = Math.max(0, Math.min(100, Math.round(Number(percent) || 0)));
    var icon = code >= 51 && code <= 99 ? "🌧️" : code <= 1 ? "☀️" : "⛅";
    var text = percent === 0 ? "TRÈS BON JOUR POUR TRAVAILLER" : percent < 60 ? "TU PEUX ENCORE ALLER TRAVAILLER" : percent < 80 ? "T’ES VAILLANT" : "RESTE CHEZ TOI, C’EST MIEUX";
    return icon + " " + percent + " % — " + text;
  }

  function refresh() {
    if (!navigator.onLine || !navigator.geolocation) { render(); return; }
    navigator.geolocation.getCurrentPosition(function (position) {
      var url = "https://api.open-meteo.com/v1/forecast?latitude=" + position.coords.latitude + "&longitude=" + position.coords.longitude + "&current=weather_code&hourly=precipitation_probability&forecast_days=1&timezone=auto";
      fetch(url).then(function (response) { return response.json(); }).then(function (data) {
        var percent = 0;
        var code = data.current && data.current.weather_code || 0;
        if (data.hourly && data.hourly.precipitation_probability) {
          var values = data.hourly.precipitation_probability;
          var times = data.hourly.time || [];
          var now = Date.now();
          var closest = Infinity;
          for (var i = 0; i < times.length; i++) {
            var distance = Math.abs(new Date(times[i]).getTime() - now);
            if (distance < closest) { closest = distance; percent = values[i]; }
          }
        }
        var value = message(percent, code);
        bubble.dataset.weather = value;
        localStorage.setItem("last_weather_text", value);
        render();
      }).catch(function () { render(); });
    }, function () { render(); }, { enableHighAccuracy: false, timeout: 8000, maximumAge: 600000 });
  }

  function windLevel(kmh){if(kmh>=75)return{css:3,label:'TRÈS DANGEREUX',icon:'🚨',advice:'Évitez de circuler avec un véhicule ou une caravane. Rafales violentes : sécurisez la caravane, le véhicule, l’auvent et les équipements, puis mettez-vous à l’abri.'};if(kmh>=65)return{css:3,label:'DANGEREUX',icon:'🔴',advice:'Ne partez pas avec une caravane si vous pouvez l’éviter. Risque important lié aux rafales : sécurisez l’auvent et les équipements.'};if(kmh>=60)return{css:2,label:'ATTENTION',icon:'🟠',advice:'Déconseillé de circuler en tractant une caravane. Fortes rafales : vérifiez l’auvent, les cales, le véhicule et les objets extérieurs.'};if(kmh>=55)return{css:1,label:'FORT',icon:'🟠',advice:'Évitez de partir en tractant une caravane par ce vent. Rangez ou sécurisez l’auvent et les équipements extérieurs.'};if(kmh>=45)return{css:1,label:'VIGILANCE',icon:'🟡',advice:'Vent sensible. Surveillez l’auvent, la caravane, le véhicule et les objets extérieurs.'};return{css:1,label:'FAIBLE',icon:'🟢',advice:'Pas de risque particulier lié au vent.'}}
  function showDanger(kind,maxGust,hailSize,extra){
    extra=extra||{};
    var day=new Date().toISOString().slice(0,10),strength=(kind==='wind'||kind==='combined')?Math.floor(Number(maxGust||0)/10)*10:(hailSize||0);
    var hazardSignature=kind==='combined'?[extra.hailConfirmed?'hail':'',extra.hailPossible?'hailPossible':'',extra.lightning?'lightning':'',extra.wind?'wind':'',extra.flood?'flood'+(extra.floodLevel||''):''].join('-'):'';
    var warningKey=[kind,day,strength,hazardSignature].join('|'),lastKey=sessionStorage.getItem('danger_weather_last_key')||'';
    if(lastKey===warningKey)return;
    sessionStorage.setItem('danger_weather_last_key',warningKey);
    var title=document.getElementById('dangerWeatherTitle'),speed=document.getElementById('dangerWeatherSpeed'),text=document.getElementById('dangerWeatherText'),sub=document.getElementById('dangerWeatherSub');
    overlay.className='';
    if(kind==='combined'){
      var labels=[];
      if(extra.hailConfirmed)labels.push('GRÊLE');else if(extra.hailPossible)labels.push('GRÊLE POSSIBLE');
      if(extra.lightning)labels.push('FOUDRE');
      if(extra.wind)labels.push('VENT FORT');
      if(extra.flood)labels.push('INONDATION');
      var wl=extra.wind?windLevel(maxGust):null;
      overlay.classList.add('level'+((extra.floodLevel==='rouge'||wl&&wl.css===3)?3:2));
      title.textContent='⚠️ '+labels.join(' + ');
      speed.textContent=extra.wind?Math.round(maxGust)+' KM/H — '+wl.label:'';
      text.innerHTML='Plusieurs dangers sont annoncés près de votre emplacement enregistré. Protégez votre <strong>véhicule</strong>, votre caravane et votre matériel.'+(wl?'<br><br><strong>'+wl.advice+'</strong>':'');
      sub.textContent=extra.flood?'Éloignez-vous des cours d’eau et des points bas. Ne vous engagez jamais sur une route inondée.':'Éloignez-vous des arbres, des cours d’eau et des installations exposées.';
    }else if(kind==='hail'){
      overlay.classList.add('level'+(hailSize&&hailSize>=4?3:hailSize&&hailSize>=2?2:1));
      title.textContent='⚠️ RISQUE DE GRÊLE'; speed.textContent='';
      text.innerHTML='Préparez les <strong>filets anti-grêle</strong> et protégez votre véhicule, votre caravane et votre matériel.';
      sub.textContent=hailSize?'Grêlons possibles : environ '+hailSize+' cm.':'Taille des grêlons non précisée : aucune estimation n’est inventée.';
    }else if(kind==='storm'){
      overlay.classList.add('level2');
      title.textContent='⚠️ VIGILANCE ORANGE ORAGES'; speed.textContent='GRÊLE POSSIBLE';
      text.innerHTML='Météo-France signale des orages dangereux dans le département de votre emplacement. Préparez les <strong>filets anti-grêle</strong> et protégez votre véhicule, votre caravane et votre matériel.';
      sub.textContent='Alerte départementale officielle : la grêle reste possible même si elle n’est pas encore localisée précisément.';
    }else if(kind==='thunderstorm'){
      overlay.classList.add('level1');
      title.textContent='⛈️ RISQUE D’ORAGES'; speed.textContent='SOYEZ PRUDENT';
      text.textContent='Des orages sont annoncés près de votre emplacement enregistré. Risques possibles : foudre, fortes pluies et rafales de vent.';
      sub.textContent='Mettez-vous à l’abri dans un bâtiment solide et éloignez-vous des arbres et des cours d’eau.';
    }else if(kind==='flood'){
      overlay.classList.add(extra.floodLevel==='rouge'?'level3':extra.floodLevel==='orange'?'level2':'level1');
      title.textContent='🌊 RISQUE D’INONDATION'; speed.textContent=(extra.floodLevel||'').toUpperCase();
      text.textContent='Un risque d’inondation ou de crue concerne le département de votre emplacement enregistré. Éloignez le véhicule, la caravane et le matériel des cours d’eau et des points bas.';
      sub.textContent='Ne vous engagez jamais sur une route inondée, même si le niveau d’eau paraît faible.';
    }else{
      var wl=windLevel(maxGust); overlay.classList.add('level'+wl.css);
      title.textContent=wl.icon+' VENT — '+wl.label; speed.textContent=Math.round(maxGust)+' KM/H';
      text.textContent=wl.advice;
      sub.textContent='Alerte basée sur la position enregistrée avec « Retourner sur la place ». Affichée à partir de 55 km/h.';
    }
    overlay.hidden=false;
  }

  var lastDangerCheck=0;
  function checkSavedPlaceDanger(force){
    if(!navigator.onLine)return;
    var lat=parseFloat(localStorage.getItem('return_lat')),lon=parseFloat(localStorage.getItem('return_lon'));
    if(!Number.isFinite(lat)||!Number.isFinite(lon))return;
    var now=Date.now();if(!force&&now-lastDangerCheck<5*60*1000)return;lastDangerCheck=now;
    var u='https://api.open-meteo.com/v1/forecast?latitude='+encodeURIComponent(lat)+'&longitude='+encodeURIComponent(lon)+'&hourly=weather_code,wind_gusts_10m&forecast_days=2&timezone=auto&wind_speed_unit=kmh';
    fetch(u).then(function(r){if(!r.ok)throw new Error('weather');return r.json()}).then(function(d){
      var times=d.hourly&&d.hourly.time||[],codes=d.hourly&&d.hourly.weather_code||[],gusts=d.hourly&&d.hourly.wind_gusts_10m||[];
      var end=now+12*3600*1000,maxG=0,hail=false,thunderstorm=false;
      for(var i=0;i<times.length;i++){var t=new Date(times[i]).getTime();if(t<now-3600000||t>end)continue;var g=Number(gusts[i])||0;if(g>maxG)maxG=g;var c=Number(codes[i]);if(c===96||c===99)hail=true;if(c===95||c===96||c===99)thunderstorm=true;}
      function displayRisks(v){
        var orange=!!(v&&v.orangeThunderstorm),lightning=thunderstorm||orange||!!(v&&v.yellowThunderstorm),wind=maxG>=55,hailPossible=hail||orange,flood=!!(v&&v.floodRisk);
        var count=(hailPossible?1:0)+(lightning?1:0)+(wind?1:0)+(flood?1:0);
        if(count>1)showDanger('combined',maxG,null,{hailConfirmed:hail,hailPossible:hailPossible&&!hail,lightning:lightning,wind:wind,flood:flood,floodLevel:v&&v.floodLevel});
        else if(hail)showDanger('hail',0,null);
        else if(orange)showDanger('storm',0,null);
        else if(lightning)showDanger('thunderstorm',0,null);
        else if(wind)showDanger('wind',maxG,null);
        else if(flood)showDanger('flood',0,null,{floodLevel:v&&v.floodLevel});
      }
      fetch('/api/vigilance?lat='+encodeURIComponent(lat)+'&lon='+encodeURIComponent(lon),{cache:'no-store'}).then(function(r){if(!r.ok)throw 0;return r.json()}).then(displayRisks).catch(function(){displayRisks(null)});
    }).catch(function(){});
  }
  window.__checkSavedPlaceDanger=function(){checkSavedPlaceDanger(true)};

  function scrollState(){ document.body.classList.toggle('weatherScrolled',(window.scrollY||0)>45); }
  addEventListener('scroll',scrollState,{passive:true});
  addEventListener('focus',function(){checkSavedPlaceDanger(true)});
  document.addEventListener('visibilitychange',function(){if(!document.hidden)checkSavedPlaceDanger(true)});
  scrollState(); render(); refresh(); checkSavedPlaceDanger(true);
  setInterval(render,30000); setInterval(refresh,900000); setInterval(function(){checkSavedPlaceDanger(false)},900000);
  addEventListener("online", function(){refresh();checkSavedPlaceDanger(true)});
})();
