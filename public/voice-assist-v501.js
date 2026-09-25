(function(){
'use strict';
if(window.__voiceClean501)return;window.__voiceClean501=1;
var PRESS=1200,armed=false,active=null,started=0,x=0,y=0,ready=false,fired=false,timer=0,block=null,blockUntil=0;
function clean(s){return String(s||'').replace(/\s+/g,' ').trim()}
function on(){try{return localStorage.getItem('carplay_voice_enabled_v387')!=='0'}catch(e){return true}}
function toast(msg){
 var id='voiceStatusV501',el=document.getElementById(id);
 if(!el){
   el=document.createElement('div');el.id=id;
   el.style.cssText='position:fixed;left:50%;bottom:24px;transform:translateX(-50%);z-index:2147483647;padding:12px 16px;border:2px solid #f39b19;border-radius:14px;background:#07111df2;color:#fff;font:900 15px Arial,sans-serif;text-align:center;max-width:88vw;pointer-events:none;box-shadow:0 8px 24px #0009';
   (document.body||document.documentElement).appendChild(el);
 }
 el.textContent=msg;el.style.display='block';clearTimeout(el._h);el._h=setTimeout(function(){el.style.display='none'},1600);
}
function setOn(v){try{localStorage.setItem('carplay_voice_enabled_v387',v===false?'0':'1')}catch(e){}return on()}
function say(t){
 t=clean(t);if(!t||!on()||!window.speechSynthesis||typeof SpeechSynthesisUtterance==='undefined')return false;
 try{speechSynthesis.cancel();var u=new SpeechSynthesisUtterance(t);u.lang='fr-FR';u.rate=.9;u.volume=1;speechSynthesis.speak(u);return true}catch(e){return false}
}
function arm(){
 if(armed||!on())return armed;
 armed=true;
 say('Son activé');
 toast('🔊 Son activé pour cette page');
 return true;
}
function target(n){
 if(!n||!n.closest)return null;
 return n.closest('[data-voice-card],[data-voice-read],[data-voice-help],button,a,select,input,summary,article,[onclick],[role="button"],[data-action],[data-target],.card,[class*="card"],.fiche,[class*="fiche"],.small,.market,.market-card,.marketCard,.station-card,.stationCard,.result-card,.resultCard,.go,.open,.verify,.details,.register,.day,.dayBtn,.tab,.tile,.directBtn,.homeTopButton,.settingHead,.changeArea,.back,#status,.status,.sectionTitle,.heading,.marketPeriodMain,.marketPeriodCount,.marketPeriodExtra,h1,h2,h3,.specialBadge,.specialDate,.specialTimer,.tradeStatus');
}
function pick(a){return a[Math.floor(Math.random()*a.length)]||''}
function oise(el){
 var d=el&&el.dataset||{};
 if(String(d.voiceDepartment||d.department||'').trim()==='60')return true;
 var k=clean(d.marketKey||'');
 if(/(^|[|:/_-])60([|:/_-]|$)/.test(k))return true;
 try{var q=new URLSearchParams(location.search||'');if(String(q.get('area')||q.get('department')||q.get('dept')||'').trim()==='60')return true}catch(e){}
 return false;
}
function humor(el,city,name){
 city=clean(city).toLowerCase();name=clean(name).toLowerCase();
 if(oise(el)){
   var a=[
    "Attention, vous êtes sur un marché à Jonathan, le vaqueso du 60. S'il est déjà passé, il a peut-être pris tous les clients.",
    "Si Isaac est déjà passé sur ce marché, ça sert peut-être à rien de revenir trop tard, il a déjà pris les clients.",
    "Attention, Jonathan pourrait être passé avant vous. Le vaqueso du 60 aime bien arriver avant tout le monde.",
    "Isaac, le vaqueso du 60, connaît peut-être déjà ce marché. S'il est passé la semaine dernière, il a peut-être déjà pris tous les clients.",
    "Attention, ce marché pourrait avoir Jonathan et Isaac, les deux vaqueso du 60. S'ils sont passés avant vous, il va falloir chercher les clients qui restent.",
    "Jonathan et Isaac sur le même marché, les deux vaqueso du 60. Là, il vaut mieux arriver avant eux si vous voulez les clients."
   ];
   if(city.indexOf('senlis')>=0||name.indexOf('senlis')>=0)a.push("Attention, vous êtes dans le quartier à Isaac. C'est un garçon qui n'est pas du genre à donner un bâton pour se faire battre. Mais si vous voulez y aller, alors.");
   return pick(a);
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
function market(el){
 var d=el.dataset||{},day=clean(d.voiceDay),city=clean(d.voiceCity),name=clean(d.voiceName),dist=clean(d.voiceDistance),count=clean(d.voiceCount),hours=clean(d.voiceHours);
 if(!city){var n=el.querySelector('.name');if(n)city=clean(n.textContent).replace(/\d+(?:[,.]\d+)?\s*km/i,'').trim()}
 if(!name){var ms=el.querySelectorAll('.meta');for(var i=0;i<ms.length;i++){var s=clean(ms[i].textContent);if(s&&!/^🕒|^👥|^Tirage|^Humeur|^Responsable|^Modèle/i.test(s)){name=s;break}}}
 if(!hours){var ts=el.querySelectorAll('.meta');for(var j=0;j<ts.length;j++){var q=clean(ts[j].textContent);if(/^🕒/.test(q)){hours=clean(q.replace(/^🕒\s*/,''));break}}}
 var generic=/^(?:marché|marche)(?:\s+hebdomadaire)?$/i.test(name),label='';
 if(city&&(!name||name.toLowerCase()===city.toLowerCase()||generic))label='Marché de '+city;else if(name&&city)label=name+', '+city;else label=name||city||'Marché';
 var p=[];if(day)p.push(day);p.push(label);p.push(humor(el,city,name));if(dist)p.push(dist);if(count)p.push('Commerçants : '+count);if(hours)p.push('Horaires : '+hours);return p.filter(Boolean).join('. ')+'.';
}
function text(el){
 if(!el)return '';
 if(el.dataset){if(el.dataset.voiceText)return clean(el.dataset.voiceText);if(el.dataset.voiceHelp)return clean(el.dataset.voiceHelp);if(el.dataset.voiceCard==='market')return market(el)}
 if(el.tagName==='SELECT'){var o=el.options&&el.selectedIndex>=0?el.options[el.selectedIndex]:null;return clean(o&&o.textContent||el.getAttribute('aria-label'))}
 var a=clean(el.getAttribute&&el.getAttribute('aria-label'));if(a)return a;
 var t=clean(el.getAttribute&&el.getAttribute('title'));if(t)return t;
 var z=clean(el.innerText||el.textContent||el.value);return z.length>700?z.slice(0,700):z;
}
function stop(e){try{if(e.cancelable)e.preventDefault()}catch(x){}try{e.stopPropagation();e.stopImmediatePropagation()}catch(x){}}
function suppress(el,ms){block=el;blockUntil=Date.now()+ms}
function blocked(n){return block&&Date.now()<blockUntil&&(n===block||(block.contains&&block.contains(n))||(n&&n.contains&&n.contains(block)))}
function reset(){clearTimeout(timer);timer=0;active=null;started=0;ready=false;fired=false}
function fireLong(el){
 if(!el||fired)return;
 fired=true;ready=true;
 suppress(el,2200);
 try{navigator.vibrate&&navigator.vibrate(35)}catch(e){}
 if(!armed){arm();return}
 var s=text(el);if(s)say(s);
}
function start(e){
 if(e.touches&&e.touches.length!==1){reset();return}
 var el=target(e.target);if(!el)return;var t=e.touches[0];
 // Réveiller le moteur vocal dans le geste iPhone, sans rien dire avant 1,20 s.
 try{if(window.speechSynthesis)window.speechSynthesis.resume()}catch(_){}
 active=el;started=Date.now();x=t.clientX;y=t.clientY;ready=false;fired=false;clearTimeout(timer);
 timer=setTimeout(function(){
   if(!active)return;
   // À 1,20 s, pendant que le doigt est encore posé : activation ou lecture.
   fireLong(active);
 },PRESS);
}
function move(e){
 if(!active||ready)return;var t=e.touches&&e.touches[0];if(!t){reset();return}
 if(Math.abs(t.clientX-x)>28||Math.abs(t.clientY-y)>28)reset();
}
function end(e){
 var el=active||target(e.target);
 var held=started?Date.now()-started:0;
 var wasFired=fired;
 var long=!!(el&&(wasFired||ready||held>=PRESS));
 if(long&&!wasFired)fireLong(el);
 clearTimeout(timer);timer=0;active=null;started=0;ready=false;fired=false;
 if(!el)return;
 if(long){
   // Le relâchement d'un appui long vocal est toujours bloqué : aucune navigation.
   suppress(el,2200);
   stop(e);
 }
}
function click(e){
 if(blocked(e.target)){
   stop(e);
   block=null;blockUntil=0;
   return;
 }
 // Un appui court garde son fonctionnement normal.
 // Seul l'appui long de 1,20 s est réservé à la voix.
}
function installLongPressProtection(){
 try{
   var st=document.createElement('style');
   st.id='voiceLongPressProtectionV501';
   st.textContent='button,a,[role="button"],[onclick],[data-action],[data-target],[data-voice-card],.card,[class*="card"],.fiche,[class*="fiche"],img{-webkit-touch-callout:none!important;-webkit-user-select:none!important;user-select:none!important} img{-webkit-user-drag:none!important}';
   (document.head||document.documentElement).appendChild(st);
 }catch(_){}
 try{document.querySelectorAll('img').forEach(function(img){img.draggable=false})}catch(_){}
}
installLongPressProtection();
document.addEventListener('dragstart',function(e){
 if((e.target&&e.target.tagName==='IMG')||target(e.target)){e.preventDefault();e.stopPropagation()}
},true);
document.addEventListener('selectstart',function(e){
 if(target(e.target)){e.preventDefault();e.stopPropagation()}
},true);
document.addEventListener('touchstart',start,{capture:true,passive:true});
document.addEventListener('touchmove',move,{capture:true,passive:true});
document.addEventListener('touchend',end,{capture:true,passive:false});
document.addEventListener('touchcancel',reset,{capture:true,passive:true});
document.addEventListener('click',click,true);
document.addEventListener('contextmenu',function(e){if(target(e.target))e.preventDefault()},true);
window.CouteauVoice={enabled:on,setEnabled:setOn,speak:function(t){return armed?say(t):false},pageArmed:function(){return armed},activatePage:arm,buildMarket:market,version:'V501'};
})();