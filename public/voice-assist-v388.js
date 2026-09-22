(function(){
  'use strict';
  var KEY='carplay_voice_enabled_v387';
  var PRESS_MS=1200;
  var active=null,timer=0,startX=0,startY=0,fired=false,suppressClickTarget=null,suppressClickUntil=0,preferredVoice=null,touchStartedAtV395=0,touchReadyV395=false;
  function installNoSelectV389(){
    if(document.getElementById('carplayVoiceNoSelectV389'))return;
    var st=document.createElement('style');
    st.id='carplayVoiceNoSelectV389';
    st.textContent='.carplayVoiceEnabled [data-voice-card],.carplayVoiceEnabled [data-voice-card] *,.carplayVoiceEnabled button,.carplayVoiceEnabled a,.carplayVoiceEnabled [onclick],.carplayVoiceEnabled [role="button"]{-webkit-user-select:none!important;user-select:none!important;-webkit-touch-callout:none!important}.carplayVoiceEnabled [data-voice-card]{touch-action:pan-y}';
    (document.head||document.documentElement).appendChild(st);
  }
  function enabled(){try{return localStorage.getItem(KEY)==='1'}catch(_){return false}}
  function setEnabled(on){try{localStorage.setItem(KEY,on?'1':'0')}catch(_){}syncSetting();try{window.dispatchEvent(new CustomEvent('carplay-voice-change',{detail:{enabled:!!on}}))}catch(_){}}
  function clean(s){return String(s||'').replace(/\s+/g,' ').trim()}
  function hourText(s){return clean(s).replace(/(\d{1,2})[:h.](\d{2})/g,function(_,h,m){return Number(m)?(Number(h)+' heures '+Number(m)):(Number(h)+' heures')}).replace(/\b(\d{1,2})h\b/g,'$1 heures').replace(/–|—/g,' à ')}
  function unknownTime(s){s=clean(s).toLowerCase();return !s||/à vérifier|a verifier|à confirmer|a confirmer|non précisé|non precise|non publié|non publie|inconnu/.test(s)}
  function marketTime(card){
    var n=card.querySelector('.shared-time');if(n)return clean(n.textContent);
    var metas=[].slice.call(card.querySelectorAll('.meta'));
    for(var i=0;i<metas.length;i++){var t=clean(metas[i].textContent);if(/^🕒/.test(t))return clean(t.replace(/^🕒\s*/,''));}
    return clean(card.dataset.voiceHours||'');
  }
  function unknownCount(s){s=clean(s).toLowerCase();return !s||/à vérifier|a verifier|à confirmer|a confirmer|non précisé|non precise|non publié|non publie|inconnu|indisponible/.test(s)}
  function marketCount(card){
    var label=clean(card.dataset.voiceCountLabel||''),value=clean(card.dataset.voiceCount||'');
    if(!value){var sc=card.querySelector('.shared-count');if(sc)value=clean(sc.textContent)}
    var full=clean(card.innerText||card.textContent||'');
    if(!value){
      var m=full.match(/(?:Nombre\s+(?:de|d['’])\s*)?(chalets|emplacements(?:\s*\/\s*exposants)?|exposants|commerçants|places(?:\s*\/\s*commerçants)?)\s*:\s*([^·|]+?)(?=(?:\s+(?:Tirage|Humeur|Responsable|Modèle|Inscription|Organisateur|GPS|📞|ℹ️))|$)/i);
      if(m){if(!label)label=clean(m[1]);value=clean(m[2])}
    }
    if(!label)label='commerçants';
    label=label.replace(/^nombre\s+(?:de|d['’])\s*/i,'');
    if(unknownCount(value))return 'nombre de '+label+' inconnu';
    return 'nombre de '+label+' : '+value;
  }
  function firstStartTime(s){
    s=clean(s);if(unknownTime(s))return'';
    var m=s.match(/\b([01]?\d|2[0-3])\s*(?:h|:|\.)\s*([0-5]\d)?\b/i);
    if(!m)return'';
    var h=Number(m[1]),mi=m[2]?Number(m[2]):0;
    return mi?(h+' heures '+mi):(h+' heures');
  }
  function marketArrival(card,time){
    var a=clean(card.dataset.voiceArrival||'');
    if(a&&!unknownTime(a))return 'il faut être là à '+hourText(a);
    var start=firstStartTime(time);
    return start?('il faut être là à '+start):"heure d'arrivée inconnue";
  }
  function buildMarket(card){
    var name=clean(card.dataset.voiceName||'');
    if(!name){var h=card.querySelector('h2');if(h)name=clean(h.textContent);}
    if(!name){var n=card.querySelector('.name');if(n)name=clean(n.textContent.replace(/\d+(?:[,.]\d+)?\s*km/i,''));}
    if(!name)name='Marché';
    var day=clean(card.dataset.voiceDay||'');
    var dist=clean(card.dataset.voiceDistance||'');
    if(!dist){var d=card.querySelector('[data-feature="market-distance"],.distance');if(d)dist=clean(d.textContent.replace(/^📍\s*/,''));}
    var time=marketTime(card),parts=[name];
    if(day)parts.push(day);
    if(dist)parts.push('à '+dist);
    if(unknownTime(time))parts.push('horaire inconnu');else parts.push('horaire '+hourText(time));
    parts.push(marketCount(card));
    parts.push(marketArrival(card,time));
    var verified=!!card.querySelector('.marketVerificationDot.green,.statusDot.ok');
    if(verified)parts.push('fiche vérifiée');
    return parts.join('. ')+'.';
  }
  function buttonSpeech(el){
    if(!el)return '';
    var own=clean(el.getAttribute&&el.getAttribute('data-voice-help')||'');
    if(own)return own;
    var id=el.id||'';
    var byId={
      fuelStationsQuickBtn:'Stations : essence, gazole et GPL à moins de quinze kilomètres.',
      contactMailButton:'Mail : envoyer un message.',
      housePhotoButton:'Mesurer une maison : estimer les surfaces de la maison.',
      nearby80Button:'Marchés à moins de cent cinquante kilomètres.',
      homeAddressBookBtn:"Adresses : ouvrir le carnet d'adresses.",
      locationPermissionBtn:'Localisation : activer la position GPS.'
    };
    if(byId[id])return byId[id];
    if(el.classList&&el.classList.contains('gear'))return 'Réglages : ouvrir les réglages.';
    if(el.matches&&el.matches('.card.blue'))return 'Marchés : marchés, foires, Noël et brocantes.';
    if(el.matches&&el.matches('.directBtn.place'))return 'Mes papiers : ouvrir vos papiers.';
    if(el.matches&&el.matches('.directBtn.docs'))return 'Démarches professionnelles : carte commerçant, assurance et K bis.';
    if(el.matches&&el.matches('.returnPlaceTrafic'))return "Retourner sur la place : ouvrir l'emplacement enregistré.";
    if(el.matches&&el.matches('.eraseTile'))return "Effacer emplacement : supprimer l'emplacement enregistré.";
    var label=clean((el.getAttribute&&el.getAttribute('aria-label'))||(el.getAttribute&&el.getAttribute('title'))||el.innerText||el.textContent||'');
    if(!label)return 'Bouton.';
    if(label.length>120)label=label.slice(0,120);
    return label+'.';
  }
  function buildSpeech(card){
    if(!card)return '';
    if(!card.dataset.voiceCard)return buttonSpeech(card);
    if(card.dataset.voiceText)return clean(card.dataset.voiceText);
    var kind=card.dataset.voiceCard||'market';
    if(kind==='market')return buildMarket(card);
    return clean(card.innerText||card.textContent||'');
  }
  function toast(msg){
    var id='carplayVoiceToastV387',el=document.getElementById(id);
    if(!el){el=document.createElement('div');el.id=id;el.style.cssText='position:fixed;left:50%;bottom:22px;transform:translateX(-50%);z-index:2147483600;max-width:88vw;padding:11px 15px;border-radius:14px;background:#07111df2;border:2px solid #f39b19;color:#fff;font:900 14px Arial,sans-serif;text-align:center;box-shadow:0 8px 24px #0009;pointer-events:none';document.body.appendChild(el)}
    el.textContent=msg;el.style.display='block';clearTimeout(el._hide);el._hide=setTimeout(function(){el.style.display='none'},2200);
  }
  function loadPreferredVoice(){
    try{
      var vv=window.speechSynthesis&&window.speechSynthesis.getVoices?window.speechSynthesis.getVoices():[];
      preferredVoice=vv.find(function(v){return /^fr(?:-|_)/i.test(v.lang||'')})||vv.find(function(v){return /français|french/i.test(v.name||'')})||null;
    }catch(_){preferredVoice=null}
  }
  function speak(text){
    text=clean(text);if(!text||!enabled())return false;
    if(!('speechSynthesis' in window)||typeof SpeechSynthesisUtterance==='undefined'){toast('🔇 Lecture vocale indisponible sur cet appareil.');return false}
    try{
      window.speechSynthesis.cancel();window.speechSynthesis.resume();
      var u=new SpeechSynthesisUtterance(text);u.lang='fr-FR';u.rate=.92;u.pitch=1;u.volume=1;if(!preferredVoice)loadPreferredVoice();if(preferredVoice)u.voice=preferredVoice;
      u.onerror=function(){toast('🔇 La voix ne fonctionne pas sur cet appareil. Vous pouvez la désactiver dans Réglages.')};
      window.speechSynthesis.speak(u);toast('🔊 '+text);return true;
    }catch(_){toast('🔇 La voix ne fonctionne pas sur cet appareil.');return false}
  }
  function eligibleTarget(e){
    if(!enabled()||!e.target||!e.target.closest)return null;
    var clickable=e.target.closest('button,a,[onclick],[role="button"]');
    if(clickable&&!clickable.matches('input,select,textarea,label'))return clickable;
    var card=e.target.closest('[data-voice-card]');
    return card||null;
  }
  function cancel(){clearTimeout(timer);timer=0;active=null;fired=false}
  function fireLongPress(target){
    if(!target)return;
    fired=true;
    suppressClickTarget=target;
    suppressClickUntil=Date.now()+1000;
    try{navigator.vibrate&&navigator.vibrate(35)}catch(_){}
    speak(buildSpeech(target));
  }
  function begin(e){
    if(e&&e.pointerType==='touch')return;
    var card=eligibleTarget(e);if(!card)return;active=card;fired=false;startX=Number(e.clientX||0);startY=Number(e.clientY||0);clearTimeout(timer);
    timer=setTimeout(function(){if(active)fireLongPress(active)},PRESS_MS);
  }
  function move(e){if(!active)return;var dx=Math.abs(Number(e.clientX||0)-startX),dy=Math.abs(Number(e.clientY||0)-startY);if(dx>18||dy>18)cancel()}
  function end(){clearTimeout(timer);timer=0;active=null;setTimeout(function(){fired=false},80)}
  function touchBeginV394(e){
    if(!enabled()||!e.target||!e.target.closest)return;
    var target=eligibleTarget(e);
    if(!target)return;
    var t=e.touches&&e.touches[0];if(!t)return;
    active=target;fired=false;touchReadyV395=false;touchStartedAtV395=Date.now();startX=t.clientX;startY=t.clientY;clearTimeout(timer);
    timer=setTimeout(function(){
      if(active){
        touchReadyV395=true;
        toast('🔊 Relâchez pour écouter');
      }
    },PRESS_MS);
  }
  function touchMoveV394(e){
    if(!active)return;
    var t=e.touches&&e.touches[0];if(!t){cancel();touchReadyV395=false;touchStartedAtV395=0;return}
    var dx=Math.abs(t.clientX-startX),dy=Math.abs(t.clientY-startY);
    if(dx>28||dy>28){cancel();touchReadyV395=false;touchStartedAtV395=0;}
  }
  function touchEndV394(e){
    var target=active;
    var held=touchStartedAtV395?Date.now()-touchStartedAtV395:0;
    clearTimeout(timer);timer=0;active=null;
    if(target&&(touchReadyV395||held>=PRESS_MS)){
      fired=true;
      suppressClickTarget=target;
      suppressClickUntil=Date.now()+1000;
      speak(buildSpeech(target));
    }
    touchReadyV395=false;touchStartedAtV395=0;
    setTimeout(function(){fired=false},80);
  }
  function syncSetting(){
    var t=document.getElementById('voiceAssistToggle'),s=document.getElementById('voiceAssistStatus'),on=enabled();
    document.documentElement.classList.toggle('carplayVoiceEnabled',on);
    if(t)t.checked=on;
    if(s)s.textContent=on?'🔊 Voix activée — appui long 1,20 seconde sur une fiche ou un bouton.':'🔇 Voix désactivée.';
  }
  function initSetting(){
    loadPreferredVoice();
    syncSetting();
    var t=document.getElementById('voiceAssistToggle');
    if(t&&!t.dataset.voiceWired){
      if(window.voiceSettingsDirect){
        t.dataset.voiceWired='direct';
      }else{
        t.dataset.voiceWired='1';
        t.addEventListener('change',function(){setEnabled(t.checked);if(t.checked)speak('Lecture vocale activée.')});
      }
    }
  }
  installNoSelectV389();
  document.addEventListener('selectstart',function(e){if(enabled()&&e.target.closest&&e.target.closest('[data-voice-card],button,a,[onclick],[role="button"]'))e.preventDefault()},true);
  document.addEventListener('dragstart',function(e){if(enabled()&&e.target.closest&&e.target.closest('[data-voice-card],button,a,[onclick],[role="button"]'))e.preventDefault()},true);
  document.addEventListener('click',function(e){
    if(suppressClickUntil&&Date.now()<suppressClickUntil&&suppressClickTarget&&(e.target===suppressClickTarget||suppressClickTarget.contains(e.target))){
      e.preventDefault();e.stopImmediatePropagation();suppressClickTarget=null;suppressClickUntil=0;
    }
  },true);
  document.addEventListener('touchstart',touchBeginV394,{capture:true,passive:true});
  document.addEventListener('touchmove',touchMoveV394,{capture:true,passive:true});
  document.addEventListener('touchend',touchEndV394,{capture:true,passive:true});
  document.addEventListener('touchcancel',cancel,{capture:true,passive:true});
  document.addEventListener('pointerdown',begin,true);document.addEventListener('pointermove',move,true);document.addEventListener('pointerup',end,true);document.addEventListener('pointercancel',cancel,true);
  document.addEventListener('contextmenu',function(e){if(enabled()&&e.target.closest&&e.target.closest('[data-voice-card],button,a,[onclick],[role="button"]'))e.preventDefault()},true);
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',initSetting);else initSetting();
  window.addEventListener('storage',syncSetting);if(window.speechSynthesis)window.speechSynthesis.addEventListener&&window.speechSynthesis.addEventListener('voiceschanged',loadPreferredVoice);
  window.CouteauVoice={enabled:enabled,setEnabled:setEnabled,speak:speak,buildMarket:buildMarket,pressMs:PRESS_MS};
})();
