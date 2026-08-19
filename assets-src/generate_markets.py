from pathlib import Path
import re, ast

A=Path('app/src/main/assets'); A.mkdir(parents=True,exist_ok=True)

def extract(src,name):
    t=Path(src).read_text(encoding='utf-8',errors='ignore')
    m=re.search(r'const\s+'+re.escape(name)+r'\s*=\s*(\[.*?\]);',t,re.S)
    if not m: raise SystemExit('Impossible de trouver '+name+' dans '+src)
    return m.group(1)

def options(js,country):
    # Les options sont écrites directement dans le HTML : elles existent même si le JS ancien de l'autoradio plante.
    try: arr=ast.literal_eval(js)
    except Exception: return ''
    out=[]
    for i,a in enumerate(arr):
        lab=(str(a[0])+' — '+str(a[1])) if country=='fr' else str(a[1])
        lab=lab.replace('&','&amp;').replace('<','&lt;').replace('>','&gt;').replace('"','&quot;')
        out.append('<option value="%d">%s</option>'%(i,lab))
    return ''.join(out)

T='''<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no"><title>__TITLE__</title><style>
*{box-sizing:border-box}html,body{margin:0;min-height:100%;font-family:Arial,sans-serif;color:#fff;background:#07101d url('route66-bg.jpg') center/cover fixed no-repeat}.shade{min-height:100vh;background:rgba(2,8,18,.45);padding:10px}.app{width:98%;max-width:1180px;margin:auto}h1{text-align:center;font-size:44px;margin:8px 0 16px}.picker{background:rgba(8,19,38,.92);padding:20px;border-radius:24px}.label{font-size:25px;font-weight:bold;margin-bottom:10px}select{display:block;width:100%;height:96px;border:4px solid #62d8ff;border-radius:22px;background:#087ee5;color:white;font-size:30px;font-weight:bold;padding:0 20px}#confirm{display:block;width:90%;height:104px;margin:24px auto 0;border:4px solid #aaa;border-radius:28px;background:#777;color:#ddd;font-size:36px;font-weight:bold}#confirm.ready{background:#087ee5;border-color:#62d8ff;color:white}.results{display:none;margin-top:18px}.days{position:sticky;top:0;z-index:5;display:flex;gap:10px;overflow-x:auto;padding:12px;background:#071426}.day{flex:0 0 115px;height:60px;border:2px solid #62d8ff;border-radius:30px;background:#17304f;color:#fff;font-size:20px;font-weight:bold}.day.active{background:#087ee5}.heading{font-size:28px;font-weight:bold;margin:16px 4px}.cards{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px}.card{background:rgba(8,19,38,.94);padding:18px;border-radius:20px}.name{font-size:27px;font-weight:bold}.meta{font-size:18px;margin-top:9px}.weather{margin-top:14px;padding:11px;background:#071426;border-radius:12px}.actions{display:flex;gap:10px;margin-top:14px}.actions button{flex:1;height:60px;border:0;border-radius:14px;color:#fff;font-size:17px;font-weight:bold}.nav{background:#087ee5}.verify{background:#e89217}@media(max-width:760px){h1{font-size:34px}.cards{grid-template-columns:1fr}select{font-size:25px}#confirm{font-size:31px}}
</style></head><body><div class="shade"><main class="app"><h1>__TITLE__</h1><section class="picker"><div class="label">CHOISIR SON __WORD__</div><select id="areaSelect" onchange="areaChanged(this)"><option value="">— APPUYEZ ICI —</option>__OPTIONS__</select><button id="confirm" disabled onclick="confirmArea()">CONFIRMER</button></section><section id="results" class="results"><div id="days" class="days"></div><div id="heading" class="heading"></div><div id="cards" class="cards"></div></section></main></div><script>
var country='__COUNTRY__';var areas=__AREAS__;var data=__DATA__;var selected=null;var currentDay='lundi';var dayNames={lundi:'LUN',mardi:'MAR',mercredi:'MER',jeudi:'JEU',vendredi:'VEN',samedi:'SAM',dimanche:'DIM'};
function E(x){return document.getElementById(x)}function areaLabel(a){return country==='fr'?a[0]+' — '+a[1]:a[1]}
function areaChanged(s){var b=E('confirm');if(s.value===''){selected=null;b.disabled=true;b.className='';return}selected=areas[parseInt(s.value,10)];b.disabled=false;b.className='ready'}
function marketRows(){var o=[],i,r;if(!selected)return o;for(i=0;i<data.length;i++){r=data[i];if(String(r[0])===String(selected[0])&&String(r[4]||'').toLowerCase()===currentDay)o.push(r)}return o}
function buildDays(){var h='',k;for(k in dayNames)h+='<button class="day '+(k===currentDay?'active':'')+'" onclick="setDay(\''+k+'\')">'+dayNames[k]+'</button>';E('days').innerHTML=h}function setDay(d){currentDay=d;buildDays();render()}
function safe(x){var d=document.createElement('div');d.appendChild(document.createTextNode(String(x==null?'':x)));return d.innerHTML}
function render(){var rs=marketRows(),h='',i,r;E('heading').innerHTML=safe(areaLabel(selected))+' — '+dayNames[currentDay];for(i=0;i<rs.length;i++){r=rs[i];h+='<div class="card"><div class="name">'+safe(r[2]||r[1]||'Marché')+'</div><div class="meta">📍 '+safe(r[3]||'À préciser')+'</div><div class="meta">🕒 '+safe(r[5]||'Horaire à vérifier')+'</div><div class="meta">👥 Commerçants : '+safe(r[7]||'À vérifier')+'</div><div class="weather"><b>🌤️ Météo 07h00–13h30</b></div><div class="actions"><button class="nav" onclick="go('+i+')">ALLER AU MARCHÉ</button><button class="verify" onclick="verify('+i+')">VÉRIFIER</button></div></div>'}if(!h)h='<div class="card">Aucun marché enregistré pour ce jour.</div>';E('cards').innerHTML=h}
function confirmArea(){if(!selected){areaChanged(E('areaSelect'));if(!selected)return}buildDays();render();E('results').style.display='block';E('results').scrollIntoView(true)}function go(i){var r=marketRows()[i];location.href='https://www.google.com/maps/search/?api=1&query='+encodeURIComponent((r[2]||'')+' '+(r[3]||''))}function verify(i){var r=marketRows()[i];var time=prompt('Horaire vérifié :',r[5]||'');if(time!==null){try{localStorage.setItem('verify:'+country+':'+r.slice(0,6).join('|'),time)}catch(e){}alert('Vérification enregistrée')}}
</script></body></html>'''

def make(country,title,word,areas,data): return T.replace('__COUNTRY__',country).replace('__TITLE__',title).replace('__WORD__',word).replace('__AREAS__',areas).replace('__DATA__',data).replace('__OPTIONS__',options(areas,country))
frA=extract('/tmp/france-source.html','departments'); frD=extract('/tmp/france-source.html','data'); beA=extract('/tmp/belgique-source.html','regions'); beD=extract('/tmp/belgique-source.html','data')
(A/'marches.html').write_text(make('fr','MARCHÉS DE FRANCE','DÉPARTEMENT',frA,frD),encoding='utf-8')
(A/'belgique-marches.html').write_text(make('be','MARCHÉS DE BELGIQUE','PROVINCE / RÉGION',beA,beD),encoding='utf-8')
