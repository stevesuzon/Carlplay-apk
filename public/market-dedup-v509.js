(function(root){
  'use strict';
  function norm(v){return String(v||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();}
  function core(r,index){
    var city=norm(r[3]).split(' '),stop=['marche','marches','de','du','des','d','la','le','les','a','au','aux','en','sur','place','halle','halles','alimentaire','alimentaires','couvert','couverte','hebdomadaire'];
    return norm(r[index]).split(' ').filter(function(w){return w&&!stop.includes(w)&&!city.includes(w)&&!/^\d{5}$/.test(w);}).map(function(w){return w.length>5&&w.endsWith('s')&&!w.endsWith('ss')?w.slice(0,-1):w;}).join(' ');
  }
  function address(r){return core(r,8);}
  function point(r){
    if(r[10]==null||r[11]==null||String(r[10]).trim()===''||String(r[11]).trim()==='')return null;
    var lat=Number(r[10]),lon=Number(r[11]);return Number.isFinite(lat)&&Number.isFinite(lon)&&Math.abs(lat)<=90&&Math.abs(lon)<=180&&(lat||lon)?{lat:lat,lon:lon}:null;
  }
  function meters(a,b){var p=Math.PI/180,x=Math.sin((b.lat-a.lat)*p/2)**2+Math.cos(a.lat*p)*Math.cos(b.lat*p)*Math.sin((b.lon-a.lon)*p/2)**2;return 12742000*Math.asin(Math.sqrt(Math.min(1,x)));}
  function hours(r){var m=norm(r[5]).match(/^(\d{1,2})\s*h\s*(\d{2})?\s*(\d{1,2})\s*h\s*(\d{2})?$/);return m?[Number(m[1])*60+Number(m[2]||0),Number(m[3])*60+Number(m[4]||0)]:null;}
  function same(a,b){
    if(!a||!b||norm(a[0])!==norm(b[0])||norm(a[1])!==norm(b[1])||!norm(a[3])||norm(a[3])!==norm(b[3])||!norm(a[4])||norm(a[4])!==norm(b[4]))return false;
    var ha=hours(a),hb=hours(b);if(ha&&hb&&(ha[1]<=hb[0]||hb[1]<=ha[0]))return false;
    var aa=address(a),ab=address(b),na=core(a,2),nb=core(b,2),pa=point(a),pb=point(b),d=pa&&pb?meters(pa,pb):null;
    // City-only addresses and inherited city positions are never evidence of identity.
    if(aa&&ab&&aa===ab)return d===null||d<=200;
    // Different explicit addresses or widely separated points describe different sites.
    if(aa&&ab&&aa!==ab)return false;
    if(d!==null&&d>300)return false;
    if(na&&nb&&na===nb)return true;
    if(!na&&!nb&&norm(a[2])===norm(b[2]))return true;
    // A source URL identifying the same site can resolve completely different aliases.
    var urls=Array.isArray(a[9])?a[9]:[],other=Array.isArray(b[9])?b[9]:[];
    return urls.some(function(u){return /openstreetmap\.org\/(node|way|relation)\/\d+|\/marche\/[^/?]+|data\.datatourisme\.fr\/[^?]+/.test(u)&&other.includes(u);});
  }
  function rows(input){
    var buckets=new Map(),out=[];
    (input||[]).forEach(function(r){var key=[norm(r[0]),norm(r[1]),norm(r[3]),norm(r[4])].join('|'),bucket=buckets.get(key)||[];
      if(!bucket.some(function(existing){return same(existing,r);})) {bucket.push(r);out.push(r);buckets.set(key,bucket);}
    });return out;
  }
  root.MarketDedupV509={same:same,rows:rows};
})(typeof window!=='undefined'?window:globalThis);
