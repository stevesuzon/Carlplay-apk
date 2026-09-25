(function(){
'use strict';
if(window.__couteauVoiceV485Loaded)return;
window.__couteauVoiceV485Loaded=true;

var PRESS_MS=1200;
var SESSION_KEY='couteau_voice_active_v485';
var press=null;
var timer=0;
var suppressUntil=0;
var suppressTarget=null;
var currentUtterance=null;
var preferredVoice=null;
var pendingText='';

function clean(v){return String(v==null?'':v).replace(/\s+/g,' ').trim()}
function stripIcons(v){
  return clean(String(v==null?'':v)
    .replace(/[\p{Extended_Pictographic}\uFE0F\u200D]/gu,' ')
    .replace(/[\u2190-\u21FF\u2600-\u27BF\u2B00-\u2BFF]/g,' '));
}
function sessionActive(){try{return sessionStorage.getItem(SESSION_KEY)==='1'}catch(_){return false}}
function activateSession(){try{sessionStorage.setItem(SESSION_KEY,'1')}catch(_){}}

function loadVoice(){
  try{
    var vv=window.speechSynthesis&&window.speechSynthesis.getVoices?window.speechSynthesis.getVoices():[];
    preferredVoice=vv.find(function(v){return /^fr[-_]FR$/i.test(v.lang||'')&&/Thomas/i.test(v.name||'')})
      ||vv.find(function(v){return /^fr[-_]FR$/i.test(v.lang||'')})
      ||vv.find(function(v){return /^fr(?:-|_)/i.test(v.lang||'')})
      ||vv.find(function(v){return /français|french/i.test(v.name||'')})
      ||null;
  }catch(_){preferredVoice=null}
}

function speakNow(text){
  text=stripIcons(text);
  if(!text)return false;
  if(!('speechSynthesis' in window)||typeof SpeechSynthesisUtterance==='undefined')return false;
  try{
    window.speechSynthesis.cancel();
    window.speechSynthesis.resume();
    if(!preferredVoice)loadVoice();
    var u=new SpeechSynthesisUtterance(text);
    currentUtterance=u;
    u.lang='fr-FR';
    u.rate=1.08;
    u.pitch=1.08;
    u.volume=1;
    if(preferredVoice)u.voice=preferredVoice;
    u.onend=function(){if(currentUtterance===u)currentUtterance=null};
    u.onerror=function(){if(currentUtterance===u)currentUtterance=null};
    window.speechSynthesis.speak(u);
    return true;
  }catch(_){return false}
}

function activationSquare(text){
  pendingText=stripIcons(text);
  var old=document.getElementById('couteauVoiceActivateV485');
  if(old)old.remove();

  var box=document.createElement('button');
  box.id='couteauVoiceActivateV485';
  box.type='button';
  box.innerHTML='<span class="cvSpeaker">🔊</span><strong>ACTIVER LE SON</strong><small>TOUCHER UNE FOIS</small>';
  box.style.cssText='position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);z-index:2147483647;width:250px;height:250px;border:4px solid #f39b19;border-radius:28px;background:#0b668d;color:#fff;box-shadow:0 18px 52px #000d;font:950 22px Arial,sans-serif;text-align:center;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;touch-action:manipulation;-webkit-user-select:none;user-select:none';
  var speaker=box.querySelector('.cvSpeaker');
  if(speaker)speaker.style.cssText='font-size:52px;line-height:1';
  var small=box.querySelector('small');
  if(small)small.style.cssText='font-size:13px;font-weight:900';

  var done=false;
  function enable(e){
    if(done)return;
    done=true;
    try{e.preventDefault()}catch(_){}
    try{e.stopPropagation()}catch(_){}
    activateSession();
    if(box.parentNode)box.remove();
    var toSay=pendingText;
    pendingText='';
    // Le toucher sur le carré est le geste utilisateur qui déverrouille la voix iPhone.
    if(toSay)speakNow(toSay);
    else speakNow('Son activé');
  }
  box.addEventListener('touchend',enable,{capture:true,passive:false});
  box.addEventListener('click',enable,true);
  document.body.appendChild(box);
}

function hourText(v){
  return clean(v)
    .replace(/(\d{1,2})[:h.](\d{2})/g,function(_,h,m){return Number(m)?Number(h)+' heures '+Number(m):Number(h)+' heures'})
    .replace(/\b(\d{1,2})h\b/g,'$1 heures')
    .replace(/–|—/g,' à ');
}
function unknown(v){
  var s=clean(v).toLowerCase();
  return !s||/à vérifier|a verifier|à confirmer|a confirmer|non précisé|non precise|non publié|non publie|inconnu|indisponible/.test(s);
}
function pick(a){return a[Math.floor(Math.random()*a.length)]||''}

function marketTime(card){
  var shared=card.querySelector('.shared-time');
  if(shared)return clean(shared.textContent);
  var raw=clean(card.dataset.voiceHours||'');
  if(raw)return raw;
  var metas=[].slice.call(card.querySelectorAll('.meta'));
  for(var i=0;i<metas.length;i++){
    var t=clean(metas[i].textContent);
    if(/^🕒/.test(t))return clean(t.replace(/^🕒\s*/,''));
  }
  return '';
}
function marketCount(card){
  var label=clean(card.dataset.voiceCountLabel||'commerçants');
  var value=clean(card.dataset.voiceCount||'');
  if(!value){
    var n=card.querySelector('.shared-count');
    if(n)value=clean(n.textContent);
  }
  return unknown(value)?'nombre de '+label+' inconnu':'nombre de '+label+' : '+value;
}
function isOise(card){
  var d=card&&card.dataset||{};
  if(String(d.voiceDepartment||d.department||'').trim()==='60')return true;
  var key=clean(d.marketKey||'');
  if(/(^|[|:/_-])60([|:/_-]|$)/.test(key))return true;
  try{
    var q=new URLSearchParams(location.search||'');
    if(String(q.get('area')||q.get('department')||q.get('dept')||'').trim()==='60')return true;
  }catch(_){}
  return false;
}
function marketHumor(card){
  var city=clean(card.dataset.voiceCity||'').toLowerCase();
  var name=clean(card.dataset.voiceName||'').toLowerCase();

  if(isOise(card)){
    var oise=[
      "Attention, vous êtes sur un marché à Jonathan, le vaqueso du 60. S'il est déjà passé, il a peut-être pris tous les clients.",
      "Si Isaac est déjà passé sur ce marché, ça sert peut-être à rien de revenir trop tard, il a déjà pris les clients.",
      "Attention, Jonathan pourrait être passé avant vous. Le vaqueso du 60 aime bien arriver avant tout le monde.",
      "Isaac, le vaqueso du 60, connaît peut-être déjà ce marché. S'il est passé la semaine dernière, il a peut-être déjà pris tous les clients.",
      "Attention, ce marché pourrait avoir Jonathan et Isaac, les deux vaqueso du 60. S'ils sont passés avant vous, il va falloir chercher les clients qui restent.",
      "Jonathan et Isaac sur le même marché, les deux vaqueso du 60. Là, il vaut mieux arriver avant eux si vous voulez les clients."
    ];
    if(city.indexOf('senlis')>=0||name.indexOf('senlis')>=0){
      oise.push("Attention, vous êtes dans le quartier à Isaac. C'est un garçon qui n'est pas du genre à donner un bâton pour se faire battre. Mais si vous voulez y aller, alors");
    }
    return pick(oise);
  }

  return pick([
    "Celui-là, je le sens bien.",
    "Ce marché-là, je le sens pas du tout.",
    "Celui-là, il est pas mal.",
    "Ah celui-là, ça peut être une bonne surprise.",
    "Celui-là, il a l'air de valoir le détour.",
    "Celui-là, c'est pas le marché du siècle.",
    "Je connais un garçon qui a travaillé dessus.",
    "Celui-là, aujourd'hui, je lui donnerais sa chance.",
    "Celui-là, il peut faire une bonne matinée.",
    "Celui-là, faut voir ce que ça donne ce matin."
  ]);
}
function buildMarket(card){
  var city=clean(card.dataset.voiceCity||'');
  var name=clean(card.dataset.voiceName||'');
  var day=clean(card.dataset.voiceDay||'');
  var distance=clean(card.dataset.voiceDistance||'');
  if(!city){
    var cityNode=card.querySelector('.name,h2,h3');
    if(cityNode)city=clean(cityNode.textContent).replace(/\d+(?:[,.]\d+)?\s*km/i,'').trim();
  }
  if(!name){
    var meta=card.querySelector('.meta');
    if(meta)name=clean(meta.textContent);
  }

  var parts=[];
  if(name&&city&&name.toLowerCase()!==city.toLowerCase())parts.push(name+', '+city);
  else if(name)parts.push(name);
  else if(city)parts.push('Marché de '+city);
  else parts.push('Marché');

  parts.push(marketHumor(card));
  if(day)parts.push(day);
  if(distance)parts.push(distance);
  parts.push(marketCount(card));

  var time=marketTime(card);
  parts.push(unknown(time)?'horaire inconnu':'horaire '+hourText(time));
  return parts.filter(Boolean).join('. ')+'.';
}

function visibleControlText(el){
  if(!el)return '';
  if(el.tagName==='SELECT'){
    var o=el.options&&el.selectedIndex>=0?el.options[el.selectedIndex]:null;
    return stripIcons(o&&o.textContent||'');
  }
  var type=String(el.type||'').toLowerCase();
  if(type==='checkbox'||type==='radio'){
    var label=el.closest&&el.closest('label');
    if(!label&&el.id){
      try{label=document.querySelector('label[for="'+String(el.id).replace(/"/g,'\\\"')+'"]')}catch(_){}
    }
    return stripIcons(label&&(label.innerText||label.textContent)||'');
  }
  var text=stripIcons(el.innerText||el.textContent||'');
  if(!text&&el.value)text=stripIcons(el.value);
  return text;
}

function buildSpeech(target){
  if(!target)return '';
  if(target.matches&&target.matches('[data-voice-card="market"]'))return buildMarket(target);
  return visibleControlText(target);
}

function targetFromPoint(el){
  if(!el||!el.closest)return null;
  if(el.closest('#couteauVoiceActivateV485'))return null;

  var card=el.closest('[data-voice-card="market"]');
  var control=el.closest('button,a,select,summary,input[type="button"],input[type="submit"],input[type="checkbox"],input[type="radio"],[role="button"],[role="menuitem"],[role="option"],[onclick],[data-action],[data-target],.go,.open,.verify,.details,.register,.day,.dayBtn,.tab,.tile,.directBtn,.homeTopButton,.settingHead,.changeArea,.back');

  if(control&&(!card||control!==card))return control;
  if(card)return card;

  var readable=el.closest('[data-voice-read],#status,.status,.sectionTitle,.heading,.marketPeriodCount,.marketPeriodMain,.marketPeriodExtra,h1,h2,h3,.specialBadge,.specialDate,.specialTimer,.tradeStatus');
  if(readable)return readable;

  return null;
}

function stopEvent(e){
  try{if(e&&e.cancelable)e.preventDefault()}catch(_){}
  try{e&&e.stopPropagation()}catch(_){}
  try{e&&e.stopImmediatePropagation&&e.stopImmediatePropagation()}catch(_){}
}
function related(el){
  if(!suppressTarget||!el)return false;
  return el===suppressTarget||(suppressTarget.contains&&suppressTarget.contains(el))||(el.contains&&el.contains(suppressTarget));
}
function suppress(target){
  suppressTarget=target;
  suppressUntil=Date.now()+2600;
}
function clearPress(){
  clearTimeout(timer);
  timer=0;
  press=null;
}
function armLongPress(){
  if(!press)return;
  press.armed=true;
  try{navigator.vibrate&&navigator.vibrate(35)}catch(_){}
}
function completeLongPress(p,e){
  if(!p)return false;
  var elapsed=Date.now()-p.started;
  if(!p.armed&&elapsed<PRESS_MS)return false;
  var text=buildSpeech(p.target);
  if(!text)return false;
  suppress(p.target);
  stopEvent(e);
  if(sessionActive())speakNow(text);
  else activationSquare(text);
  return true;
}

function startTouch(e){
  if(press||!e.touches||e.touches.length!==1)return;
  var target=targetFromPoint(e.target);
  if(!target)return;
  var t=e.touches[0];
  press={target:target,type:'touch',x:Number(t.clientX||0),y:Number(t.clientY||0),started:Date.now(),armed:false};
  clearTimeout(timer);
  timer=setTimeout(armLongPress,PRESS_MS);
}
function moveTouch(e){
  if(!press||press.type!=='touch'||!e.touches||e.touches.length!==1)return;
  var t=e.touches[0];
  if(Math.abs(Number(t.clientX||0)-press.x)>45||Math.abs(Number(t.clientY||0)-press.y)>45)clearPress();
}
function endTouch(e){
  if(!press||press.type!=='touch'){
    if(Date.now()<suppressUntil&&related(e.target))stopEvent(e);
    return;
  }
  var p=press;
  clearTimeout(timer);timer=0;press=null;
  completeLongPress(p,e);
}

function startPointer(e){
  if(e.pointerType==='touch')return;
  if(e.button!=null&&e.button!==0)return;
  var target=targetFromPoint(e.target);
  if(!target)return;
  press={target:target,type:'pointer',id:e.pointerId,x:Number(e.clientX||0),y:Number(e.clientY||0),started:Date.now(),armed:false};
  clearTimeout(timer);
  timer=setTimeout(armLongPress,PRESS_MS);
}
function movePointer(e){
  if(!press||press.type!=='pointer'||press.id!==e.pointerId)return;
  if(Math.abs(Number(e.clientX||0)-press.x)>45||Math.abs(Number(e.clientY||0)-press.y)>45)clearPress();
}
function endPointer(e){
  if(!press||press.type!=='pointer'||press.id!==e.pointerId)return;
  var p=press;
  clearTimeout(timer);timer=0;press=null;
  completeLongPress(p,e);
}

document.addEventListener('touchstart',startTouch,{capture:true,passive:true});
document.addEventListener('touchmove',moveTouch,{capture:true,passive:true});
document.addEventListener('touchend',endTouch,{capture:true,passive:false});
document.addEventListener('touchcancel',clearPress,true);
document.addEventListener('pointerdown',startPointer,true);
document.addEventListener('pointermove',movePointer,true);
document.addEventListener('pointerup',endPointer,true);
document.addEventListener('pointercancel',clearPress,true);
document.addEventListener('click',function(e){
  if(e.target&&e.target.closest&&e.target.closest('#couteauVoiceActivateV485'))return;
  if(Date.now()<suppressUntil&&related(e.target)){stopEvent(e);return false}
},true);
document.addEventListener('contextmenu',function(e){
  if(targetFromPoint(e.target))stopEvent(e);
},true);

(function style(){
  var st=document.createElement('style');
  st.id='couteauVoiceStyleV485';
  st.textContent='button,button *,a,a *,select,select *,summary,summary *,[role="button"],[role="button"] *,[role="menuitem"],[role="menuitem"] *,[role="option"],[role="option"] *,[data-voice-card],[data-voice-card] *,#status,#status *,.status,.status *,.sectionTitle,.sectionTitle *,.heading,.heading *,h1,h1 *,h2,h2 *,h3,h3 *{-webkit-user-select:none!important;user-select:none!important;-webkit-touch-callout:none!important}[data-voice-card]{touch-action:pan-y pinch-zoom!important}button,a,[role="button"],#status,.status,.sectionTitle,.heading{touch-action:manipulation}'
  (document.head||document.documentElement).appendChild(st);
})();

loadVoice();
if(window.speechSynthesis&&window.speechSynthesis.addEventListener)window.speechSynthesis.addEventListener('voiceschanged',loadVoice);

window.CouteauVoice={
  enabled:sessionActive,
  setEnabled:function(v){if(v)activateSession();},
  speak:function(text){return sessionActive()?speakNow(text):false;},
  buildMarket:buildMarket,
  pressMs:PRESS_MS
};
})();
