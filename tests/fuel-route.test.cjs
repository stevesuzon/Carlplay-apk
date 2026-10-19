const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
(async()=>{
 const {normalizeStation,routeFuel}=await import('../src/gps/fuel.mjs');
 const station=normalizeStation({id:1,geom:{lat:48,lon:2},gazole_prix:1.8,sp95_prix:1.9,e10_prix:1.85,sp98_prix:2,sp98_rupture_type:'temporaire'});
 assert.equal(station.prices.Gazole,1.8);assert.equal(station.prices.E10,1.85);assert.equal(station.prices.SP98,null);
 const originalFetch=global.fetch;const pages=[];
 global.fetch=async url=>{const offset=Number(new URL(url).searchParams.get('offset'));pages.push(offset);return Response.json({total_count:135,results:Array.from({length:offset===0?100:35},(_,i)=>({id:offset+i,geom:{lat:48,lon:2},e10_prix:1.85}))});};
 let response=await routeFuel(new Request('https://test/gps/api/fuel?lat=48&lon=2'));let data=await response.json();assert.equal(data.stations.length,135);assert.equal(data.partial,false);assert.deepEqual(pages,[0,100]);
 global.fetch=async()=>{throw Error('outage');};response=await routeFuel(new Request('https://test/gps/api/fuel?lat=48&lon=2'));assert.equal(response.status,503);global.fetch=originalFetch;
 const panel={dataset:{},setAttribute(){},addEventListener(){},textContent:'',innerHTML:''},listeners={};
 const window={addEventListener(n,fn){listeners[n]=fn;},dispatchEvent(){}};
 const sandbox={window,document:{getElementById:()=>panel},CustomEvent:class {constructor(type,opts){this.type=type;this.detail=opts.detail;}},setInterval(){},setTimeout,clearTimeout,AbortController,console,fetch:async()=>{throw Error('unmocked request');}};
 const source=fs.readFileSync(require.resolve('../public/gps/fuel.js'),'utf8').replace('  display();\n})();',`  window.testFuel={build,project,km,verifyOnRoute,pointAt,roadDistance,display,seed(route,stations){passedIds.clear();current=route;profileKey='test';found=new Map(stations.map(st=>[st.id,st]));accessDistances.clear();for(const st of stations)accessDistances.set(stationKey(st),{km:0});fix=route.pts[0];},move(p){fix=p;display();},loseDistance(st){accessDistances.delete(stationKey(st));}};\n})();`);
 vm.runInNewContext(source,sandbox);const t=window.testFuel;
 // U-shaped trip: the displayed distance must follow all three road segments.
 const route=t.build([[48,2],[48.01,2],[48.01,2.01],[48,2.01]]),near=t.project([48.001,2.01],route);
 const stations=Array.from({length:12},(_,i)=>({id:String(i),coords:[48.001,2.01],point:near.point,s:near.s+i*.0001,Gazole:1.8,SP95:1.9,E10:1.85,SP98:2,city:'Test'}));
 t.seed(route,stations);t.display();assert.equal(panel.dataset.remaining,'12');assert.equal(window.gpsFuelMarkers.length,12);assert.match(panel.innerHTML,/SP95/);assert.match(panel.innerHTML,/E10/);
 const distance=t.roadDistance(stations[0],{s:0});assert(distance>2.7);assert(distance>t.km(route.pts[0],stations[0].coords)*3);
 t.move([48,2.01]);assert.equal(panel.dataset.remaining,'0');assert.equal(window.gpsFuelMarkers.length,0);
 t.seed(route,[stations[0]]);t.loseDistance(stations[0]);t.display();assert.match(panel.innerHTML,/Distance routière indisponible/);assert(!panel.innerHTML.includes('Estimation'));
 // Verify a real road-shaped access, then reject a long detour/opposite carriageway.
 const straight=t.build([[48,2],[48.02,2]]),projection=t.project([48.01,2],straight),candidate={id:'valid',coords:[48.01,2],point:projection.point,s:projection.s};
 sandbox.fetch=async(_,options)=>{const {from,to}=JSON.parse(options.body);return {ok:true,json:async()=>({points:[from,to],summary:{lengthInMeters:t.km(from,to)*1000}})};};
 assert.equal((await t.verifyOnRoute(candidate,straight,0,{vehicle:'car'})).accepted,true);
 sandbox.fetch=async(_,options)=>{const {from,to}=JSON.parse(options.body);return {ok:true,json:async()=>({points:[from,to],summary:{lengthInMeters:5000}})};};
 assert.equal((await t.verifyOnRoute({...candidate,id:'detour'},straight,0,{vehicle:'truck',confirmed:true})).accepted,false);
 console.log('PASS fuel: pagination, missing prices, outages, 12-station total, road distance on U route, passed markers removed, no aerial fallback, access and detour checks.');
})();
