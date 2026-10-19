(function () {
  'use strict';
  if (window.__gpsFuelRouteV40) return;
  window.__gpsFuelRouteV40 = true;
  const panel = document.getElementById('gpsFuelInfo');
  if (!panel) return;
  const api = '/api/fuel-stations';
  const rad = Math.PI / 180;
  function km(a, b) {
    const d = (b[0] - a[0]) * rad, e = (b[1] - a[1]) * rad;
    const v = Math.sin(d / 2) ** 2 + Math.cos(a[0] * rad) * Math.cos(b[0] * rad) * Math.sin(e / 2) ** 2;
    return 12742 * Math.asin(Math.min(1, Math.sqrt(v)));
  }
  function build(points) {
    const pts = points.filter(p => Array.isArray(p) && p.length >= 2 && Number.isFinite(p[0]) && Number.isFinite(p[1]) && Math.abs(p[0]) <= 90 && Math.abs(p[1]) <= 180);
    if (pts.length < 2) return null;
    const ds = [0];
    for (let i = 1; i < pts.length; i++) ds.push(ds[i - 1] + km(pts[i - 1], pts[i]));
    return {pts, ds, total: ds[ds.length - 1]};
  }
  // Project onto road segments, not just the sparse route vertices.
  function project(p, route) {
    let best = {d: Infinity, s: 0};
    const scale = Math.cos(p[0] * rad);
    for (let i = 1; i < route.pts.length; i++) {
      const a = route.pts[i - 1], b = route.pts[i];
      const ax = (a[1] - p[1]) * scale, ay = a[0] - p[0];
      const dx = (b[1] - a[1]) * scale, dy = b[0] - a[0];
      const den = dx * dx + dy * dy;
      const t = den ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / den)) : 0;
      const d = km(p, [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])]);
      if (d < best.d) best = {d, s: route.ds[i - 1] + t * (route.ds[i] - route.ds[i - 1]), point:[a[0]+t*(b[0]-a[0]),a[1]+t*(b[1]-a[1])]};
    }
    return best;
  }
  function samples(route, start) {
    const out = [];
    let i = 1;
    function at(s) {
      while (i < route.ds.length - 1 && route.ds[i] < s) i++;
      const a = route.pts[i - 1], b = route.pts[i];
      const len = route.ds[i] - route.ds[i - 1];
      const t = len ? (s - route.ds[i - 1]) / len : 0;
      return [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])];
    }
    for (let s = start; s < route.total; s += 20) out.push(at(s));
    out.push(route.pts[route.pts.length - 1]);
    return out;
  }
  let current = null, routeObject = null, fix = null, generation = 0, profile = {};
  let profileKey = '', batchIds = [], batchNumber = 0;
  const passedIds = new Set();
  const accessDistances = new Map();
  const membershipCache = new Map();
  let accessBusy = false;
  let found = new Map(), pending = false, completed = 0, total = 0, failures = 0, lastScan = 0;
  const controllers = new Set(), cache = new Map();
  let details = null, lastView = null;
  const escape = s => String(s || '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const price = v => Number.isFinite(v) && v > 0 ? v.toFixed(3).replace('.', ',') + ' €/L' : 'Non publié';
  const distanceText = distance => distance < .02 ? 'Station à proximité' : 'Prochaine ≈ ' + (distance < 1 ? Math.max(10, Math.round(distance * 1000 / 10) * 10) + ' m' : distance.toFixed(1).replace('.', ',') + ' km');
  const modeName = () => profile.travelMode === 'pedestrian' ? 'À pied' : profile.roadMode === 'direct' ? 'Par les villes' : 'Grandes routes';
  function renderDetails() {
    if (!details?.open) return;
    if (!lastView) { details.close(); return; }
    const {group, list, here, distance, cities} = lastView;
    const rows = group.map((station, index) => {
      const estimate = Math.max(0, station.s - here.s) + km(station.point, station.coords);
      const routed = index === 0 && distance !== null;
      const label = distanceText(routed ? distance : estimate).replace('Prochaine ≈', routed ? 'À ≈' : 'Estimation ≈');
      return '<li><strong>' + escape(station.name || station.city || 'Station') + '</strong><span>' + escape(station.city) + ' · ' + label + '</span><span>Gazole : ' + price(station.Gazole) + ' · SP98 : ' + price(station.SP98) + '</span></li>';
    }).join('');
    details.querySelector('.gps-fuel-detail-body').innerHTML = '<h2 id="gpsFuelDetailsTitle">' + modeName() + '</h2><p>Groupe ' + (batchNumber || 1) + ' · ' + group.length + ' stations à venir</p><ol>' + rows + '</ol><h3>Par ville, sur le parcours restant</h3><p>' + [...cities].map(([city, count]) => escape(city) + ' : <b>' + count + '</b>').join('<br>') + '</p><small>' + list.length + ' stations repérées' + (pending || failures ? ' · recherche incomplète' : '') + '. Accès vérifié dans le sens du parcours. Les coordonnées cartographiques peuvent être imprécises. Les estimations incluent une liaison à vol d’oiseau tant que l’accès routier n’est pas calculé.</small>';
  }
  function openDetails() {
    if (!lastView) return;
    if (!details) {
      details = document.createElement('dialog'); details.id = 'gpsFuelDetails39';
      details.setAttribute('aria-labelledby', 'gpsFuelDetailsTitle');
      details.innerHTML = '<button class="gps-fuel-close" type="button" aria-label="Fermer les stations">Fermer ×</button><div class="gps-fuel-detail-body"></div>';
      document.body.appendChild(details);
      details.querySelector('button').addEventListener('click', () => details.close());
      details.addEventListener('click', event => { if (event.target === details) details.close(); });
    }
    details.showModal(); renderDetails();
  }
  panel.setAttribute('role', 'button'); panel.tabIndex = 0;
  panel.setAttribute('aria-label', 'Stations du trajet : ouvrir les détails et le nombre par ville');
  panel.addEventListener('click', openDetails);
  panel.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); openDetails(); } });
  function remaining(here) {
    for (const station of found.values()) if (station.s < here.s - .08) passedIds.add(station.id);
    return [...found.values()].filter(v => !passedIds.has(v.id)).sort((a, b) => a.s - b.s || a.id.localeCompare(b.id));
  }
  function display() {
    if (!current) { lastView = null; renderDetails(); panel.textContent = '⛽ Stations : choisissez un trajet'; return; }
    const here = fix ? project(fix, current) : {s: 0, d: 0};
    if (fix && here.d > 3) { lastView = null; renderDetails(); panel.textContent = '⛽ Hors du trajet · attente du recalcul'; return; }
    const list = remaining(here);
    const byId = new Map(list.map(station => [station.id, station]));
    batchIds = batchIds.filter(id => byId.has(id));
    // Keep the same group until it is exhausted: 10, 9, ... 1, then the next 10 (or fewer).
    // Wait for the scan before fixing a group, so out-of-order replies cannot choose distant stations first.
    if (!batchIds.length && list.length && !pending) {
      batchIds = list.slice(0, 10).map(station => station.id);
      batchNumber++;
    }
    const group = batchIds.length ? batchIds.map(id => byId.get(id)) : list.slice(0, 10);
    const status = pending ? 'Recherche sur tout le trajet : ' + completed + '/' + total : failures ? 'Recherche partielle · nouvelle tentative automatique' : 'Tout le trajet analysé';
    if (!list.length) {
      lastView = null; renderDetails();
      panel.textContent = pending ? '⛽ Vérification des stations sur le parcours…' : failures ? '⛽ Vérification incomplète · réessai automatique' : '⛽ Aucune station confirmée sur ce parcours';
      return;
    }
    const next = group[0];
    const accessKey = next.id + ':' + next.point.map(v=>v.toFixed(5)).join(',') + ':' + profileKey;
    const access = accessDistances.get(accessKey);
    if (!accessBusy && (!access || (access.error && Date.now()-access.at>30000))) void calculateAccess(next, accessKey);
    const distance = access && Number.isFinite(access.km) ? Math.max(0,next.s-here.s) + access.km : null;
    const cities = new Map();
    for (const station of list) if (station.city) cities.set(station.city, (cities.get(station.city) || 0) + 1);
    const cityCounts = [...cities].map(([city, count]) => city + ' : ' + count).join(' · ');
    panel.title = modeName() + ' · Groupe ' + (batchNumber || 1) + ' · ' + list.length + ' stations repérées restantes · ' + cityCounts + ' · ' + (next.name || next.city || '') + ' · ' + status + ' · Accès vérifié sur le parcours sélectionné' + (next.updated ? ' · Prix déclaré le ' + new Date(next.updated).toLocaleDateString('fr-FR') : '');
    // A failed routing service must not produce a fake 0 m. Show the geometric estimate explicitly.
    const estimate = Math.max(0, next.s - here.s) + km(next.point, next.coords);
    const dist = distance === null ? distanceText(estimate).replace('Prochaine ≈', 'Estimation ≈') : distanceText(distance);
    const countLabel = pending || failures ? ' repérée' : ' à venir';
    panel.innerHTML = '<b>⛽ ' + group.length + ' station' + (group.length > 1 ? 's' : '') + countLabel + ((pending || failures) && group.length > 1 ? 's' : '') + '</b><div class="gps-station-distance">' + dist + '</div><div>Gazole : ' + price(next.Gazole) + '</div><div>SP98 : ' + price(next.SP98) + '</div>';
    panel.dataset.group = String(batchNumber || 1);
    panel.dataset.remaining = String(group.length);
    panel.dataset.total = String(list.length);
    panel.dataset.mode = profile.roadMode || 'main';
    panel.dataset.cityCounts = JSON.stringify(Object.fromEntries(cities));
    lastView = {group, list, here, distance, cities}; renderDetails();
  }
  async function calculateAccess(station, key) {
    const token = generation;
    const requestProfile = {...profile};
    accessBusy = true;
    await Promise.resolve();
    const controller = new AbortController();
    controllers.add(controller);
    const timer = setTimeout(()=>controller.abort(),27000);
    try {
      const direct = km(station.point,station.coords);
      let distance;
      if (direct < .015) distance = direct;
      else {
        const response = await fetch('/gps/api/route?fuel-access=1',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({from:station.point,to:station.coords,profile:requestProfile}),signal:controller.signal});
        if (!response.ok) throw Error('Station access route unavailable');
        const data = await response.json();
        distance = Number(data.summary?.lengthInMeters) / 1000;
        if (!Number.isFinite(distance) || distance < direct * .8) throw Error('Station access distance invalid');
      }
      if (token === generation) accessDistances.set(key,{km:distance,at:Date.now()});
    } catch (_) {
      if (token === generation) accessDistances.set(key,{error:true,at:Date.now()});
    } finally {
      clearTimeout(timer);controllers.delete(controller);
      if (token === generation) {accessBusy=false;display();}
    }
  }
  async function query(p, fuel, token) {
    const key = p.map(v => v.toFixed(4)).join(',') + ':' + fuel;
    const old = cache.get(key);
    if (old && Date.now() - old.at < 120000) return old.rows;
    for (let attempt = 0; attempt < 2; attempt++) {
      if (token !== generation) return null;
      const controller = new AbortController();
      controllers.add(controller);
      const timer = setTimeout(() => controller.abort(), 25000);
      try {
        const response = await fetch(api + '?lat=' + p[0] + '&lon=' + p[1] + '&fuel=' + fuel, {signal: controller.signal});
        if (!response.ok) throw Error('HTTP ' + response.status);
        const data = await response.json();
        if (!data.ok || !Array.isArray(data.stations)) throw Error('Stations indisponibles');
        cache.set(key, {at: Date.now(), rows: data.stations});
        if (cache.size > 400) cache.delete(cache.keys().next().value);
        return data.stations;
      } catch (_) { if (token !== generation) return null; }
      finally { clearTimeout(timer); controllers.delete(controller); }
    }
    return null;
  }
  function pointAt(route, s) {
    s = Math.max(0, Math.min(route.total, s));
    let low = 1, high = route.ds.length - 1;
    while (low < high) { const mid = (low + high) >> 1; if (route.ds[mid] < s) low = mid + 1; else high = mid; }
    const a = route.pts[low - 1], b = route.pts[low], length = route.ds[low] - route.ds[low - 1];
    const t = length ? (s - route.ds[low - 1]) / length : 0;
    return [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])];
  }
  async function accessRoute(from, to, requestProfile, token) {
    if (token !== generation) throw Error('Obsolete route');
    const controller = new AbortController(); controllers.add(controller);
    const timer = setTimeout(() => controller.abort(), 20000);
    try {
      const response = await fetch('/gps/api/route?fuel-access=1', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({from,to,profile:requestProfile}),signal:controller.signal});
      if (!response.ok) throw Error('Access verification unavailable');
      const data = await response.json();
      if (!Array.isArray(data.points) || data.points.length < 2 || !Number.isFinite(data.summary?.lengthInMeters)) throw Error('Invalid access route');
      if (!data.points.every(p => Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1]))) throw Error('Invalid geometry');
      return data;
    } finally { clearTimeout(timer); controllers.delete(controller); }
  }
  async function verifyOnRoute(station, route, token, requestProfile) {
    const cached = membershipCache.get(station.id);
    if (cached) return cached;
    // A nearby town is not part of the route: only inspect stations immediately beside it.
    // Coordinates and road snapping have finite precision; validate the actual access in both directions too.
    const before = Math.max(0, station.s - .15), after = Math.min(route.total, station.s + .15);
    if (after - before < .03) return {accepted:false};
    const from = pointAt(route, before), to = pointAt(route, after);
    const inbound = await accessRoute(from, station.coords, requestProfile, token);
    const outbound = await accessRoute(station.coords, to, requestProfile, token);
    if (token !== generation) throw Error('Obsolete route');
    const joined = [...inbound.points, ...outbound.points];
    let accepted = km(inbound.points.at(-1), station.coords) <= .075 && km(outbound.points[0], station.coords) <= .075;
    accepted = accepted && km(inbound.points[0], from) <= .05 && km(outbound.points.at(-1), to) <= .05;
    const length = (inbound.summary.lengthInMeters + outbound.summary.lengthInMeters) / 1000;
    accepted = accepted && length <= after - before + .12 && length >= (after - before) * .65;
    let furthest = before;
    // Densify to reject even sparse geometries that leave the selected road or turn back.
    for (let i = 0; accepted && i < joined.length; i++) {
      const a = i ? joined[i - 1] : joined[i], b = joined[i];
      const count = Math.max(1, Math.ceil(km(a, b) / .02));
      for (let n = 1; n <= count; n++) {
        const point = [a[0] + (b[0]-a[0])*n/count, a[1] + (b[1]-a[1])*n/count];
        const near = project(point, route);
        if (near.d > .045 || near.s < before - .035 || near.s > after + .035 || near.s < furthest - .035) { accepted = false; break; }
        furthest = Math.max(furthest, near.s);
      }
    }
    const result = {accepted, km:Math.max(0, inbound.summary.lengthInMeters/1000 - (station.s-before))};
    membershipCache.set(station.id,result);
    return result;
  }
  async function scan() {
    if (!current || pending) return;
    const token = generation, route = current, requestProfile = {...profile}, scanProfileKey = profileKey;
    const here = fix ? project(fix, route) : {s: 0, d: 0};
    if (here.d > 3) return;
    pending = true; lastScan = Date.now(); completed = 0; failures = 0;
    const locations = samples(route, here.s), refreshed = new Map(), candidates = new Map();
    total = locations.length; let cursor = 0;
    display();
    async function worker() {
      while (cursor < locations.length && token === generation) {
        const p = locations[cursor++];
        const results = await Promise.all(['Gazole', 'SP98'].map(fuel => query(p, fuel, token)));
        if (token !== generation) return;
        results.forEach((rows, n) => {
          if (rows === null) { failures++; return; }
          const fuel = n === 0 ? 'Gazole' : 'SP98';
          for (const st of rows) {
            if (st.available === false || !(Number(st.price) > 0) || !Number.isFinite(Number(st.lat)) || !Number.isFinite(Number(st.lon))) continue;
            const key = String(st.id || st.lat + ',' + st.lon);
            const near = project([Number(st.lat), Number(st.lon)], route);
            if (near.d > .075 || near.s < here.s - .08) continue;
            const v = candidates.get(key) || {id:String(key), coords:[Number(st.lat),Number(st.lon)], point:near.point, s: near.s, name: st.name || st.brand || '', city: st.city || '', updated: null};
            v[fuel] = Number(st.price);
            if (fuel === 'Gazole' || !v.updated) v.updated = st.updatedAt;
            candidates.set(key, v);
          }
        });
        completed++; display();
      }
    }
    try {
      await Promise.all([worker(), worker()]);
      if (token !== generation) return;
      const ordered = [...candidates.values()].sort((a,b)=>a.s-b.s); let checkIndex = 0;
      async function verifyWorker() {
        while (checkIndex < ordered.length && token === generation) {
          const station = ordered[checkIndex++];
          try {
            const result = await verifyOnRoute(station, route, token, requestProfile);
            if (token !== generation) return;
            if (result.accepted) {
              const key = station.id + ':' + station.point.map(v=>v.toFixed(5)).join(',') + ':' + scanProfileKey;
              accessDistances.set(key,{km:result.km,at:Date.now()});
              found.set(station.id,station); refreshed.set(station.id,station);
            }
          } catch (_) { if (token !== generation) return; failures++; }
          display();
        }
      }
      await Promise.all([verifyWorker(),verifyWorker()]);
    }
    finally { if (token === generation) { if (!failures) found = refreshed; pending = false; display(); } }
  }
  window.addEventListener('gps-fuel-state-v35', event => {
    const data = event.detail || {};
    if(data.profile)profile=data.profile;
    const nextProfileKey = JSON.stringify([profile.travelMode,profile.roadMode,profile.tolls,profile.vehicle,profile.trailer,profile.height,profile.width,profile.length,profile.weight]);
    const pos = data.position;
    if (pos && !pos.waiting && !(pos.accuracy > 100) && Number.isFinite(pos.lat) && Number.isFinite(pos.lon)) fix = [pos.lat, pos.lon];
    if (data.route !== routeObject || nextProfileKey !== profileKey) {
      profileKey = nextProfileKey; batchIds = []; batchNumber = 0; passedIds.clear();
      routeObject = data.route; generation++; accessDistances.clear(); membershipCache.clear(); accessBusy=false;
      for (const controller of controllers) controller.abort();
      controllers.clear(); pending = false; found = new Map(); failures = 0;
      current = data.route && Array.isArray(data.route.points) ? build(data.route.points) : null;
      if (current) void scan();
    }
    display();
  });
  setInterval(() => { if (current && !pending && Date.now() - lastScan > (failures ? 30000 : 180000)) void scan(); if(current)display(); }, 15000);
  display();
})();
