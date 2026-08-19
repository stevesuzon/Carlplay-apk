from pathlib import Path
import re

A = Path('app/src/main/assets')
A.mkdir(parents=True, exist_ok=True)


def extract(src, name):
    text = Path(src).read_text(encoding='utf-8', errors='ignore')
    match = re.search(r'const\s+' + re.escape(name) + r'\s*=\s*(\[.*?\]);', text, re.S)
    if not match:
        raise SystemExit(f'Impossible de trouver {name} dans {src}')
    return match.group(1)


TEMPLATE = r'''<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">
<title>__TITLE__</title>
<style>
*{box-sizing:border-box}html,body{margin:0;min-height:100%;font-family:Arial,Helvetica,sans-serif;color:#fff;background:#07101d url('route66-bg.jpg') center center/cover fixed no-repeat}body{min-height:100vh}.shade{min-height:100vh;background:rgba(2,8,18,.42);padding:14px}.app{width:min(1180px,97vw);margin:auto}h1{text-align:center;font-size:clamp(30px,5vw,56px);margin:4px 0 16px;text-shadow:0 3px 12px #000}.picker,.card{background:rgba(8,19,38,.90);border-radius:22px}.picker{padding:14px;box-shadow:0 10px 26px #0008}button{font-family:inherit;touch-action:manipulation;cursor:pointer}#choose,#confirm{width:100%;min-height:76px;border-radius:22px;font-size:clamp(20px,3vw,31px);font-weight:950;color:#fff}#choose{border:3px solid #62d8ff;background:linear-gradient(135deg,#05aaff,#1739db);display:flex;justify-content:space-between;align-items:center;padding:0 24px}#confirm{margin-top:12px;border:2px solid #777;background:#555;color:#aaa;cursor:not-allowed}#confirm.ready{background:linear-gradient(135deg,#05aaff,#1739db);border-color:#62d8ff;color:#fff;cursor:pointer;box-shadow:0 7px 18px #0007}#panel{display:none;position:fixed;inset:2vh 2vw;z-index:100;background:rgba(16,35,58,.98);border:3px solid #62d8ff;border-radius:24px;padding:12px;overflow:auto}#panel.open{display:block}#close{position:sticky;top:0;width:100%;height:58px;border:0;border-radius:15px;background:#d84343;color:#fff;font-weight:950;font-size:19px;z-index:3}.area{width:100%;min-height:62px;margin:6px 0;border:1px solid #ffffff55;border-radius:16px;background:linear-gradient(135deg,#203650,#17273b);color:#fff;font-size:20px;font-weight:850;text-align:left;padding:10px 18px}.area.sel{background:linear-gradient(135deg,#087fce,#1739db);border:3px solid #62d8ff}#results{display:none;margin-top:14px}.days{position:sticky;top:0;z-index:30;display:flex;gap:10px;overflow-x:auto;white-space:nowrap;padding:10px 5px;background:rgba(4,13,28,.94);border-radius:18px;-webkit-overflow-scrolling:touch;scrollbar-width:thin}.day{flex:0 0 auto;min-width:108px;height:54px;border:2px solid #62d8ff;border-radius:999px;background:#132a48;color:#fff;font-size:18px;font-weight:950}.day.active{background:#087ee5;box-shadow:0 4px 12px #0007}#heading{font-size:clamp(21px,3vw,28px);font-weight:950;margin:14px 4px 4px}#count{margin:0 4px 12px;opacity:.9;font-size:16px}.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(340px,1fr));gap:13px}.card{padding:17px;border:1px solid #ffffff35;box-shadow:0 8px 22px #0008;min-width:0}.card.verified{outline:2px solid #42d68b}.name{font-size:clamp(21px,2.4vw,27px);font-weight:950;line-height:1.15;padding-right:4px}.city{font-size:18px;margin-top:9px;line-height:1.35}.meta{margin-top:8px;font-size:17px;line-height:1.45}.infoLine{margin-top:6px;font-size:16px;color:#e8f1ff}.tag{display:inline-block;margin-top:9px;padding:5px 10px;border-radius:999px;background:#ffffff18;font-weight:850}.weather{margin-top:14px;padding:11px 12px;border-radius:15px;background:rgba(2,12,25,.62);border:1px solid #6ed8ff55;font-size:16px;line-height:1.35;min-height:48px}.weather b{display:block;margin-bottom:3px}.actions{display:flex;gap:10px;margin-top:14px}.actions button{flex:1;min-height:56px;border:0;border-radius:15px;font-size:17px;font-weight:950;color:#fff}.verify{background:#f39b19}.nav{background:#087ee5}dialog{width:min(670px,94vw);max-height:90vh;overflow:auto;border:2px solid #62d8ff;border-radius:20px;background:#10233a;color:#fff;padding:18px}dialog::backdrop{background:#000b}dialog h2{margin-top:0}dialog label{display:block;margin:12px 0 5px;font-weight:850}dialog input,dialog select,dialog textarea{width:100%;min-height:48px;border-radius:12px;border:1px solid #ffffff55;padding:8px 12px;font-size:18px;background:#081727;color:#fff}dialog textarea{min-height:78px;resize:vertical}.modalBtns{display:flex;gap:10px;margin-top:16px}.modalBtns button{flex:1;min-height:52px;border:0;border-radius:13px;color:#fff;font-weight:950;font-size:17px}.save{background:#087ee5}.cancel{background:#555}.empty{background:rgba(8,19,38,.9);padding:20px;border-radius:18px;font-size:18px}@media(max-width:760px){.shade{padding:8px}.cards{grid-template-columns:1fr}#choose,#confirm{min-height:68px}.actions{flex-direction:column}.actions button{width:100%}}@media(orientation:landscape) and (min-width:800px){.shade{padding:10px}.picker{max-width:980px;margin:auto}.cards{grid-template-columns:repeat(2,minmax(0,1fr))}.name{font-size:24px}.card{padding:14px}}
</style>
</head>
<body>
<div class="shade"><main class="app">
<h1>__TITLE__</h1>
<section class="picker"><button id="choose"><span>CHOISIR SON __AREAWORD__</span><span>▼</span></button><button id="confirm" disabled>CONFIRMER</button></section>
<section id="results"><div id="days" class="days"></div><div id="heading"></div><div id="count"></div><div id="cards" class="cards"></div></section>
</main></div>
<div id="panel"><button id="close">FERMER</button><div id="areas"></div></div>
<dialog id="verifyDlg"><h2>VÉRIFIER CE MARCHÉ</h2><div id="verifyName"></div><label>Horaire confirmé</label><input id="vTime" placeholder="ex. 07h00–13h00"><label>Nombre de commerçants</label><input id="vCount" placeholder="ex. 20–30"><label>Tirage au sort</label><select id="vDraw"><option value="">À préciser</option><option>Oui</option><option>Non</option></select><label>Remarque</label><textarea id="vNote" placeholder="Information utile sur ce marché"></textarea><div class="modalBtns"><button class="cancel" id="cancelVerify">ANNULER</button><button class="save" id="saveVerify">ENREGISTRER</button></div></dialog>
<script>
const country='__COUNTRY__';
const countryCode='__COUNTRYCODE__';
const areas=__AREAS__;
const data=__DATA__;
const dayNames={lundi:'LUN',mardi:'MAR',mercredi:'MER',jeudi:'JEU',vendredi:'VEN',samedi:'SAM',dimanche:'DIM'};
const dayOrder=['dimanche','lundi','mardi','mercredi','jeudi','vendredi','samedi'];
let selected=null,currentDay=dayOrder[new Date().getDay()]||'lundi',verifyIndex=null;
const $=id=>document.getElementById(id);
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function label(a){return country==='fr'?a[0]+' — '+a[1]:a[1]}
function marketName(r){return r[2]||r[1]||'Marché'}
function marketPlace(r){return r[3]||'Localité à préciser'}
function key(r){return 'marketVerify:'+country+':'+r.slice(0,6).join('|')}
function weatherKey(r){return 'marketWeather:'+country+':'+marketName(r)+'|'+marketPlace(r)}
function savedFor(r){try{return JSON.parse(localStorage.getItem(key(r))||'null')}catch(e){return null}}
function populate(){
  $('areas').innerHTML=areas.map((a,i)=>`<button class="area" data-i="${i}">${esc(label(a))}</button>`).join('');
  document.querySelectorAll('.area').forEach(b=>b.onclick=()=>{
    selected=areas[+b.dataset.i];
    document.querySelectorAll('.area').forEach(x=>x.classList.remove('sel'));
    b.classList.add('sel');
    $('choose').firstElementChild.textContent=label(selected);
    $('confirm').disabled=false;$('confirm').classList.add('ready');
    $('panel').classList.remove('open');document.body.style.overflow='';
  });
}
$('choose').onclick=()=>{$('panel').classList.add('open');document.body.style.overflow='hidden'};
$('close').onclick=()=>{$('panel').classList.remove('open');document.body.style.overflow=''};
function buildDays(){
  $('days').innerHTML=Object.entries(dayNames).map(([k,v])=>`<button class="day ${k===currentDay?'active':''}" data-day="${k}">${v}</button>`).join('');
  document.querySelectorAll('.day').forEach(b=>b.onclick=()=>{currentDay=b.dataset.day;buildDays();render()});
}
function rows(){if(!selected)return[];return data.filter(r=>r[0]===selected[0]&&String(r[4]||'').toLowerCase()===currentDay)}
function cardHtml(r,i){
  const s=savedFor(r);const time=s?.time||r[5]||'Horaire à vérifier';const count=s?.count||r[7]||'À vérifier';const draw=s?.draw||'À vérifier';const note=s?.note||'';const type=r[6]||'Marché';
  return `<article class="card ${s?'verified':''}"><div class="name">${esc(marketName(r))}</div><div class="city">📍 ${esc(marketPlace(r))}</div><div class="meta">🕒 ${esc(time)}</div><div class="infoLine">👥 Commerçants : ${esc(count)}</div><div class="infoLine">🎲 Tirage au sort : ${esc(draw)}</div>${note?`<div class="infoLine">📝 ${esc(note)}</div>`:''}<span class="tag">${esc(type)}</span><div class="weather" id="wx-${i}"><b>🌤️ Météo 07h00–13h30</b><span>Chargement…</span></div><div class="actions"><button class="nav" onclick="navigateTo(${i})">ALLER AU MARCHÉ</button><button class="verify" onclick="openVerify(${i})">VÉRIFIER</button></div></article>`;
}
function render(){
  const rs=rows();$('heading').textContent=label(selected)+' — '+dayNames[currentDay];$('count').textContent=rs.length+' marché(s)';
  $('cards').innerHTML=rs.length?rs.map(cardHtml).join(''):'<div class="empty">Aucun marché enregistré pour ce jour.</div>';
  rs.forEach((r,i)=>loadWeather(r,i));
}
$('confirm').onclick=()=>{
  if(!selected)return;buildDays();render();$('results').style.display='block';
  setTimeout(()=>$('results').scrollIntoView({behavior:'smooth',block:'start'}),80);
};
function navigateTo(i){const r=rows()[i];const q=encodeURIComponent(marketName(r)+' '+marketPlace(r));location.href='https://www.google.com/maps/search/?api=1&query='+q}
function openVerify(i){
  const r=rows()[i];verifyIndex=i;const s=savedFor(r);
  $('verifyName').textContent=marketName(r)+' — '+marketPlace(r);
  $('vTime').value=s?.time||r[5]||'';$('vCount').value=s?.count||r[7]||'';$('vDraw').value=s?.draw||'';$('vNote').value=s?.note||'';
  $('verifyDlg').showModal();
}
$('cancelVerify').onclick=()=>$('verifyDlg').close();
$('saveVerify').onclick=()=>{
  const r=rows()[verifyIndex];localStorage.setItem(key(r),JSON.stringify({time:$('vTime').value.trim(),count:$('vCount').value.trim(),draw:$('vDraw').value,note:$('vNote').value.trim(),updated:Date.now()}));$('verifyDlg').close();render();
};
function nextDate(day){
  const map={dimanche:0,lundi:1,mardi:2,mercredi:3,jeudi:4,vendredi:5,samedi:6};const now=new Date();let d=(map[day]-now.getDay()+7)%7;if(d===0)d=7;const x=new Date(now);x.setDate(now.getDate()+d);return x.toISOString().slice(0,10);
}
function weatherIcon(code){if(code===0)return'☀️';if([1,2].includes(code))return'🌤️';if(code===3)return'☁️';if([45,48].includes(code))return'🌫️';if([51,53,55,56,57,61,63,65,66,67,80,81,82].includes(code))return'🌧️';if([71,73,75,77,85,86].includes(code))return'🌨️';if([95,96,99].includes(code))return'⛈️';return'🌤️'}
async function coordsFor(r){
  const k='coords:'+country+':'+marketPlace(r);try{const c=JSON.parse(localStorage.getItem(k)||'null');if(c)return c}catch(e){}
  const queries=[marketPlace(r),marketName(r)+' '+marketPlace(r)];
  for(const q of queries){try{const u='https://geocoding-api.open-meteo.com/v1/search?name='+encodeURIComponent(q)+'&count=5&language=fr&format=json&countryCode='+countryCode;const j=await fetch(u,{cache:'no-store'}).then(x=>x.json());if(j.results&&j.results.length){const z=j.results[0],c={lat:z.latitude,lon:z.longitude};try{localStorage.setItem(k,JSON.stringify(c))}catch(e){}return c}}catch(e){}}
  throw new Error('geo');
}
async function loadWeather(r,i){
  const el=$('wx-'+i);if(!el)return;
  try{
    const c=await coordsFor(r),date=nextDate(currentDay);const u='https://api.open-meteo.com/v1/forecast?latitude='+c.lat+'&longitude='+c.lon+'&hourly=temperature_2m,precipitation_probability,weather_code&timezone=auto&start_date='+date+'&end_date='+date;
    const j=await fetch(u,{cache:'no-store'}).then(x=>x.json());let temps=[],rain=[],codes=[];
    (j.hourly?.time||[]).forEach((t,k)=>{const hm=t.slice(11,16);if(hm>='07:00'&&hm<='13:30'){if(Number.isFinite(j.hourly.temperature_2m?.[k]))temps.push(j.hourly.temperature_2m[k]);if(Number.isFinite(j.hourly.precipitation_probability?.[k]))rain.push(j.hourly.precipitation_probability[k]);if(Number.isFinite(j.hourly.weather_code?.[k]))codes.push(j.hourly.weather_code[k])}});
    if(!temps.length)throw new Error('wx');const min=Math.round(Math.min(...temps)),max=Math.round(Math.max(...temps)),rp=rain.length?Math.max(...rain):0,code=codes.length?codes[Math.floor(codes.length/2)]:0;
    el.innerHTML='<b>'+weatherIcon(code)+' Météo 07h00–13h30</b><span>'+min+'° à '+max+'° · pluie max '+rp+'%</span>';
  }catch(e){el.innerHTML='<b>🌤️ Météo 07h00–13h30</b><span>Internet nécessaire pour la météo.</span>'}
}
populate();
</script>
</body></html>'''


def make_page(country, title, areas, data):
    area_word = 'DÉPARTEMENT' if country == 'fr' else 'PROVINCE / RÉGION'
    country_code = 'FR' if country == 'fr' else 'BE'
    return (TEMPLATE
            .replace('__TITLE__', title)
            .replace('__AREAWORD__', area_word)
            .replace('__COUNTRY__', country)
            .replace('__COUNTRYCODE__', country_code)
            .replace('__AREAS__', areas)
            .replace('__DATA__', data))


fr_areas = extract('/tmp/france-source.html', 'departments')
fr_data = extract('/tmp/france-source.html', 'data')
be_areas = extract('/tmp/belgique-source.html', 'regions')
be_data = extract('/tmp/belgique-source.html', 'data')

# Écrasement total des anciennes pages : seules ces nouvelles pages sont mises dans l'APK.
(A / 'marches.html').write_text(make_page('fr', 'MARCHÉS DE FRANCE', fr_areas, fr_data), encoding='utf-8')
(A / 'belgique-marches.html').write_text(make_page('be', 'MARCHÉS DE BELGIQUE', be_areas, be_data), encoding='utf-8')
