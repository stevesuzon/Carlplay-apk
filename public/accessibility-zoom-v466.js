(function(){
  'use strict';
  if(window.CarPlayZoom)return;
  var KEY='carplay_display_zoom_v466';
  var SCALES={normal:1,large:1.18,extra:1.35};
  var LABELS={normal:'Taille normale',large:'Affichage agrandi',extra:'Affichage très agrandi'};
  var tracked=new Map(),applying=false,queued=0,observer=null;
  function current(){try{var mode=localStorage.getItem(KEY)||'normal';return Object.prototype.hasOwnProperty.call(SCALES,mode)?mode:'normal'}catch(_){return 'normal'}}
  function updateControls(mode){
    document.querySelectorAll('[data-carplay-zoom]').forEach(function(button){
      button.setAttribute('aria-pressed',button.getAttribute('data-carplay-zoom')===mode?'true':'false');
    });
    var status=document.getElementById('zoomSettingStatus'),message=LABELS[mode]+'. Tu peux aussi zoomer et dézoomer avec deux doigts.';
    if(status&&status.textContent!==message)status.textContent=message;
  }
  function carriesText(el){
    if(!el||!el.tagName||!el.style)return false;
    var tag=el.tagName.toUpperCase();
    if(/^(SCRIPT|STYLE|SVG|CANVAS|IMG|VIDEO|AUDIO|IFRAME|BR|HR)$/.test(tag))return false;
    if(/^(INPUT|TEXTAREA|SELECT)$/.test(tag))return true;
    for(var child=el.firstChild;child;child=child.nextSibling){
      if(child.nodeType===3&&child.nodeValue&&child.nodeValue.trim())return true;
    }
    return false;
  }
  function apply(mode){
    if(applying)return;
    applying=true;
    try{
      mode=Object.prototype.hasOwnProperty.call(SCALES,mode)?mode:current();
      // Le zoom de la page dépassait la largeur du téléphone. Seuls les caractères
      // grandissent désormais ; le navigateur recalcule la largeur des cartes.
      document.documentElement.style.zoom='';
      document.documentElement.setAttribute('data-carplay-zoom',mode);
      tracked.forEach(function(base,el){
        if(!el.isConnected){tracked.delete(el);return}
        el.style.fontSize=base.inline;
      });
      if(mode!=='normal'&&document.body){
        var nodes=document.body.querySelectorAll('*'),factor=SCALES[mode];
        for(var i=0;i<nodes.length;i++){
          var el=nodes[i];if(!carriesText(el)||tracked.has(el))continue;
          var baseSize=parseFloat(getComputedStyle(el).fontSize);
          if(isFinite(baseSize)&&baseSize>0)tracked.set(el,{inline:el.style.fontSize,px:baseSize});
        }
        tracked.forEach(function(base,el){
          if(el.isConnected)el.style.fontSize=(Math.round(base.px*factor*10)/10)+'px';
        });
      }
      updateControls(mode);
    }finally{applying=false}
  }
  function schedule(){if(current()==='normal'||queued)return;queued=setTimeout(function(){queued=0;apply(current())},180)}
  function ready(){
    apply(current());
    if(document.body&&typeof MutationObserver!=='undefined'){
      observer=new MutationObserver(function(){if(!applying)schedule()});
      observer.observe(document.body,{childList:true,subtree:true});
    }
  }
  var style=document.createElement('style');
  style.id='carplayAdaptiveZoomV468';
  style.textContent='html[data-carplay-zoom="large"] button,html[data-carplay-zoom="extra"] button,html[data-carplay-zoom="large"] a,html[data-carplay-zoom="extra"] a{white-space:normal;overflow-wrap:anywhere}';
  (document.head||document.documentElement).appendChild(style);
  window.CarPlayZoom={
    set:function(mode){
      if(!Object.prototype.hasOwnProperty.call(SCALES,mode))return;
      try{localStorage.setItem(KEY,mode)}catch(_){}
      apply(mode);
    },
    get:current
  };
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',ready,{once:true});else ready();
  window.addEventListener('storage',function(event){if(event.key===KEY)apply(current())});
})();
