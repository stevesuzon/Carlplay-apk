(function(){
  // Compatibilité ancienne version : ne jamais rebloquer la saisie du code.
  function unlockSubscriptionCode(){
    var panel=document.getElementById('subscriptionSettings');
    if(!panel)return;
    var code=panel.querySelector('.sub-setting-code');
    var activate=panel.querySelector('.sub-setting-activate');
    if(code){code.disabled=false;code.removeAttribute('aria-disabled');}
    if(activate){activate.disabled=false;activate.removeAttribute('aria-disabled');}
  }
  document.addEventListener('DOMContentLoaded',function(){setTimeout(unlockSubscriptionCode,0);setTimeout(unlockSubscriptionCode,500);});
})();
