(function(){
  'use strict';
  const storageKey='carplay-market-milestone-seen-v457';
  let showing=false,current=0,pending=[];
  function saved(){try{return Math.max(0,Number(localStorage.getItem(storageKey))||0)}catch(_){return 0}}
  function remember(n){try{localStorage.setItem(storageKey,String(n))}catch(_){}}
  function showNext(){
    if(showing||!pending.length||!document.body)return;
    const item=pending.shift();if(item.milestone<=saved()){showNext();return}showing=true;current=item.milestone;
    const shade=document.createElement('div');shade.className='market-milestone-overlay';
    shade.setAttribute('role','dialog');shade.setAttribute('aria-modal','true');shade.setAttribute('aria-label','50 nouveautés ajoutées');
    const card=document.createElement('section');card.className='market-milestone-card';
    const sub=document.createElement('p');sub.textContent=item.milestone+' nouveautés ajoutées au total';card.appendChild(sub);
    const list=document.createElement('div');list.className='market-milestone-departments';
    (Array.isArray(item.breakdown)?item.breakdown:[]).forEach(function(row){
      const line=document.createElement('div');const label=document.createElement('span');label.textContent='Département '+row.area+' · '+({marche:'Marchés',brocante:'Brocantes et foires',voyageur:'Marchés voyageurs'}[row.kind]||'Événements');
      const value=document.createElement('strong');value.textContent=String(row.count);line.append(label,value);list.appendChild(line);
    });card.appendChild(list);
    const button=document.createElement('button');button.type='button';button.textContent='DÉCOUVRIR LES MARCHÉS';
    button.addEventListener('click',function(){remember(item.milestone);shade.remove();showing=false;current=0;showNext()});
    card.appendChild(button);shade.appendChild(card);document.body.appendChild(shade);button.focus();
  }
  async function check(){
    if(document.hidden)return;
    try{
      const response=await fetch('/api/markets/milestones?after='+Math.max(saved(),current,pending.length?pending[pending.length-1].milestone:0),{cache:'no-store'});
      if(!response.ok)return;
      const data=await response.json();if(!data.ok||!Array.isArray(data.milestones))return;
      for(const item of data.milestones){if(!pending.some(x=>x.milestone===item.milestone)&&item.milestone>saved())pending.push(item)}
      showNext();
    }catch(_){}
  }
  const style=document.createElement('style');style.textContent=".market-milestone-overlay{position:fixed;inset:0;z-index:2147483646;display:flex;align-items:flex-end;justify-content:center;overflow:auto;padding:18px;box-sizing:border-box;background:#081324 url('/market-milestone-50-v457.jpg') center center/cover no-repeat;color:#fff;font-family:system-ui,sans-serif;text-align:center}.market-milestone-card{box-sizing:border-box;width:min(100%,550px);max-height:47vh;overflow:auto;padding:15px 18px 18px;border:2px solid #ffb13d;border-radius:22px;background:#090e18eb;box-shadow:0 15px 50px #000c;backdrop-filter:blur(9px)}.market-milestone-card p{margin:0 0 8px;font-size:17px;font-weight:700;color:#ffe0a1}.market-milestone-departments{max-height:25vh;overflow:auto;margin:8px 0 14px;text-align:left}.market-milestone-departments div{display:flex;justify-content:space-between;gap:16px;padding:8px;border-bottom:1px solid #ffffff32}.market-milestone-departments strong{color:#ffcc78;white-space:nowrap}.market-milestone-card button{width:100%;padding:13px;border:0;border-radius:14px;color:#201205;background:linear-gradient(100deg,#ffe18a,#ff9b23);font-size:16px;font-weight:800;cursor:pointer}@media(max-height:650px){.market-milestone-overlay{background-position:center 42%}.market-milestone-card{max-height:49vh}}";document.head.appendChild(style);
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',check,{once:true});else check();
  document.addEventListener('visibilitychange',function(){if(!document.hidden)check()});setInterval(check,60000);
})();
