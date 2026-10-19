(() => {
  'use strict';
  const $=id=>document.getElementById(id),root=$('walkCamera'),video=root.querySelector('video'),math=window.WalkARMath;
  const button=document.createElement('button'),status=document.createElement('div'),align=document.createElement('button'),canvas=document.createElement('canvas');
  button.id='walkARStart';button.type='button';button.textContent='Activer le chemin AR';
  status.id='walkARStatus';status.setAttribute('role','status');
  align.id='walkARAlign';align.type='button';align.textContent='Aligner au sol';align.hidden=true;
  canvas.id='walkARCanvas';canvas.hidden=true;canvas.setAttribute('aria-hidden','true');
  root.insertBefore(canvas,root.children[1]);root.append(button,status,align);
  const credit=document.createElement('a');credit.id='walkARCredit';credit.href='/gps/webar-license.txt';credit.target='_blank';credit.rel='noopener';credit.textContent='AR © Niantic Spatial · licence';root.append(credit);
  const frame=document.createElement('canvas'),frameCtx=frame.getContext('2d');
  let running=false,loading=false,ready=false,generation=0,watch=null,fix=null,group=null,scene=null,cam=null,route=null,anchor=null,normal=false,lastFrameAt=0,enginePromise=null,startTimeout=null;
  const say=t=>status.textContent=t;
  const dispose=()=>{if(group){group.traverse(o=>{o.geometry?.dispose();if(Array.isArray(o.material))o.material.forEach(m=>m.dispose());else o.material?.dispose();});group.removeFromParent();group=null;}anchor=null;};
  function invalidate(text){dispose();if(running){align.hidden=false;say(text);}}
  function resize(){if(!running)return;canvas.width=Math.round(root.clientWidth*Math.min(devicePixelRatio||1,2));canvas.height=Math.round(root.clientHeight*Math.min(devicePixelRatio||1,2));}

  function script(src,attrs={}){return new Promise((resolve,reject)=>{const s=document.createElement('script');s.src=src;s.crossOrigin='anonymous';Object.entries(attrs).forEach(([k,v])=>s.setAttribute(k,v));const timeout=setTimeout(()=>{s.remove();reject(Error('Chargement trop long. Vérifiez la connexion et réessayez.'));},30000);s.onload=()=>{clearTimeout(timeout);resolve();};s.onerror=()=>{clearTimeout(timeout);s.remove();reject(Error('Le moteur AR ne se charge pas. Réessayez.'));};document.head.appendChild(s);});}
  function engine(){
    if(enginePromise)return enginePromise;
    enginePromise=(async()=>{
      if(!window.THREE)await script('https://cdn.jsdelivr.net/npm/three@0.160.1/build/three.min.js');
      if(!window.XR8)await script('https://cdn.jsdelivr.net/npm/@8thwall/engine-binary@1.0.0/dist/xr.js');
      if(!window.XR8)throw Error('Moteur AR indisponible.');
      await XR8.loadChunk('slam');await XR8.initialize();
    })().catch(e=>{enginePromise=null;throw e;});return enginePromise;
  }
  function stop(){
    generation++;clearTimeout(startTimeout);startTimeout=null;running=loading=ready=normal=false;lastFrameAt=0;
    if(watch!==null)navigator.geolocation.clearWatch(watch);watch=null;fix=null;
    if(window.XR8){try{XR8.stop();XR8.clearCameraPipelineModules();}catch{}}
    dispose();scene=cam=null;route=null;canvas.hidden=true;root.classList.remove('walk-ar-running');align.hidden=true;button.hidden=false;button.disabled=false;button.textContent='Activer le chemin AR';
    video.srcObject?.getTracks().forEach(t=>t.stop());video.srcObject=null;
  }
  function fail(e){stop();say(e?.message||'AR indisponible. Le guidage reste accessible.');if(!root.hidden&&!document.hidden)void window.couteauWalkCamera?.open();}
  function mesh(points,color,opacity=1){const T=window.THREE,g=new T.BufferGeometry();g.setAttribute('position',new T.Float32BufferAttribute(points,3));g.computeVertexNormals();const m=new T.Mesh(g,new T.MeshBasicMaterial({color,transparent:opacity<1,opacity,side:T.DoubleSide,depthWrite:opacity===1}));group.add(m);}
  function strip(a,b,width,y,color,opacity){const dx=b.x-a.x,dz=b.z-a.z,l=Math.hypot(dx,dz);if(l<.01)return;const x=-dz/l*width/2,z=dx/l*width/2;mesh([a.x+x,y,a.z+z,a.x-x,y,a.z-z,b.x+x,y,b.z+z,b.x+x,y,b.z+z,a.x-x,y,a.z-z,b.x-x,y,b.z-z],color,opacity);}
  function place(){
    if(!running||!normal||!cam){say('Bougez doucement le téléphone pour reconnaître le sol.');return;}
    if(!fix||Date.now()-fix.at>5000||fix.accuracy>20){say('Position GPS trop imprécise. Attendez dehors, puis réessayez.');return;}
    const state=window.couteauGps?.getState();if(!state?.active||state.profile?.travelMode!=='pedestrian'){say('Démarrez un itinéraire piéton.');return;}
    const section=math.forward(state.route.points,[fix.lat,fix.lon]);if(!section||section.distance>25||section.path.length<2){say('Rapprochez-vous du trajet indiqué sur la carte.');return;}
    const hits=XR8.XrController.hitTest(.5,.72).filter(h=>['DETECTED_SURFACE','ESTIMATED_SURFACE'].includes(h.type)&&h.distance<8&&h.position.y<cam.position.y-.35);
    const hit=hits.find(h=>{if(!h.rotation)return false;const up=new THREE.Vector3(0,1,0).applyQuaternion(new THREE.Quaternion(h.rotation.x,h.rotation.y,h.rotation.z,h.rotation.w));return up.y>.9;});
    if(!hit){say('Visez un sol plat et texturé, puis réessayez.');return;}
    const dir=cam.getWorldDirection(new THREE.Vector3());if(Math.hypot(dir.x,dir.z)<.2){say('Inclinez moins le téléphone et visez le chemin devant vous.');return;}
    // Manual alignment is explicit: user faces the route's departure direction.
    // Geometry is built ONCE in SLAM world coordinates, never parented to the camera.
    const bearing=section.bearing,angle=Math.atan2(-dir.x,-dir.z)+bearing;
    dispose();scene=XR8.Threejs.xrScene().scene;group=new THREE.Group();scene.add(group);
    const origin={x:cam.position.x,y:hit.position.y+.025,z:cam.position.z};
    const pts=section.path.map(p=>math.world({x:p.x-section.x,z:p.z-section.z},angle,origin));
    for(let i=1;i<pts.length;i++){
      const a=pts[i-1],b=pts[i],dx=b.x-a.x,dz=b.z-a.z,len=Math.hypot(dx,dz);strip(a,b,1.45,origin.y,0x29aaff,.16);strip(a,b,1.06,origin.y+.002,0xffffff);strip(a,b,.94,origin.y+.006,0x008fff,.8);
      const ux=dx/len,uz=dz/len,px=-uz,pz=ux;
      for(let d=.8;d<len;d+=2.5){const x=a.x+ux*d,z=a.z+uz*d,y=origin.y+.025;const v=(side,forward)=>[x+px*side+ux*forward,y,z+pz*side+uz*forward];mesh([...v(-.35,-.25),...v(0,.12),...v(-.35,-.03),...v(-.35,-.03),...v(0,.12),...v(0,.34),...v(0,.12),...v(.35,-.25),...v(.35,-.03),...v(0,.12),...v(.35,-.03),...v(0,.34)],0xffffff);}
    }
    anchor={x:cam.position.x,z:cam.position.z};route=state.route;align.textContent='Recaler au sol';say('Aligné · recalage conseillé à chaque changement de pente');
  }
  async function start(){
    if(running||loading)return;const state=window.couteauGps?.getState();if(!state?.active||state.profile?.travelMode!=='pedestrian'){say('Démarrez un trajet piéton.');return;}
    const token=++generation;loading=true;button.disabled=true;say('Autorisez les mouvements du téléphone, puis patientez…');
    try{
      // Permission must be requested synchronously from the user's tap on iOS.
      const permissions=[];
      for(const sensor of [window.DeviceOrientationEvent,window.DeviceMotionEvent])if(typeof sensor?.requestPermission==='function')permissions.push(sensor.requestPermission());
      if((await Promise.all(permissions)).some(result=>result!=='granted'))throw Error('Autorisez les mouvements pour activer le suivi AR.');
      startTimeout=setTimeout(()=>{if(token===generation)fail(Error('Chargement AR trop long. Réessayez.'));},45000);
      await engine();if(token!==generation||root.hidden)return;clearTimeout(startTimeout);
      window.couteauWalkCamera?.releaseForAR();video.srcObject=null;
      running=true;loading=false;button.hidden=true;canvas.hidden=false;root.classList.add('walk-ar-running');resize();
      watch=navigator.geolocation.watchPosition(p=>{fix={lat:p.coords.latitude,lon:p.coords.longitude,accuracy:p.coords.accuracy,at:p.timestamp};},()=>say('Localisation indisponible. La carte reste accessible.'),{enableHighAccuracy:true,maximumAge:2000,timeout:15000});
      XR8.clearCameraPipelineModules();XR8.XrController.configure({disableWorldTracking:false,scale:'absolute'});
      XR8.addCameraPipelineModules([XR8.GlTextureRenderer.pipelineModule(),XR8.Threejs.pipelineModule(),XR8.XrController.pipelineModule(),{
        name:'couteau-walk-ground',
        onCameraStatusChange:({status:state,stream})=>{if(token!==generation)return;if(state==='hasStream'){video.srcObject=stream;void video.play().catch(()=>{});}if(state==='failed')fail(Error('Caméra refusée. Autorisez-la puis réessayez.'));},
        onStart:()=>{if(token!==generation)return;clearTimeout(startTimeout);({scene,camera:cam}=XR8.Threejs.xrScene());XR8.XrController.updateCameraProjectionMatrix({origin:cam.position,facing:cam.quaternion});align.hidden=false;say('Tournez-vous dans le sens du départ, visez le sol puis touchez « Aligner au sol ».');},
        onUpdate:({processCpuResult})=>{
          if(token!==generation)return;
          const r=processCpuResult?.reality;normal=r?.trackingStatus==='NORMAL';
          if(group&&!normal)invalidate('Suivi perdu. Visez le sol et réalignez le chemin.');
          if(group&&anchor&&Math.hypot(cam.position.x-anchor.x,cam.position.z-anchor.z)>35)invalidate('Nouvelle portion : visez le sol et réalignez le chemin.');
          if(group&&window.couteauGps?.getState().route!==route)invalidate('Itinéraire modifié : réalignez le chemin.');
        },
        onRender:()=>{if(token!==generation||!running)return;const firstFrame=!ready;ready=true;lastFrameAt=performance.now();if(frame.width!==canvas.width||frame.height!==canvas.height){frame.width=canvas.width;frame.height=canvas.height;}frameCtx.drawImage(canvas,0,0);if(firstFrame)window.dispatchEvent(new Event('couteau-ar-frame-ready'));},
        onException:e=>{if(token===generation)fail(e);}
      }]);
      startTimeout=setTimeout(()=>{if(token===generation&&!ready)fail(Error('Le suivi AR ne démarre pas. Réessayez dans Safari.'));},25000);
      XR8.run({canvas,allowedDevices:XR8.XrConfig.device().MOBILE,glContextConfig:{alpha:false,preserveDrawingBuffer:true}});
    }catch(e){if(token===generation)fail(e);}finally{if(token===generation){loading=false;button.disabled=false;}}
  }
  button.addEventListener('click',()=>void start());align.addEventListener('click',place);
  window.couteauWalkAR={stop,getFrame:()=>running&&ready&&performance.now()-lastFrameAt<1500?frame:null,isRunning:()=>running};
  new MutationObserver(()=>{if(root.hidden&&(running||loading))stop();}).observe(root,{attributes:true,attributeFilter:['hidden']});
  document.addEventListener('visibilitychange',()=>{if(document.hidden&&(running||loading)){stop();say('Touchez « Activer le chemin AR » pour reprendre.');}});
  window.addEventListener('pagehide',stop);window.addEventListener('resize',()=>{resize();if(group)invalidate('Orientation modifiée : réalignez le chemin.');});
})();
