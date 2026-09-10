(function(){
  try{
    var saved=JSON.parse(localStorage.getItem('server_markets')||'[]');
    if(!Array.isArray(saved)||!saved.length||!Array.isArray(window.data))return;
    var currentCountry=String(window.country||'fr').toUpperCase();
    var known=new Map(data.map(function(m,i){return [[currentCountry,m[0],m[1],m[2],m[3],m[4]].join('|').toLowerCase(),i]}));
    saved.forEach(function(m){
      if(String(m.country||'FR').toUpperCase()!==currentCountry)return;
var row=[m.area,m.kind||'marche',m.name,m.city||'',m.day,m.hours||'',m.kind==='brocante'?'Brocante':'Marché',m.merchants||'',m.address||'',m.country||currentCountry,m.latitude,m.longitude,m.draw||'',m.registration||'',m.note||''];
      var key=[currentCountry,row[0],row[1],row[2],row[3],row[4]].join('|').toLowerCase();
      if(known.has(key)){data[known.get(key)]=row}else{data.push(row);known.set(key,data.length-1)}
      if(Array.isArray(window.areas)&&!areas.some(function(a){return String(a[0])===String(m.area)}))areas.push([m.area,m.area]);
    });
  }catch(e){}
})();
