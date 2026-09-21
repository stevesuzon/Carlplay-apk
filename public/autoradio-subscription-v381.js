(function(){
  "use strict";
  var STYLE_ID="autoradioSubscriptionStyleV381";

  function isAutoradio(){
    try{
      return /CouteauSuisseAutoradio/i.test(navigator.userAgent||"") ||
        localStorage.getItem("carplay_device_type")==="autoradio";
    }catch(_){return /CouteauSuisseAutoradio/i.test(navigator.userAgent||"")}
  }
  if(!isAutoradio())return;

  function installStyle(){
    if(document.getElementById(STYLE_ID))return;
    var st=document.createElement("style");
    st.id=STYLE_ID;
    st.textContent=`
      html.autoradio-subscription-v381 #settings,
      body.autoradio-subscription-v381 #settings{
        width:100vw!important;max-width:none!important;left:0!important;right:0!important;
        box-sizing:border-box!important;background:#071426!important;color:#fff!important;
        padding:12px 18px 26px!important;overflow-y:auto!important
      }
      #subscriptionSettings{border:0!important;background:transparent!important;margin:0!important;padding:0!important}
      #subscriptionSettings>.settingHead{
        min-height:58px!important;border:2px solid #3c78bd!important;border-radius:15px!important;
        background:linear-gradient(180deg,#193f71,#102d52)!important;color:#fff!important;
        font:950 22px/1 Arial!important;padding:0 20px!important
      }
      #subscriptionSettings>.settingBody{
        background:linear-gradient(180deg,#0b2547,#07182e)!important;
        border:2px solid #2e70bb!important;border-radius:20px!important;
        padding:16px 18px 20px!important;margin-top:10px!important
      }
      #subscriptionSettings>.settingBody.open{display:block!important}
      #subscriptionSettings .sub-current-status{
        margin:0 0 10px!important;padding:9px 14px!important;border-width:2px!important;
        border-radius:14px!important;font-size:16px!important
      }
      #subscriptionSettings .sub-current-status>div:first-child{font-size:18px!important}
      #subscriptionSettings .sub-settings{
        display:grid!important;grid-template-columns:1fr!important;gap:0!important;
        padding:0!important;margin:0!important
      }
      #subscriptionSettings .autoradio-info-title,
      #subscriptionSettings .autoradio-code-title{
        display:block!important;margin:8px 0 10px!important;color:#fff!important;
        font:950 26px/1.05 Arial!important;letter-spacing:.2px!important
      }
      #subscriptionSettings .autoradio-info-title{margin-top:2px!important}
      #subscriptionSettings .sub-settings>label{display:block!important;margin:7px 0!important;color:#eef6ff!important;font:900 17px/1.2 Arial!important}
      #subscriptionSettings .autoradio-name-grid{
        display:grid!important;grid-template-columns:1fr 1fr!important;gap:16px!important;
        margin:0 0 13px!important
      }
      #subscriptionSettings .autoradio-field-card{
        display:flex!important;flex-direction:column!important;gap:5px!important;
        min-width:0!important;padding:9px 13px!important;border:2px solid #6f9ed7!important;
        border-radius:14px!important;background:linear-gradient(180deg,#315b92,#264a78)!important
      }
      #subscriptionSettings .autoradio-field-card .autoradio-field-label{
        color:#fff!important;font:900 16px/1 Arial!important
      }
      #subscriptionSettings input.sub-setting-last-name,
      #subscriptionSettings input.sub-setting-first-name{
        width:100%!important;height:48px!important;min-height:48px!important;margin:0!important;padding:0 8px!important;
        border:0!important;outline:0!important;background:transparent!important;color:#fff!important;
        font:850 24px/1 Arial!important;box-shadow:none!important
      }
      #subscriptionSettings input.sub-setting-email,
      #subscriptionSettings input.sub-setting-code{
        width:100%!important;box-sizing:border-box!important;min-height:66px!important;margin:0 0 12px!important;
        padding:0 18px!important;border:2px solid #6f9ed7!important;border-radius:14px!important;
        background:linear-gradient(180deg,#315b92,#264a78)!important;color:#fff!important;
        font:850 24px/1 Arial!important;box-shadow:none!important
      }
      #subscriptionSettings input.sub-setting-code{
        min-height:70px!important;text-align:center!important;font-size:30px!important;font-weight:950!important;
        letter-spacing:8px!important;text-transform:uppercase!important
      }
      #subscriptionSettings input::placeholder{color:#cadbf1!important;opacity:.72!important}
      #subscriptionSettings .sub-setting-confirm-email,
      #subscriptionSettings .sub-setting-change-email,
      #subscriptionSettings .sub-setting-activate{
        width:100%!important;min-height:64px!important;margin:4px 0 12px!important;border:0!important;border-radius:14px!important;
        background:linear-gradient(180deg,#168dff,#0870dc)!important;color:#fff!important;
        font:950 21px/1.1 Arial!important;padding:8px 18px!important
      }
      #subscriptionSettings .sub-setting-recover-code{
        width:100%!important;min-height:58px!important;margin:2px 0 6px!important;border:2px solid #42a5ff!important;border-radius:14px!important;
        background:#0b315e!important;color:#fff!important;font:900 18px/1.15 Arial!important;padding:8px 18px!important
      }
      #subscriptionSettings .sub-setting-confirmed{
        min-height:60px!important;display:flex!important;align-items:center!important;padding:10px 16px!important;
        border:2px solid #42d57b!important;border-radius:14px!important;background:#0c3b29!important;
        color:#7ff0a7!important;font:900 18px/1.25 Arial!important
      }
      #subscriptionSettings .sub-setting-confirmed[style*="display: none"]{display:none!important}
      #subscriptionSettings .sub-setting-warning{font-size:14px!important;line-height:1.25!important}
      #subscriptionSettings .sub-recovery-help{
        display:block!important;margin:0 0 10px!important;color:#c7d5e7!important;
        font:700 13px/1.3 Arial!important
      }
      #subscriptionSettings .sub-settings-message{
        min-height:22px!important;margin-top:6px!important;color:#ffd557!important;
        font:900 16px/1.25 Arial!important;text-align:center!important
      }
      #subscriptionSettings a[href*="snapchat.com"]{
        display:block!important;margin:0 0 14px!important;padding:8px 12px!important;
        border:1px solid #e9d43b!important;border-radius:12px!important;background:#1b1d20!important;
        color:#fff!important;text-align:center!important;text-decoration:none!important;font:800 14px/1.25 Arial!important
      }
      #subscriptionSettings a[href*="snapchat.com"] strong{color:#ffdf48!important}
      @media(max-height:600px){
        #subscriptionSettings>.settingBody{padding:12px 16px 16px!important}
        #subscriptionSettings .autoradio-info-title,#subscriptionSettings .autoradio-code-title{font-size:22px!important;margin:5px 0 7px!important}
        #subscriptionSettings .autoradio-field-card{padding:6px 11px!important}
        #subscriptionSettings input.sub-setting-last-name,#subscriptionSettings input.sub-setting-first-name{height:42px!important;min-height:42px!important;font-size:21px!important}
        #subscriptionSettings input.sub-setting-email{min-height:56px!important;font-size:21px!important}
        #subscriptionSettings input.sub-setting-code{min-height:60px!important;font-size:27px!important}
        #subscriptionSettings .sub-setting-confirm-email,#subscriptionSettings .sub-setting-change-email,#subscriptionSettings .sub-setting-activate{min-height:56px!important;font-size:19px!important}
        #subscriptionSettings .sub-setting-recover-code{min-height:52px!important;font-size:16px!important}
      }
    `;
    (document.head||document.documentElement).appendChild(st);
    document.documentElement.classList.add("autoradio-subscription-v381");
    if(document.body)document.body.classList.add("autoradio-subscription-v381");
  }

  function enhance(){
    installStyle();
    var panel=document.getElementById("subscriptionSettings");
    if(!panel)return false;
    panel.classList.add("autoradio-subscription-panel-v381");
    var body=panel.querySelector(".settingBody");
    var settings=panel.querySelector(".sub-settings");
    if(!body||!settings)return false;

    if(!settings.querySelector(".autoradio-info-title")){
      var title=document.createElement("div");
      title.className="autoradio-info-title";
      title.textContent="VOS INFORMATIONS";
      settings.insertBefore(title,settings.firstChild);
    }

    var firstLabel=settings.querySelector("label");
    if(firstLabel)firstLabel.style.display="none";

    var last=settings.querySelector(".sub-setting-last-name");
    var first=settings.querySelector(".sub-setting-first-name");
    if(last&&first&&!settings.querySelector(".autoradio-name-grid")){
      var oldParent=last.parentElement;
      var grid=document.createElement("div");
      grid.className="autoradio-name-grid";
      function wrap(input,label){
        var card=document.createElement("div");
        card.className="autoradio-field-card";
        var t=document.createElement("span");
        t.className="autoradio-field-label";
        t.textContent=label;
        card.appendChild(t);
        card.appendChild(input);
        return card;
      }
      grid.appendChild(wrap(last,"Nom"));
      grid.appendChild(wrap(first,"Prénom"));
      if(oldParent&&oldParent.parentNode){
        oldParent.parentNode.insertBefore(grid,oldParent);
        oldParent.remove();
      }
    }

    var emailLabel=settings.querySelector(".sub-setting-email-label");
    if(emailLabel)emailLabel.innerHTML="<b>Adresse e-mail complète</b>";
    var email=settings.querySelector(".sub-setting-email");
    if(email)email.placeholder="votre.email@exemple.com";

    var code=settings.querySelector(".sub-setting-code");
    var activate=settings.querySelector(".sub-setting-activate");
    var recover=settings.querySelector(".sub-setting-recover-code");
    var help=settings.querySelector(".sub-recovery-help");
    var codeLabel=code?code.previousElementSibling:null;
    if(codeLabel&&codeLabel.tagName==="LABEL"){
      codeLabel.className="autoradio-code-title";
      codeLabel.innerHTML="VOTRE CODE D’ABONNEMENT";
    }else if(code&&!settings.querySelector(".autoradio-code-title")){
      var ct=document.createElement("div");
      ct.className="autoradio-code-title";
      ct.textContent="VOTRE CODE D’ABONNEMENT";
      settings.insertBefore(ct,code);
    }
    if(code)code.placeholder="Entrez votre code d’abonnement";
    if(activate)activate.textContent="Activer / changer mon code";
    if(recover){
      recover.textContent="✉  RÉCUPÉRER MON CODE D’ABONNEMENT";
      if(activate&&activate.parentNode===recover.parentNode){
        activate.insertAdjacentElement("afterend",recover);
      }
    }
    if(help&&code){
      help.textContent="Vous avez déjà un code ? Saisissez-le ci-dessous pour activer ou récupérer votre abonnement.";
      var titleNode=settings.querySelector(".autoradio-code-title");
      if(titleNode)titleNode.insertAdjacentElement("afterend",help);
    }
    return true;
  }

  var tries=0;
  function start(){
    if(enhance())return;
    var t=setInterval(function(){
      tries++;
      if(enhance()||tries>=24)clearInterval(t);
    },250);
  }

  if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",start,{once:true});
  else start();
  window.addEventListener("pageshow",function(){setTimeout(enhance,120)});
})();
