import baseWorker from "./v156.js";

function withHeader(response,name,value){
  const h=new Headers(response.headers);h.set(name,value);
  return new Response(response.body,{status:response.status,statusText:response.statusText,headers:h});
}

function removeScript(text,pattern){return text.replace(pattern,'')}

async function optimizeHtml(response,url){
  const type=response.headers.get('content-type')||'';
  if(!type.includes('text/html'))return response;
  let text=await response.text();
  if(url.pathname.endsWith('/special-marches.html')||url.pathname==='/special-marches.html'){
    const country=url.searchParams.get('country')==='be'?'be':'fr';
    if(country==='fr'){
      text=removeScript(text,/<script\s+src=["']market-data-be\.js[^"']*["']><\/script>\s*/i);
    }else{
      text=removeScript(text,/<script\s+src=["']market-data-fr\.js[^"']*["']><\/script>\s*/i);
      text=removeScript(text,/<script\s+src=["']markets-france-update-v139\.js[^"']*["']><\/script>\s*/i);
      text=removeScript(text,/<script\s+src=["']markets-france-osm-v139\.js[^"']*["']><\/script>\s*/i);
      text=removeScript(text,/<script\s+src=["']markets-35-corrections-v142\.js[^"']*["']><\/script>\s*/i);
      text=removeScript(text,/<script\s+src=["']markets-35-missing-v143\.js[^"']*["']><\/script>\s*/i);
      text=text.replace(/window\.__FR_DATA\s*=\s*Array\.isArray\(data\)\s*\?\s*data\.slice\(\)\s*:\s*\[\]\s*;/,'window.__FR_DATA = []; window.data = [];');
    }
    if(!text.includes('special-market-server-v157.js')){
      const tag='<script src="/special-market-server-v157.js?v=157" defer></script>';
      text=text.includes('</body>')?text.replace('</body>',tag+'</body>'):text+tag;
    }
  }
  const h=new Headers(response.headers);
  h.set('cache-control','no-store, no-cache, must-revalidate');
  return new Response(text,{status:response.status,statusText:response.statusText,headers:h});
}

function fastAsset(response,url){
  if(!response||!response.ok)return response;
  const p=url.pathname.toLowerCase();
  if(/\.(png|jpe?g|webp|svg|mp4)$/.test(p))return withHeader(response,'cache-control','public, max-age=86400, stale-while-revalidate=604800');
  if(/\.(css|js)$/.test(p)){
    if(p.includes('market-data-')||p.includes('markets-france-')||p.includes('markets-35-')||p.includes('markets-44-')||p.includes('markets-missing-'))return withHeader(response,'cache-control','public, max-age=3600, stale-while-revalidate=86400');
    return withHeader(response,'cache-control','public, max-age=900, stale-while-revalidate=3600');
  }
  return response;
}

export default{
  async fetch(request,env,ctx){
    const url=new URL(request.url);
    const response=await baseWorker.fetch(request,env,ctx);
    const type=response.headers.get('content-type')||'';
    if(type.includes('text/html'))return optimizeHtml(response,url);
    return fastAsset(response,url);
  }
};
