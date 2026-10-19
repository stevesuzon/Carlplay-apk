(() => {
  'use strict';
  const layer=document.createElement('div');layer.id='gpsReadableSigns';layer.setAttribute('aria-label','Lieux sur la carte');document.body.appendChild(layer);
  document.body.classList.add('gps-readable-signs');
  const entries=new Map();let dirty=true,lastFrame=0;
  const observer=new MutationObserver(()=>{dirty=true});observer.observe(document.getElementById('gps-root'),{childList:true,subtree:true});
  function sync(){
    const counts=new Map(),seen=new Set();
    for(const source of document.querySelectorAll('.place-pin .market-sign')){
      const base=source.getAttribute('aria-label')+'|'+source.dataset.kind,n=counts.get(base)||0,key=base+'|'+n;counts.set(base,n+1);seen.add(key);
      let anchor=source.parentElement.querySelector('.gps-sign-anchor');
      if(!anchor){anchor=document.createElement('span');anchor.className='gps-sign-anchor';anchor.setAttribute('aria-hidden','true');source.parentElement.appendChild(anchor);}
      let item=entries.get(key);
      if(!item){
        const button=source.cloneNode(true);button.className='readable-market-sign';button.hidden=true;
        button.querySelector('small').textContent=source.querySelector('small').textContent.replace(/\s*[·—-]\s*Non publi.*$/i,'');
        const hint=document.createElement('span');hint.className='sign-tap-hint';hint.textContent='Voir les détails ›';button.querySelector('.sign-face').appendChild(hint);
        button.addEventListener('click',()=>{if(dirty){dirty=false;sync();}entries.get(key)?.source.click();});layer.appendChild(button);item={source,anchor,button};entries.set(key,item);
      }
      item.source=source;item.anchor=anchor;
    }
    for(const [key,item] of entries)if(!seen.has(key)){item.button.remove();entries.delete(key);}
  }
  function frame(time){
    requestAnimationFrame(frame);if(document.hidden||time-lastFrame<50)return;lastFrame=time;
    if(dirty){dirty=false;sync();}
    const hidden=document.body.classList.contains('gps-planning')||!!document.querySelector('#walkCamera:not([hidden])')||!!document.querySelector('.gps-sign-shade');layer.hidden=hidden;if(hidden)return;
    const width=innerWidth,height=innerHeight,candidates=[],shown=new Set();
    for(const item of entries.values()){
      const r=item.anchor.getBoundingClientRect();
      if(r.x<8||r.x>width-8||r.y<100||r.y>height-70)continue;
      candidates.push({...item,x:r.x,y:r.y,priority:Math.hypot(r.x-width/2,r.y-height*.65)});
    }
    const occupied=[];
    for(const item of candidates.sort((a,b)=>a.priority-b.priority)){
      if(occupied.length>=6)break;
      const w=Math.min(260,width*.68),h=116,left=Math.max(8,Math.min(width-w-8,item.x-w/2)),top=Math.max(12,item.y-h);
      if(occupied.some(r=>left<r.right+8&&left+w>r.left-8&&top<r.bottom+8&&top+h>r.top-8))continue;
      item.button.style.left=left+'px';item.button.style.top=top+'px';item.button.style.setProperty('--sign-stem-x',(item.x-left)+'px');shown.add(item.button);
      occupied.push({left,top,right:left+w,bottom:top+h});
    }
    for(const {button} of entries.values()){const hide=!shown.has(button);if(button.hidden!==hide)button.hidden=hide;}
  }
  requestAnimationFrame(frame);
})();
