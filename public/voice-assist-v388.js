(function(){
  'use strict';
  if(window.__carplayVoiceV456Loaded)return;
  window.__carplayVoiceV456Loaded=true;
  var KEY='carplay_voice_enabled_v387';
  var PRESS_MS=1200;
  var active=null,timer=0,startX=0,startY=0,fired=false,suppressClickTarget=null,suppressClickUntil=0,preferredVoice=null,touchStartedAtV395=0,touchReadyV395=false,currentUtteranceV396=null,primeUtteranceV396=null,touchTargetV398=null,suppressAllClicksUntilV398=0,queuedTouchTextV400='',voiceAwakeV423=false,touchActionDoneV456=false;
  function installNoSelectV389(){
    if(document.getElementById('carplayVoiceNoSelectV389'))return;
    var st=document.createElement('style');
    st.id='carplayVoiceNoSelectV389';
    st.textContent='.carplayVoiceEnabled [data-voice-card],.carplayVoiceEnabled [data-voice-card] *,.carplayVoiceEnabled button,.carplayVoiceEnabled a,.carplayVoiceEnabled [onclick],.carplayVoiceEnabled [role="button"]{-webkit-user-select:none!important;user-select:none!important;-webkit-touch-callout:none!important}.carplayVoiceEnabled [data-voice-card]{touch-action:pan-y}';
    (document.head||document.documentElement).appendChild(st);
  }
  function enabled(){return true}
  function voiceUnlockedV456(){try{return sessionStorage.getItem('carplay_voice_unlocked_v456')==='1'}catch(_){return false}}
  function unlockVoiceV456(){
    voiceAwakeV423=true;
    try{sessionStorage.setItem('carplay_voice_unlocked_v456','1')}catch(_){}
    try{localStorage.setItem(KEY,'1')}catch(_){}
    try{document.cookie='carplay_voice_enabled=1; path=/; max-age=31536000; SameSite=Lax'}catch(_){}
    document.documentElement.classList.add('carplayVoiceEnabled');
  }
  function setEnabled(){
    unlockVoiceV456();
    syncSetting();
    try{window.dispatchEvent(new CustomEvent('carplay-voice-change',{detail:{enabled:true}}))}catch(_){}
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
    var city=clean(card.dataset.voiceCity||'');
    var name=clean(card.dataset.voiceName||'');
    if(!city){
      var n=card.querySelector('.name');
      if(n)city=clean(n.childNodes&&n.childNodes[0]?n.childNodes[0].textContent:n.textContent).replace(/\d+(?:[,.]\d+)?\s*km/i,'').trim();
    }
    if(!name){
      var metas=[].slice.call(card.querySelectorAll('.meta'));
      for(var i=0;i<metas.length;i++){
        var mt=clean(metas[i].textContent);
        if(mt&&!/^🕒|^👥|^Tirage|^Humeur|^Responsable|^Modèle/i.test(mt)){name=mt;break}
      }
    }
    var parts=[];
    if(city)parts.push('Le marché de '+city);
    else parts.push('Le marché');
    if(name&&clean(name).toLowerCase()!==clean(city).toLowerCase())parts.push(name);
    parts.push(marketCount(card));
    var time=marketTime(card);
    if(unknownTime(time))parts.push('horaire inconnu');
    else parts.push('horaire '+hourText(time));
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
    if(el.tagName==='SELECT'){
      var opt=el.options&&el.selectedIndex>=0?el.options[el.selectedIndex]:null;
      var txt=clean(opt&&opt.textContent||el.getAttribute('aria-label')||'Menu');
      return txt.replace(/\s*[—–-]\s*/g,', ').replace(/\bKM\b/gi,'kilomètres')+'.';
    }
    var txt=clean(el.innerText||el.textContent||'');
    if(!txt&&el.getAttribute)txt=clean(el.getAttribute('aria-label')||el.getAttribute('title')||el.getAttribute('data-voice-help')||'');
    if(!txt&&el.querySelector){
      var img=el.querySelector('img[alt]');
      if(img)txt=clean(img.getAttribute('alt')||'');
    }
    if(!txt&&el.classList&&el.classList.contains('gear'))txt='Réglages';
    txt=txt.replace(/[←→›⌄⚙️⚙]/g,' ').replace(/[•·]/g,', ').replace(/\bKM\b/gi,'kilomètres').replace(/\s+/g,' ').trim();
    if(!txt)return 'Bouton.';
    if(txt.length>160)txt=txt.slice(0,160);
    return txt+'.';
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
    if(!('speechSynthesis' in window)||typeof SpeechSynthesisUtterance==='undefined')return;
    try{
      window.speechSynthesis.resume();
      primeUtteranceV396=new SpeechSynthesisUtterance('\u00a0');
      primeUtteranceV396.lang='fr-FR';
      primeUtteranceV396.volume=0.01;
      primeUtteranceV396.rate=10;
      window.speechSynthesis.speak(primeUtteranceV396);
    }catch(_){}
  }
  function wakeSpeechV423(){
    if(voiceAwakeV423||!('speechSynthesis' in window)||typeof SpeechSynthesisUtterance==='undefined')return;
    try{
      window.speechSynthesis.resume();
      loadPreferredVoice();
      var u=new SpeechSynthesisUtterance('a');
      primeUtteranceV396=u;
      u.lang='fr-FR';u.volume=0.001;u.rate=10;u.pitch=1;
      if(preferredVoice)u.voice=preferredVoice;
      u.onstart=function(){voiceAwakeV423=true};
      u.onend=function(){primeUtteranceV396=null;voiceAwakeV423=true};
      u.onerror=function(){primeUtteranceV396=null;voiceAwakeV423=false};
      window.speechSynthesis.speak(u);
    }catch(_){voiceAwakeV423=false}
  }
  function resetSpeechV423(){
    voiceAwakeV423=false;
    preferredVoice=null;
    try{if(window.speechSynthesis){window.speechSynthesis.cancel();window.speechSynthesis.resume()}}catch(_){}
    loadPreferredVoice();
    syncSetting();
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
    if(!e.target||!e.target.closest)return null;
    var clickable=e.target.closest('button,a,select,input[type="button"],input[type="submit"],summary,[onclick],[role="button"],[data-voice-help],[data-voice-card],#homeAddressBookBtn,.addressBookTile,.card,.small,.settingHead,.market,.market-card,.marketCard,.station-card,.stationCard,.result-card,.resultCard,.tile,.directBtn,.homeTopButton');
    if(clickable&&!clickable.matches('input,textarea,label'))return clickable;
    var card=e.target.closest('[data-voice-card]');
    return card||null;
  }
  function cancel(){clearTimeout(timer);timer=0;active=null;fired=false}
  function fireLongPress(target){
    if(!target)return;
    fired=true;
    suppressClickTarget=target;
    suppressClickUntil=Date.now()+1800;
    try{navigator.vibrate&&navigator.vibrate(35)}catch(_){}
    var text=clean(buildSpeech(target));
    if(voiceUnlockedV456())speakImmediateV400(text);
    else showTapFallbackV400(text);
  }
  function begin(e){
    if(e&&e.pointerType==='touch')return;
    var card=eligibleTarget(e);if(!card)return;
    active=card;fired=false;startX=Number(e.clientX||0);startY=Number(e.clientY||0);clearTimeout(timer);
    timer=setTimeout(function(){if(active)fireLongPress(active)},PRESS_MS);
  }
  function move(e){if(!active)return;var dx=Math.abs(Number(e.clientX||0)-startX),dy=Math.abs(Number(e.clientY||0)-startY);if(dx>18||dy>18)cancel()}
  function end(){clearTimeout(timer);timer=0;active=null;setTimeout(function(){fired=false},80)}
  function showTapFallbackV400(text){
    text=clean(text);if(!text)return false;
    var old=document.getElementById('voiceTapFallbackV400');if(old)old.remove();
    var b=document.createElement('button');
    b.id='voiceTapFallbackV400';b.type='button';
    b.setAttribute('aria-label','Toucher pour écouter '+text);
    b.innerHTML='<span style="display:block;font-size:42px;line-height:1;margin-bottom:12px">🔊</span><span style="display:block;font-size:21px;line-height:1.15">TOUCHER POUR ÉCOUTER</span><span style="display:block;margin-top:12px;font-size:13px;line-height:1.25;color:#d8ecff">La voix sera ensuite prête pour les autres boutons.</span>';
    b.style.cssText='position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);z-index:2147483647;width:min(72vw,280px);height:min(72vw,280px);max-height:280px;min-height:230px;padding:22px 18px;border:4px solid #f39b19;border-radius:26px;background:#0b668d;color:#fff;font:950 19px Arial,sans-serif;text-align:center;box-shadow:0 16px 46px #000d;-webkit-touch-callout:none;-webkit-user-select:none;user-select:none;touch-action:manipulation;outline:none';
    var busy=false;
    function play(e){
      if(e){try{e.preventDefault()}catch(_){}try{e.stopPropagation()}catch(_){}try{e.stopImmediatePropagation&&e.stopImmediatePropagation()}catch(_){}}
      if(busy)return;busy=true;
      unlockVoiceV456();
      try{
        if(!('speechSynthesis' in window)||typeof SpeechSynthesisUtterance==='undefined')throw 0;
        window.speechSynthesis.cancel();window.speechSynthesis.resume();loadPreferredVoice();
        var u=new SpeechSynthesisUtterance(text);
        currentUtteranceV396=u;u.lang='fr-FR';u.rate=.92;u.pitch=1;u.volume=1;
        if(preferredVoice)u.voice=preferredVoice;
        u.onstart=function(){voiceAwakeV423=true;toast('🔊 '+text);if(b&&b.parentNode)b.remove()};
        u.onend=function(){currentUtteranceV396=null;if(b&&b.parentNode)b.remove()};
        u.onerror=function(){currentUtteranceV396=null;busy=false;toast('🔇 Touchez encore une fois pour écouter.')};
        window.speechSynthesis.speak(u);
      }catch(_){busy=false;toast('🔇 Lecture vocale indisponible.')}
    }
    b.addEventListener('click',play,true);
    b.addEventListener('touchend',play,{passive:false,capture:true});
    document.body.appendChild(b);
    return true;
  }
  function speakImmediateV400(text){
    text=clean(text);if(!text)return false;
    if(!voiceUnlockedV456()){showTapFallbackV400(text);return false}
    if(!('speechSynthesis' in window)||typeof SpeechSynthesisUtterance==='undefined'){showTapFallbackV400(text);return false}
    try{
      window.speechSynthesis.cancel();
      window.speechSynthesis.resume();
      loadPreferredVoice();
      var u=new SpeechSynthesisUtterance(text);
      currentUtteranceV396=u;
      u.lang='fr-FR';u.rate=.92;u.pitch=1;u.volume=1;
      if(preferredVoice)u.voice=preferredVoice;
      var started=false,finished=false;
      u.onstart=function(){started=true;voiceAwakeV423=true;toast('🔊 '+text)};
      u.onend=function(){finished=true;currentUtteranceV396=null};
      u.onerror=function(){finished=true;currentUtteranceV396=null;showTapFallbackV400(text)};
      window.speechSynthesis.speak(u);
      setTimeout(function(){
        if(!started&&!finished&&currentUtteranceV396===u){
          try{window.speechSynthesis.cancel()}catch(_){}
          currentUtteranceV396=null;
          showTapFallbackV400(text);
        }
      },700);
      return true;
    }catch(_){showTapFallbackV400(text);return false}
  }
  function prepareTouchSpeechV400(target){queuedTouchTextV400=target?clean(buildSpeech(target)):''}
  function cancelTouchSpeechV400(){queuedTouchTextV400=''}
  function resumeTouchSpeechV400(target){
    var text=queuedTouchTextV400||clean(buildSpeech(target));
    queuedTouchTextV400='';
    if(voiceUnlockedV456())return speakImmediateV400(text);
    return showTapFallbackV400(text);
  }
  function touchBeginV394(e){
    if(!e.target||!e.target.closest)return;
    var target=eligibleTarget(e);if(!target)return;
    var t=e.touches&&e.touches[0];if(!t)return;
    active=target;touchTargetV398=target;fired=false;touchReadyV395=false;touchActionDoneV456=false;
    touchStartedAtV395=Date.now();startX=t.clientX;startY=t.clientY;clearTimeout(timer);prepareTouchSpeechV400(target);
    timer=setTimeout(function(){
      if(!active)return;
      touchReadyV395=true;fired=true;touchActionDoneV456=true;
      suppressClickTarget=active;suppressClickUntil=Date.now()+2200;
      try{navigator.vibrate&&navigator.vibrate(35)}catch(_){}
      resumeTouchSpeechV400(active);
    },PRESS_MS);
  }
  function touchMoveV394(e){
    if(touchReadyV395)return;
    if(!active)return;
    var t=e.touches&&e.touches[0];
    if(!t){cancel();cancelTouchSpeechV400();touchTargetV398=null;touchReadyV395=false;touchActionDoneV456=false;touchStartedAtV395=0;return}
    var dx=Math.abs(t.clientX-startX),dy=Math.abs(t.clientY-startY);
    if(dx>28||dy>28){cancel();cancelTouchSpeechV400();touchTargetV398=null;touchReadyV395=false;touchActionDoneV456=false;touchStartedAtV395=0}
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
      fired=true;suppressClickTarget=target;suppressClickUntil=Date.now()+2200;
      blockLongPressReleaseV397(e);
      if(!touchActionDoneV456){touchActionDoneV456=true;resumeTouchSpeechV400(target)}
    }else cancelTouchSpeechV400();
    touchTargetV398=null;touchReadyV395=false;touchActionDoneV456=false;touchStartedAtV395=0;
    setTimeout(function(){fired=false},160);
  }
  function syncSetting(){
    document.documentElement.classList.add('carplayVoiceEnabled');
    var s=document.getElementById('voiceAssistStatus');
    if(s)s.textContent='🔊 Appui long 1,20 seconde sur un bouton pour écouter.';
  }
  function initSetting(){
    try{localStorage.setItem(KEY,'1')}catch(_){}
    try{document.cookie='carplay_voice_enabled=1; path=/; max-age=31536000; SameSite=Lax'}catch(_){}
    loadPreferredVoice();syncSetting();
  }
  installNoSelectV389();
  document.addEventListener('selectstart',function(e){if(e.target.closest&&e.target.closest('[data-voice-card],button,a,select,[onclick],[role="button"]'))e.preventDefault()},true);
  document.addEventListener('dragstart',function(e){if(e.target.closest&&e.target.closest('[data-voice-card],button,a,select,[onclick],[role="button"]'))e.preventDefault()},true);
  document.addEventListener('click',function(e){
    if(!e.target||e.target.tagName!=='SELECT')return;
    e.preventDefault();e.stopImmediatePropagation();
    openVoiceSelectV396(e.target);
  },true);
  document.addEventListener('change',function voiceSelectChangeV396(e){
    if(!e.target||e.target.tagName!=='SELECT')return;
    var opt=e.target.options&&e.target.selectedIndex>=0?e.target.options[e.target.selectedIndex]:null;
    var txt=clean(opt&&opt.textContent||'');
    if(txt)speak(txt.replace(/\s*[—–-]\s*/g,', '));
  },true);
  document.addEventListener('click',function(e){
    if(e.target&&e.target.closest&&e.target.closest('#voiceTapFallbackV400'))return;
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
  document.addEventListener('touchcancel',function(){cancel();cancelTouchSpeechV400();touchTargetV398=null;touchReadyV395=false;touchStartedAtV395=0;},{capture:true,passive:true});
  document.addEventListener('pointerdown',begin,true);document.addEventListener('pointermove',move,true);document.addEventListener('pointerup',end,true);document.addEventListener('pointercancel',cancel,true);
  document.addEventListener('contextmenu',function(e){if(e.target.closest&&e.target.closest('[data-voice-card],button,a,select,[onclick],[role="button"]'))e.preventDefault()},true);
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',initSetting);else initSetting();
  window.addEventListener('storage',syncSetting);if(window.speechSynthesis)window.speechSynthesis.addEventListener&&window.speechSynthesis.addEventListener('voiceschanged',loadPreferredVoice);
  window.addEventListener('pageshow',function(){resetSpeechV423()});
  document.addEventListener('visibilitychange',function(){if(!document.hidden)resetSpeechV423()});
  window.addEventListener('focus',function(){if(enabled())resetSpeechV423()});
  window.CouteauVoice={enabled:enabled,setEnabled:setEnabled,speak:speak,buildMarket:buildMarket,pressMs:PRESS_MS};
})();
