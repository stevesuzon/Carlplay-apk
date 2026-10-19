(() => {
  'use strict';
  const $=id=>document.getElementById(id),meters=n=>n>=1000?(n/1000).toFixed(1).replace('.',',')+' km':Math.round(Math.max(0,n))+' m';
  let guidance=null;
  function update(){
    const state=window.couteauGps?.getState(),r=state?.route;if(!r)return;
    const remaining=Number.isFinite(guidance?.remaining)?Math.max(0,guidance.remaining):r.summary.lengthInMeters;
    const seconds=r.summary.lengthInMeters>0?r.summary.travelTimeInSeconds*remaining/r.summary.lengthInMeters:0;
    $('walkTurnDistance').textContent=Number.isFinite(guidance?.distance)?meters(guidance.distance):'—';
    $('walkRemaining').textContent=meters(remaining);
    $('walkMinutes').textContent=Number.isFinite(seconds)?Math.ceil(seconds/60)+' min':'—';
    $('walkArrival').textContent=Number.isFinite(seconds)?new Date(Date.now()+seconds*1000).toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit'}):'—';
  }
  window.addEventListener('couteau-gps-guidance',e=>{guidance=e.detail;update();});
  window.addEventListener('couteau-gps-state',e=>{if(!e.detail?.active)guidance=null;update();});
})();
