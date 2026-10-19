const {chromium}=require('playwright');const fs=require('fs');const assert=require('node:assert/strict');
const math=require('../public/gps/walk-ar-math.js');
const route=[[48,2],[48.0002,2],[48.0002,2.0003]];
const section=math.forward(route,[48,2],60);assert(section.path.length===3);assert(section.path[1].z<0);assert(section.path[2].x>0);
const east=math.world({x:1,z:0},Math.PI/2,{x:0,y:0,z:0});assert(Math.abs(east.x)<1e-9&&Math.abs(east.z+1)<1e-9);
assert.equal(math.forward([[48,2],[48,2]],[48,2]),null);
assert(Math.abs(math.forward([[48,2],[49,2]],[48,2],60).path[1].z+60)<1e-6);
(async()=>{
const browser=await chromium.launch({headless:true,args:['--no-sandbox']});const page=await browser.newPage({viewport:{width:390,height:844},deviceScaleFactor:1});const errors=[];page.on('pageerror',e=>errors.push(e.message));
await page.route('**/gps/navigation.js*',r=>r.fulfill({body:''}));await page.route('**/gps/fuel.js*',r=>r.fulfill({body:''}));await page.route('**/gps/nearby.js*',r=>r.fulfill({body:''}));
await page.route('**/three@*/build/three.min.js',r=>r.fulfill({path:'node_modules/three/build/three.min.js',contentType:'text/javascript'}));
await page.addInitScript(()=>{navigator.geolocation.watchPosition=(cb)=>{cb({coords:{latitude:48,longitude:2,accuracy:5},timestamp:Date.now()});return 9;};navigator.geolocation.clearWatch=()=>{};});
await page.goto('http://127.0.0.1:8765/gps/');
await page.addScriptTag({path:'node_modules/three/build/three.min.js'});
await page.evaluate(()=>{
window.testScene=new THREE.Scene();window.testCam=new THREE.PerspectiveCamera(65,390/844,.01,100);testCam.position.set(0,1.6,0);
window.testRoute={points:[[48,2],[48.0002,2],[48.0002,2.0003]],summary:{lengthInMeters:45,travelTimeInSeconds:40}};
window.couteauGps={getState:()=>({active:true,route:testRoute,profile:{travelMode:'pedestrian'}})};
document.getElementById('gpsPlanner').hidden=true;document.body.classList.remove('gps-planning');document.getElementById('walkCamera').hidden=false;
window.XR8={loadChunk:async()=>{},initialize:async()=>{},stop:()=>{window.stops=(window.stops||0)+1;},clearCameraPipelineModules:()=>{},addCameraPipelineModules:mods=>{window.pipeline=mods.at(-1);},GlTextureRenderer:{pipelineModule:()=>({})},Threejs:{pipelineModule:()=>({}),xrScene:()=>({scene:testScene,camera:testCam})},XrController:{pipelineModule:()=>({}),configure:c=>{window.xrConfig=c;},updateCameraProjectionMatrix:()=>{},hitTest:()=>[{type:'DETECTED_SURFACE',position:{x:0,y:0,z:-2},rotation:{x:0,y:0,z:0,w:1},distance:2}]},XrConfig:{device:()=>({MOBILE:'MOBILE'})},run:()=>{pipeline.onStart();pipeline.onUpdate({processCpuResult:{reality:{trackingStatus:'NORMAL'}}});pipeline.onRender();}};
window.dispatchEvent(new CustomEvent('couteau-gps-guidance',{detail:{message:'Tournez à droite',distance:22,remaining:45}}));
});
await page.click('#walkARStart');await page.waitForFunction(()=>!document.getElementById('walkARAlign').hidden);await page.click('#walkARAlign');
assert.equal(await page.evaluate(()=>xrConfig.disableWorldTracking),false);
assert.equal(await page.evaluate(()=>testScene.children.length),1);
const coords=await page.evaluate(()=>Array.from(testScene.children[0].children[0].geometry.attributes.position.array));
await page.evaluate(()=>{testCam.position.x+=2;testCam.rotation.y=.6;pipeline.onUpdate({processCpuResult:{reality:{trackingStatus:'NORMAL'}}});});
assert.deepEqual(await page.evaluate(()=>Array.from(testScene.children[0].children[0].geometry.attributes.position.array)),coords);
await page.screenshot({path:'webar-layout.png'});
await page.evaluate(()=>pipeline.onUpdate({processCpuResult:{reality:{trackingStatus:'LIMITED'}}}));assert.equal(await page.evaluate(()=>testScene.children.length),0);
assert((await page.textContent('#walkARStatus')).includes('Suivi perdu'));
await page.click('#closeWalkCamera');assert.equal(await page.locator('#walkCamera').isVisible(),false);assert(await page.evaluate(()=>stops>0));
assert.deepEqual(errors,[]);console.log('PASS: route geometry, fixed world transform, tracking loss, camera cleanup, HUD layout. Physical iPhone tracking NOT tested.');
// Verify the real distributed engine loads and initializes WASM, independently of mocks.
const real=await browser.newPage({viewport:{width:390,height:844}});
await real.route('https://cdn.jsdelivr.net/npm/@8thwall/engine-binary@1.0.0/dist/**',r=>{
 const part=new URL(r.request().url()).pathname.split('/dist/')[1];
 if(!part||part.includes('..'))return r.abort();
 return r.fulfill({path:'node_modules/@8thwall/engine-binary/dist/'+part});
});
await real.goto('http://127.0.0.1:8765/gps/webar-license.txt');
await real.addScriptTag({path:'node_modules/three/build/three.min.js'});
await real.addScriptTag({url:'https://cdn.jsdelivr.net/npm/@8thwall/engine-binary@1.0.0/dist/xr.js'});
await real.waitForFunction(()=>!!window.XR8,{},{timeout:30000});
await real.evaluate(async()=>{await Promise.race([(async()=>{await XR8.loadChunk('slam');await XR8.initialize();})(),new Promise((_,reject)=>setTimeout(()=>reject(Error('XR engine initialization timeout')),45000))]);});
assert.equal(await real.evaluate(()=>typeof XR8.XrController.hitTest),'function');
console.log('PASS: real XR engine SLAM chunk initialization.');
await browser.close();
})();
