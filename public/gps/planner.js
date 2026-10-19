(() => {
  'use strict';
  const $=id=>document.getElementById(id), planner=$('gpsPlanner'), status=$('plannerStatus'), input=$('gpsAddress');
  let mode='normal',destination=null,controller=null,generation=0,searchId=0,searchController=null,timer=0,busy=false,lastFix=null,stream=null,cameraRun=0,walking=false,wasActive=false,cameraAttempted=false,wake=null;
  const valid=p=>p && Number.isFinite(p.lat)&&Number.isFinite(p.lon)&&Math.abs(p.lat)<=90&&Math.abs(p.lon)<=180;
  const recentKey='gps-recent-addresses-v1',recentSelect=$('gpsRecentAddresses');
  const addressKey=p=>Number(p.lat).toFixed(5)+','+Number(p.lon).toFixed(5);
  let recent=[];try{const stored=JSON.parse(localStorage.getItem(recentKey)||'[]');if(Array.isArray(stored)){const seen=new Set();recent=stored.filter(p=>{if(!valid(p)||typeof p.name!=='string'||!p.name.trim()||seen.has(addressKey(p)))return false;seen.add(addressKey(p));return true;}).slice(0,30);}}catch{}
  function renderRecent(){
    recentSelect.replaceChildren(new Option(recent.length?'Mes adresses ('+recent.length+')':'Mes adresses (0)',''));
    recent.forEach((p,index)=>recentSelect.appendChild(new Option(p.name,String(index))));recentSelect.value='';
  }
  function rememberAddress(place){
    const name=String(place.label||place.name||place.address||'Destination').trim().slice(0,300);
    const entry={name,address:String(place.address||name).slice(0,300),lat:place.lat,lon:place.lon,precision:place.precision||''};
    recent=[entry,...recent.filter(p=>addressKey(p)!==addressKey(entry))].slice(0,30);
    try{localStorage.setItem(recentKey,JSON.stringify(recent));}catch{}renderRecent();
  }
  recentSelect.addEventListener('change',()=>{if(recentSelect.value==='')return;const place=recent[Number(recentSelect.value)];if(place){input.blur();recentSelect.blur();open(place);}});
  renderRecent();
  const meters=n=>n>=1000?(n/1000).toFixed(1).replace('.',',')+' km':Math.max(0,Math.round(n/10)*10)+' m';
  let savedProfile={};try{savedProfile=JSON.parse(localStorage.getItem('gps-voyage-profile')||'{}');}catch{}
  let convoyProfiles={};try{convoyProfiles=JSON.parse(localStorage.getItem('gps-convoy-profiles-v5')||'{}');}catch{}
  const convoyKey=()=>$('vehicle').value+':'+$('trailer').value;
  function loadConvoy(){const saved=convoyProfiles[convoyKey()]||{};for(const key of ['length','height','width','weight'])$(key).value=saved[key]||({length:'12',height:'2.65',width:'2.50',weight:'6000'}[key]);}
  function rememberConvoy(){convoyProfiles[convoyKey()]=Object.fromEntries(['length','height','width','weight'].map(key=>[key,$(key).value]));}
  function syncChoices(){planner.querySelectorAll('[data-choice]').forEach(b=>{const field=$(b.dataset.choice),value=field.type==='checkbox'?String(field.checked):field.value;b.setAttribute('aria-pressed',String(b.dataset.value===value));});}
  if(['car','truck'].includes(savedProfile.vehicle))$('vehicle').value=savedProfile.vehicle;
  if(['small','large','trailer'].includes(savedProfile.trailer))$('trailer').value=savedProfile.trailer;
  loadConvoy();syncChoices();
  function message(text){status.textContent=text;}
  function setBusy(value){busy=value;$('confirmGps').disabled=value;$('cancelCalculation').hidden=!value;planner.querySelectorAll('[data-mode],[data-choice],input,select,#editAddress').forEach(el=>el.disabled=value);}
  function cancel(){generation++;controller?.abort();controller=null;setBusy(false);}
  function closeCamera(){cameraRun++;if(stream)stream.getTracks().forEach(t=>t.stop());stream=null;$('walkCamera').hidden=true;$('walkCamera').querySelector('video').srcObject=null;}
  let resumeCamera=false;
  async function openCamera(){
    const run=++cameraRun;
    try {
      if(!navigator.mediaDevices?.getUserMedia)throw Error('Caméra indisponible.');
      const media=await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:'environment'}},audio:false});
      if(run!==cameraRun||!walking||!wasActive){media.getTracks().forEach(t=>t.stop());return;}
      if(stream)stream.getTracks().forEach(t=>t.stop());stream=media;
      const video=$('walkCamera').querySelector('video');video.srcObject=stream;$('walkCamera').hidden=false;
      await video.play();if(run!==cameraRun)return;
      $('openWalkCamera').textContent='📷 Vue piéton';
      media.getVideoTracks().forEach(track=>track.addEventListener('ended',()=>{if(stream===media)closeCamera();},{once:true}));
    } catch {if(run===cameraRun){closeCamera();$('openWalkCamera').textContent='📷 Activer la caméra';$('openWalkCamera').title='Autorisez la caméra dans les réglages du navigateur. Le guidage reste disponible sur la carte.';}}
  }
  async function keepScreen(){try{if(navigator.wakeLock&&!wake&&wasActive&&!document.hidden){wake=await navigator.wakeLock.request('screen');wake.addEventListener('release',()=>{wake=null});}}catch{}}
  function chooseMode(value){mode=value;planner.querySelectorAll('[data-mode]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.mode===mode)));$('convoyOptions').hidden=mode!=='convoi';$('vehicleOptions').hidden=mode==='pieton';$('roadOptions').hidden=mode==='pieton';$('walkFunOptions').hidden=mode!=='pieton';syncChoices();message('');}
  let previewRun=0,previewAbort=null,previewTimeout=null;
  function stopPreview(){previewRun++;previewAbort?.abort();clearTimeout(previewTimeout);$('destinationStreet').hidden=true;$('destinationStreet').removeAttribute('src');}
  async function showDestinationPreview(place){
    stopPreview();const run=previewRun,frame=$('destinationStreet'),status=$('destinationImageStatus');
    status.hidden=false;status.textContent='Recherche d’une photo de rue…';$('destinationCaption').textContent='Photo de rue · Panoramax';
    const abort=new AbortController();previewAbort=abort;previewTimeout=setTimeout(()=>abort.abort(),12000);
    try{
      const response=await fetch('/gps/api/panorama?'+new URLSearchParams({lat:place.lat,lon:place.lon}),{signal:abort.signal});const data=await response.json();if(run!==previewRun)return;clearTimeout(previewTimeout);
      if(!response.ok||!data.panorama?.viewer?.startsWith('/gps/panorama-viewer?'))throw Error();
      const p=data.panorama,approximate=['municipality','city','locality'].includes(place.precision);
      $('destinationCaption').textContent='Photo de rue · Panoramax · à '+p.distance+' m du point'+(approximate?' · centre de la ville':'');
      frame.src=p.viewer;frame.hidden=false;status.textContent='Chargement de la photo de rue…';
      previewTimeout=setTimeout(()=>{if(run===previewRun){frame.hidden=true;frame.removeAttribute('src');status.hidden=false;status.textContent='Photo de rue indisponible. Vous pouvez confirmer le trajet.';}},22000);
    }catch{if(run!==previewRun)return;clearTimeout(previewTimeout);status.textContent='Aucune photo de rue disponible ici. Vous pouvez confirmer le trajet.';}
  }
  window.addEventListener('message',event=>{
    const frame=$('destinationStreet');if(event.origin!==location.origin||event.source!==frame.contentWindow||frame.hidden)return;
    if(event.data?.type==='gps-panorama-ready'){clearTimeout(previewTimeout);$('destinationImageStatus').hidden=true;}
    if(event.data?.type==='gps-panorama-error'){clearTimeout(previewTimeout);frame.hidden=true;frame.removeAttribute('src');$('destinationImageStatus').hidden=false;$('destinationImageStatus').textContent='Photo de rue indisponible. Vous pouvez confirmer le trajet.';}
  });
  function open(place=null){
    cancel();searchController?.abort();searchId++;clearTimeout(timer);closeCamera();window.couteauGps?.stop();
    destination=valid(place)?{id:place.id||'couteau-destination',kind:place.kind||'terrain',city:'',day:'',hours:'',merchants:'',...place,address:place.address||place.name}:null;
    if(destination)rememberAddress(destination);else stopPreview();
    document.body.classList.add('gps-planning');planner.hidden=false;$('addressForm').hidden=!!destination;$('modeStep').hidden=!destination;$('gpsResults').replaceChildren();
    if(destination){showDestinationPreview(destination);input.blur();planner.scrollTop=0;$('chosenAddress').textContent=destination.name||destination.address;chooseMode(mode);}else {input.value='';message('');input.focus({preventScroll:true});}
  }
  window.couteauGpsPlanner={open, getSelection:()=>({destination,profile:profile()}),restore(saved){open(saved.destination);const p=saved.profile;for(const key of ['vehicle','trailer','roadMode'])if(p[key]!=null)$(key).value=p[key];$('tolls').checked=p.tolls!==false;loadConvoy();for(const key of ['length','height','width','weight'])if(Number(p[key])>0)$(key).value=p[key];chooseMode(p.travelMode==='pedestrian'?'pieton':p.trailer!=='none'?'convoi':'normal');syncChoices();}};
  async function search(){
    searchController?.abort();const id=++searchId,q=input.value.trim();$('gpsResults').replaceChildren();
    if(q.length<3){message(q?'Saisissez au moins trois caractères.':'');return;}
    const abort=new AbortController();searchController=abort;message('Recherche…');
    const query=new URLSearchParams({q});if(lastFix){query.set('lat',lastFix.lat);query.set('lon',lastFix.lon);}
    const timeout=setTimeout(()=>abort.abort(),25000);
    try{
      const response=await fetch('/gps/api/search?'+query,{signal:abort.signal});const data=await response.json();if(id!==searchId)return;
      if(!response.ok)throw Error(data.error||'Recherche indisponible.');
      const rows=(data.results||[]).filter(valid);message(rows.length?'':data.note||'Aucune adresse trouvée. Précisez la ville et le numéro.');
      for(const place of rows){const button=document.createElement('button');button.type='button';button.setAttribute('role','listitem');button.textContent=place.label||place.name;button.addEventListener('click',()=>{searchId++;abort.abort();open(place);});$('gpsResults').appendChild(button);}
    }catch(e){if(id===searchId)message(e.name==='AbortError'?'La recherche prend trop de temps. Réessayez.':e.message);}finally{clearTimeout(timeout);}
  }
  input.addEventListener('input',()=>{searchId++;searchController?.abort();clearTimeout(timer);timer=setTimeout(search,300);});
  $('addressForm').addEventListener('submit',event=>{event.preventDefault();clearTimeout(timer);void search();});
  planner.querySelectorAll('[data-mode]').forEach(button=>button.addEventListener('click',()=>chooseMode(button.dataset.mode)));
  planner.querySelectorAll('[data-choice]').forEach(button=>button.addEventListener('click',()=>{if(busy)return;const key=button.dataset.choice,field=$(key);if(key==='vehicle'||key==='trailer')rememberConvoy();if(field.type==='checkbox')field.checked=button.dataset.value==='true';else field.value=button.dataset.value;if(key==='vehicle'||key==='trailer')loadConvoy();syncChoices();message('');}));
  $('editAddress').addEventListener('click',()=>open());
  $('cancelCalculation').addEventListener('click',()=>{cancel();message('Calcul annulé.');});
  function profile(){
    const p={travelMode:mode==='pieton'?'pedestrian':'drive',vehicle:mode==='pieton'?'car':$('vehicle').value,trailer:mode==='convoi'?$('trailer').value:'none',tolls:$('tolls').checked,roadMode:mode==='pieton'?'direct':$('roadMode').value,confirmed:true};
    if(mode==='convoi')for(const key of ['length','height','width','weight']){const value=Number($(key).value),[min,max]=({length:[2,25],height:[1,5],width:[1,3.5],weight:[500,60000]})[key];if(!(value>=min&&value<=max))throw Error('Le gabarit enregistré est invalide.');p[key]=$(key).value;}
    else Object.assign(p,p.vehicle==='truck'?{length:5.8,height:'2.53',width:'2.50',weight:'3500'}:{length:4.4,height:'1.50',width:'2.10',weight:'1500'});
    return p;
  }
  function position(signal){return new Promise((resolve,reject)=>{
    if(!navigator.geolocation){reject(Error('Localisation indisponible sur cet appareil.'));return;}
    const onAbort=()=>reject(new DOMException('Annulé','AbortError'));signal.addEventListener('abort',onAbort,{once:true});
    navigator.geolocation.getCurrentPosition(p=>{signal.removeEventListener('abort',onAbort);if(signal.aborted)return;if(p.coords.accuracy>100){reject(Error('Position trop imprécise. Réessayez à l’extérieur.'));return;}resolve(p);},e=>{signal.removeEventListener('abort',onAbort);reject(Error(e.code===1?'Autorisez la localisation dans les réglages du navigateur, puis confirmez à nouveau.':'Position introuvable. Réessayez à l’extérieur.'));},{enableHighAccuracy:true,timeout:18000,maximumAge:3000});
  });}
  function ready(signal){return new Promise((resolve,reject)=>{
    if(window.couteauGps){resolve();return;}
    const done=()=>{cleanup();resolve();},abort=()=>{cleanup();reject(new DOMException('Annulé','AbortError'));},timeout=setTimeout(()=>{cleanup();reject(Error('La carte ne se charge pas. Vérifiez votre connexion.'));},15000);
    function cleanup(){clearTimeout(timeout);window.removeEventListener('couteau-gps-ready',done);signal.removeEventListener('abort',abort);}
    window.addEventListener('couteau-gps-ready',done,{once:true});signal.addEventListener('abort',abort,{once:true});
  });}
  function showNavigation(){stopPreview();planner.hidden=true;document.body.classList.remove('gps-planning');message('');}
  $('confirmGps').addEventListener('click',async()=>{
    if(busy||!destination)return;let selected;try{selected=profile();}catch(e){message(e.message);return;}
    cancel();const run=generation,abort=new AbortController();controller=abort;setBusy(true);message('Recherche de votre position…');
    try{
      const fix=await position(abort.signal);if(run!==generation)return;
      const from=[fix.coords.latitude,fix.coords.longitude];message('Calcul de l’itinéraire '+(mode==='pieton'?'piéton':mode==='convoi'?'adapté au convoi':'normal')+'…');
      const timeout=setTimeout(()=>abort.abort(),28000);let response;
      try{response=await fetch('/gps/api/route',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({from,to:[destination.lat,destination.lon],profile:selected}),signal:abort.signal});}finally{clearTimeout(timeout);}
      const route=await response.json();if(run!==generation)return;
      if(!response.ok)throw Error(route.error||'Calcul indisponible.');
      if(!Array.isArray(route.points)||route.points.length<2||!route.summary||!route.instructions?.length)throw Error('Itinéraire incomplet. Réessayez.');
      if(mode==='convoi'&&route.vehicleRestrictionsChecked!==true)throw Error('Les paramètres du convoi ne sont pas appliqués.');
      if(mode==='pieton'&&route.mode!=='pedestrian')throw Error('Le trajet piéton n’a pas été calculé.');
      await ready(abort.signal);if(run!==generation||abort.signal.aborted)return;
      if(mode==='convoi'){rememberConvoy();try{localStorage.setItem('gps-convoy-profiles-v5',JSON.stringify(convoyProfiles));}catch{}}
      savedProfile=selected;try{localStorage.setItem('gps-voyage-profile',JSON.stringify(selected));}catch{}
      window.couteauGps.start({route,destination,profile:selected});showNavigation();
    }catch(e){if(run===generation)message(e.name==='AbortError'?'Calcul interrompu. Réessayez.':e.message);}
    finally{if(run===generation){controller=null;setBusy(false);}}
  });
  window.addEventListener('gps-fuel-state-v35',event=>{const {position:p}=event.detail||{};if(p&&valid(p))lastFix=p;});
  window.addEventListener('couteau-gps-state',event=>{
    const state=event.detail||{};walking=state.profile?.travelMode==='pedestrian';wasActive=!!state.active;
    $('gpsFuelInfo').hidden=!wasActive||walking;$('openWalkCamera').hidden=!wasActive||!walking;
    if(wasActive){void keepScreen();if(walking&&!cameraAttempted){cameraAttempted=true;void openCamera();}}
    else {closeCamera();cameraAttempted=false;$('gpsNextDirection').hidden=true;if(wake){void wake.release();wake=null;}}
    if(!walking)closeCamera();
    if(state.arrived){$('gpsNextDirection').textContent='Vous êtes arrivé';$('gpsNextDirection').hidden=false;}
    if(!wasActive&&!state.arrived&&!state.destination&&planner.hidden)open();
  });
  window.addEventListener('couteau-gps-guidance',event=>{
    const g=event.detail;$('gpsNextDirection').hidden=true;
    $('walkInstruction').textContent=g.message;$('walkDistance').textContent='Dans '+meters(g.distance)+' · '+meters(g.remaining)+' restants';$('walkArrow').textContent=/demi.tour/i.test(g.message)?'↶':/gauche/i.test(g.message)?'↰':/droite/i.test(g.message)?'↱':'↑';
  });
  $('openWalkCamera').addEventListener('click',()=>void openCamera());$('closeWalkCamera').addEventListener('click',closeCamera);
  document.addEventListener('visibilitychange',()=>{if(document.hidden){resumeCamera=!!stream;closeCamera();}else{void keepScreen();if(resumeCamera&&walking&&wasActive){resumeCamera=false;void openCamera();}}});window.addEventListener('pagehide',()=>{cancel();closeCamera();});
  // Accept old destination links without auto-selecting an ambiguous first search result.
  const params=new URLSearchParams(location.search||location.hash.slice(1)),raw=params.get('destination');
  if(raw){window.gpsExplicitDestination=true;let p;try{p=JSON.parse(raw);}catch{const pair=raw.split(',').map(Number);if(pair.length===2&&pair.every(Number.isFinite))p={lat:pair[0],lon:pair[1]};}if(valid(p))open({...p,name:params.get('name')||p.name||'Destination'});else{input.value=raw;void search();}history.replaceState(null,'','/gps/');}
})();
