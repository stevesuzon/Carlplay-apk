(function(){
'use strict';
if(window.__carplayVoiceV477Loaded)return;
window.__carplayVoiceV477Loaded=true;

var PRESS_MS=1200;
var SESSION_KEY='carplay_voice_prompt_confirmed_v477';
var press=null,timer=0,suppressUntil=0,suppressTarget=null,currentUtterance=null,preferredVoice=null;
var hlmCache={};

function clean(v){return String(v==null?'':v).replace(/\s+/g,' ').trim()}
function spoken(v){return clean(String(v==null?'':v).replace(/[\p{Extended_Pictographic}\uFE0F\u200D]/gu,' '))}
function confirmed(){try{return sessionStorage.getItem(SESSION_KEY)==='1'}catch(_){return false}}
function confirmSession(){try{sessionStorage.setItem(SESSION_KEY,'1')}catch(_){}}
function toast(msg){
  var el=document.getElementById('carplayVoiceToastV477');
  if(!el){el=document.createElement('div');el.id='carplayVoiceToastV477';el.style.cssText='position:fixed;left:50%;bottom:22px;transform:translateX(-50%);z-index:2147483646;max-width:88vw;padding:11px 15px;border-radius:14px;background:#07111df2;border:2px solid #f39b19;color:#fff;font:900 14px Arial,sans-serif;text-align:center;box-shadow:0 8px 24px #0009;pointer-events:none';document.body.appendChild(el)}
  el.textContent=msg;el.style.display='block';clearTimeout(el._hide);el._hide=setTimeout(function(){el.style.display='none'},1700);
}
function loadVoice(){
  try{
    var vv=window.speechSynthesis&&window.speechSynthesis.getVoices?window.speechSynthesis.getVoices():[];
    preferredVoice=vv.find(function(v){return /^fr[-_]FR$/i.test(v.lang||'')&&/Thomas/i.test(v.name||'')})
      ||vv.find(function(v){return /^fr[-_]FR$/i.test(v.lang||'')&&/Thierry|Nicolas|Alexandre|Male/i.test(v.name||'')})
      ||vv.find(function(v){return /^fr[-_]FR$/i.test(v.lang||'')})
      ||vv.find(function(v){return /^fr(?:-|_)/i.test(v.lang||'')})
      ||vv.find(function(v){return /français|french/i.test(v.name||'')})||null;
  }catch(_){preferredVoice=null}
}
function speakNow(text){
  text=spoken(text);if(!text)return false;
  if(!('speechSynthesis' in window)||typeof SpeechSynthesisUtterance==='undefined'){toast('🔇 Lecture vocale indisponible.');return false}
  try{
    window.speechSynthesis.resume();
    if(!preferredVoice)loadVoice();
    var u=new SpeechSynthesisUtterance(text);
    currentUtterance=u;u.lang='fr-FR';u.rate=1.10;u.pitch=1.12;u.volume=1;
    if(preferredVoice)u.voice=preferredVoice;
    u.onstart=function(){toast('🔊 '+text)};
    u.onend=function(){if(currentUtterance===u)currentUtterance=null};
    u.onerror=function(){if(currentUtterance===u)currentUtterance=null;toast('🔇 Refais un appui long.')};
    window.speechSynthesis.speak(u);
    return true;
  }catch(_){toast('🔇 Refais un appui long.');return false}
}
function showFirstPrompt(text){
  var old=document.getElementById('voicePromptV477');if(old)old.remove();
  var b=document.createElement('button');b.id='voicePromptV477';b.type='button';
  b.innerHTML='<span style="display:block;font-size:42px;margin-bottom:10px">🔊</span><span style="display:block;font-size:21px">TOUCHER POUR ÉCOUTER</span><span style="display:block;margin-top:10px;font-size:13px">Une seule fois après ouverture de l’application.</span>';
  b.style.cssText='position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);z-index:2147483647;width:min(74vw,290px);min-height:230px;padding:22px 18px;border:4px solid #f39b19;border-radius:26px;background:#0b668d;color:#fff;font:950 19px Arial,sans-serif;text-align:center;box-shadow:0 16px 46px #000d;touch-action:manipulation;-webkit-user-select:none;user-select:none';
  var done=false;
  function play(e){
    if(done)return;done=true;
    try{e&&e.preventDefault()}catch(_){}try{e&&e.stopPropagation()}catch(_){}
    confirmSession();if(b.parentNode)b.remove();speakNow(text);
  }
  b.addEventListener('click',play,true);
  b.addEventListener('touchend',play,{capture:true,passive:false});
  document.body.appendChild(b);
}
function say(text){text=spoken(text);if(!text)return;if(confirmed())speakNow(text);else showFirstPrompt(text)}

function hourText(s){return clean(s).replace(/(\d{1,2})[:h.](\d{2})/g,function(_,h,m){return Number(m)?Number(h)+' heures '+Number(m):Number(h)+' heures'}).replace(/\b(\d{1,2})h\b/g,'$1 heures').replace(/–|—/g,' à ')}
function unknown(s){s=clean(s).toLowerCase();return !s||/à vérifier|a verifier|à confirmer|a confirmer|non précisé|non precise|non publié|non publie|inconnu|indisponible/.test(s)}
function marketTime(card){
  var n=card.querySelector('.shared-time');if(n)return clean(n.textContent);
  var raw=clean(card.dataset.voiceHours||'');if(raw)return raw;
  var metas=[].slice.call(card.querySelectorAll('.meta'));
  for(var i=0;i<metas.length;i++){var t=clean(metas[i].textContent);if(/^🕒/.test(t))return clean(t.replace(/^🕒\s*/,''))}
  return '';
}
function marketCount(card){
  var label=clean(card.dataset.voiceCountLabel||'commerçants'),value=clean(card.dataset.voiceCount||'');
  if(!value){var sc=card.querySelector('.shared-count');if(sc)value=clean(sc.textContent)}
  if(unknown(value))return 'nombre de '+label+' inconnu';
  return 'nombre de '+label+' : '+value;
}
function marketDistance(card){
  var raw=clean((card.dataset&&card.dataset.voiceDistance)||'');
  var m=raw.match(/(\d+(?:[,.]\d+)?)\s*km/i);
  if(!m){m=clean(card.innerText||card.textContent||'').match(/(\d+(?:[,.]\d+)?)\s*km\b/i)}
  return m?Number(m[1].replace(',','.')):NaN;
}
function isFiveNearest(card){
  var cards=[].slice.call(document.querySelectorAll('[data-voice-card="market"]'));
  var ranked=cards.map(function(c){return{card:c,km:marketDistance(c)}}).filter(function(x){return Number.isFinite(x.km)}).sort(function(a,b){return a.km-b.km});
  return ranked.slice(0,5).some(function(x){return x.card===card});
}
function pick(a){return a[Math.floor(Math.random()*a.length)]||''}
function nearbyComment(card){
  if(!isFiveNearest(card))return '';
  var km=marketDistance(card);if(!Number.isFinite(km))return '';
  if(km<=8)return pick(["Celui-là est juste à côté, pratique si tu veux partir tranquille.","Pas besoin de faire chauffer le moteur longtemps pour celui-là.","Si tu veux rester vraiment près, celui-là fait l'affaire."]);
  if(km<=15)return pick(["Bon choix si tu veux pas aller loin.","Celui-là est encore tout près, tu peux partir tranquille.","Pratique si tu veux économiser les kilomètres."]);
  if(km<=27)return pick(["Marché de dépannage si tu te lèves tard.","Si tu pars un peu tard, celui-là peut te sauver la matinée.","Pas trop loin, pratique pour un départ de dernière minute."]);
  if(km<=35)return pick(["Bon marché si tu veux pas aller loin.","Une trentaine de kilomètres, ça reste raisonnable.","Celui-là, pas besoin de partir à l'aube."]);
  if(km<=50)return pick(["Celui-là reste dans les plus proches, ça se tente.","Un peu de route, mais ça reste raisonnable.","Celui-là peut faire l'affaire si tu veux éviter un grand trajet."]);
  return pick(["C'est quand même un des cinq plus proches aujourd'hui.","Celui-là est dans les plus proches, même s'il faut rouler un peu.","Pas le plus près du monde, mais il reste dans ton top cinq."]);
}
function marketJoke(card){
  if(card&&card.dataset&&card.dataset.nearHlmV473==='1')return "Ah celui-là, c'est un bon marché à matelas !";
  var near=nearbyComment(card);if(near)return near;
  return pick(["Celui-là, je le sens bien.","Ce marché-là, je le sens pas du tout.","Celui-là, il est pas mal.","Celui-là, aujourd'hui, je le sens moyen.","Ah celui-là, ça peut être une bonne surprise.","Celui-là, il a l'air de valoir le détour.","Celui-là, c'est pas le marché du siècle.","Sur celui-là, je connais des gars qui ont travaillé dessus.","Celui-là, je sais pas pourquoi, mais il me plaît bien.","Ce marché-là, je le sens pas, mais alors pas du tout.","Celui-là, il pourrait bien faire l'affaire."]);
}
function buildMarket(card){
  var city=clean(card.dataset.voiceCity||''),name=clean(card.dataset.voiceName||''),day=clean(card.dataset.voiceDay||''),dist=clean(card.dataset.voiceDistance||'');
  if(!city){var n=card.querySelector('.name,h2');if(n)city=clean(n.childNodes&&n.childNodes[0]?n.childNodes[0].textContent:n.textContent).replace(/\d+(?:[,.]\d+)?\s*km/i,'').trim()}
  var parts=[];
  if(city)parts.push('Le marché de '+city);else parts.push('Le marché');
  if(name&&name.toLowerCase()!==city.toLowerCase())parts.push(name);
  parts.push(marketJoke(card));
  if(day)parts.push(day);
  if(dist)parts.push('à '+dist);
  parts.push(marketCount(card));
  var time=marketTime(card);parts.push(unknown(time)?'horaire inconnu':'horaire '+hourText(time));
  return parts.filter(Boolean).join('. ')+'.';
}
function buttonSpeech(el){
  if(!el)return '';
  if(el.tagName==='SELECT'){
    var o=el.options&&el.selectedIndex>=0?el.options[el.selectedIndex]:null;
    return spoken(o&&o.textContent||el.getAttribute('aria-label')||'Menu')+'.';
  }
  var t=spoken(el.getAttribute&&el.getAttribute('aria-label')||'')||spoken(el.innerText||el.textContent||'')||spoken(el.getAttribute&&el.getAttribute('title')||'');
  t=t.replace(/\bKM\b/gi,'kilomètres');if(t.length>190)t=t.slice(0,190);return t?t+'.':'';
}
function buildSpeech(target){
  if(!target)return '';
  if(target.dataset&&target.dataset.voiceCard==='market')return buildMarket(target);
  if(target.dataset&&target.dataset.voiceText)return spoken(target.dataset.voiceText);
  return buttonSpeech(target);
}
function targetFromEvent(e){
  var el=e&&e.target;if(!el||!el.closest)return null;
  if(el.closest('#voicePromptV477'))return null;
  var card=el.closest('[data-voice-card]');
  var ctl=el.closest('button,a,select,summary,input[type="button"],input[type="submit"],[onclick],[role="button"]');
  if(ctl&&(!card||ctl!==card))return ctl;
  if(card)return card;
  return el.closest('.card,.market,.market-card,.marketCard,.station-card,.stationCard,.result-card,.resultCard,.tile,.directBtn,.homeTopButton,.settingHead');
}
function stopEvent(e){
  try{if(e&&e.cancelable)e.preventDefault()}catch(_){}
  try{e&&e.stopPropagation()}catch(_){}
  try{e&&e.stopImmediatePropagation&&e.stopImmediatePropagation()}catch(_){}
}
function relatedToSuppressed(el){
  if(!suppressTarget||!el)return false;
  return el===suppressTarget||(suppressTarget.contains&&suppressTarget.contains(el))||(el.contains&&el.contains(suppressTarget));
}
function setSuppress(target){suppressTarget=target;suppressUntil=Date.now()+1100}
function clearPress(){clearTimeout(timer);timer=0;press=null}
function startPress(e){
  if(e.button!=null&&e.button!==0)return;
  if(e.isPrimary===false)return;
  var target=targetFromEvent(e);if(!target)return;
  if(e.pointerType==='touch'&&e.width>80&&e.height>80)return;
  try{window.speechSynthesis&&window.speechSynthesis.resume()}catch(_){}
  press={target:target,id:e.pointerId,start:Date.now(),x:Number(e.clientX||0),y:Number(e.clientY||0),long:false,pointerType:e.pointerType||'mouse'};
  prefetchHlm(target);
  clearTimeout(timer);
  timer=setTimeout(function(){
    if(!press)return;
    press.long=true;setSuppress(press.target);
    try{navigator.vibrate&&navigator.vibrate(35)}catch(_){}
  },PRESS_MS);
}
function movePress(e){
  if(!press||e.pointerId!==press.id||press.long)return;
  if(Math.abs(Number(e.clientX||0)-press.x)>30||Math.abs(Number(e.clientY||0)-press.y)>30)clearPress();
}
function finishPress(e){
  if(!press||e.pointerId!==press.id)return;
  var p=press,isLong=p.long||(Date.now()-p.start>=PRESS_MS);
  clearTimeout(timer);timer=0;press=null;
  if(!isLong)return;
  setSuppress(p.target);stopEvent(e);
  say(buildSpeech(p.target));
}
function cancelPress(e){if(press&&(!e||e.pointerId==null||e.pointerId===press.id))clearPress()}

function cardCoords(card){
  if(!card)return null;
  function num(v){var n=Number(String(v==null?'':v).replace(',','.').trim());return Number.isFinite(n)?n:null}
  var d=card.dataset||{},lat=num(d.lat||d.latitude||d.voiceLat||d.marketLat),lon=num(d.lon||d.lng||d.long||d.longitude||d.voiceLon||d.marketLon);
  if(lat!==null&&lon!==null&&Math.abs(lat)<=90&&Math.abs(lon)<=180)return{lat:lat,lon:lon};
  var nodes=[card].concat([].slice.call(card.querySelectorAll('a,button,[href],[onclick],[data-lat],[data-lon],[data-lng]')).slice(0,12));
  for(var i=0;i<nodes.length;i++){
    var n=nodes[i],nd=n.dataset||{};lat=num(nd.lat||nd.latitude);lon=num(nd.lon||nd.lng||nd.long||nd.longitude);
    if(lat!==null&&lon!==null&&Math.abs(lat)<=90&&Math.abs(lon)<=180)return{lat:lat,lon:lon};
    var raw='';try{raw=decodeURIComponent([n.getAttribute('href')||'',n.getAttribute('onclick')||''].join(' '))}catch(_){}
    var m=raw.match(/(-?\d{1,2}\.\d{4,})\s*[,; ]\s*(-?\d{1,3}\.\d{4,})/);
    if(m){lat=Number(m[1]);lon=Number(m[2]);if(Math.abs(lat)<=90&&Math.abs(lon)<=180)return{lat:lat,lon:lon}}
  }
  return null;
}
function prefetchHlm(target){
  var card=target&&target.closest?target.closest('[data-voice-card="market"]'):null;if(!card||!card.dataset)return;
  if(card.dataset.nearHlmV473==='1'||card.dataset.nearHlmV473==='0'||card.dataset.nearHlmV473==='pending')return;
  var c=cardCoords(card);if(!c)return;
  var key=c.lat.toFixed(4)+','+c.lon.toFixed(4);
  if(hlmCache[key]!==undefined){card.dataset.nearHlmV473=hlmCache[key]?'1':'0';return}
  card.dataset.nearHlmV473='pending';
  fetch('/api/near-hlm?lat='+encodeURIComponent(c.lat)+'&lon='+encodeURIComponent(c.lon),{cache:'force-cache'})
    .then(function(r){return r.ok?r.json():{near:false}})
    .then(function(d){var v=!!(d&&d.near);hlmCache[key]=v;card.dataset.nearHlmV473=v?'1':'0'})
    .catch(function(){card.dataset.nearHlmV473='0'});
}

document.addEventListener('pointerdown',startPress,true);
document.addEventListener('pointermove',movePress,true);
document.addEventListener('pointerup',finishPress,true);
document.addEventListener('pointercancel',cancelPress,true);
document.addEventListener('touchend',function(e){if(Date.now()<suppressUntil&&relatedToSuppressed(e.target))stopEvent(e)},{capture:true,passive:false});
document.addEventListener('click',function(e){
  if(e.target&&e.target.closest&&e.target.closest('#voicePromptV477'))return;
  if(Date.now()<suppressUntil&&relatedToSuppressed(e.target)){stopEvent(e);suppressUntil=0;return false}
},true);
document.addEventListener('auxclick',function(e){if(Date.now()<suppressUntil&&relatedToSuppressed(e.target))stopEvent(e)},true);
document.addEventListener('submit',function(e){
  if(Date.now()<suppressUntil&&suppressTarget){
    var form=e.target;if(form&&form.contains&&form.contains(suppressTarget))stopEvent(e);
  }
},true);
document.addEventListener('contextmenu',function(e){var t=targetFromEvent(e);if(t)stopEvent(e)},true);
document.addEventListener('selectstart',function(e){if(targetFromEvent(e))e.preventDefault()},true);
document.addEventListener('dragstart',function(e){if(targetFromEvent(e))e.preventDefault()},true);

loadVoice();
if(window.speechSynthesis&&window.speechSynthesis.addEventListener)window.speechSynthesis.addEventListener('voiceschanged',loadVoice);
window.CouteauVoice={enabled:function(){return true},setEnabled:function(){},speak:say,buildMarket:buildMarket,pressMs:PRESS_MS};
})();