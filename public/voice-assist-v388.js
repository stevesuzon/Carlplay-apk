(function(){
  'use strict';
  var KEY='carplay_voice_enabled_v387';
  var PRESS_MS=1200;
  var active=null,timer=0,startX=0,startY=0,fired=false,suppressClickTarget=null,suppressClickUntil=0,preferredVoice=null,touchStartedAtV395=0,touchReadyV395=false,currentUtteranceV396=null,primeUtteranceV396=null,touchTargetV398=null,suppressAllClicksUntilV398=0,queuedTouchUtteranceV399=null,queuedTouchTextV399='';
  function installNoSelectV389(){
    if(document.getElementById('carplayVoiceNoSelectV389'))return;
    var st=document.createElement('style');
    st.id='carplayVoiceNoSelectV389';
    st.textContent='.carplayVoiceEnabled [data-voice-card],.carplayVoiceEnabled [data-voice-card] *,.carplayVoiceEnabled button,.carplayVoiceEnabled a,.carplayVoiceEnabled [onclick],.carplayVoiceEnabled [role="button"]{-webkit-user-select:none!important;user-select:none!important;-webkit-touch-callout:none!important}.carplayVoiceEnabled [data-voice-card]{touch-action:pan-y}';
    (document.head||document.documentElement).appendChild(st);
  }
  function enabled(){
    try{if(localStorage.getItem(KEY)==='1')return true}catch(_){}
    try{return /(?:^|;\s*)carplay_voice_enabled=1(?:;|$)/.test(document.cookie||'')}catch(_){return false}
  }
  function setEnabled(on){
    try{localStorage.setItem(KEY,on?'1':'0')}catch(_){}
    try{document.cookie='carplay_voice_enabled='+(on?'1':'0')+'; path=/; max-age=31536000; SameSite=Lax'}catch(_){}
    syncSetting();
    try{window.dispatchEvent(new CustomEvent('carplay-voice-change',{detail:{enabled:!!on}}))}catch(_){}
  }
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
  function openVoiceSelectV396(sel){
    if(!sel||!sel.options)return;
    var old=document.getElementById('voiceSelectOverlayV396');if(old)old.remove();
    var overlay=document.createElement('div');
    overlay.id='voiceSelectOverlayV396';
    overlay.style.cssText='position:fixed;inset:0;z-index:2147483645;background:rgba(0,0,0,.88);padding:18px;overflow:auto;-webkit-overflow-scrolling:touch';
    var panel=document.createElement('div');
    panel.style.cssText='max-width:620px;margin:0 auto;background:#101b2a;border:2px solid #f39b19;border-radius:20px;padding:14px;color:#fff';
    var title=document.createElement('div');
    title.style.cssText='font:950 22px/1.2 Arial,sans-serif;text-align:center;margin:4px 48px 14px';
    title.textContent=sel.getAttribute('aria-label')||'Choisir';
    var back=document.createElement('button');
    back.type='button';back.textContent='← RETOUR';
    back.setAttribute('data-voice-help','Retour : fermer la liste.');
    back.style.cssText='width:100%;min-height:50px;margin-bottom:12px;border:0;border-radius:13px;background:#253b55;color:#fff;font:950 17px Arial,sans-serif';
    back.addEventListener('click',function(){overlay.remove()});
    panel.appendChild(title);panel.appendChild(back);
    Array.prototype.forEach.call(sel.options,function(opt,idx){
      if(opt.disabled)return;
      var b=document.createElement('button');
      b.type='button';
      b.textContent=clean(opt.textContent||opt.label||opt.value||'');
      b.setAttribute('data-voice-help',b.textContent.replace(/\s*[—–-]\s*/g,', ')+'.');
      b.style.cssText='display:block;width:100%;min-height:54px;margin:7px 0;padding:10px 12px;border:1px solid #61758c;border-radius:12px;background:'+(idx===sel.selectedIndex?'#0b668d':'#172536')+';color:#fff;text-align:left;font:900 17px Arial,sans-serif';
      b.addEventListener('click',function(){
        sel.selectedIndex=idx;
        try{sel.dispatchEvent(new Event('input',{bubbles:true}))}catch(_){}
        try{sel.dispatchEvent(new Event('change',{bubbles:true}))}catch(_){}
        overlay.remove();
      });
      panel.appendChild(b);
    });
    overlay.appendChild(panel);
    overlay.addEventListener('click',function(e){if(e.target===overlay)overlay.remove()});
    document.body.appendChild(overlay);
  }
  function buttonSpeech(el){
    if(!el)return '';
    var own=clean(el.getAttribute&&el.getAttribute('data-voice-help')||'');
    if(own)return own;
    if(el.tagName==='SELECT'){
      var opt=el.options&&el.selectedIndex>=0?el.options[el.selectedIndex]:null;
      var txt=clean(opt&&opt.textContent||el.getAttribute('aria-label')||'Menu');
      return txt.replace(/\s*[—–-]\s*/g,', ')+'.';
    }
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
  function primeVoiceV396(){
    if(!enabled()||!('speechSynthesis' in window)||typeof SpeechSynthesisUtterance==='undefined')return;
    try{
      window.speechSynthesis.resume();
      primeUtteranceV396=new SpeechSynthesisUtterance('\u00a0');
      primeUtteranceV396.lang='fr-FR';
      primeUtteranceV396.volume=0.01;
      primeUtteranceV396.rate=10;
      window.speechSynthesis.speak(primeUtteranceV396);
    }catch(_){}
  }
  function speak(text){
    text=clean(text);if(!text||!enabled())return false;
    if(!('speechSynthesis' in window)||typeof SpeechSynthesisUtterance==='undefined'){toast('🔇 Lecture vocale indisponible sur cet appareil.');return false}
    try{
      window.speechSynthesis.cancel();window.speechSynthesis.resume();
      currentUtteranceV396=new SpeechSynthesisUtterance(text);
      currentUtteranceV396.lang='fr-FR';currentUtteranceV396.rate=.92;currentUtteranceV396.pitch=1;currentUtteranceV396.volume=1;
      if(!preferredVoice)loadPreferredVoice();if(preferredVoice)currentUtteranceV396.voice=preferredVoice;
      currentUtteranceV396.onstart=function(){toast('🔊 '+text)};
      currentUtteranceV396.onend=function(){currentUtteranceV396=null};
      currentUtteranceV396.onerror=function(){toast('🔇 La voix ne fonctionne pas sur cet appareil.');currentUtteranceV396=null};
      window.speechSynthesis.speak(currentUtteranceV396);return true;
    }catch(_){toast('🔇 La voix ne fonctionne pas sur cet appareil.');return false}
  }
  function eligibleTarget(e){
    if(!enabled()||!e.target||!e.target.closest)return null;
    var clickable=e.target.closest('button,a,select,[onclick],[role="button"]');
    if(clickable&&!clickable.matches('input,textarea,label'))return clickable;
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
  function prepareTouchSpeechV399(target){
    if(!target||!enabled()||!('speechSynthesis' in window)||typeof SpeechSynthesisUtterance==='undefined')return;
    var text=clean(buildSpeech(target));if(!text)return;
    try{
      window.speechSynthesis.cancel();
      loadPreferredVoice();
      queuedTouchTextV399=text;
      queuedTouchUtteranceV399=new SpeechSynthesisUtterance(text);
      queuedTouchUtteranceV399.lang='fr-FR';
      queuedTouchUtteranceV399.rate=.92;
      queuedTouchUtteranceV399.pitch=1;
      queuedTouchUtteranceV399.volume=1;
      if(preferredVoice)queuedTouchUtteranceV399.voice=preferredVoice;
      queuedTouchUtteranceV399.onstart=function(){toast('🔊 '+text)};
      queuedTouchUtteranceV399.onend=function(){queuedTouchUtteranceV399=null;queuedTouchTextV399='';};
      queuedTouchUtteranceV399.onerror=function(){toast('🔇 Aucun son. Réessayez une fois.');queuedTouchUtteranceV399=null;queuedTouchTextV399='';};
      window.speechSynthesis.pause();
      window.speechSynthesis.speak(queuedTouchUtteranceV399);
    }catch(_){queuedTouchUtteranceV399=null;queuedTouchTextV399='';}
  }
  function cancelTouchSpeechV399(){
    try{window.speechSynthesis.cancel()}catch(_){}
    queuedTouchUtteranceV399=null;queuedTouchTextV399='';
  }
  function resumeTouchSpeechV399(target){
    try{
      if(queuedTouchUtteranceV399&&queuedTouchTextV399){
        window.speechSynthesis.resume();
        return true;
      }
    }catch(_){}
    return speak(buildSpeech(target));
  }
  function touchBeginV394(e){
    if(!enabled()||!e.target||!e.target.closest)return;
    var target=eligibleTarget(e);
    if(!target)return;
    var t=e.touches&&e.touches[0];if(!t)return;
    active=target;touchTargetV398=target;fired=false;touchReadyV395=false;touchStartedAtV395=Date.now();startX=t.clientX;startY=t.clientY;clearTimeout(timer);prepareTouchSpeechV399(target);
    timer=setTimeout(function(){
      if(active){
        touchReadyV395=true;
        suppressAllClicksUntilV398=Date.now()+4000;
        toast('🔊 Relâchez pour écouter');
      }
    },PRESS_MS);
  }
  function touchMoveV394(e){
    if(touchReadyV395)return;
    if(!active)return;
    var t=e.touches&&e.touches[0];
    if(!t){cancel();cancelTouchSpeechV399();touchTargetV398=null;touchReadyV395=false;touchStartedAtV395=0;return}
    var dx=Math.abs(t.clientX-startX),dy=Math.abs(t.clientY-startY);
    if(dx>28||dy>28){cancel();cancelTouchSpeechV399();touchTargetV398=null;touchReadyV395=false;touchStartedAtV395=0;}
  }
  function blockLongPressReleaseV397(e){
    try{if(e&&e.cancelable)e.preventDefault()}catch(_){}
    try{if(e)e.stopPropagation()}catch(_){}
    try{if(e&&e.stopImmediatePropagation)e.stopImmediatePropagation()}catch(_){}
  }
  function touchEndV394(e){
    var target=active||touchTargetV398;
    var held=touchStartedAtV395?Date.now()-touchStartedAtV395:0;
    var isLong=!!(target&&(touchReadyV395||held>=PRESS_MS));
    clearTimeout(timer);timer=0;active=null;
    if(isLong){
      fired=true;
      suppressClickTarget=target;
      suppressClickUntil=Date.now()+2500;
      suppressAllClicksUntilV398=Date.now()+2500;
      blockLongPressReleaseV397(e);
      resumeTouchSpeechV399(target);
    }
    if(!isLong)cancelTouchSpeechV399();
    touchTargetV398=null;touchReadyV395=false;touchStartedAtV395=0;
    setTimeout(function(){fired=false},160);
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
  document.addEventListener('selectstart',function(e){if(enabled()&&e.target.closest&&e.target.closest('[data-voice-card],button,a,select,[onclick],[role="button"]'))e.preventDefault()},true);
  document.addEventListener('dragstart',function(e){if(enabled()&&e.target.closest&&e.target.closest('[data-voice-card],button,a,select,[onclick],[role="button"]'))e.preventDefault()},true);
  document.addEventListener('click',function(e){
    if(!enabled()||!e.target||e.target.tagName!=='SELECT')return;
    e.preventDefault();e.stopImmediatePropagation();
    openVoiceSelectV396(e.target);
  },true);
  document.addEventListener('change',function voiceSelectChangeV396(e){
    if(!enabled()||!e.target||e.target.tagName!=='SELECT')return;
    var opt=e.target.options&&e.target.selectedIndex>=0?e.target.options[e.target.selectedIndex]:null;
    var txt=clean(opt&&opt.textContent||'');
    if(txt)speak(txt.replace(/\s*[—–-]\s*/g,', '));
  },true);
  document.addEventListener('click',function(e){
    if(suppressAllClicksUntilV398&&Date.now()<suppressAllClicksUntilV398){
      e.preventDefault();e.stopPropagation();e.stopImmediatePropagation();
      return;
    }
    if(suppressClickUntil&&Date.now()<suppressClickUntil&&suppressClickTarget){
      var hit=(e.target===suppressClickTarget)||(suppressClickTarget.contains&&suppressClickTarget.contains(e.target))||(e.target&&e.target.contains&&e.target.contains(suppressClickTarget));
      if(hit){
        e.preventDefault();e.stopPropagation();e.stopImmediatePropagation();
        suppressClickTarget=null;suppressClickUntil=0;
      }
    }
  },true);
  document.addEventListener('touchstart',touchBeginV394,{capture:true,passive:true});
  document.addEventListener('touchmove',touchMoveV394,{capture:true,passive:true});
  document.addEventListener('touchend',touchEndV394,{capture:true,passive:false});
  document.addEventListener('touchcancel',function(){cancel();cancelTouchSpeechV399();touchTargetV398=null;touchReadyV395=false;touchStartedAtV395=0;},{capture:true,passive:true});
  document.addEventListener('pointerdown',begin,true);document.addEventListener('pointermove',move,true);document.addEventListener('pointerup',end,true);document.addEventListener('pointercancel',cancel,true);
  document.addEventListener('contextmenu',function(e){if(enabled()&&e.target.closest&&e.target.closest('[data-voice-card],button,a,select,[onclick],[role="button"]'))e.preventDefault()},true);
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',initSetting);else initSetting();
  window.addEventListener('storage',syncSetting);if(window.speechSynthesis)window.speechSynthesis.addEventListener&&window.speechSynthesis.addEventListener('voiceschanged',loadPreferredVoice);
  window.CouteauVoice={enabled:enabled,setEnabled:setEnabled,speak:speak,buildMarket:buildMarket,pressMs:PRESS_MS};
})();
