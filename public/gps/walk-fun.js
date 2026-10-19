(() => {
  'use strict';
  const camera=document.getElementById('walkCamera'),video=camera.querySelector('video'),layer=document.getElementById('walkFunLayer'),toggle=document.getElementById('toggleWalkFun'),status=document.getElementById('walkFunStatus');
  const checkbox=document.getElementById('enableWalkFun');
  let enabled=false,model=null,loading=null,running=false,timer=null,epoch=0,tracks=[],nextId=0;
  try{enabled=localStorage.getItem('gps-walk-fun')==='on';}catch{}
  const props=[['🐷','Tirelire'],['🛏️','Matelas'],['🛏️','Matelas + sommier'],['🪑','Chaise ancienne'],['🛋️','Canapé'],['🪞','Miroir ancien'],['🕰️','Pendule'],['🏺','Vase'],['🖼️','Tableau'],['🧰','Coffre ancien'],['🪑','Table + chaises'],['🛋️','Fauteuil'],['💡','Lampe vintage'],['🗄️','Commode']];
  let combinations=[];try{const saved=JSON.parse(localStorage.getItem('gps-fun-combinations')||'[]');if(Array.isArray(saved))combinations=saved.filter(v=>typeof v==='string').slice(-1000);}catch{}
  function surprise(){
    const used=new Set(combinations);let choice,price,key,attempt=0;
    do{choice=Math.floor(Math.random()*props.length);price=(4+Math.floor(Math.random()*497))*5;key=choice+':'+price;if(++attempt>50){let n=0;while(used.has((n%props.length)+':'+((4+Math.floor(n/props.length))*5)))n++;choice=n%props.length;price=(4+Math.floor(n/props.length))*5;key=choice+':'+price;break;}}while(used.has(key));
    combinations.push(key);combinations=combinations.slice(-1000);try{localStorage.setItem('gps-fun-combinations',JSON.stringify(combinations));}catch{}
    return {choice,price,prop:props[choice],quip:Math.random()<.22,tutelle:Math.random()<.6};
  }

  function active(){return enabled&&!camera.hidden&&!document.hidden&&!video.paused&&video.readyState>=2&&!!video.srcObject;}
  function clear(){epoch++;clearTimeout(timer);timer=null;tracks=[];layer.replaceChildren();}
  function script(src){return new Promise((resolve,reject)=>{const s=document.createElement('script');s.src=src;s.onload=resolve;s.onerror=()=>{s.remove();reject(Error('Effets indisponibles'));};document.head.appendChild(s);});}
  async function load(){
    if(model)return model;if(loading)return loading;
    loading=(async()=>{if(!window.tf)await script('https://cdn.jsdelivr.net/npm/@tensorflow/tfjs@4.22.0/dist/tf.min.js');if(!window.cocoSsd)await script('https://cdn.jsdelivr.net/npm/@tensorflow-models/coco-ssd@2.2.3/dist/coco-ssd.min.js');await window.tf.ready();model=await window.cocoSsd.load({base:'lite_mobilenet_v2'});return model;})();
    try{return await loading;}finally{loading=null;}
  }
  function update(predictions){
    const rect=video.getBoundingClientRect(),scale=Math.max(rect.width/video.videoWidth,rect.height/video.videoHeight),ox=(rect.width-video.videoWidth*scale)/2,oy=(rect.height-video.videoHeight*scale)/2;
    const boxes=predictions.filter(p=>p.class==='person'&&p.score>=.65&&p.bbox?.length===4&&p.bbox.every(Number.isFinite)).sort((a,b)=>b.score-a.score).slice(0,4);
    const used=new Set(),fresh=[];
    for(const p of boxes){
      const [x,y,w,h]=p.bbox;if(w<15||h<35)continue;
      const cx=x+w/2,cy=y+h/2;
      let best=null,dist=Infinity;
      for(const t of tracks){const d=Math.hypot(cx-t.cx,cy-t.cy);if(!used.has(t.id)&&d<Math.max(w,h)*.5&&d<dist){best=t;dist=d;}}
      if(!best){
        const id=nextId++,gift=surprise(),el=document.createElement('div');el.className='walk-fun-prop';
        el.innerHTML='<span class="fun-object" aria-hidden="true">'+gift.prop[0]+'</span><strong class="fun-price"><small>Trésorerie</small>'+gift.price.toLocaleString('fr-FR')+' €</strong><span class="fun-name">Besoin : '+gift.prop[1]+'</span>'+(gift.tutelle?'<span class="fun-tutelle">✕ Sous tutelle</span>':'')+(gift.quip?'<span class="fun-quip">Chine ! Celui-là,<br>je le sens bien !</span>':'');
        if(gift.choice===0)el.classList.add('fun-pig');layer.appendChild(el);best={id,el};
      }
      used.add(best.id);best.cx=cx;best.cy=cy;
      const px=cx*scale+ox,py=y*scale+oy-8,hud=camera.querySelector('.walk-hud').getBoundingClientRect();
      // Never move an accessory onto the directions or controls, or display it off-screen.
      best.el.hidden=px<30||px>rect.width-30||py<Math.max(90,hud.bottom-rect.top+135)||py>rect.height-125;
      best.el.style.left=px+'px';best.el.style.top=py+'px';fresh.push(best);
    }
    for(const t of tracks)if(!used.has(t.id))t.el.remove();tracks=fresh;
  }
  async function tick(){
    if(running||!active())return;running=true;const run=epoch;const started=performance.now();
    try{
      if(!model)status.textContent='Chargement des effets…';
      const detector=await load();if(run!==epoch||!active())return;
      const predictions=await detector.detect(video,8,.65);if(run!==epoch||!active())return;
      update(predictions);status.textContent='';
    }catch{if(run===epoch){enabled=false;clear();sync();status.textContent='Effets indisponibles · guidage maintenu';}}
    finally{running=false;if(active())timer=setTimeout(tick,Math.max(250,650-(performance.now()-started)));}
  }
  function sync(){checkbox.checked=enabled;toggle.textContent=enabled?'Effets : activés':'Effets : désactivés';toggle.setAttribute('aria-pressed',String(enabled));layer.hidden=!enabled;if(!active()){clear();if(!enabled)status.textContent='';}else void tick();}
  checkbox.addEventListener('change',()=>{enabled=checkbox.checked;try{localStorage.setItem('gps-walk-fun',enabled?'on':'off');}catch{}sync();});
  toggle.addEventListener('click',()=>{enabled=!enabled;try{localStorage.setItem('gps-walk-fun',enabled?'on':'off');}catch{}sync();});
  new MutationObserver(sync).observe(camera,{attributes:true,attributeFilter:['hidden']});
  video.addEventListener('playing',sync);video.addEventListener('pause',sync);document.addEventListener('visibilitychange',sync);window.addEventListener('resize',()=>{clear();sync();});window.addEventListener('pagehide',clear);sync();
})();
