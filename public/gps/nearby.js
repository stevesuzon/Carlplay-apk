(function () {
  'use strict';
  if (window.__gpsNearby41) return;
  window.__gpsNearby41 = true;
  const panel = document.getElementById('gpsFuelInfo');
  if (!panel) return;
  const api = '/api/fuel-stations';
  const rad = Math.PI / 180, radius = 25;
  const km = (a,b) => { const d=(b[0]-a[0])*rad,e=(b[1]-a[1])*rad; return 12742*Math.asin(Math.min(1,Math.sqrt(Math.sin(d/2)**2+Math.cos(a[0]*rad)*Math.cos(b[0]*rad)*Math.sin(e/2)**2))); };
  const escape = value => String(value ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const price = value => Number.isFinite(value)&&value>0 ? value.toFixed(3).replace('.',',')+' €/L' : 'Non publié';
  const distance = value => value<1 ? Math.max(10,Math.round(value*1000/10)*10)+' m' : value.toFixed(1).replace('.',',')+' km';
  let fix=null,origin=null,dialog=null,rows=new Map(),selected=null,loading=false,failures=0,busy=false,error='',token=0,navId=null,sequence=0;
  const controllers=new Set();
  function centers(point) {
    // The existing feed covers 15 km per query. The center plus six surrounding discs cover the 25 km circle.
    const out=[point],angular=15/6371,latitude=point[0]*rad,longitude=point[1]*rad;
    for(let i=0;i<6;i++) {
      const bearing=i*Math.PI/3;
      const lat=Math.asin(Math.sin(latitude)*Math.cos(angular)+Math.cos(latitude)*Math.sin(angular)*Math.cos(bearing));
      const lon=longitude+Math.atan2(Math.sin(bearing)*Math.sin(angular)*Math.cos(latitude),Math.cos(angular)-Math.sin(latitude)*Math.sin(lat));
      out.push([lat/rad,lon/rad]);
    }
    return out;
  }
  function ordered() {return [...rows.values()].sort((a,b)=>a.distance-b.distance || a.id.localeCompare(b.id));}
  function render() {
    if(!dialog?.open)return;
    const body=dialog.querySelector('.nearby-body');
    if(selected) {
      body.innerHTML='<section class="nearby-confirm"><h2>Voulez-vous aller à cette station ?</h2><h3>'+escape(selected.name||'Station-service')+'</h3><p>'+escape([selected.address,selected.city].filter(Boolean).join(', '))+'</p><p>'+distance(selected.distance)+' à vol d’oiseau</p><p>Gazole : '+price(selected.Gazole)+'<br>SP98 : '+price(selected.SP98)+'</p><p>Le GPS calculera le trajet routier avec les réglages de votre véhicule. Cette station deviendra votre destination.</p>'+(error?'<p role="alert" class="nearby-error">'+escape(error)+'</p>':'')+'<div class="nearby-actions"><button data-action="back" '+(busy?'disabled':'')+'>Retour à la liste</button><button class="nearby-primary" data-action="go" '+(busy?'disabled':'')+'>'+(busy?'Calcul du trajet…':'Oui, y aller')+'</button></div></section>';
      return;
    }
    const list=ordered();
    const status=!origin ? 'Activez votre position pour rechercher les stations.' : loading ? 'Recherche dans un rayon de 25 km…' : failures ? 'Liste partielle : certaines recherches ont échoué.' : list.length+' station'+(list.length>1?'s':'')+' repérée'+(list.length>1?'s':'')+' dans un rayon de 25 km';
    body.innerHTML='<p role="status">'+status+'</p><p class="nearby-note">Du plus près au plus loin. Distances à vol d’oiseau depuis votre position à l’ouverture ; le guidage calcule la distance par la route.</p><button data-action="refresh">'+(!origin?'Activer ma position':'Actualiser autour de moi')+'</button>'+(error?'<p role="alert" class="nearby-error">'+escape(error)+'</p>':'')+'<div class="nearby-list">'+list.map(station=>'<button class="nearby-station" data-station="'+escape(station.id)+'"><span class="nearby-row"><strong>'+escape(station.name||'Station-service')+'</strong><b>'+distance(station.distance)+'</b></span><span>'+escape(station.city||'Ville non renseignée')+'</span>'+(station.address?'<span class="nearby-address">'+escape(station.address)+'</span>':'')+'<span class="nearby-prices">Gazole : '+price(station.Gazole)+' · SP98 : '+price(station.SP98)+'</span></button>').join('')+'</div>'+(!list.length&&!loading&&origin&&!failures?'<p>Aucune station repérée dans ce rayon.</p>':'');
  }
  function stopSearch() {token++;for(const c of controllers)c.abort();controllers.clear();loading=false;}
  async function query(point,fuel,run) {
    const controller=new AbortController();controllers.add(controller);
    const timer=setTimeout(()=>controller.abort(),20000);
    try {
      const response=await fetch(api+'?lat='+point[0]+'&lon='+point[1]+'&fuel='+fuel,{signal:controller.signal});
      if(!response.ok)throw Error('Stations indisponibles');
      const data=await response.json();
      if(!data.ok||!Array.isArray(data.stations))throw Error('Réponse invalide');
      if(run!==token)return;
      for(const station of data.stations) {
        if(station.lat===null||station.lon===null||station.lat===''||station.lon==='')continue;
        const coords=[Number(station.lat),Number(station.lon)];
        if(!coords.every(Number.isFinite)||Math.abs(coords[0])>90||Math.abs(coords[1])>180)continue;
        const d=km(origin,coords);if(d>radius)continue;
        const id=String(station.id||coords.join(','));
        const item=rows.get(id)||{id,lat:coords[0],lon:coords[1],distance:d,name:station.name||station.brand||'Station-service',city:station.city||'',address:station.address||''};
        if(station.available!==false && Number(station.price)>0)item[fuel]=Number(station.price);
        rows.set(id,item);
      }
    } catch (_) {if(run===token)failures++;}
    finally {clearTimeout(timer);controllers.delete(controller);}
  }
  async function search() {
    stopSearch();const run=token;selected=null;error='';rows=new Map();failures=0;origin=fix?[...fix]:null;
    if(!origin){render();return;}
    loading=true;render();const locations=centers(origin);let index=0;
    async function worker(){while(index<locations.length&&run===token){const point=locations[index++];await Promise.all(['Gazole','SP98'].map(fuel=>query(point,fuel,run)));if(run===token)render();}}
    await Promise.all([worker(),worker()]);
    if(run===token){loading=false;render();}
  }
  function refresh() {
    if(busy)return;
    if(!navigator.geolocation){error='La position GPS est indisponible sur cet appareil.';render();return;}
    error='';navigator.geolocation.getCurrentPosition(position=>{
      if(!dialog?.open)return;
      fix=[position.coords.latitude,position.coords.longitude];void search();
    },()=>{error='Autorisez la localisation, puis réessayez.';render();},{enableHighAccuracy:true,maximumAge:10000,timeout:12000});
  }
  function open() {
    if(!dialog) {
      dialog=document.createElement('dialog');dialog.id='gpsNearbyStations41';dialog.setAttribute('aria-labelledby','nearby-title');
      dialog.innerHTML='<header><div><h1 id="nearby-title">Stations autour de moi</h1><p>Rayon de 25 km</p></div><button data-action="close" aria-label="Fermer les stations">Fermer ×</button></header><main class="nearby-body"></main>';
      document.body.appendChild(dialog);
      dialog.addEventListener('click',event=>{
        const button=event.target.closest('button');if(!button)return;
        const action=button.dataset.action;
        if(action==='close'){dialog.close();return;}
        if(busy)return;
        if(action==='refresh'){refresh();return;}
        if(action==='back'){selected=null;error='';render();return;}
        if(action==='go'&&selected){
          busy=true;error='';navId='fuel41-'+Date.now()+'-'+(++sequence);render();
          window.dispatchEvent(new CustomEvent('gps-fuel-navigate-v41',{detail:{requestId:navId,station:{...selected}}}));return;
        }
        if(button.dataset.station){selected=rows.get(button.dataset.station)||null;error='';render();}
      });
      dialog.addEventListener('close',()=>{stopSearch();if(navId)window.dispatchEvent(new CustomEvent('gps-fuel-navigate-cancel-v41',{detail:{requestId:navId}}));busy=false;navId=null;selected=null;});
    }
    if(dialog.open)return;
    document.getElementById('gpsFuelDetails39')?.close();
    dialog.showModal();void search();if(!fix)refresh();
  }
  panel.setAttribute('aria-label','Ouvrir les stations autour de moi dans un rayon de 25 km');
  panel.addEventListener('click',event=>{event.preventDefault();event.stopImmediatePropagation();open();},true);
  panel.addEventListener('keydown',event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();event.stopImmediatePropagation();open();}},true);
  window.addEventListener('gps-fuel-state-v35',event=>{const pos=event.detail?.position;if(pos&&!pos.waiting&&!(pos.accuracy>100)&&Number.isFinite(pos.lat)&&Number.isFinite(pos.lon))fix=[pos.lat,pos.lon];});
  window.addEventListener('gps-fuel-navigate-result-v41',event=>{
    if(!navId||event.detail?.requestId!==navId)return;
    busy=false;navId=null;
    if(event.detail.ok){dialog.close();return;}
    error=event.detail.error||'Le trajet est indisponible. Réessayez.';render();
  });
})();
