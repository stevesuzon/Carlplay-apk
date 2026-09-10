(function(){
  var overlay=document.getElementById('contactMailOverlay'),form=document.getElementById('contactMailForm');
  if(!overlay||!form)return;
  var missing=document.getElementById('missingMarketFields'),name=document.getElementById('missingMarketName'),department=document.getElementById('missingMarketDepartment'),town=document.getElementById('missingMarketTown'),problem=document.getElementById('contactProblem'),send=document.getElementById('contactMailSend'),status=document.getElementById('contactMailStatus');
  function motif(){var checked=form.querySelector('input[name="motif"]:checked');return checked&&checked.value||''}
  function refresh(){var isMissing=motif()==='Marché manquant';missing.hidden=!isMissing;[name,department,town].forEach(function(el){el.required=isMissing});send.disabled=!(motif()&&problem.value.trim()&&(!isMissing||(name.value.trim()&&department.value.trim()&&town.value.trim())))}
  window.openContactMail=function(){overlay.hidden=false;document.body.style.overflow='hidden';refresh()};
  window.closeContactMail=function(){overlay.hidden=true;document.body.style.overflow='';status.textContent='';status.className=''};
  form.addEventListener('input',refresh);form.addEventListener('change',refresh);
  overlay.addEventListener('click',function(e){if(e.target===overlay)window.closeContactMail()});
  form.addEventListener('submit',async function(e){e.preventDefault();refresh();if(send.disabled||!form.reportValidity())return;send.disabled=true;send.textContent='ENVOI EN COURS…';status.textContent='';status.className='';var data=Object.fromEntries(new FormData(form).entries());data._subject='Application CarPlay - '+data.motif;data._template='table';data._captcha='false';try{var response=await fetch('https://formsubmit.co/ajax/appli.suzon@gmail.com',{method:'POST',headers:{'Content-Type':'application/json','Accept':'application/json'},body:JSON.stringify(data)});var result=await response.json().catch(function(){return{}});if(!response.ok||result.success===false)throw new Error('send');status.textContent='✅ DEMANDE ENVOYÉE. Steve va la recevoir.';status.className='ok';form.reset();missing.hidden=true;setTimeout(window.closeContactMail,2400)}catch(err){status.textContent='❌ Envoi impossible. Vérifiez Internet puis réessayez.';status.className='error'}finally{send.textContent='ENVOYER LE MESSAGE';refresh()}});
})();
