(function(){
'use strict';
if(window.__carplayAccessibilityZoomV459)return;window.__carplayAccessibilityZoomV459=1;
var KEY='carplay_ui_zoom_level';
var LEVELS={normal:1,large:1.14,xlarge:1.28};
function current(){var k='normal';try{k=localStorage.getItem(KEY)||'normal'}catch(_){}return LEVELS[k]?k:'normal'}
function ensureViewport(){
  var m=document.querySelector('meta[name="viewport"]');
  if(!m){m=document.createElement('meta');m.name='viewport';document.head.appendChild(m)}
  var c=String(m.content||'width=device-width,initial-scale=1');
  var parts=c.split(',').map(function(x){return x.trim()}).filter(Boolean).filter(function(x){return !/^(maximum-scale|minimum-scale|user-scalable)\s*=/i.test(x)});
  if(!parts.some(function(x){return /^width\s*=/i.test(x)}))parts.unshift('width=device-width');
  if(!parts.some(function(x){return /^initial-scale\s*=/i.test(x)}))parts.push('initial-scale=1');
  parts.push('maximum-scale=5','user-scalable=yes');m.content=parts.join(',');
}
function apply(key){
  if(!LEVELS[key])key='normal';
  try{localStorage.setItem(KEY,key)}catch(_){}
  var scale=LEVELS[key];document.documentElement.style.zoom=String(scale);document.documentElement.setAttribute('data-ui-zoom',key);
  refreshButtons(key);
  try{window.dispatchEvent(new CustomEvent('carplay-ui-zoom-change',{detail:{level:key,scale:scale}}))}catch(_){}
}
function refreshButtons(key){document.querySelectorAll('[data-ui-zoom-choice]').forEach(function(b){var on=b.getAttribute('data-ui-zoom-choice')===key;b.setAttribute('aria-pressed',on?'true':'false');b.style.outline=on?'4px solid #ffb52b':'none';b.style.background=on?'#0b668d':'#1a2b3d'})}
function addSettings(){
  var settings=document.getElementById('settings');if(!settings||document.getElementById('uiZoomSettingRow'))return;
  var row=document.createElement('div');row.className='settingRow';row.id='uiZoomSettingRow';
  row.innerHTML='<button class="settingHead" type="button"><span>🔎 AGRANDIR L’ÉCRAN</span><span>⌄</span></button><div class="settingBody" id="uiZoomMenu"><div class="settingNote" style="padding:12px 14px">Choisissez un niveau. Il reste identique sur toutes les pages et la mise en page s’adapte à l’écran.</div><div style="display:grid;grid-template-columns:1fr;gap:9px;padding:0 14px 14px"><button type="button" data-ui-zoom-choice="normal">NORMAL</button><button type="button" data-ui-zoom-choice="large">AGRANDI</button><button type="button" data-ui-zoom-choice="xlarge">TRÈS AGRANDI</button></div><div class="settingNote" style="padding:0 14px 14px">Le zoom à deux doigts reste disponible en plus.</div></div>';
  var notif=document.getElementById('notificationMenu'),anchor=notif&&notif.closest?notif.closest('.settingRow'):document.getElementById('adminSettingRow');
  settings.insertBefore(row,anchor||settings.querySelector('.closeSettings')||null);
  var head=row.querySelector('.settingHead'),body=row.querySelector('.settingBody');head.addEventListener('click',function(){body.classList.toggle('open')});
  row.querySelectorAll('[data-ui-zoom-choice]').forEach(function(b){b.addEventListener('click',function(e){e.preventDefault();apply(b.getAttribute('data-ui-zoom-choice'))})});
  refreshButtons(current());
}
ensureViewport();
var st=document.createElement('style');st.id='carplayPinchZoomV459';st.textContent='html,body{touch-action:pan-x pan-y pinch-zoom}.carplayVoiceEnabled [data-voice-card]{touch-action:pan-y pinch-zoom!important}';(document.head||document.documentElement).appendChild(st);
function init(){ensureViewport();apply(current());addSettings()}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
window.addEventListener('pageshow',function(){apply(current())});window.addEventListener('storage',function(e){if(!e||e.key===KEY)apply(current())});
window.CouteauAccessibilityZoom={apply:apply,current:current,levels:LEVELS};
})();
