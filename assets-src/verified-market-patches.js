(function(){
  try{
    if(typeof country==='undefined'||country!=='fr'||!Array.isArray(data))return;
    for(var i=0;i<data.length;i++){
      var r=data[i];
      if(!r||String(r[0])!=='29')continue;
      var name=(String(r[1]||'')+' '+String(r[2]||'')).toLowerCase();
      if(name.indexOf('saint-louis')>=0||name.indexOf('saint louis')>=0){
        r[3]='Rues de Lyon et Louis-Pasteur — implantation provisoire liée aux travaux du secteur Saint-Louis (2026). Ouverture des halles et abords prévue à l’automne 2027.';
      }
    }
  }catch(e){}
})();
