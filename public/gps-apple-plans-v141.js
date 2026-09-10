(function(){
  'use strict';
  var apple=document.getElementById('gpsApple');
  var oldRefresh=window.refreshPrefs;
  window.refreshPrefs=function(){
    if(typeof oldRefresh==='function')oldRefresh();
    var selected=localStorage.getItem('gps_pref')||'';
    if(apple)apple.classList.toggle('selected',selected==='Plans Apple');
  };
  window.returnPlace=function(){
    var lat=localStorage.getItem('return_lat'),lon=localStorage.getItem('return_lon');
    if(!lat||!lon){
      if(!navigator.geolocation){alert('GPS indisponible');return;}
      navigator.geolocation.getCurrentPosition(function(position){
        localStorage.setItem('return_lat',position.coords.latitude);
        localStorage.setItem('return_lon',position.coords.longitude);
        if(typeof window.showStatuses==='function')window.showStatuses();
        alert('Camping enregistré. Appuie à nouveau pour y retourner.');
      },function(){alert('Impossible de récupérer votre position.');},{enableHighAccuracy:true});
      return;
    }
    var point=lat+','+lon,pref=localStorage.getItem('gps_pref')||'Google Maps';
    if(pref==='Waze')location.href='https://waze.com/ul?ll='+encodeURIComponent(point)+'&navigate=yes';
    else if(pref==='Plans Apple')location.href='https://maps.apple.com/?daddr='+encodeURIComponent(point)+'&dirflg=d';
    else location.href='https://www.google.com/maps/dir/?api=1&destination='+encodeURIComponent(point)+'&travelmode=driving&dir_action=navigate';
  };
  window.refreshPrefs();
})();
