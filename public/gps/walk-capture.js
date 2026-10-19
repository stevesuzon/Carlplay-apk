(() => {
  'use strict';
  const $=id=>document.getElementById(id),camera=$('walkCamera'),video=camera.querySelector('video'),canvas=document.createElement('canvas'),ctx=canvas.getContext('2d'),dialog=$('captureResult'),shutter=$('walkShutter');
  let recorder=null,microphone=null,output=null,chunks=[],drawTimer=null,stopTimer=null,started=0,pending=false,run=0,file=null,url=null;
  const note=t=>$('captureStatus').textContent=t;
  function available(){return !camera.hidden&&!document.hidden&&(!!window.couteauWalkAR?.getFrame()||video.readyState>=2&&video.videoWidth>0);}
  function textBox(text,x,y,w,size,color,bg){
    const lines=String(text).split('\n');ctx.font=`700 ${size}px Arial`;ctx.textAlign='center';ctx.textBaseline='middle';
    if(bg){ctx.fillStyle=bg;ctx.fillRect(x,y,w,lines.length*(size+4)+8);}ctx.fillStyle=color;
    lines.forEach((line,i)=>ctx.fillText(line,x+w/2,y+6+size/2+i*(size+4),w-8));
  }
  function draw(){
    if(!available())return false;
    const r=camera.getBoundingClientRect(),ratio=Math.min(2,1280/Math.max(r.width,r.height));
    if(!recorder||recorder.state==='inactive'){canvas.width=Math.round(r.width*ratio);canvas.height=Math.round(r.height*ratio);}
    ctx.setTransform(canvas.width/r.width,0,0,canvas.height/r.height,0,0);ctx.clearRect(0,0,r.width,r.height);
    const ar=window.couteauWalkAR?.getFrame();if(ar){ctx.drawImage(ar,0,0,r.width,r.height);}else{const scale=Math.max(r.width/video.videoWidth,r.height/video.videoHeight),w=video.videoWidth*scale,h=video.videoHeight*scale;ctx.drawImage(video,(r.width-w)/2,(r.height-h)/2,w,h);}
    const hud=camera.querySelector('.walk-hud').getBoundingClientRect();textBox($('walkArrow').textContent+' '+$('walkTurnDistance').textContent+'\n'+$('walkInstruction').textContent,hud.x-r.x,hud.y-r.y,hud.width,15,'#fff','#112944dc');const trip=camera.querySelector('.walk-trip').getBoundingClientRect();textBox($('walkMinutes').textContent+' · '+$('walkRemaining').textContent+' · '+$('walkArrival').textContent,trip.x-r.x,trip.y-r.y,trip.width,15,'#fff','#112944dc');
    for(const prop of camera.querySelectorAll('.walk-fun-prop:not([hidden])')){
      if(prop.parentElement.hidden)continue;
      for(const el of prop.querySelectorAll('.fun-object,.fun-price,.fun-name,.fun-tutelle,.fun-quip')){
        const cs=getComputedStyle(el);if(cs.visibility==='hidden'||Number(cs.opacity)<.1)continue;
        const b=el.getBoundingClientRect();if(!b.width||!b.height)continue;
        let text=el.innerText,size=parseFloat(cs.fontSize)||12,bg=cs.backgroundColor,color=cs.color;
        if(el.classList.contains('fun-price'))text='Trésorerie\n'+el.innerText.replace('Trésorerie','').trim();
        if(el.classList.contains('fun-object')){ctx.font=`${size}px Arial`;ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(text,b.x-r.x+b.width/2,b.y-r.y+b.height/2);if(prop.classList.contains('fun-pig')){ctx.font='20px Arial';ctx.fillText('🪙',b.x-r.x+b.width/2,b.y-r.y+2);}}
        else textBox(text,b.x-r.x,b.y-r.y,b.width,size,color,bg);
      }
    }
    return true;
  }
  function release(){clearInterval(drawTimer);clearTimeout(stopTimer);drawTimer=stopTimer=null;microphone?.getTracks().forEach(t=>t.stop());output?.getTracks().forEach(t=>t.stop());microphone=output=null;shutter.textContent='●';shutter.classList.remove('recording');shutter.disabled=false;}
  function result(blob,kind){
    if(!blob?.size){note('La capture a échoué. Réessayez.');return;}
    if(url)URL.revokeObjectURL(url);const ext=kind==='photo'?'jpg':blob.type.includes('mp4')?'mp4':'webm';file=new File([blob],'Couteau-Suisse-'+new Date().toISOString().replace(/[:.]/g,'-')+'.'+ext,{type:blob.type});url=URL.createObjectURL(file);
    const media=document.createElement(kind==='photo'?'img':'video');media.src=url;if(kind==='photo')media.alt='Photo capturée';else{media.controls=true;media.playsInline=true;}
    $('capturePreview').replaceChildren(media);$('captureTitle').textContent=kind==='photo'?'Votre photo':'Votre vidéo avec le son';$('captureSaveStatus').textContent='Touchez Enregistrer / partager, puis choisissez l’enregistrement dans Photos si proposé.';dialog.hidden=false;$('saveCapture').focus();note('');
  }
  function stop(){run++;if(recorder&&recorder.state!=='inactive'){recorder.stop();shutter.disabled=true;note('Préparation de la vidéo…');}else if(pending){pending=false;release();note('Enregistrement annulé.');}}
  function takePhoto(){if(!draw()){note('Attendez que la caméra soit prête.');return;}canvas.toBlob(blob=>result(blob,'photo'),'image/jpeg',.93);}
  async function startRecording(){
    if(pending||recorder&&recorder.state!=='inactive'){stop();return;}
    if(!available()){note('Attendez que la caméra soit prête.');return;}
    if(!window.MediaRecorder||!canvas.captureStream){note('Vidéo indisponible dans ce navigateur. La photo reste disponible.');return;}
    const token=++run;pending=true;shutter.textContent='…';note('Autorisez le micro pour enregistrer votre voix.');
    try{
      const mic=await navigator.mediaDevices.getUserMedia({audio:true,video:false});if(token!==run||!available()){mic.getTracks().forEach(t=>t.stop());return;}microphone=mic;
      draw();output=canvas.captureStream(24);for(const track of mic.getAudioTracks())output.addTrack(track);
      const mime=['video/mp4;codecs=avc1.42E01E,mp4a.40.2','video/mp4','video/webm;codecs=vp8,opus','video/webm'].find(t=>MediaRecorder.isTypeSupported(t));
      const rec=new MediaRecorder(output,{...(mime?{mimeType:mime}:{}),videoBitsPerSecond:2000000});recorder=rec;chunks=[];
      rec.ondataavailable=e=>{if(e.data.size)chunks.push(e.data);};rec.onstop=()=>{const blob=new Blob(chunks,{type:rec.mimeType||mime||'video/webm'});chunks=[];recorder=null;release();result(blob,'video');};
      rec.onerror=()=>{note('Enregistrement interrompu.');if(rec.state!=='inactive')rec.stop();else release();};
      rec.start(1000);pending=false;started=Date.now();shutter.textContent='■';shutter.classList.add('recording');
      drawTimer=setInterval(()=>{draw();const seconds=Math.floor((Date.now()-started)/1000);note('● '+Math.floor(seconds/60)+':'+String(seconds%60).padStart(2,'0')+' · Micro activé');},1000/24);
      stopTimer=setTimeout(stop,120000);
    }catch{if(token===run){pending=false;release();note('Micro refusé ou enregistrement indisponible. Autorisez le micro et réessayez.');}}
  }
  let pressed=false,longPress=false,holdTimer=null;
  function press(){if(pressed||shutter.disabled||!dialog.hidden)return;pressed=true;longPress=false;holdTimer=setTimeout(()=>{if(!pressed)return;longPress=true;void startRecording();},450);}
  function unpress(cancel=false){if(!pressed)return;pressed=false;clearTimeout(holdTimer);if(longPress)stop();else if(!cancel)takePhoto();}
  shutter.addEventListener('pointerdown',e=>{if(e.button!==0)return;e.preventDefault();try{shutter.setPointerCapture(e.pointerId);}catch{}press();});
  shutter.addEventListener('pointerup',e=>{e.preventDefault();unpress();});shutter.addEventListener('pointercancel',()=>unpress(true));shutter.addEventListener('lostpointercapture',()=>unpress(true));
  shutter.addEventListener('contextmenu',e=>e.preventDefault());shutter.addEventListener('click',e=>{e.preventDefault();if(e.detail===0&&!pressed&&!pending&&(!recorder||recorder.state==='inactive'))takePhoto();});
  shutter.addEventListener('keydown',e=>{if((e.key===' '||e.key==='Enter')&&!e.repeat){e.preventDefault();press();}});shutter.addEventListener('keyup',e=>{if(e.key===' '||e.key==='Enter'){e.preventDefault();unpress();}});
  document.addEventListener('visibilitychange',()=>{if(document.hidden)unpress(true);});
  $('saveCapture').addEventListener('click',async()=>{
    if(!file)return;
    try{if(navigator.canShare?.({files:[file]})){await navigator.share({files:[file]});$('captureSaveStatus').textContent='Menu de partage fermé.';}else{const a=document.createElement('a');a.href=url;a.download=file.name;a.click();$('captureSaveStatus').textContent='Téléchargement demandé. Retrouvez le fichier dans les téléchargements.';}}
    catch(e){if(e.name!=='AbortError')$('captureSaveStatus').textContent='Le partage a échoué. Réessayez ou utilisez Télécharger.';}
  });
  $('downloadCapture').addEventListener('click',()=>{if(!file)return;const a=document.createElement('a');a.href=url;a.download=file.name;a.click();});
  $('closeCapture').addEventListener('click',()=>{dialog.hidden=true;$('capturePreview').querySelector('video')?.pause();if(url)URL.revokeObjectURL(url);url=null;file=null;$('capturePreview').replaceChildren();});
  new MutationObserver(()=>{if(camera.hidden){unpress(true);stop();}}).observe(camera,{attributes:true,attributeFilter:['hidden']});document.addEventListener('visibilitychange',()=>{if(document.hidden)stop();});window.addEventListener('pagehide',()=>{stop();release();});
})();

