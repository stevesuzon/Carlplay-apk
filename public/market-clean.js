(function () {
  "use strict";
  var areaCss = document.createElement("link");
  areaCss.rel = "stylesheet";
  areaCss.href = "markets-fullscreen.css";
  document.head.appendChild(areaCss);
  var selected = null,
    server = "https://carplay-metiers.appli-suzon.workers.dev";
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
  function areaLabel(a) {
    return country === "fr" ? a[0] + " — " + a[1] : a[1];
  }
  function areaKey() {
    return selected ? String(selected[0]) : "";
  }
  function marketRows() {
    var k = areaKey(),
      out = [],
      i,
      r;
    for (i = 0; i < data.length; i++) {
      r = data[i];
      if (String(r[0]) === k && String(r[4]).toLowerCase() === currentDay)
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
      '<h2>VOTRE MÉTIER</h2><p>Enregistrez votre métier pour afficher automatiquement la concurrence sur chaque marché.</p><input id="newTradeInput" maxlength="80" placeholder="Ex. Matelas" style="width:94%;height:68px;border:3px solid #62d8ff;border-radius:15px;background:#081727;color:#fff;font-size:27px;padding:10px 15px"><div class="bubbleBtns"><button id="newCancel" class="red">ANNULER</button><button id="newTradeSave" class="blue">ENREGISTRER</button></div>',
    );
    bindTap(el("newCancel"), closeBubble);
    bindTap(el("newTradeSave"), function () {
      var v = el("newTradeInput").value.trim();
      if (!v) {
        el("newTradeInput").focus();
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
        renderMarkets();
      };
  }
  function listText(v) {
    return v && v.length ? v.join(", ") : "À vérifier";
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
      url;
    el("heading").textContent =
      areaLabel(selected) + " — " + currentDay.toUpperCase();
    for (i = 0; i < rs.length; i++) {
      r = rs[i];
      s = saved(r) || {};
      name = r[2] || "Marché";
      place = r[3] || "À préciser";
      time = s.time || r[5] || "Horaire à vérifier";
      count = s.count || r[7] || "À vérifier";
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
        "&lat=" +
        encodeURIComponent(r[10] == null ? "" : r[10]) +
        "&lon=" +
        encodeURIComponent(r[11] == null ? "" : r[11]);
      html +=
        '<article class="card"><div class="name">' +
        esc(place) +
        "</div>" +
        '<div class="meta" style="font-weight:900;font-size:20px;margin-bottom:8px">' +
        esc(name) +
        "</div>" +
        (r[8] ? '<div class="meta">📍 ' + esc(r[8]) + "</div>" : "") +
        '<div class="meta">🕒 ' +
        esc(time) +
        '</div><div class="meta">👥 Commerçants : ' +
        esc(count) +
        '</div><div class="meta">Tirage au sort : ' +
        esc(s.draw || r[12] || "À vérifier") +
        '</div><div class="meta">Accueil du placier : ' +
        esc(s.welcome || "À vérifier") +
        '</div><div class="meta">Placier : ' +
        esc(listText(s.placer)) +
        '</div><div class="meta">Modèle de clients : ' +
        esc(s.clientModel || "À vérifier") +
        '</div><div class="weather" id="weather_' +
        i +
        '">🌤️ Météo 07h00–13h30 : chargement…</div><div id="competition_' +
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
    loadWeather(rs);
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
  function showMarkets() {
    el("picker").style.display = "none";
    el("results").style.display = "block";
    renderDays();
    renderMarkets();
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
      overlay = document.createElement("div"),
      listHtml = "",
      i;
    picker.innerHTML =
      '<div class="label">CHOISIR SON ' +
      (country === "fr" ? "DÉPARTEMENT" : "SECTEUR") +
      '</div><button type="button" id="areaOpen" class="areaOpen">APPUYEZ ICI</button><button type="button" id="confirm" disabled>CONFIRMER</button>';
    for (i = 0; i < areas.length; i++)
      listHtml +=
        '<button type="button" class="areaChoice" data-area="' +
        i +
        '">' +
        esc(areaLabel(areas[i])) +
        "</button>";
    overlay.id = "areaOverlay";
    overlay.className = "areaOverlay";
    overlay.innerHTML =
      '<div class="areaOverlayHead"><button type="button" id="areaClose" class="areaClose">← RETOUR</button><h2>CHOISIR SON ' +
      (country === "fr" ? "DÉPARTEMENT" : "SECTEUR") +
      '</h2></div><div class="areaOverlayHint">FAITES DÉFILER PUIS APPUYEZ SUR VOTRE CHOIX</div><div id="areaList" class="areaList">' +
      listHtml +
      "</div>";
    document.body.appendChild(overlay);
    var open = el("areaOpen"),
      confirm = el("confirm");
    function closeArea() {
      overlay.className = "areaOverlay";
      document.body.style.overflow = "";
    }
    marketTap(open, function () {
      overlay.className = "areaOverlay open";
      document.body.style.overflow = "hidden";
      el("areaList").scrollTop = 0;
    });
    marketTap(el("areaClose"), closeArea);
    var choices = el("areaList").getElementsByTagName("button");
    for (i = 0; i < choices.length; i++)
      marketTap(
        choices[i],
        function () {
          var n = Number(this.getAttribute("data-area"));
          selected = areas[n];
          open.textContent = areaLabel(selected);
          confirm.disabled = false;
          confirm.className = "ready";
          closeArea();
        }.bind(choices[i]),
      );
    marketTap(confirm, function () {
      if (selected) showMarkets();
    });
    marketTap(el("changeArea"), function () {
      el("results").style.display = "none";
      picker.style.display = "block";
      selected = null;
      open.textContent = "APPUYEZ ICI";
      confirm.disabled = true;
      confirm.className = "";
      window.scrollTo(0, 0);
    });
    el("tradeSave").onclick = function () {
      var v = el("tradeInput").value.trim();
      if (!v) {
        el("tradeInput").focus();
        return;
      }
      localStorage.setItem("market_trade", v);
      el("tradeStatus").textContent = "Métier enregistré : " + v;
      el("tradeSave").textContent = "MODIFIER LE MÉTIER";
      if (el("results").style.display === "block") renderMarkets();
    };
    var trade = currentTrade();
    el("tradeInput").value = trade;
    el("tradeStatus").textContent = trade
      ? "Métier enregistré : " + trade
      : "Aucun métier enregistré.";
    el("tradeSave").textContent = trade
      ? "MODIFIER LE MÉTIER"
      : "ENREGISTRER LE MÉTIER";
  }
  function addRegistrationLines() {
    var rs = marketRows(),
      cards = el("cards") && el("cards").querySelectorAll(".card"),
      i,
      line,
      target;
    if (!cards) return;
    for (i = 0; i < cards.length && i < rs.length; i++) {
      if (cards[i].querySelector(".registrationMeta")) continue;
      line = document.createElement("div");
      line.className = "meta registrationMeta";
      line.textContent =
        "Inscription : " + (rs[i][13] || "Non publiée officiellement");
      target = cards[i].querySelector('[id^="competition_"]');
      cards[i].insertBefore(line, target);
    }
  }
  new MutationObserver(addRegistrationLines).observe(el("cards"), {
    childList: true,
  });
  init();
  document.addEventListener("visibilitychange", function () {
    if (!document.hidden) refreshCountsOnReturn();
  });
  window.addEventListener("focus", refreshCountsOnReturn);
  window.addEventListener("pageshow", refreshCountsOnReturn);
})();
