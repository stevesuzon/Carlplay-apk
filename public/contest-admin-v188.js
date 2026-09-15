(function(){
'use strict';
function secret(){var e=document.getElementById('secret');return e?e.value:''}
async function api(path){var r=await fetch(path,{headers:{authorization:'Bearer '+secret()},cache:'no-store'}),j=await r.json().catch(function(){return {}});if(!r.ok)throw j;return j}
function add(){
  if(document.getElementById('contestAdminBox'))return;
  var main=document.querySelector('main.wrap');if(!main)return;
  var s=document.createElement('section');s.className='box';s.id='contestAdminBox';s.style.display='none';
  s.innerHTML='<h2>🏆 CONCOURS</h2><div class="card total contestSummary"><strong id="contestParticipantCount">—</strong><span>PARTICIPANT(S)</span></div><div id="contestAdminStatus" class="note" style="margin-top:12px">Chargement…</div>';
  var requests=document.getElementById('gpsPermissionBox');
  if(requests&&requests.parentNode)requests.parentNode.insertBefore(s,requests);else main.insertBefore(s,main.children[1]||null);
}
async function load(){
  add();
  var box=document.getElementById('contestAdminBox');
  if(!box||localStorage.getItem('carplay_admin_here')!=='1'){if(box)box.style.display='none';return}
  box.style.display='block';
  try{
    var j=await api('/api/admin/contest');
    var n=(j.participants||[]).length;
    var c=document.getElementById('contestParticipantCount');if(c)c.textContent=String(n);
    var st=document.getElementById('contestAdminStatus');
    if(st)st.textContent='Concours : '+(Date.now()<Number(j.config&&j.config.end_at||0)?'en cours':'terminé')+'. Les demandes des participants sont regroupées juste en dessous dans « Demandes à valider ».';
  }catch(e){
    var st2=document.getElementById('contestAdminStatus');if(st2)st2.textContent='Concours indisponible pour le moment.';
  }
}
window.loadContestSummary=load;
add();setTimeout(load,600);setInterval(load,15000);
})();