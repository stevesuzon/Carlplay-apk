(function(){
  'use strict';
  if(window.CarPlayZoom)return;
  var KEY='carplay_display_zoom_v466';
  var SCALES={normal:1,large:1.18,extra:1.35};
  var LABELS={normal:'Taille normale',large:'Affichage agrandi',extra:'Affichage très agrandi'};
  function current(){try{var mode=localStorage.getItem(KEY)||'normal';return Object.prototype.hasOwnProperty.call(SCALES,mode)?mode:'normal'}catch(_){return 'normal'}}
  function updateControls(mode){
    document.querySelectorAll('[data-carplay-zoom]').forEach(function(button){
      button.setAttribute('aria-pressed',button.getAttribute('data-carplay-zoom')===mode?'true':'false');
    });
    var status=document.getElementById('zoomSettingStatus');
    if(status)status.textContent=LABELS[mode]+'. Tu peux aussi zoomer et dézoomer avec deux doigts.';
  }
  function apply(mode){
    mode=Object.prototype.hasOwnProperty.call(SCALES,mode)?mode:current();
    document.documentElement.style.zoom=String(SCALES[mode]);
    updateControls(mode);
  }
  window.CarPlayZoom={
    set:function(mode){
      if(!Object.prototype.hasOwnProperty.call(SCALES,mode))return;
      try{localStorage.setItem(KEY,mode)}catch(_){}
      apply(mode);
    },
    get:current
  };
  apply(current());
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',function(){apply(current())},{once:true});
  window.addEventListener('storage',function(event){if(event.key===KEY)apply(current())});
})();
