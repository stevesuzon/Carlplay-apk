(() => {
  'use strict';
  const camera=document.getElementById('walkCamera'),video=camera.querySelector('video'),layer=document.getElementById('walkFunLayer'),toggle=document.getElementById('toggleWalkFun'),status=document.getElementById('walkFunStatus');
  const checkbox=document.getElementById('enableWalkFun');
  let enabled=false,model=null,loading=null,running=false,timer=null,epoch=0,tracks=[],nextId=0;
  try{enabled=localStorage.getItem('gps-walk-fun')==='on';}catch{}
  const props=[['🐷','Tirelire'],['🛏️','Matelas'],['🛏️','Matelas + sommier'],['🪑','Chaise ancienne'],['🛋️','Canapé'],['🪞','Miroir ancien'],['🕰️','Pendule'],['🏺','Vase'],['🖼️','Tableau'],['🧰','Coffre ancien'],['🪑','Table + chaises'],['🛋️','Fauteuil'],['💡','Lampe vintage'],['🗄️','Commode'],['🏠','Refaire la toiture'],['🪑','Rempailler une chaise'],['🛏️','Matelas neuf'],['🪑','Meubles'],['🌳','Couper les arbres chez elle'],['🌿','Tailler la haie'],['🧹','Débarrasser le grenier'],['📦','Vider la cave'],['🎨','Refaire la peinture'],['🪟','Changer les fenêtres'],['🧱','Réparer le muret'],['🪵','Bois de chauffage'],['🛋️','Retapisser le fauteuil'],['🪑','Restaurer une table'],['🚿','Refaire la salle de bain'],['🏡','Nettoyer la terrasse'],['🧰','Petits travaux'],['🪴','Entretenir le jardin'],['👜','Sacoche']];
  const quips=['Chine-le quand même, on ne sait jamais !','Les enfants à la maison.','Il fait le riche, mais il n’a pas 10 francs.','Celui-là, c’est un ermite.','Mange-merde.','Chinez celle-là, je la sens bonne !','Chine ! Celui-là, je le sens bien !','Il y a peut-être un trésor au grenier !','Une belle affaire en vue !','Un petit tour à la brocante ?','Ça sent la trouvaille !','Une chaise à sauver, une affaire à faire !','Le grenier réserve des surprises !'];
  let combinations=[];try{const saved=JSON.parse(localStorage.getItem('gps-fun-combinations')||'[]');if(Array.isArray(saved))combinations=saved.filter(v=>typeof v==='string').slice(-1000);}catch{}
  function surprise(){
    const used=new Set(combinations);let choice,price,key,attempt=0;
    do{choice=Math.floor(Math.random()*props.length);price=(4+Math.floor(Math.random()*497))*5;key=choice+':'+price;if(++attempt>50){let n=0;while(used.has((n%props.length)+':'+((4+Math.floor(n/props.length))*5)))n++;choice=n%props.length;price=(4+Math.floor(n/props.length))*5;key=choice+':'+price;break;}}while(used.has(key));
    combinations.push(key);combinations=combinations.slice(-1000);try{localStorage.setItem('gps-fun-combinations',JSON.stringify(combinations));}catch{}
    return {choice,price,prop:props[choice],quip:Math.random()<.4?quips[Math.floor(Math.random()*quips.length)]:null,tutelle:Math.random()<.15};
  }

  function source(){return window.couteauWalkAR?.getFrame()||(!video.paused&&video.readyState>=2&&video.srcObject?video:null);}
  function active(){return enabled&&!camera.hidden&&!document.hidden&&!!source();}
  function clear(){epoch++;clearTimeout(timer);timer=null;tracks=[];layer.replaceChildren();}
  function script(src){return new Promise((resolve,reject)=>{const s=document.createElement('script');s.src=src;const timeout=setTimeout(()=>{s.remove();reject(Error('Chargement trop long'));},30000);s.onload=()=>{clearTimeout(timeout);resolve();};s.onerror=()=>{clearTimeout(timeout);s.remove();reject(Error('Effets indisponibles'));};document.head.appendChild(s);});}
  async function load(){
    if(model)return model;if(loading)return loading;
    loading=(async()=>{if(!window.tf)await script('https://cdn.jsdelivr.net/npm/@tensorflow/tfjs@4.22.0/dist/tf.min.js');if(!window.cocoSsd)await script('https://cdn.jsdelivr.net/npm/@tensorflow-models/coco-ssd@2.2.3/dist/coco-ssd.min.js');await window.tf.ready();model=await window.cocoSsd.load({base:'lite_mobilenet_v2'});return model;})();
    try{return await loading;}finally{loading=null;}
  }
  function update(predictions,input){
    const rect=camera.getBoundingClientRect(),width=input.videoWidth||input.width,height=input.videoHeight||input.height,scale=Math.max(rect.width/width,rect.height/height),ox=(rect.width-width*scale)/2,oy=(rect.height-height*scale)/2;
    const boxes=predictions.filter(p=>p.class==='person'&&p.score>=.65&&p.bbox?.length===4&&p.bbox.every(Number.isFinite)).sort((a,b)=>b.score-a.score).slice(0,4);
    const used=new Set(),fresh=[];
    for(const p of boxes){
      const [x,y,w,h]=p.bbox;if(w<15||h<35)continue;
      const cx=x+w/2,cy=y+h/2;
      let best=null,dist=Infinity;
      for(const t of tracks){const d=Math.hypot(cx-t.cx,cy-t.cy);if(!used.has(t.id)&&d<Math.max(w,h)*.5&&d<dist){best=t;dist=d;}}
      if(!best){
        const id=nextId++,gift=surprise(),el=document.createElement('div');el.className='walk-fun-prop';
        el.innerHTML='<span class="fun-object" aria-hidden="true">'+gift.prop[0]+'</span><strong class="fun-price"><small>Trésorerie</small>👜 '+gift.price.toLocaleString('fr-FR')+' €</strong><span class="fun-name">Besoin : '+gift.prop[1]+'</span>'+(gift.tutelle?'<span class="fun-tutelle">✕ Sous tutelle</span>':'')+(gift.quip?'<span class="fun-quip">'+gift.quip+'</span>':'');
        if(gift.choice===0)el.classList.add('fun-pig');layer.appendChild(el);best={id,el};
      }
      used.add(best.id);best.cx=cx;best.cy=cy;
      const px=cx*scale+ox,py=y*scale+oy-Math.max(32,Math.min(64,h*scale*.08)),hud=camera.querySelector('.walk-hud').getBoundingClientRect();
      // Anchor the entire badge above the head; never push it down onto the face.
      const top=Math.max(8,hud.bottom-rect.top+8),bottom=rect.height-190;
      best.el.classList.toggle('fun-compact',py-150<top);
      best.el.hidden=px<0||px>rect.width||py>bottom||py<top+40;
      const halfWidth=(best.el.offsetWidth||190)/2+8;
      best.el.style.left=Math.max(halfWidth,Math.min(rect.width-halfWidth,px))+'px';
      best.el.style.top=Math.min(bottom,py)+'px';fresh.push(best);
    }
    for(const t of tracks)if(!used.has(t.id))t.el.remove();tracks=fresh;
  }
  async function tick(){
    if(running||!active())return;running=true;const run=epoch;const started=performance.now();
    try{
      if(!model)status.textContent='Chargement des effets…';
      const detector=await load();if(run!==epoch||!active())return;
      const input=source();if(!input)return;
      const predictions=await detector.detect(input,8,.65);if(run!==epoch||!active())return;
      update(predictions,input);status.textContent=tracks.some(t=>!t.el.hidden)?'':'Visez une personne pour afficher les effets';
    }catch{if(run===epoch){enabled=false;clear();sync();status.textContent='Effets indisponibles · guidage maintenu';}}
    finally{running=false;if(active())timer=setTimeout(tick,Math.max(250,650-(performance.now()-started)));}
  }
  function sync(){checkbox.checked=enabled;toggle.textContent=enabled?'Effets : activés':'Effets : désactivés';toggle.setAttribute('aria-pressed',String(enabled));layer.hidden=!enabled;if(!active()){clear();if(!enabled)status.textContent='';}else void tick();}
  checkbox.addEventListener('change',()=>{enabled=checkbox.checked;try{localStorage.setItem('gps-walk-fun',enabled?'on':'off');}catch{}sync();});
  toggle.addEventListener('click',()=>{enabled=!enabled;try{localStorage.setItem('gps-walk-fun',enabled?'on':'off');}catch{}sync();});
  new MutationObserver(sync).observe(camera,{attributes:true,attributeFilter:['hidden']});
  window.addEventListener('couteau-ar-frame-ready',sync);video.addEventListener('playing',sync);video.addEventListener('pause',sync);document.addEventListener('visibilitychange',sync);window.addEventListener('resize',()=>{clear();sync();});window.addEventListener('pagehide',clear);sync();
})();

