(function(){
'use strict';
function esc(s){return String(s==null?'':s).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]})}
function token(){var e=document.getElementById('secret');return e&&e.value||localStorage.getItem('carplay_admin_token')||localStorage.getItem('carplay_admin_secret')||''}
function box(){
  var x=document.getElementById('appMessagesBox');if(x)return x;
  var anchor=document.getElementById('peopleCountersBox'),m=document.querySelector('main.wrap');if(!m)return null;
  var s=document.createElement('section');s.className='box';s.id='appMessagesBox';s.style.display='none';
  s.innerHTML='<h2>💬 MESSAGES REÇUS</h2><button class="bannedToggle" id="toggleAppMessages">VOUS AVEZ <span id="appMessagesCount">0</span> MESSAGE(S) — VOIR</button><div id="appMessagesList" style="display:none;margin-top:10px"></div><p class="note">Chaque carte affiche le nom, le prénom, l’adresse e-mail et le message reçu.</p>';
  if(anchor&&anchor.parentNode)anchor.insertAdjacentElement('afterend',s);else m.insertBefore(s,m.children[1]||null);return s;
}
function card(m){
  var name=((m.first_name||'')+' '+(m.last_name||'')).trim()||'Nom non renseigné';
  var email=m.email||'E-mail non renseigné';
  var canBan=String(email).toLowerCase()!=='appli.suzon@gmail.com'&&(email!=='E-mail non renseigné'||m.device_id);
  return '<div class="gpsRequest"><strong>'+esc(name)+'</strong><span>'+esc(email)+'<br><b>'+esc(m.kind||'Message')+'</b><br>'+esc(m.message||'').replace(/\n/g,'<br>')+'</span><div class="gpsActions"><button class="gpsYes" onclick="readAppMessage(\''+esc(m.id)+'\')">MARQUER COMME LU</button>'+(canBan?'<button class="gpsNo" onclick="banAppMessageUser('+JSON.stringify(String(email==='E-mail non renseigné'?'':email))+','+JSON.stringify(String(m.device_id||''))+','+JSON.stringify(name)+')">BANNIR</button>':'<button class="secondary" disabled>ADMIN</button>')+'</div></div>';
}

window.banAppMessageUser=async function(email,deviceId,name){if(!confirm('Bannir '+(name||email||'cette personne')+' de Couteau Suisse ?'))return;try{var r=await fetch('/api/admin/banned-users',{method:'POST',headers:{authorization:'Bearer '+token(),'content-type':'application/json'},body:JSON.stringify({action:'ban',email:email||'',deviceId:deviceId||'',name:name||''}),cache:'no-store'}),j=await r.json();if(!r.ok)throw new Error(j.error||'Impossible');alert('Personne bannie.');if(window.loadBannedUsers)window.loadBannedUsers();}catch(e){alert('Bannissement impossible.')}};
window.readAppMessage=async function(id){try{await fetch('/api/admin/app-messages',{method:'POST',headers:{authorization:'Bearer '+token(),'content-type':'application/json'},body:JSON.stringify({id:id}),cache:'no-store'})}catch(e){}load()};
async function load(){
  var b=box(),t=token();if(!b||!t||localStorage.getItem('carplay_admin_here')!=='1')return;
  b.style.display='block';
  try{
    var r=await fetch('/api/admin/app-messages',{headers:{authorization:'Bearer '+t},cache:'no-store'}),j=await r.json();if(!r.ok)throw j;
    var a=j.messages||[],c=document.getElementById('appMessagesCount'),list=document.getElementById('appMessagesList');if(c)c.textContent=String(a.length);if(list)list.innerHTML=a.map(card).join('')||'<p class="note">Aucun message reçu en attente.</p>';
  }catch(e){}
}
window.loadAdminAppMessages=load;
document.addEventListener('DOMContentLoaded',function(){
  var b=box(),toggle=document.getElementById('toggleAppMessages'),list=document.getElementById('appMessagesList');var gps=document.getElementById('gpsPermissionBox'),ban=document.getElementById('bannedUsersBox');if(b&&gps)b.insertAdjacentElement('afterend',gps);if(gps&&ban)gps.insertAdjacentElement('afterend',ban);
  if(toggle)toggle.onclick=function(){var open=list.style.display!=='none';list.style.display=open?'none':'block';var c=document.getElementById('appMessagesCount');this.innerHTML='VOUS AVEZ <span id="appMessagesCount">'+(c?c.textContent:'0')+'</span> MESSAGE(S) — '+(open?'VOIR':'MASQUER');if(!open)load()};
  setTimeout(load,500);setInterval(function(){if(!document.hidden)load()},30000);
});
})();
