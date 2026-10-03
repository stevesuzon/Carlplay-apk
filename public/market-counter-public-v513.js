(function(){'use strict';
function start(){
  const settings=document.getElementById('settings');if(!settings||document.getElementById('publicMarketCountRow'))return;
  const row=document.createElement('div');row.className='settingRow';row.id='publicMarketCountRow';
  row.innerHTML='<button class="settingHead" type="button" aria-expanded="false"><span>📊 MARCHÉS DANS L’APPLICATION</span><span>⌄</span></button><div class="settingBody" id="publicMarketCountBody"><div class="marketPublicGrid"><div class="marketPublicCard"><strong data-market-total>—</strong><span>MARCHÉS AU TOTAL</span></div><div class="marketPublicCard"><strong data-market-app>—</strong><span>DANS L’APPLICATION</span></div></div><div class="marketPublicProgress"><progress max="100" value="0" data-market-progress></progress><b data-market-pct>Progression —</b></div><div class="settingNote" data-market-status>Chargement…</div></div>';
  const style=document.createElement('style');style.textContent='#publicMarketCountRow .marketPublicGrid{display:grid;grid-template-columns:1fr 1fr;gap:10px;padding:12px}#publicMarketCountRow .marketPublicCard{padding:16px 8px;border:2px solid #ff9d00;border-radius:16px;background:#121923;text-align:center}#publicMarketCountRow .marketPublicCard strong{display:block;color:#ffa500;font-size:clamp(32px,9vw,52px);line-height:1.05}#publicMarketCountRow .marketPublicCard span{display:block;margin-top:8px;font-weight:900;font-size:13px}#publicMarketCountRow .marketPublicProgress{padding:0 12px 10px;text-align:center}#publicMarketCountRow progress{width:100%;height:22px;accent-color:#ffa500}#publicMarketCountRow .marketPublicProgress b{display:block;margin-top:6px;color:#ffa500;font-size:18px}';
  document.head.appendChild(style);
  const anchor=document.getElementById('removedMarketsSettingRow');if(anchor&&anchor.parentNode===settings)anchor.insertAdjacentElement('afterend',row);else settings.appendChild(row);
  const head=row.querySelector('.settingHead'),body=row.querySelector('.settingBody');
  body.style.display='none';
  head.onclick=function(){const open=body.style.display!=='block';body.style.display=open?'block':'none';head.setAttribute('aria-expanded',open?'true':'false');head.lastElementChild.textContent=open?'⌃':'⌄';if(open)load();};
  const fmt=n=>new Intl.NumberFormat('fr-FR').format(Number(n)||0);
  let loading=false,last=0;
  async function load(){
    if(loading||Date.now()-last<30000)return;loading=true;
    const status=row.querySelector('[data-market-status]');status.textContent='Actualisation…';
    try{
      const r=await fetch('/api/market-counts',{cache:'no-store'}),d=await r.json();if(!r.ok||!d.ok)throw Error('indisponible');
      row.querySelector('[data-market-total]').textContent=fmt(d.total);
      row.querySelector('[data-market-app]').textContent=fmt(d.inApplication);
      row.querySelector('[data-market-progress]').value=Math.max(0,Math.min(100,Number(d.progress)||0));
      row.querySelector('[data-market-pct]').textContent='Progression '+(Number(d.progress)||0).toLocaleString('fr-FR',{maximumFractionDigits:1})+' %';
      status.textContent='Mise à jour automatique du compteur.';
      last=Date.now();
    }catch(_){status.textContent='Compteur momentanément indisponible. Réessaie dans quelques instants.';}
    finally{loading=false;}
  }
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});else start();
})();