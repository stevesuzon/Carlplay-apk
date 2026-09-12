(function () {
  "use strict";
  if (!window.CARPLAY_MARKET_LAZY) {
    document.write('<script src="markets-44-complete.js?v=20260902-complet"><\/script>');
    document.write('<script src="markets-france-national.js?v=20260902-national"><\/script>');
    document.write('<script src="markets-missing-v97.js?v=20260902"><\/script>');
    document.write('<script src="markets-missing-v100.js?v=20260902"><\/script>');
    document.write('<script src="markets-missing-v101.js?v=20260902"><\/script>');
    document.write('<script src="markets-missing-v102.js?v=20260902"><\/script>');
    document.write('<script src="markets-missing-v103.js?v=20260902"><\/script>');
    document.write('<script src="markets-missing-v104.js?v=20260902"><\/script>');
    document.write('<script src="market-weekly-filter.js?v=20260902-france-belgique"><\/script>');
  }
  var selected = null,
    server = "https://carplay-metiers.appli-suzon.workers.dev",
    searchQuery = "";
  var days = [
    "lundi",
    "mardi",
    "mercredi",
    "jeudi",
    "vendredi",
    "samedi",
    "dimanche",
  ];
  var jsDay = new Date().getDay();
  var currentDay =
    ["dimanche", "lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi"][
      jsDay
    ] || "lundi";
  var labels = {
    lundi: "LUN",
    mardi: "MAR",
    mercredi: "MER",
    jeudi: "JEU",
    vendredi: "VEN",
    samedi: "SAM",
    dimanche: "DIM",
  };
  function el(id) {
    return document.getElementById(id);
  }
  function esc(v) {
    return String(v == null ? "" : v)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }
  function cleanCardText(v) {
    return String(v == null ? "" : v)
      .replace(/\s+officiellement\b/gi, "")
      .replace(/\s*[,;:-]?\s*GPS\s+[àa]\s+confirmer\s+sur\s+place\b/gi, "")
      .replace(/\s{2,}/g, " ")
      .trim();
  }
  function verificationDot(r, s) {
    var note = String((r && r[6]) || "")
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "");
    var complete = s && s.time && s.count && s.draw;
    var official = note.indexOf("verifie sur le site officiel") >= 0 || note.indexOf("verifie officiellement") >= 0;
    var ok = !!complete || official;
    return '<span class="marketVerificationDot ' + (ok ? "green" : "orange") + '" title="' + (ok ? "Fiche vérifiée" : "Fiche à vérifier") + '" aria-label="' + (ok ? "Fiche vérifiée" : "Fiche à vérifier") + '"></span>';
  }
  function favoriteKey(r) {
    return "marketFavoriteDeviceOnlyV1:" + country + ":" + identity(r);
  }
  function isFavorite(r) {
    try {
      return localStorage.getItem(favoriteKey(r)) === "1";
    } catch (e) {
      return false;
    }
  }
  function toggleFavorite(index, btn) {
    var r = marketRows()[index],
      k,
      on;
    if (!r) return;
    k = favoriteKey(r);
    try {
      on = localStorage.getItem(k) === "1";
      if (on) localStorage.removeItem(k);
      else localStorage.setItem(k, "1");
      on = !on;
    } catch (e) {
      on = isFavorite(r);
    }
    if (btn) {
      btn.classList.toggle("active", on);
      btn.textContent = on ? "★" : "☆";
      btn.setAttribute(
        "aria-label",
        on ? "Retirer des favoris" : "Ajouter aux favoris",
      );
      btn.setAttribute(
        "title",
        on ? "Retirer des favoris" : "Ajouter aux favoris",
      );
    }
    return false;
  }
  window.toggleMarketFavorite = toggleFavorite;
  (function migrateLocalFavorites() {
    try {
      var i, k, v, nk;
      for (i = localStorage.length - 1; i >= 0; i--) {
        k = localStorage.key(i);
        if (k && k.indexOf("marketFavoriteV1:") === 0) {
          v = localStorage.getItem(k);
          nk = k.replace("marketFavoriteV1:", "marketFavoriteDeviceOnlyV1:");
          if (v === "1" && localStorage.getItem(nk) !== "1")
            localStorage.setItem(nk, "1");
          localStorage.removeItem(k);
        }
      }
    } catch (e) {}
  })();
  function areaLabel(a) {
    return country === "fr" ? a[0] + " — " + a[1] : a[1];
  }
  function areaKey() {
    return selected ? String(selected[0]) : "";
  }
  var marketChunkCache = {}, marketChunkToken = 0;
  function marketChunkUrl() {
    return "/market-chunks/" + encodeURIComponent(country) + "/" +
      encodeURIComponent(areaKey()) + "/" + encodeURIComponent(currentDay) + ".json?v=160";
  }
  function loadSelectedMarketChunk(done) {
    if (!window.CARPLAY_MARKET_LAZY) { done(); return; }
    var key = country + "|" + areaKey() + "|" + currentDay, token = ++marketChunkToken;
    if (marketChunkCache[key]) { window.data = marketChunkCache[key]; done(); return; }
    if (el("cards")) el("cards").innerHTML = '<article class="card empty">Chargement des marchés…</article>';
    fetch(marketChunkUrl(), { cache: "no-cache" })
      .then(function (r) { if (!r.ok) throw 0; return r.json(); })
      .then(function (rows) {
        if (token !== marketChunkToken) return;
        marketChunkCache[key] = Array.isArray(rows) ? rows : [];
        window.data = marketChunkCache[key];
        done();
      })
      .catch(function () {
        if (token !== marketChunkToken) return;
        window.data = [];
        if (el("cards")) el("cards").innerHTML = '<article class="card empty">Impossible de charger les marchés. Vérifiez Internet puis réessayez.</article>';
      });
  }
  function renderSelectedMarkets() {
    loadSelectedMarketChunk(function () { renderMarkets(); });
  }
  function normSearch(v) {
    return String(v || "")
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, " ")
      .trim();
  }
  function marketRows() {
    var k = areaKey(),
      out = [],
      i,
      r,
      q = normSearch(searchQuery),
      aq = q,
      a = window.BE_CITY_ALIASES || {},
      x;
    if (country === "be" && q) {
      for (x in a) {
        if (normSearch(x) === q) {
          aq = normSearch(a[x]);
          break;
        }
      }
    }
    for (i = 0; i < data.length; i++) {
      r = data[i];
      if (
        String(r[0]) === k &&
        String(r[4]).toLowerCase() === currentDay &&
        (!q ||
          normSearch(
            (r[2] || "") + " " + (r[3] || "") + " " + (r[8] || ""),
          ).indexOf(q) >= 0 ||
          normSearch(
            (r[2] || "") + " " + (r[3] || "") + " " + (r[8] || ""),
          ).indexOf(aq) >= 0)
      )
        out.push(r);
    }
    return out;
  }
  function verificationKey(r) {
    return (
      "marketVerifyV9:" +
      country +
      ":" +
      [r[0], r[1], r[2], r[3], r[4], r[5], r[8] || ""].join("|")
    );
  }
  function saved(r) {
    try {
      var v = localStorage.getItem(verificationKey(r));
      return v ? JSON.parse(v) : null;
    } catch (e) {
      return null;
    }
  }
  function correctedNow() {
    var epoch = Number(localStorage.getItem("net_time_epoch") || 0),
      savedAt = Number(localStorage.getItem("net_time_saved_at") || 0);
    return epoch && savedAt
      ? new Date(epoch + (Date.now() - savedAt))
      : new Date();
  }
  function dayNumber(day) {
    return {
      dimanche: 0,
      lundi: 1,
      mardi: 2,
      mercredi: 3,
      jeudi: 4,
      vendredi: 5,
      samedi: 6,
    }[day];
  }
  function nextDate(day) {
    var d = correctedNow(),
      target = dayNumber(day),
      add = (target - d.getDay() + 7) % 7;
    d.setDate(d.getDate() + add);
    return (
      d.getFullYear() +
      "-" +
      String(d.getMonth() + 1).padStart(2, "0") +
      "-" +
      String(d.getDate()).padStart(2, "0")
    );
  }
  function countDate(day) {
    return nextDate(day) + "-compteurs-reels-v6-20260824-zero-general";
  }
  function deviceId() {
    var id = localStorage.getItem("shared_trade_device");
    if (!id) {
      id = "a" + Date.now().toString(36) + Math.random().toString(36).slice(2);
      localStorage.setItem("shared_trade_device", id);
    }
    return id;
  }
  function currentTrade() {
    return String(localStorage.getItem("market_trade") || "").trim();
  }
  var tradeChoices = [
    "Brocante",
    "Matelas",
    "Vêtements",
    "Alimentaire",
    "Outillage",
    "Bijoux",
    "Chaussures",
    "Couvreur",
    "Rempailleur / Restauration",
    "Bonbons des Vosges",
    "Horloger",
    "Meubles",
    "Tapis",
    "Espace vert",
  ];
  function knownTrade(v) {
    return tradeChoices.indexOf(v) >= 0;
  }
  function identity(r) {
    return [country, r[0], r[2], r[3], r[4], r[8] || ""].join("|");
  }
  function closeBubble() {
    var old = el("newMarketBubble");
    if (old && old.parentNode) old.parentNode.removeChild(old);
  }
  function bubble(html) {
    closeBubble();
    var box = document.createElement("div");
    box.id = "newMarketBubble";
    box.style.cssText =
      "position:fixed;z-index:300000;inset:0;background:rgba(0,0,0,.88);display:flex;align-items:center;justify-content:center;padding:22px";
    box.innerHTML = '<div class="bubbleBox">' + html + "</div>";
    document.body.appendChild(box);
  }
  function bindTap(node, action) {
    if (!node) return;
    function run(e) {
      var now = Date.now();
      if (now - (node.__lastDirectTap || 0) < 650) return false;
      node.__lastDirectTap = now;
      if (e) {
        if (e.preventDefault) e.preventDefault();
        if (e.stopPropagation) e.stopPropagation();
      }
      action();
      return false;
    }
    node.ontouchend = run;
    node.onclick = run;
  }
  function marketTap(node, action) {
    if (!node) return;
    var sx = 0,
      sy = 0,
      moved = false;
    node.ontouchstart = function (e) {
      var t = e.touches && e.touches[0];
      if (t) {
        sx = t.clientX;
        sy = t.clientY;
        moved = false;
      }
    };
    node.ontouchmove = function (e) {
      var t = e.touches && e.touches[0];
      if (t && (Math.abs(t.clientX - sx) > 14 || Math.abs(t.clientY - sy) > 14))
        moved = true;
    };
    function run(e) {
      var now = Date.now();
      if (moved || now - (node.__marketTapAt || 0) < 650) return false;
      node.__marketTapAt = now;
      if (e) {
        if (e.preventDefault) e.preventDefault();
        if (e.stopPropagation) e.stopPropagation();
      }
      action();
      return false;
    }
    node.ontouchend = run;
    node.onclick = run;
  }
  function gps(r) {
    var rawLat = r[10],
      rawLon = r[11],
      hasCoords =
        rawLat !== null &&
        rawLat !== undefined &&
        rawLat !== "" &&
        rawLon !== null &&
        rawLon !== undefined &&
        rawLon !== "",
      lat = hasCoords ? Number(rawLat) : NaN,
      lon = hasCoords ? Number(rawLon) : NaN,
      destination,
      q,
      pref = localStorage.getItem("gps_pref") || "Google Maps";
    hasCoords = hasCoords && Number.isFinite(lat) && Number.isFinite(lon);
    if (hasCoords) {
      destination = lat + "," + lon;
    } else {
      destination = [r[3] || "", r[2] || "", r[8] || ""]
        .filter(Boolean)
        .join(", ");
    }
    q = encodeURIComponent(destination);
    window.location.href =
      pref === "Waze"
        ? "https://www.waze.com/ul?ll=" +
          (hasCoords ? encodeURIComponent(lat + "," + lon) : "") +
          "&q=" +
          q +
          "&navigate=yes"
        : pref === "Plans Apple"
          ? "https://maps.apple.com/?daddr=" + q + "&dirflg=d"
          : "https://www.google.com/maps/dir/?api=1&destination=" +
          q +
          "&travelmode=driving&dir_action=navigate";
  }
  function askTrade() {
    bubble(
      '<h2>VOTRE MÉTIER</h2><p>Choisissez obligatoirement un métier dans la liste pour ne pas fausser les compteurs.</p><select id="newTradeSelect" style="width:94%;height:68px;border:3px solid #62d8ff;border-radius:15px;background:#081727;color:#fff;font-size:24px;padding:10px"><option value="">CHOISIR SON MÉTIER</option><option>Brocante</option><option>Matelas</option><option>Vêtements</option><option>Alimentaire</option><option>Outillage</option><option>Bijoux</option><option>Chaussures</option><option>Couvreur</option><option>Rempailleur / Restauration</option><option>Bonbons des Vosges</option><option>Horloger</option><option>Meubles</option><option>Tapis</option><option>Espace vert</option></select><div class="bubbleBtns"><button id="newCancel" class="red">ANNULER</button><button id="newTradeSave" class="blue">ENREGISTRER</button></div>',
    );
    bindTap(el("newCancel"), closeBubble);
    bindTap(el("newTradeSave"), function () {
      var s = el("newTradeSelect"),
        v = s.value;
      if (!knownTrade(v)) {
        s.focus();
        return;
      }
      localStorage.setItem("market_trade", v);
      el("tradeInput").value = v;
      el("tradeStatus").textContent = "Métier enregistré : " + v;
      closeBubble();
      renderMarkets();
    });
  }
  function unavailable(r) {
    bubble(
      '<h2>SERVEUR INDISPONIBLE</h2><p>La concurrence ne peut pas être vérifiée. Vous pouvez quand même ouvrir le GPS.</p><div class="bubbleBtns"><button id="newOther" class="red">AUTRE MARCHÉ</button><button id="newGps" class="blue">CONTINUER AVEC LE GPS</button></div>',
    );
    bindTap(el("newOther"), closeBubble);
    bindTap(el("newGps"), function () {
      closeBubble();
      gps(r);
    });
  }
  function showCount(count, trade, r, date) {
    var text =
      count === 0
        ? "Aucun marchand de <b>" +
          esc(trade) +
          "</b> n’est en route pour ce marché."
        : '<b class="bigCount">' +
          count +
          "</b> marchand" +
          (count > 1 ? "s" : "") +
          " de <b>" +
          esc(trade) +
          "</b> " +
          (count > 1 ? "sont" : "est") +
          " en route pour ce marché.";
    bubble(
      "<h2>CONCURRENCE SUR CE MARCHÉ</h2><p>" +
        text +
        '</p><div class="bubbleBtns"><button id="newOther" class="red">CHERCHER UN AUTRE MARCHÉ</button><button id="newGps" class="blue">CONTINUER AVEC LE GPS</button></div><small>Le nombre concerne uniquement les utilisateurs de l’application.</small>',
    );
    bindTap(el("newOther"), closeBubble);
    bindTap(el("newGps"), function () {
      closeBubble();
      try {
        fetch(server + "/api/choose", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            device: deviceId(),
            market: identity(r),
            date: date,
            trade: trade,
          }),
        }).catch(function () {});
      } catch (e) {}
      gps(r);
    });
  }
  function goDirect(index) {
    var r = marketRows()[index],
      trade = currentTrade(),
      date,
      opened = false,
      timer,
      request;
    if (!r) return;
    if (!trade) {
      askTrade();
      return;
    }
    date = countDate(currentDay);
    function openGps() {
      if (opened) return;
      opened = true;
      clearTimeout(timer);
      gps(r);
    }
    timer = setTimeout(openGps, 2500);
    try {
      request = fetch(server + "/api/choose", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          device: deviceId(),
          market: identity(r),
          date: date,
          trade: trade,
        }),
        keepalive: true,
      });
      if (request && request.then) {
        request
          .then(function () {
            loadCounts(marketRows());
          })
          .catch(function () {})
          .then(openGps);
        return;
      }
    } catch (e) {}
    openGps();
  }
  window.goMarket = goDirect;
  function countNote() {
    return '<div style="margin-top:7px;padding-top:7px;border-top:1px solid #f39b19;color:#ddd;font-size:13px;line-height:1.25">Indicatif : seuls les utilisateurs de l’appli sont comptés. D’autres marchands peuvent être présents.</div>';
  }
  function loadCounts(rs) {
    var trade = currentTrade(),
      i;
    if (!trade) {
      for (i = 0; i < rs.length; i++)
        el("competition_" + i).innerHTML =
          "⚠️ Enregistrez votre métier pour voir la concurrence" + countNote();
      return;
    }
    for (i = 0; i < rs.length; i++) loadOneCount(rs[i], i, trade);
  }
  function loadOneCount(r, index, trade) {
    var box = el("competition_" + index),
      date = countDate(currentDay),
      url =
        server +
        "/api/count?market=" +
        encodeURIComponent(identity(r)) +
        "&date=" +
        encodeURIComponent(date) +
        "&trade=" +
        encodeURIComponent(trade.toLowerCase()),
      finished = false,
      timer = setTimeout(function () {
        if (!finished) {
          finished = true;
          box.innerHTML = "⚠️ Concurrence indisponible" + countNote();
        }
      }, 4500);
    fetch(url, { cache: "no-store" })
      .then(function (res) {
        if (!res.ok) throw 0;
        return res.json();
      })
      .then(function (json) {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        var n = Number(json.count || 0),
          line =
            n === 0
              ? 'Aucun marchand de <b style="color:#ffd36d">' +
                esc(trade) +
                "</b> n’est en route pour ce marché"
              : '<b style="color:#ffd36d;font-size:27px">' +
                n +
                "</b> marchand" +
                (n > 1 ? "s" : "") +
                ' de <b style="color:#ffd36d">' +
                esc(trade) +
                "</b> " +
                (n > 1 ? "sont" : "est") +
                " en route pour ce marché";
        box.innerHTML = line + countNote();
      })
      .catch(function () {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        box.innerHTML = "⚠️ Concurrence indisponible" + countNote();
      });
  }
  function renderDays() {
    var html = "",
      i;
    for (i = 0; i < days.length; i++)
      html +=
        '<button type="button" class="day ' +
        (days[i] === currentDay ? "active" : "") +
        '" data-day="' +
        days[i] +
        '">' +
        labels[days[i]] +
        "</button>";
    el("days").innerHTML = html;
    var buttons = el("days").getElementsByTagName("button");
    for (i = 0; i < buttons.length; i++)
      buttons[i].onclick = function () {
        currentDay = this.getAttribute("data-day");
        renderDays();
        renderSelectedMarkets();
      };
    setTimeout(function () {
      var active = el("days").querySelector(".day.active");
      if (active && active.scrollIntoView)
        active.scrollIntoView({
          behavior: "smooth",
          block: "nearest",
          inline: "center",
        });
    }, 20);
  }
  function listText(v) {
    return v && v.length ? v.join(", ") : "À vérifier";
  }
  function builtInDraw(r) {
    var city = String((r && r[3]) || "").toLowerCase();
    if (city.indexOf("nantes") >= 0) return "Oui";
    if (city.indexOf("rennes") >= 0) return "Oui";
    return "À vérifier";
  }
  function marketDistanceText(r) {
    var a = parseFloat(localStorage.getItem("return_lat")),
      b = parseFloat(localStorage.getItem("return_lon")),
      c = parseFloat(r && r[10]),
      d = parseFloat(r && r[11]);
    if (!isFinite(a) || !isFinite(b) || !isFinite(c) || !isFinite(d)) return "";
    var p = Math.PI / 180,
      da = (c - a) * p,
      db = (d - b) * p,
      x =
        Math.sin(da / 2) * Math.sin(da / 2) +
        Math.cos(a * p) * Math.cos(c * p) * Math.sin(db / 2) * Math.sin(db / 2),
      km = 2 * 6371 * Math.asin(Math.sqrt(x));
    if (km < 1) return Math.round(km * 1000) + " m";
    return (km < 10 ? km.toFixed(1) : Math.round(km)) + " km";
  }
  function renderMarkets() {
    var rs = marketRows(),
      html = "",
      i,
      r,
      s,
      name,
      place,
      time,
      count,
      url,
      fav;
    el("heading").textContent =
      areaLabel(selected) +
      " — " +
      currentDay.toUpperCase() +
      (searchQuery ? " — RECHERCHE : " + searchQuery.toUpperCase() : "");
    for (i = 0; i < rs.length; i++) {
      r = rs[i];
      s = saved(r) || {};
      name = cleanCardText(r[2] || "Marché");
      place = cleanCardText(r[3] || "À préciser");
      time = cleanCardText(s.time || r[5] || "Horaire à vérifier");
      count = cleanCardText(s.count || r[7] || "À vérifier");
      fav = isFavorite(r);
      url =
        "verification-v9.html?k=" +
        encodeURIComponent(verificationKey(r)) +
        "&n=" +
        encodeURIComponent(name) +
        "&t=" +
        encodeURIComponent(r[5] || "") +
        "&c=" +
        encodeURIComponent(r[7] || "") +
        "&mk=" +
        encodeURIComponent(identity(r)) +
        "&country=" +
        encodeURIComponent(country) +
        "&lat=" +
        encodeURIComponent(r[10] == null ? "" : r[10]) +
        "&lon=" +
        encodeURIComponent(r[11] == null ? "" : r[11]) +
        "&back=" +
        encodeURIComponent(
          (country === "be"
            ? "belgique-marches-final.html"
            : "marches-final.html") +
            "?area=" +
            encodeURIComponent(areaKey()) +
            "&day=" +
            encodeURIComponent(currentDay),
        );
      html +=
        '<article class="card">' + verificationDot(r, s) + '<button type="button" class="marketFavoriteStar ' +
        (fav ? "active" : "") +
        '" aria-label="' +
        (fav ? "Retirer des favoris" : "Ajouter aux favoris") +
        '" title="' +
        (fav ? "Retirer des favoris" : "Ajouter aux favoris") +
        '" onclick="return window.toggleMarketFavorite(' +
        i +
        ',this)">' +
        (fav ? "★" : "☆") +
        '</button><div class="name">' +
        esc(place) +
        "</div>" +
        '<div class="meta" style="font-weight:900;font-size:20px;margin-bottom:8px">' +
        esc(name) +
        "</div>" +
        (marketDistanceText(r)
          ? '<div class="meta" data-feature="market-distance" style="color:#6fe0ff;font-size:18px;font-weight:950">' +
            esc(marketDistanceText(r)) +
            "</div>"
          : "") +
        '<div class="meta">🕒 ' +
        esc(time) +
        '</div><div class="meta">👥 Commerçants : ' +
        esc(count) +
        '</div><div class="meta">Tirage au sort : ' +
        esc(cleanCardText(s.draw || r[12] || builtInDraw(r))) +
        '</div><div class="meta">Accueil du placier : ' +
        esc(cleanCardText(s.welcome || "À vérifier")) +
        '</div><div class="meta">Modèle de clients : ' +
        esc(cleanCardText(s.clientModel || "À vérifier")) +
        '</div><div id="competition_' +
        i +
        '" style="margin-top:10px;padding:12px;border:3px solid #f39b19;border-radius:14px;background:#05090f;color:#fff;font-size:18px;font-weight:950">Concurrence : chargement…</div><div class="actions"><button type="button" class="go" data-market="' +
        i +
        '" ontouchstart="window.goMarket(' +
        i +
        ');return false" onclick="window.goMarket(' +
        i +
        ');return false">ALLER AU MARCHÉ</button><a class="verify" href="' +
        url +
        '">' +
        (saved(r) ? "MODIFIER" : "VÉRIFIER") +
        "</a></div></article>";
    }
    el("cards").innerHTML =
      html ||
      '<article class="card empty">Aucun marché enregistré pour ce jour.</article>';
    loadCounts(rs);
  }
  function loadWeather(rs) {
    var date = nextDate(currentDay),
      i;
    for (i = 0; i < rs.length; i++) loadOneWeather(rs[i], i, date);
  }
  function loadOneWeather(r, index, date) {
    var box = el("weather_" + index),
      place = r[3] || r[2] || "";
    if (!box) return;
    fetch(
      "https://geocoding-api.open-meteo.com/v1/search?name=" +
        encodeURIComponent(place) +
        "&count=1&language=fr&format=json",
    )
      .then(function (x) {
        if (!x.ok) throw 0;
        return x.json();
      })
      .then(function (g) {
        if (!g.results || !g.results[0]) throw 0;
        var p = g.results[0];
        return fetch(
          "https://api.open-meteo.com/v1/forecast?latitude=" +
            p.latitude +
            "&longitude=" +
            p.longitude +
            "&hourly=precipitation_probability&timezone=auto&forecast_days=8",
        );
      })
      .then(function (x) {
        if (!x.ok) throw 0;
        return x.json();
      })
      .then(function (j) {
        var max = 0,
          h,
          k;
        for (h = 7; h <= 13; h++) {
          k = (j.hourly.time || []).indexOf(
            date + "T" + String(h).padStart(2, "0") + ":00",
          );
          if (k >= 0)
            max = Math.max(
              max,
              Number(j.hourly.precipitation_probability[k] || 0),
            );
        }
        box.innerHTML = "🌤️ Météo 07h00–13h30 <b>💧 " + max + " %</b>";
      })
      .catch(function () {
        box.textContent = "🌤️ Météo 07h00–13h30 : indisponible";
      });
  }
  function pickerTop(on) {
    document.body.classList.toggle("departmentPicker", !!on);
  }
  function showMarkets() {
    pickerTop(false);
    el("picker").style.display = "none";
    el("results").style.display = "block";
    renderDays();
    renderSelectedMarkets();
    window.scrollTo(0, 0);
  }
  var lastResumeRefresh = 0;
  function refreshCountsOnReturn() {
    var now = Date.now(),
      results = el("results");
    if (
      !selected ||
      !results ||
      results.style.display !== "block" ||
      now - lastResumeRefresh < 500
    )
      return;
    lastResumeRefresh = now;
    loadCounts(marketRows());
    setTimeout(function () {
      if (selected && el("results") && el("results").style.display === "block")
        loadCounts(marketRows());
    }, 1500);
  }
  function init() {
    var picker = el("picker"),
      listHtml = "",
      i,
      code,
      boxLabel,
      params,
      restoreArea,
      restoreDay;
    pickerTop(true);
    if (country === "be") document.body.classList.add("belgiumPicker");
    boxLabel = country === "fr" ? "DÉPARTEMENT" : "PROVINCE";
    picker.innerHTML =
      '<a class="departmentBack" href="choix-marches-final.html">← RETOUR</a><div class="departmentInstruction">CHOISIR ' +
      (country === "fr" ? "UN DÉPARTEMENT" : "UNE PROVINCE") +
      '</div><div id="areaDirectList" class="areaDirectList"></div>';
    if (country === "fr") {
      listHtml =
        '<select id="frDepartmentSelect" class="frDepartmentSelect" aria-label="Choisir un département"><option value="">CHOISIR UN DÉPARTEMENT</option>';
      for (i = 0; i < areas.length; i++) {
        code = String(areas[i][0]);
        listHtml +=
          '<option value="' +
          i +
          '">' +
          esc(code + " — " + areas[i][1]) +
          "</option>";
      }
      listHtml +=
        '</select><button type="button" id="frDepartmentOpen" class="frDepartmentOpen">OUVRIR</button>';
      el("areaDirectList").innerHTML = listHtml;
      marketTap(el("frDepartmentOpen"), function () {
        var v = el("frDepartmentSelect").value;
        if (v === "") return;
        selected = areas[Number(v)];
        showMarkets();
      });
    } else {
      for (i = 0; i < areas.length; i++) {
        listHtml +=
          '<button type="button" class="areaChoice" data-area="' +
          i +
          '"><span class="areaBoxLabel">' +
          boxLabel +
          '</span><span class="areaBoxCode">' +
          esc(areas[i][1]) +
          "</span></button>";
      }
      el("areaDirectList").innerHTML = listHtml;
      var choices = el("areaDirectList").getElementsByTagName("button");
      for (i = 0; i < choices.length; i++)
        marketTap(
          choices[i],
          function () {
            selected = areas[Number(this.getAttribute("data-area"))];
            showMarkets();
          }.bind(choices[i]),
        );
    }
    marketTap(el("changeArea"), function () {
      // Retour direct à la page principale de recherche France / Belgique.
      // On ne réaffiche plus l’écran intermédiaire département / province.
      location.href = "choix-marches-final.html";
    });
    el("tradeSave").onclick = function () {
      var v = el("tradeInput").value;
      if (!knownTrade(v)) {
        el("tradeInput").focus();
        return;
      }
      localStorage.setItem("market_trade", v);
      el("tradeStatus").textContent = "Métier enregistré : " + v;
      el("tradeSave").textContent = "MODIFIER LE MÉTIER";
      if (el("results").style.display === "block") renderMarkets();
    };
    var trade = currentTrade();
    if (!knownTrade(trade)) {
      trade = "";
      localStorage.removeItem("market_trade");
    }
    el("tradeInput").value = trade;
    el("tradeStatus").textContent = trade
      ? "Métier enregistré : " + trade
      : "Aucun métier enregistré.";
    el("tradeSave").textContent = trade
      ? "MODIFIER LE MÉTIER"
      : "ENREGISTRER LE MÉTIER";
    try {
      params = new URLSearchParams(location.search);
      restoreArea = params.get("area");
      restoreDay = params.get("day");
      searchQuery = params.get("q") || "";
    } catch (e) {
      restoreArea = "";
      restoreDay = "";
    }
    if (restoreDay && days.indexOf(String(restoreDay).toLowerCase()) >= 0)
      currentDay = String(restoreDay).toLowerCase();
    if (restoreArea) {
      for (i = 0; i < areas.length; i++) {
        if (String(areas[i][0]) === String(restoreArea)) {
          selected = areas[i];
          showMarkets();
          break;
        }
      }
    }
    if (!selected) {
      // Le choix département/province se fait uniquement sur la page principale Marchés.
      location.replace("choix-marches-final.html");
      return;
    }
  }
  function addRegistrationLines() {}
  init();
  document.addEventListener("visibilitychange", function () {
    if (!document.hidden) refreshCountsOnReturn();
  });
  window.addEventListener("focus", refreshCountsOnReturn);
  window.addEventListener("pageshow", refreshCountsOnReturn);
})();
