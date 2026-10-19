const gpsGuideStates46 = new WeakMap();
function gpsGuide46(route, fix, now = Date.now()) {
  if (
    !fix ||
    !Number.isFinite(fix.lat) ||
    !Number.isFinite(fix.lon) ||
    fix.accuracy > 30
  )
    return null;
  let state = gpsGuideStates46.get(route);
  const rad = Math.PI / 180,
    dist = (a, b) =>
      12742000 *
      Math.asin(
        Math.min(
          1,
          Math.sqrt(
            Math.sin(((b[0] - a[0]) * rad) / 2) ** 2 +
              Math.cos(a[0] * rad) *
                Math.cos(b[0] * rad) *
                Math.sin(((b[1] - a[1]) * rad) / 2) ** 2,
          ),
        ),
      );
  if (!state) {
    const lengths = [0];
    for (let i = 1; i < route.points.length; i++)
      lengths.push(lengths[i - 1] + dist(route.points[i - 1], route.points[i]));
    state = {
      lengths,
      total: lengths.at(-1),
      along: null,
      time: now,
      spoken: new Set(),
    };
    gpsGuideStates46.set(route, state);
  }
  if (!state.total) return null;
  let best = null;
  const unit = 6371000 * rad,
    cos = Math.cos(fix.lat * rad),
    dt = Math.max(0, (now - state.time) / 1000),
    allow = Math.max(
      55,
      Math.max(5, (Number(fix.speed) || 0) / 3.6) * Math.min(15, dt) + 35,
    );
  for (let i = 1; i < route.points.length; i++) {
    const a = route.points[i - 1],
      b = route.points[i],
      x = (a[1] - fix.lon) * cos * unit,
      y = (a[0] - fix.lat) * unit,
      dx = (b[1] - a[1]) * cos * unit,
      dy = (b[0] - a[0]) * unit,
      den = dx * dx + dy * dy;
    if (!den) continue;
    const t = Math.max(0, Math.min(1, -(x * dx + y * dy) / den)),
      off = Math.hypot(x + t * dx, y + t * dy),
      along =
        state.lengths[i - 1] + t * (state.lengths[i] - state.lengths[i - 1]);
    if (
      state.along !== null &&
      (along < state.along - 35 || along > state.along + allow)
    )
      continue;
    const score =
      off + (state.along === null ? 0 : Math.abs(along - state.along) * 0.025);
    if (!best || score < best.score) best = { along, off, score };
  }
  if (!best || best.off > 40) return null;
  state.along = best.along;
  state.time = now;
  const scale =
    route.mode === "large-trailer" || /Valhalla/i.test(route.provider || "")
      ? 1
      : Number(route.summary.lengthInMeters) / state.total;
  const along = best.along * scale;
  let index = route.instructions.findIndex(
    (x) =>
      Number(x.routeOffsetInMeters) > 2 &&
      Number(x.routeOffsetInMeters) >= along - 12,
  );
  if (index < 0) index = Math.max(0, route.instructions.length - 1);
  const distance = Math.max(
    0,
    Number(route.instructions[index]?.routeOffsetInMeters) - along,
  );
  return { state, index, distance, along, fraction: best.along / state.total };
}
function gpsSpeakGuide46(g, route) {
  if (!g || !("speechSynthesis" in window)) return;
  const d = g.distance,
    stage = d <= 12 ? "now" : d <= 101 ? "100" : d <= 201 ? "200" : "far";
  const key = g.index + ":" + stage;
  if (g.state.spoken.has(key)) return;
  g.state.spoken.add(key);
  if (stage === "now") {
    g.state.spoken.add(g.index + ":100");
    g.state.spoken.add(g.index + ":200");
  }
  if (stage === "100") g.state.spoken.add(g.index + ":200");
  const raw = route.instructions[g.index]?.message || "Suivez le trajet";
  const message = raw.replace(
    /^dans\s+[\d.,]+\s*(?:mètres?|kilomètres?|km|m)\s*[,.:]?\s*/i,
    "",
  );
  const label =
    stage === "now"
      ? "Maintenant"
      : d >= 1000
        ? "Dans " + (d / 1000).toFixed(1).replace(".", ",") + " kilomètres"
        : "Dans " + Math.max(10, Math.round(d / 10) * 10) + " mètres";
  speechSynthesis.cancel();
  const voice = new SpeechSynthesisUtterance(label + ", " + message);
  voice.lang = "fr-FR";
  voice.rate = 0.85;
  const fr = speechSynthesis
    .getVoices()
    .find((v) => /^fr[-_]FR$/i.test(v.lang));
  if (fr) voice.voice = fr;
  speechSynthesis.speak(voice);
}

function gpsDistance28(m) {
  return m < 1000
    ? Math.round(m) + " m"
    : (m / 1000).toLocaleString("fr-FR", { maximumFractionDigits: 1 }) + " km";
}
function gpsCompare28(options) {
  const a = options.find((o) => o.id === "direct")?.route,
    b = options.find((o) => o.id === "main")?.route;
  if (!a || !b) return "Comparaison en cours";
  const same = JSON.stringify(a.points) === JSON.stringify(b.points);
  if (same) return "Même route pour ces deux options sur ce trajet";
  const dt = b.summary.travelTimeInSeconds - a.summary.travelTimeInSeconds,
    dd = b.summary.lengthInMeters - a.summary.lengthInMeters;
  return (
    "Grandes routes : " +
    gpsDuration(Math.abs(dt)) +
    (dt < 0 ? " de moins" : " de plus") +
    " · " +
    gpsDistance28(Math.abs(dd)) +
    (dd < 0 ? " de moins" : " de plus") +
    " que par les villes"
  );
}
function gpsDuration(seconds) {
  if (seconds > 0 && seconds < 60)
    return Math.max(1, Math.round(seconds)) + " s";
  const minutes = Math.max(0, Math.round(seconds / 60));
  return [
    minutes >= 60 ? Math.floor(minutes / 60) + " h" : "",
    minutes % 60 || !minutes ? (minutes % 60) + " min" : "",
  ]
    .filter(Boolean)
    .join(" ");
}
function gpsArrivalDifference(minutes) {
  if (!Math.round(minutes)) return "Vous êtes arrivé à l’heure prévue.";
  return (
    "Vous avez mis " +
    gpsDuration(Math.abs(minutes) * 60) +
    (minutes > 0 ? " de plus que prévu." : " de moins que prévu.")
  );
}
function gpsRouteBounds(points) {
  return points.reduce(
    (b, p) => [
      Math.min(b[0], p[0]),
      Math.min(b[1], p[1]),
      Math.max(b[2], p[0]),
      Math.max(b[3], p[1]),
    ],
    [90, 180, -90, -180],
  );
}
function gpsOnRoute(report, points, project) {
  return (
    project(report.lat, report.lon, points).offset <=
    Math.max(65, Number(report.radius) || 0)
  );
}
function gpsRouteStats(route, grids, project, reports, now) {
  const b = gpsRouteBounds(route.points);
  const known = new Set(
    grids
      .filter(
        ([lat, lon]) =>
          lat * 0.02 >= b[0] - 0.025 &&
          lat * 0.02 <= b[2] + 0.025 &&
          lon * 0.03 >= b[1] - 0.04 &&
          lon * 0.03 <= b[3] + 0.04 &&
          gpsOnRoute(
            { lat: lat * 0.02, lon: lon * 0.03, radius: 2000 },
            route.points,
            project,
          ),
      )
      .map((p) => p.join(":")),
  ).size;
  const active =
    reports === null
      ? null
      : reports.filter(
          (r) => r.expires > now && gpsOnRoute(r, route.points, project),
        );
  return {
    known,
    reports: active,
    count: active === null ? null : new Set(active.map((r) => r.id)).size,
  };
}
function gpsRouteCards(
  S,
  options,
  selected,
  choose,
  busy,
  retry,
  pedestrian,
  now,
  clock,
) {
  return S.jsxs("section", {
    className: "route-choices",
    "aria-label": "Choisir le trajet",
    children: [
      S.jsx("h3", {
        children: pedestrian
          ? "Votre trajet à pied"
          : "Choisissez votre trajet",
      }),
      busy && S.jsx("p", { role: "status", children: "Calcul des trajets…" }),
      S.jsx("div", {
        className: "route-choice-list",
        role: "radiogroup",
        "aria-label": "Trajets disponibles",
        children: options.map((option) =>
          S.jsxs(
            "button",
            {
              type: "button",
              role: "radio",
              "aria-checked": selected === option.id,
              disabled: !option.route,
              className:
                "route-choice " + (selected === option.id ? "chosen" : ""),
              onClick: () => choose(option.id),
              children: [
                S.jsx("strong", {
                  children: pedestrian
                    ? "À pied"
                    : option.id === "direct"
                      ? "Par les villes"
                      : "Grandes routes",
                }),
                option.route
                  ? S.jsxs(S.Fragment, {
                      children: [
                        S.jsx("span", {
                          className: "route-choice-time",
                          children: gpsDuration(
                            option.route.summary.travelTimeInSeconds,
                          ),
                        }),
                        S.jsx("span", {
                          children:
                            gpsDistance28(option.route.summary.lengthInMeters) +
                            " · Arrivée " +
                            clock(
                              now +
                                option.route.summary.travelTimeInSeconds * 1000,
                            ),
                        }),
                        !pedestrian &&
                          S.jsx("small", {
                            children: "Zones radar connues : " + option.known,
                          }),
                        !pedestrian &&
                          S.jsx("small", {
                            children:
                              option.reports === null
                                ? "Signalements indisponibles"
                                : "Radars signalés : " +
                                  (option.partial ? "au moins " : "") +
                                  new Set(
                                    option.reports
                                      .filter(
                                        (r) =>
                                          r.expires > now &&
                                          r.kind === "danger",
                                      )
                                      .map((r) => r.id),
                                  ).size,
                          }),
                        !pedestrian &&
                          option.reports !== null &&
                          S.jsx("small", {
                            children:
                              "Travaux / bouchons : " +
                              (option.partial ? "au moins " : "") +
                              new Set(
                                option.reports
                                  .filter(
                                    (r) =>
                                      r.expires > now && r.kind !== "danger",
                                  )
                                  .map((r) => r.id),
                              ).size,
                          }),
                      ],
                    })
                  : S.jsx("small", {
                      children: option.error || "Trajet indisponible",
                    }),
              ],
            },
            option.id,
          ),
        ),
      }),
      !busy &&
        options.some((o) => !o.route) &&
        S.jsx("button", {
          type: "button",
          className: "secondary",
          onClick: retry,
          children: "Réessayer",
        }),
      !pedestrian &&
        options.some((o) => o.route) &&
        S.jsx("small", {
          className: "route-estimate-note",
          children: gpsCompare28(options),
        }),
      !pedestrian &&
        S.jsx("small", {
          className: "route-estimate-note",
          children:
            "Par les villes : trajet court sans autoroute · Grandes routes : trajet le plus rapide. Horaires estimés.",
        }),
    ],
  });
}

const gpsRouteProgress = new WeakMap();
function gpsClipRoad(points, fix, group) {
  if (!group || !fix || fix.waiting || fix.accuracy > 50 || points.length < 2)
    return;
  let state = gpsRouteProgress.get(points);
  if (!state) {
    state = { along: 0, time: 0 };
    gpsRouteProgress.set(points, state);
  }
  const r = Math.PI / 180,
    unit = 6371000 * r,
    cos = Math.cos(fix.lat * r);
  let cumulative = 0,
    best = Infinity,
    along = 0,
    index = 0,
    fraction = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1],
      b = points[i];
    const dx = (b[1] - a[1]) * cos * unit,
      dy = (b[0] - a[0]) * unit;
    const x = (a[1] - fix.lon) * cos * unit,
      y = (a[0] - fix.lat) * unit;
    const len = Math.hypot(dx, dy);
    if (!len) continue;
    const t = Math.max(0, Math.min(1, -(x * dx + y * dy) / (len * len)));
    const distance = Math.hypot(x + t * dx, y + t * dy),
      candidate = cumulative + t * len;
    const allowance = Math.max(
      80,
      ((fix.speed || 0) / 3.6) *
        Math.min(10, (Date.now() - state.time) / 1000) +
        35,
    );
    if (
      candidate >= state.along - 10 &&
      (!state.time || candidate <= state.along + allowance) &&
      distance < best
    ) {
      best = distance;
      along = candidate;
      index = i;
      fraction = t;
    }
    cumulative += len;
  }
  if (best > 40 || (along < state.along + 0.15 && state.time)) return;
  state.along = Math.max(state.along, along);
  state.time = Date.now();
  const a = points[index - 1],
    b = points[index];
  const start = [
    a[0] + fraction * (b[0] - a[0]),
    a[1] + fraction * (b[1] - a[1]),
  ];
  const remaining = [start, ...points.slice(index)];
  group.eachLayer((layer) => {
    if (typeof layer.setLatLngs === "function") layer.setLatLngs(remaining);
  });
}
function gpsRigMotion(root, fix, carHeading, trailerHeading, cameraHeading) {
  if (!root) return;
  const moving = !fix.waiting && fix.accuracy <= 50 && fix.speed > 2;
  root.classList.toggle("rig-rolling", moving);
  root.style.setProperty(
    "--wheel-period",
    Math.max(0.12, Math.min(0.8, 12 / Math.max(3, fix.speed || 0))) + "s",
  );
  const car = root.querySelector("[data-rig-car]"),
    trailer = root.querySelector("[data-rig-trailer]");
  if (!car || !trailer) return;
  let hitch = root.querySelector("[data-rig-hitch]");
  if (!hitch) {
    hitch = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    hitch.setAttribute("data-rig-hitch", "");
    hitch.setAttribute("viewBox", "0 0 80 130");
    hitch.setAttribute("aria-hidden", "true");
    hitch.innerHTML =
      '<path stroke="#16202b" stroke-width="4" fill="none"/><path stroke="#b5bdc5" stroke-width="2" fill="none"/><circle r="2.5" fill="#dde2e6" stroke="#39434f"/>';
    root.querySelector(".vehicle-icons").prepend(hitch);
  }
  const yaw =
    ((((carHeading - cameraHeading + 540) % 360) - 180) * Math.PI) / 180;
  const x = 40 - 18 * Math.sin(yaw),
    y = 57 + 5 * Math.cos(yaw);
  const tx = parseFloat(trailer.style.left || "2") + 38;
  const ty = parseFloat(trailer.style.top || "27") + 25;
  const d =
    "M" +
    x +
    " " +
    y +
    " L" +
    (tx - 4) +
    " " +
    ty +
    " M" +
    x +
    " " +
    y +
    " L" +
    (tx + 4) +
    " " +
    ty;
  hitch.querySelectorAll("path").forEach((p) => p.setAttribute("d", d));
  const ball = hitch.querySelector("circle");
  ball.setAttribute("cx", x);
  ball.setAttribute("cy", y);
}

("use strict");
(() => {
  var i_ = Object.create;
  var jh = Object.defineProperty;
  var o_ = Object.getOwnPropertyDescriptor;
  var n_ = Object.getOwnPropertyNames;
  var l_ = Object.getPrototypeOf,
    u_ = Object.prototype.hasOwnProperty;
  var s_ = (e, t) => () => (e && (t = e((e = 0))), t);
  var va = (e, t) => () => (
    t || e((t = { exports: {} }).exports, t),
    t.exports
  );
  var r_ = (e, t, i, o) => {
    if ((t && typeof t == "object") || typeof t == "function")
      for (let l of n_(t))
        !u_.call(e, l) &&
          l !== i &&
          jh(e, l, {
            get: () => t[l],
            enumerable: !(o = o_(t, l)) || o.enumerable,
          });
    return e;
  };
  var ka = (e, t, i) => (
    (i = e != null ? i_(l_(e)) : {}),
    r_(
      t || !e || !e.__esModule
        ? jh(i, "default", { value: e, enumerable: !0 })
        : i,
      e,
    )
  );
  var im = va((Ee) => {
    "use strict";
    function If(e, t) {
      var i = e.length;
      e.push(t);
      e: for (; 0 < i;) {
        var o = (i - 1) >>> 1,
          l = e[o];
        if (0 < vs(l, t)) ((e[o] = t), (e[i] = l), (i = o));
        else break e;
      }
    }
    function za(e) {
      return e.length === 0 ? null : e[0];
    }
    function xs(e) {
      if (e.length === 0) return null;
      var t = e[0],
        i = e.pop();
      if (i !== t) {
        e[0] = i;
        e: for (var o = 0, l = e.length, s = l >>> 1; o < s;) {
          var f = 2 * (o + 1) - 1,
            c = e[f],
            g = f + 1,
            y = e[g];
          if (0 > vs(c, i))
            g < l && 0 > vs(y, c)
              ? ((e[o] = y), (e[g] = i), (o = g))
              : ((e[o] = c), (e[f] = i), (o = f));
          else if (g < l && 0 > vs(y, i)) ((e[o] = y), (e[g] = i), (o = g));
          else break e;
        }
      }
      return t;
    }
    function vs(e, t) {
      var i = e.sortIndex - t.sortIndex;
      return i !== 0 ? i : e.id - t.id;
    }
    Ee.unstable_now = void 0;
    typeof performance == "object" && typeof performance.now == "function"
      ? ((Yh = performance),
        (Ee.unstable_now = function () {
          return Yh.now();
        }))
      : ((xf = Date),
        (Kh = xf.now()),
        (Ee.unstable_now = function () {
          return xf.now() - Kh;
        }));
    var Yh,
      xf,
      Kh,
      ii = [],
      zi = [],
      f_ = 1,
      ea = null,
      Lt = 3,
      bf = !1,
      Al = !1,
      Dl = !1,
      wf = !1,
      Jh = typeof setTimeout == "function" ? setTimeout : null,
      $h = typeof clearTimeout == "function" ? clearTimeout : null,
      Qh = typeof setImmediate < "u" ? setImmediate : null;
    function ys(e) {
      for (var t = za(zi); t !== null;) {
        if (t.callback === null) xs(zi);
        else if (t.startTime <= e)
          (xs(zi), (t.sortIndex = t.expirationTime), If(ii, t));
        else break;
        t = za(zi);
      }
    }
    function Mf(e) {
      if (((Dl = !1), ys(e), !Al))
        if (za(ii) !== null) ((Al = !0), hn || ((hn = !0), cn()));
        else {
          var t = za(zi);
          t !== null && Tf(Mf, t.startTime - e);
        }
    }
    var hn = !1,
      Bl = -1,
      em = 5,
      tm = -1;
    function am() {
      return wf ? !0 : !(Ee.unstable_now() - tm < em);
    }
    function Sf() {
      if (((wf = !1), hn)) {
        var e = Ee.unstable_now();
        tm = e;
        var t = !0;
        try {
          e: {
            ((Al = !1), Dl && ((Dl = !1), $h(Bl), (Bl = -1)), (bf = !0));
            var i = Lt;
            try {
              t: {
                for (
                  ys(e), ea = za(ii);
                  ea !== null && !(ea.expirationTime > e && am());
                ) {
                  var o = ea.callback;
                  if (typeof o == "function") {
                    ((ea.callback = null), (Lt = ea.priorityLevel));
                    var l = o(ea.expirationTime <= e);
                    if (((e = Ee.unstable_now()), typeof l == "function")) {
                      ((ea.callback = l), ys(e), (t = !0));
                      break t;
                    }
                    (ea === za(ii) && xs(ii), ys(e));
                  } else xs(ii);
                  ea = za(ii);
                }
                if (ea !== null) t = !0;
                else {
                  var s = za(zi);
                  (s !== null && Tf(Mf, s.startTime - e), (t = !1));
                }
              }
              break e;
            } finally {
              ((ea = null), (Lt = i), (bf = !1));
            }
            t = void 0;
          }
        } finally {
          t ? cn() : (hn = !1);
        }
      }
    }
    var cn;
    typeof Qh == "function"
      ? (cn = function () {
          Qh(Sf);
        })
      : typeof MessageChannel < "u"
        ? ((Cf = new MessageChannel()),
          (Wh = Cf.port2),
          (Cf.port1.onmessage = Sf),
          (cn = function () {
            Wh.postMessage(null);
          }))
        : (cn = function () {
            Jh(Sf, 0);
          });
    var Cf, Wh;
    function Tf(e, t) {
      Bl = Jh(function () {
        e(Ee.unstable_now());
      }, t);
    }
    Ee.unstable_IdlePriority = 5;
    Ee.unstable_ImmediatePriority = 1;
    Ee.unstable_LowPriority = 4;
    Ee.unstable_NormalPriority = 3;
    Ee.unstable_Profiling = null;
    Ee.unstable_UserBlockingPriority = 2;
    Ee.unstable_cancelCallback = function (e) {
      e.callback = null;
    };
    Ee.unstable_forceFrameRate = function (e) {
      0 > e || 125 < e
        ? console.error(
            "forceFrameRate takes a positive int between 0 and 125, forcing frame rates higher than 125 fps is not supported",
          )
        : (em = 0 < e ? Math.floor(1e3 / e) : 5);
    };
    Ee.unstable_getCurrentPriorityLevel = function () {
      return Lt;
    };
    Ee.unstable_next = function (e) {
      switch (Lt) {
        case 1:
        case 2:
        case 3:
          var t = 3;
          break;
        default:
          t = Lt;
      }
      var i = Lt;
      Lt = t;
      try {
        return e();
      } finally {
        Lt = i;
      }
    };
    Ee.unstable_requestPaint = function () {
      wf = !0;
    };
    Ee.unstable_runWithPriority = function (e, t) {
      switch (e) {
        case 1:
        case 2:
        case 3:
        case 4:
        case 5:
          break;
        default:
          e = 3;
      }
      var i = Lt;
      Lt = e;
      try {
        return t();
      } finally {
        Lt = i;
      }
    };
    Ee.unstable_scheduleCallback = function (e, t, i) {
      var o = Ee.unstable_now();
      switch (
        (typeof i == "object" && i !== null
          ? ((i = i.delay), (i = typeof i == "number" && 0 < i ? o + i : o))
          : (i = o),
        e)
      ) {
        case 1:
          var l = -1;
          break;
        case 2:
          l = 250;
          break;
        case 5:
          l = 1073741823;
          break;
        case 4:
          l = 1e4;
          break;
        default:
          l = 5e3;
      }
      return (
        (l = i + l),
        (e = {
          id: f_++,
          callback: t,
          priorityLevel: e,
          startTime: i,
          expirationTime: l,
          sortIndex: -1,
        }),
        i > o
          ? ((e.sortIndex = i),
            If(zi, e),
            za(ii) === null &&
              e === za(zi) &&
              (Dl ? ($h(Bl), (Bl = -1)) : (Dl = !0), Tf(Mf, i - o)))
          : ((e.sortIndex = l),
            If(ii, e),
            Al || bf || ((Al = !0), hn || ((hn = !0), cn()))),
        e
      );
    };
    Ee.unstable_shouldYield = am;
    Ee.unstable_wrapCallback = function (e) {
      var t = Lt;
      return function () {
        var i = Lt;
        Lt = t;
        try {
          return e.apply(this, arguments);
        } finally {
          Lt = i;
        }
      };
    };
  });
  var nm = va((wy, om) => {
    "use strict";
    om.exports = im();
  });
  var gm = va((ie) => {
    "use strict";
    var Bf = Symbol.for("react.transitional.element"),
      d_ = Symbol.for("react.portal"),
      c_ = Symbol.for("react.fragment"),
      h_ = Symbol.for("react.strict_mode"),
      m_ = Symbol.for("react.profiler"),
      p_ = Symbol.for("react.consumer"),
      g_ = Symbol.for("react.context"),
      L_ = Symbol.for("react.forward_ref"),
      __ = Symbol.for("react.suspense"),
      v_ = Symbol.for("react.memo"),
      fm = Symbol.for("react.lazy"),
      y_ = Symbol.for("react.activity"),
      lm = Symbol.iterator;
    function x_(e) {
      return e === null || typeof e != "object"
        ? null
        : ((e = (lm && e[lm]) || e["@@iterator"]),
          typeof e == "function" ? e : null);
    }
    var dm = {
        isMounted: function () {
          return !1;
        },
        enqueueForceUpdate: function () {},
        enqueueReplaceState: function () {},
        enqueueSetState: function () {},
      },
      cm = Object.assign,
      hm = {};
    function pn(e, t, i) {
      ((this.props = e),
        (this.context = t),
        (this.refs = hm),
        (this.updater = i || dm));
    }
    pn.prototype.isReactComponent = {};
    pn.prototype.setState = function (e, t) {
      if (typeof e != "object" && typeof e != "function" && e != null)
        throw Error(
          "takes an object of state variables to update or a function which returns an object of state variables.",
        );
      this.updater.enqueueSetState(this, e, t, "setState");
    };
    pn.prototype.forceUpdate = function (e) {
      this.updater.enqueueForceUpdate(this, e, "forceUpdate");
    };
    function mm() {}
    mm.prototype = pn.prototype;
    function Pf(e, t, i) {
      ((this.props = e),
        (this.context = t),
        (this.refs = hm),
        (this.updater = i || dm));
    }
    var kf = (Pf.prototype = new mm());
    kf.constructor = Pf;
    cm(kf, pn.prototype);
    kf.isPureReactComponent = !0;
    var um = Array.isArray;
    function Df() {}
    var Pe = { H: null, A: null, T: null, S: null },
      pm = Object.prototype.hasOwnProperty;
    function zf(e, t, i) {
      var o = i.ref;
      return {
        $$typeof: Bf,
        type: e,
        key: t,
        ref: o !== void 0 ? o : null,
        props: i,
      };
    }
    function S_(e, t) {
      return zf(e.type, t, e.props);
    }
    function Of(e) {
      return typeof e == "object" && e !== null && e.$$typeof === Bf;
    }
    function C_(e) {
      var t = { "=": "=0", ":": "=2" };
      return (
        "$" +
        e.replace(/[=:]/g, function (i) {
          return t[i];
        })
      );
    }
    var sm = /\/+/g;
    function Af(e, t) {
      return typeof e == "object" && e !== null && e.key != null
        ? C_("" + e.key)
        : t.toString(36);
    }
    function I_(e) {
      switch (e.status) {
        case "fulfilled":
          return e.value;
        case "rejected":
          throw e.reason;
        default:
          switch (
            (typeof e.status == "string"
              ? e.then(Df, Df)
              : ((e.status = "pending"),
                e.then(
                  function (t) {
                    e.status === "pending" &&
                      ((e.status = "fulfilled"), (e.value = t));
                  },
                  function (t) {
                    e.status === "pending" &&
                      ((e.status = "rejected"), (e.reason = t));
                  },
                )),
            e.status)
          ) {
            case "fulfilled":
              return e.value;
            case "rejected":
              throw e.reason;
          }
      }
      throw e;
    }
    function mn(e, t, i, o, l) {
      var s = typeof e;
      (s === "undefined" || s === "boolean") && (e = null);
      var f = !1;
      if (e === null) f = !0;
      else
        switch (s) {
          case "bigint":
          case "string":
          case "number":
            f = !0;
            break;
          case "object":
            switch (e.$$typeof) {
              case Bf:
              case d_:
                f = !0;
                break;
              case fm:
                return ((f = e._init), mn(f(e._payload), t, i, o, l));
            }
        }
      if (f)
        return (
          (l = l(e)),
          (f = o === "" ? "." + Af(e, 0) : o),
          um(l)
            ? ((i = ""),
              f != null && (i = f.replace(sm, "$&/") + "/"),
              mn(l, t, i, "", function (y) {
                return y;
              }))
            : l != null &&
              (Of(l) &&
                (l = S_(
                  l,
                  i +
                    (l.key == null || (e && e.key === l.key)
                      ? ""
                      : ("" + l.key).replace(sm, "$&/") + "/") +
                    f,
                )),
              t.push(l)),
          1
        );
      f = 0;
      var c = o === "" ? "." : o + ":";
      if (um(e))
        for (var g = 0; g < e.length; g++)
          ((o = e[g]), (s = c + Af(o, g)), (f += mn(o, t, i, s, l)));
      else if (((g = x_(e)), typeof g == "function"))
        for (e = g.call(e), g = 0; !(o = e.next()).done;)
          ((o = o.value), (s = c + Af(o, g++)), (f += mn(o, t, i, s, l)));
      else if (s === "object") {
        if (typeof e.then == "function") return mn(I_(e), t, i, o, l);
        throw (
          (t = String(e)),
          Error(
            "Objects are not valid as a React child (found: " +
              (t === "[object Object]"
                ? "object with keys {" + Object.keys(e).join(", ") + "}"
                : t) +
              "). If you meant to render a collection of children, use an array instead.",
          )
        );
      }
      return f;
    }
    function Ss(e, t, i) {
      if (e == null) return e;
      var o = [],
        l = 0;
      return (
        mn(e, o, "", "", function (s) {
          return t.call(i, s, l++);
        }),
        o
      );
    }
    function b_(e) {
      if (e._status === -1) {
        var t = e._result;
        ((t = t()),
          t.then(
            function (i) {
              (e._status === 0 || e._status === -1) &&
                ((e._status = 1), (e._result = i));
            },
            function (i) {
              (e._status === 0 || e._status === -1) &&
                ((e._status = 2), (e._result = i));
            },
          ),
          e._status === -1 && ((e._status = 0), (e._result = t)));
      }
      if (e._status === 1) return e._result.default;
      throw e._result;
    }
    var rm =
        typeof reportError == "function"
          ? reportError
          : function (e) {
              if (
                typeof window == "object" &&
                typeof window.ErrorEvent == "function"
              ) {
                var t = new window.ErrorEvent("error", {
                  bubbles: !0,
                  cancelable: !0,
                  message:
                    typeof e == "object" &&
                    e !== null &&
                    typeof e.message == "string"
                      ? String(e.message)
                      : String(e),
                  error: e,
                });
                if (!window.dispatchEvent(t)) return;
              } else if (
                typeof process == "object" &&
                typeof process.emit == "function"
              ) {
                process.emit("uncaughtException", e);
                return;
              }
              console.error(e);
            },
      w_ = {
        map: Ss,
        forEach: function (e, t, i) {
          Ss(
            e,
            function () {
              t.apply(this, arguments);
            },
            i,
          );
        },
        count: function (e) {
          var t = 0;
          return (
            Ss(e, function () {
              t++;
            }),
            t
          );
        },
        toArray: function (e) {
          return (
            Ss(e, function (t) {
              return t;
            }) || []
          );
        },
        only: function (e) {
          if (!Of(e))
            throw Error(
              "React.Children.only expected to receive a single React element child.",
            );
          return e;
        },
      };
    ie.Activity = y_;
    ie.Children = w_;
    ie.Component = pn;
    ie.Fragment = c_;
    ie.Profiler = m_;
    ie.PureComponent = Pf;
    ie.StrictMode = h_;
    ie.Suspense = __;
    ie.__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE = Pe;
    ie.__COMPILER_RUNTIME = {
      __proto__: null,
      c: function (e) {
        return Pe.H.useMemoCache(e);
      },
    };
    ie.cache = function (e) {
      return function () {
        return e.apply(null, arguments);
      };
    };
    ie.cacheSignal = function () {
      return null;
    };
    ie.cloneElement = function (e, t, i) {
      if (e == null)
        throw Error(
          "The argument must be a React element, but you passed " + e + ".",
        );
      var o = cm({}, e.props),
        l = e.key;
      if (t != null)
        for (s in (t.key !== void 0 && (l = "" + t.key), t))
          !pm.call(t, s) ||
            s === "key" ||
            s === "__self" ||
            s === "__source" ||
            (s === "ref" && t.ref === void 0) ||
            (o[s] = t[s]);
      var s = arguments.length - 2;
      if (s === 1) o.children = i;
      else if (1 < s) {
        for (var f = Array(s), c = 0; c < s; c++) f[c] = arguments[c + 2];
        o.children = f;
      }
      return zf(e.type, l, o);
    };
    ie.createContext = function (e) {
      return (
        (e = {
          $$typeof: g_,
          _currentValue: e,
          _currentValue2: e,
          _threadCount: 0,
          Provider: null,
          Consumer: null,
        }),
        (e.Provider = e),
        (e.Consumer = { $$typeof: p_, _context: e }),
        e
      );
    };
    ie.createElement = function (e, t, i) {
      var o,
        l = {},
        s = null;
      if (t != null)
        for (o in (t.key !== void 0 && (s = "" + t.key), t))
          pm.call(t, o) &&
            o !== "key" &&
            o !== "__self" &&
            o !== "__source" &&
            (l[o] = t[o]);
      var f = arguments.length - 2;
      if (f === 1) l.children = i;
      else if (1 < f) {
        for (var c = Array(f), g = 0; g < f; g++) c[g] = arguments[g + 2];
        l.children = c;
      }
      if (e && e.defaultProps)
        for (o in ((f = e.defaultProps), f)) l[o] === void 0 && (l[o] = f[o]);
      return zf(e, s, l);
    };
    ie.createRef = function () {
      return { current: null };
    };
    ie.forwardRef = function (e) {
      return { $$typeof: L_, render: e };
    };
    ie.isValidElement = Of;
    ie.lazy = function (e) {
      return { $$typeof: fm, _payload: { _status: -1, _result: e }, _init: b_ };
    };
    ie.memo = function (e, t) {
      return { $$typeof: v_, type: e, compare: t === void 0 ? null : t };
    };
    ie.startTransition = function (e) {
      var t = Pe.T,
        i = {};
      Pe.T = i;
      try {
        var o = e(),
          l = Pe.S;
        (l !== null && l(i, o),
          typeof o == "object" &&
            o !== null &&
            typeof o.then == "function" &&
            o.then(Df, rm));
      } catch (s) {
        rm(s);
      } finally {
        (t !== null && i.types !== null && (t.types = i.types), (Pe.T = t));
      }
    };
    ie.unstable_useCacheRefresh = function () {
      return Pe.H.useCacheRefresh();
    };
    ie.use = function (e) {
      return Pe.H.use(e);
    };
    ie.useActionState = function (e, t, i) {
      return Pe.H.useActionState(e, t, i);
    };
    ie.useCallback = function (e, t) {
      return Pe.H.useCallback(e, t);
    };
    ie.useContext = function (e) {
      return Pe.H.useContext(e);
    };
    ie.useDebugValue = function () {};
    ie.useDeferredValue = function (e, t) {
      return Pe.H.useDeferredValue(e, t);
    };
    ie.useEffect = function (e, t) {
      return Pe.H.useEffect(e, t);
    };
    ie.useEffectEvent = function (e) {
      return Pe.H.useEffectEvent(e);
    };
    ie.useId = function () {
      return Pe.H.useId();
    };
    ie.useImperativeHandle = function (e, t, i) {
      return Pe.H.useImperativeHandle(e, t, i);
    };
    ie.useInsertionEffect = function (e, t) {
      return Pe.H.useInsertionEffect(e, t);
    };
    ie.useLayoutEffect = function (e, t) {
      return Pe.H.useLayoutEffect(e, t);
    };
    ie.useMemo = function (e, t) {
      return Pe.H.useMemo(e, t);
    };
    ie.useOptimistic = function (e, t) {
      return Pe.H.useOptimistic(e, t);
    };
    ie.useReducer = function (e, t, i) {
      return Pe.H.useReducer(e, t, i);
    };
    ie.useRef = function (e) {
      return Pe.H.useRef(e);
    };
    ie.useState = function (e) {
      return Pe.H.useState(e);
    };
    ie.useSyncExternalStore = function (e, t, i) {
      return Pe.H.useSyncExternalStore(e, t, i);
    };
    ie.useTransition = function () {
      return Pe.H.useTransition();
    };
    ie.version = "19.2.6";
  });
  var yo = va((Ty, Lm) => {
    "use strict";
    Lm.exports = gm();
  });
  var vm = va((yt) => {
    "use strict";
    var M_ = yo();
    function _m(e) {
      var t = "https://react.dev/errors/" + e;
      if (1 < arguments.length) {
        t += "?args[]=" + encodeURIComponent(arguments[1]);
        for (var i = 2; i < arguments.length; i++)
          t += "&args[]=" + encodeURIComponent(arguments[i]);
      }
      return (
        "Minified React error #" +
        e +
        "; visit " +
        t +
        " for the full message or use the non-minified dev environment for full errors and additional helpful warnings."
      );
    }
    function Oi() {}
    var vt = {
        d: {
          f: Oi,
          r: function () {
            throw Error(_m(522));
          },
          D: Oi,
          C: Oi,
          L: Oi,
          m: Oi,
          X: Oi,
          S: Oi,
          M: Oi,
        },
        p: 0,
        findDOMNode: null,
      },
      T_ = Symbol.for("react.portal");
    function A_(e, t, i) {
      var o =
        3 < arguments.length && arguments[3] !== void 0 ? arguments[3] : null;
      return {
        $$typeof: T_,
        key: o == null ? null : "" + o,
        children: e,
        containerInfo: t,
        implementation: i,
      };
    }
    var Pl = M_.__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE;
    function Cs(e, t) {
      if (e === "font") return "";
      if (typeof t == "string") return t === "use-credentials" ? t : "";
    }
    yt.__DOM_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE = vt;
    yt.createPortal = function (e, t) {
      var i =
        2 < arguments.length && arguments[2] !== void 0 ? arguments[2] : null;
      if (!t || (t.nodeType !== 1 && t.nodeType !== 9 && t.nodeType !== 11))
        throw Error(_m(299));
      return A_(e, t, null, i);
    };
    yt.flushSync = function (e) {
      var t = Pl.T,
        i = vt.p;
      try {
        if (((Pl.T = null), (vt.p = 2), e)) return e();
      } finally {
        ((Pl.T = t), (vt.p = i), vt.d.f());
      }
    };
    yt.preconnect = function (e, t) {
      typeof e == "string" &&
        (t
          ? ((t = t.crossOrigin),
            (t =
              typeof t == "string"
                ? t === "use-credentials"
                  ? t
                  : ""
                : void 0))
          : (t = null),
        vt.d.C(e, t));
    };
    yt.prefetchDNS = function (e) {
      typeof e == "string" && vt.d.D(e);
    };
    yt.preinit = function (e, t) {
      if (typeof e == "string" && t && typeof t.as == "string") {
        var i = t.as,
          o = Cs(i, t.crossOrigin),
          l = typeof t.integrity == "string" ? t.integrity : void 0,
          s = typeof t.fetchPriority == "string" ? t.fetchPriority : void 0;
        i === "style"
          ? vt.d.S(e, typeof t.precedence == "string" ? t.precedence : void 0, {
              crossOrigin: o,
              integrity: l,
              fetchPriority: s,
            })
          : i === "script" &&
            vt.d.X(e, {
              crossOrigin: o,
              integrity: l,
              fetchPriority: s,
              nonce: typeof t.nonce == "string" ? t.nonce : void 0,
            });
      }
    };
    yt.preinitModule = function (e, t) {
      if (typeof e == "string")
        if (typeof t == "object" && t !== null) {
          if (t.as == null || t.as === "script") {
            var i = Cs(t.as, t.crossOrigin);
            vt.d.M(e, {
              crossOrigin: i,
              integrity: typeof t.integrity == "string" ? t.integrity : void 0,
              nonce: typeof t.nonce == "string" ? t.nonce : void 0,
            });
          }
        } else t == null && vt.d.M(e);
    };
    yt.preload = function (e, t) {
      if (
        typeof e == "string" &&
        typeof t == "object" &&
        t !== null &&
        typeof t.as == "string"
      ) {
        var i = t.as,
          o = Cs(i, t.crossOrigin);
        vt.d.L(e, i, {
          crossOrigin: o,
          integrity: typeof t.integrity == "string" ? t.integrity : void 0,
          nonce: typeof t.nonce == "string" ? t.nonce : void 0,
          type: typeof t.type == "string" ? t.type : void 0,
          fetchPriority:
            typeof t.fetchPriority == "string" ? t.fetchPriority : void 0,
          referrerPolicy:
            typeof t.referrerPolicy == "string" ? t.referrerPolicy : void 0,
          imageSrcSet:
            typeof t.imageSrcSet == "string" ? t.imageSrcSet : void 0,
          imageSizes: typeof t.imageSizes == "string" ? t.imageSizes : void 0,
          media: typeof t.media == "string" ? t.media : void 0,
        });
      }
    };
    yt.preloadModule = function (e, t) {
      if (typeof e == "string")
        if (t) {
          var i = Cs(t.as, t.crossOrigin);
          vt.d.m(e, {
            as: typeof t.as == "string" && t.as !== "script" ? t.as : void 0,
            crossOrigin: i,
            integrity: typeof t.integrity == "string" ? t.integrity : void 0,
          });
        } else vt.d.m(e);
    };
    yt.requestFormReset = function (e) {
      vt.d.r(e);
    };
    yt.unstable_batchedUpdates = function (e, t) {
      return e(t);
    };
    yt.useFormState = function (e, t, i) {
      return Pl.H.useFormState(e, t, i);
    };
    yt.useFormStatus = function () {
      return Pl.H.useHostTransitionStatus();
    };
    yt.version = "19.2.6";
  });
  var Sm = va((Dy, xm) => {
    "use strict";
    function ym() {
      if (!(
        typeof __REACT_DEVTOOLS_GLOBAL_HOOK__ > "u" ||
        typeof __REACT_DEVTOOLS_GLOBAL_HOOK__.checkDCE != "function"
      ))
        try {
          __REACT_DEVTOOLS_GLOBAL_HOOK__.checkDCE(ym);
        } catch (e) {
          console.error(e);
        }
    }
    (ym(), (xm.exports = vm()));
  });
  var z1 = va((Yr) => {
    "use strict";
    var at = nm(),
      Yp = yo(),
      D_ = Sm();
    function k(e) {
      var t = "https://react.dev/errors/" + e;
      if (1 < arguments.length) {
        t += "?args[]=" + encodeURIComponent(arguments[1]);
        for (var i = 2; i < arguments.length; i++)
          t += "&args[]=" + encodeURIComponent(arguments[i]);
      }
      return (
        "Minified React error #" +
        e +
        "; visit " +
        t +
        " for the full message or use the non-minified dev environment for full errors and additional helpful warnings."
      );
    }
    function Kp(e) {
      return !(
        !e ||
        (e.nodeType !== 1 && e.nodeType !== 9 && e.nodeType !== 11)
      );
    }
    function _u(e) {
      var t = e,
        i = e;
      if (e.alternate) for (; t.return;) t = t.return;
      else {
        e = t;
        do ((t = e), (t.flags & 4098) !== 0 && (i = t.return), (e = t.return));
        while (e);
      }
      return t.tag === 3 ? i : null;
    }
    function Qp(e) {
      if (e.tag === 13) {
        var t = e.memoizedState;
        if (
          (t === null &&
            ((e = e.alternate), e !== null && (t = e.memoizedState)),
          t !== null)
        )
          return t.dehydrated;
      }
      return null;
    }
    function Wp(e) {
      if (e.tag === 31) {
        var t = e.memoizedState;
        if (
          (t === null &&
            ((e = e.alternate), e !== null && (t = e.memoizedState)),
          t !== null)
        )
          return t.dehydrated;
      }
      return null;
    }
    function Cm(e) {
      if (_u(e) !== e) throw Error(k(188));
    }
    function B_(e) {
      var t = e.alternate;
      if (!t) {
        if (((t = _u(e)), t === null)) throw Error(k(188));
        return t !== e ? null : e;
      }
      for (var i = e, o = t; ;) {
        var l = i.return;
        if (l === null) break;
        var s = l.alternate;
        if (s === null) {
          if (((o = l.return), o !== null)) {
            i = o;
            continue;
          }
          break;
        }
        if (l.child === s.child) {
          for (s = l.child; s;) {
            if (s === i) return (Cm(l), e);
            if (s === o) return (Cm(l), t);
            s = s.sibling;
          }
          throw Error(k(188));
        }
        if (i.return !== o.return) ((i = l), (o = s));
        else {
          for (var f = !1, c = l.child; c;) {
            if (c === i) {
              ((f = !0), (i = l), (o = s));
              break;
            }
            if (c === o) {
              ((f = !0), (o = l), (i = s));
              break;
            }
            c = c.sibling;
          }
          if (!f) {
            for (c = s.child; c;) {
              if (c === i) {
                ((f = !0), (i = s), (o = l));
                break;
              }
              if (c === o) {
                ((f = !0), (o = s), (i = l));
                break;
              }
              c = c.sibling;
            }
            if (!f) throw Error(k(189));
          }
        }
        if (i.alternate !== o) throw Error(k(190));
      }
      if (i.tag !== 3) throw Error(k(188));
      return i.stateNode.current === i ? e : t;
    }
    function Jp(e) {
      var t = e.tag;
      if (t === 5 || t === 26 || t === 27 || t === 6) return e;
      for (e = e.child; e !== null;) {
        if (((t = Jp(e)), t !== null)) return t;
        e = e.sibling;
      }
      return null;
    }
    var Oe = Object.assign,
      P_ = Symbol.for("react.element"),
      Is = Symbol.for("react.transitional.element"),
      Hl = Symbol.for("react.portal"),
      xn = Symbol.for("react.fragment"),
      $p = Symbol.for("react.strict_mode"),
      pd = Symbol.for("react.profiler"),
      e2 = Symbol.for("react.consumer"),
      di = Symbol.for("react.context"),
      fc = Symbol.for("react.forward_ref"),
      gd = Symbol.for("react.suspense"),
      Ld = Symbol.for("react.suspense_list"),
      dc = Symbol.for("react.memo"),
      Ri = Symbol.for("react.lazy"),
      _d = Symbol.for("react.activity"),
      k_ = Symbol.for("react.memo_cache_sentinel"),
      Im = Symbol.iterator;
    function kl(e) {
      return e === null || typeof e != "object"
        ? null
        : ((e = (Im && e[Im]) || e["@@iterator"]),
          typeof e == "function" ? e : null);
    }
    var z_ = Symbol.for("react.client.reference");
    function vd(e) {
      if (e == null) return null;
      if (typeof e == "function")
        return e.$$typeof === z_ ? null : e.displayName || e.name || null;
      if (typeof e == "string") return e;
      switch (e) {
        case xn:
          return "Fragment";
        case pd:
          return "Profiler";
        case $p:
          return "StrictMode";
        case gd:
          return "Suspense";
        case Ld:
          return "SuspenseList";
        case _d:
          return "Activity";
      }
      if (typeof e == "object")
        switch (e.$$typeof) {
          case Hl:
            return "Portal";
          case di:
            return e.displayName || "Context";
          case e2:
            return (e._context.displayName || "Context") + ".Consumer";
          case fc:
            var t = e.render;
            return (
              (e = e.displayName),
              e ||
                ((e = t.displayName || t.name || ""),
                (e = e !== "" ? "ForwardRef(" + e + ")" : "ForwardRef")),
              e
            );
          case dc:
            return (
              (t = e.displayName || null),
              t !== null ? t : vd(e.type) || "Memo"
            );
          case Ri:
            ((t = e._payload), (e = e._init));
            try {
              return vd(e(t));
            } catch {}
        }
      return null;
    }
    var Nl = Array.isArray,
      J = Yp.__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE,
      xe = D_.__DOM_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE,
      wo = { pending: !1, data: null, method: null, action: null },
      yd = [],
      Sn = -1;
    function qa(e) {
      return { current: e };
    }
    function lt(e) {
      0 > Sn || ((e.current = yd[Sn]), (yd[Sn] = null), Sn--);
    }
    function Ae(e, t) {
      (Sn++, (yd[Sn] = e.current), (e.current = t));
    }
    var Ua = qa(null),
      ou = qa(null),
      ji = qa(null),
      ir = qa(null);
    function or(e, t) {
      switch ((Ae(ji, t), Ae(ou, e), Ae(Ua, null), t.nodeType)) {
        case 9:
        case 11:
          e = (e = t.documentElement) && (e = e.namespaceURI) ? Bp(e) : 0;
          break;
        default:
          if (((e = t.tagName), (t = t.namespaceURI)))
            ((t = Bp(t)), (e = y1(t, e)));
          else
            switch (e) {
              case "svg":
                e = 1;
                break;
              case "math":
                e = 2;
                break;
              default:
                e = 0;
            }
      }
      (lt(Ua), Ae(Ua, e));
    }
    function Hn() {
      (lt(Ua), lt(ou), lt(ji));
    }
    function xd(e) {
      e.memoizedState !== null && Ae(ir, e);
      var t = Ua.current,
        i = y1(t, e.type);
      t !== i && (Ae(ou, e), Ae(Ua, i));
    }
    function nr(e) {
      (ou.current === e && (lt(Ua), lt(ou)),
        ir.current === e && (lt(ir), (pu._currentValue = wo)));
    }
    var Rf, bm;
    function So(e) {
      if (Rf === void 0)
        try {
          throw Error();
        } catch (i) {
          var t = i.stack.trim().match(/\n( *(at )?)/);
          ((Rf = (t && t[1]) || ""),
            (bm =
              -1 <
              i.stack.indexOf(`
    at`)
                ? " (<anonymous>)"
                : -1 < i.stack.indexOf("@")
                  ? "@unknown:0:0"
                  : ""));
        }
      return (
        `
` +
        Rf +
        e +
        bm
      );
    }
    var Ef = !1;
    function Uf(e, t) {
      if (!e || Ef) return "";
      Ef = !0;
      var i = Error.prepareStackTrace;
      Error.prepareStackTrace = void 0;
      try {
        var o = {
          DetermineComponentFrameRoot: function () {
            try {
              if (t) {
                var _ = function () {
                  throw Error();
                };
                if (
                  (Object.defineProperty(_.prototype, "props", {
                    set: function () {
                      throw Error();
                    },
                  }),
                  typeof Reflect == "object" && Reflect.construct)
                ) {
                  try {
                    Reflect.construct(_, []);
                  } catch (x) {
                    var v = x;
                  }
                  Reflect.construct(e, [], _);
                } else {
                  try {
                    _.call();
                  } catch (x) {
                    v = x;
                  }
                  e.call(_.prototype);
                }
              } else {
                try {
                  throw Error();
                } catch (x) {
                  v = x;
                }
                (_ = e()) &&
                  typeof _.catch == "function" &&
                  _.catch(function () {});
              }
            } catch (x) {
              if (x && v && typeof x.stack == "string")
                return [x.stack, v.stack];
            }
            return [null, null];
          },
        };
        o.DetermineComponentFrameRoot.displayName =
          "DetermineComponentFrameRoot";
        var l = Object.getOwnPropertyDescriptor(
          o.DetermineComponentFrameRoot,
          "name",
        );
        l &&
          l.configurable &&
          Object.defineProperty(o.DetermineComponentFrameRoot, "name", {
            value: "DetermineComponentFrameRoot",
          });
        var s = o.DetermineComponentFrameRoot(),
          f = s[0],
          c = s[1];
        if (f && c) {
          var g = f.split(`
`),
            y = c.split(`
`);
          for (
            l = o = 0;
            o < g.length && !g[o].includes("DetermineComponentFrameRoot");
          )
            o++;
          for (; l < y.length && !y[l].includes("DetermineComponentFrameRoot");)
            l++;
          if (o === g.length || l === y.length)
            for (
              o = g.length - 1, l = y.length - 1;
              1 <= o && 0 <= l && g[o] !== y[l];
            )
              l--;
          for (; 1 <= o && 0 <= l; o--, l--)
            if (g[o] !== y[l]) {
              if (o !== 1 || l !== 1)
                do
                  if ((o--, l--, 0 > l || g[o] !== y[l])) {
                    var p =
                      `
` + g[o].replace(" at new ", " at ");
                    return (
                      e.displayName &&
                        p.includes("<anonymous>") &&
                        (p = p.replace("<anonymous>", e.displayName)),
                      p
                    );
                  }
                while (1 <= o && 0 <= l);
              break;
            }
        }
      } finally {
        ((Ef = !1), (Error.prepareStackTrace = i));
      }
      return (i = e ? e.displayName || e.name : "") ? So(i) : "";
    }
    function O_(e, t) {
      switch (e.tag) {
        case 26:
        case 27:
        case 5:
          return So(e.type);
        case 16:
          return So("Lazy");
        case 13:
          return e.child !== t && t !== null
            ? So("Suspense Fallback")
            : So("Suspense");
        case 19:
          return So("SuspenseList");
        case 0:
        case 15:
          return Uf(e.type, !1);
        case 11:
          return Uf(e.type.render, !1);
        case 1:
          return Uf(e.type, !0);
        case 31:
          return So("Activity");
        default:
          return "";
      }
    }
    function wm(e) {
      try {
        var t = "",
          i = null;
        do ((t += O_(e, i)), (i = e), (e = e.return));
        while (e);
        return t;
      } catch (o) {
        return (
          `
Error generating stack: ` +
          o.message +
          `
` +
          o.stack
        );
      }
    }
    var Sd = Object.prototype.hasOwnProperty,
      cc = at.unstable_scheduleCallback,
      qf = at.unstable_cancelCallback,
      R_ = at.unstable_shouldYield,
      E_ = at.unstable_requestPaint,
      Nt = at.unstable_now,
      U_ = at.unstable_getCurrentPriorityLevel,
      t2 = at.unstable_ImmediatePriority,
      a2 = at.unstable_UserBlockingPriority,
      lr = at.unstable_NormalPriority,
      q_ = at.unstable_LowPriority,
      i2 = at.unstable_IdlePriority,
      H_ = at.log,
      N_ = at.unstable_setDisableYieldValue,
      vu = null,
      Ft = null;
    function Fi(e) {
      if (
        (typeof H_ == "function" && N_(e),
        Ft && typeof Ft.setStrictMode == "function")
      )
        try {
          Ft.setStrictMode(vu, e);
        } catch {}
    }
    var Zt = Math.clz32 ? Math.clz32 : G_,
      F_ = Math.log,
      Z_ = Math.LN2;
    function G_(e) {
      return ((e >>>= 0), e === 0 ? 32 : (31 - ((F_(e) / Z_) | 0)) | 0);
    }
    var bs = 256,
      ws = 262144,
      Ms = 4194304;
    function Co(e) {
      var t = e & 42;
      if (t !== 0) return t;
      switch (e & -e) {
        case 1:
          return 1;
        case 2:
          return 2;
        case 4:
          return 4;
        case 8:
          return 8;
        case 16:
          return 16;
        case 32:
          return 32;
        case 64:
          return 64;
        case 128:
          return 128;
        case 256:
        case 512:
        case 1024:
        case 2048:
        case 4096:
        case 8192:
        case 16384:
        case 32768:
        case 65536:
        case 131072:
          return e & 261888;
        case 262144:
        case 524288:
        case 1048576:
        case 2097152:
          return e & 3932160;
        case 4194304:
        case 8388608:
        case 16777216:
        case 33554432:
          return e & 62914560;
        case 67108864:
          return 67108864;
        case 134217728:
          return 134217728;
        case 268435456:
          return 268435456;
        case 536870912:
          return 536870912;
        case 1073741824:
          return 0;
        default:
          return e;
      }
    }
    function Pr(e, t, i) {
      var o = e.pendingLanes;
      if (o === 0) return 0;
      var l = 0,
        s = e.suspendedLanes,
        f = e.pingedLanes;
      e = e.warmLanes;
      var c = o & 134217727;
      return (
        c !== 0
          ? ((o = c & ~s),
            o !== 0
              ? (l = Co(o))
              : ((f &= c),
                f !== 0
                  ? (l = Co(f))
                  : i || ((i = c & ~e), i !== 0 && (l = Co(i)))))
          : ((c = o & ~s),
            c !== 0
              ? (l = Co(c))
              : f !== 0
                ? (l = Co(f))
                : i || ((i = o & ~e), i !== 0 && (l = Co(i)))),
        l === 0
          ? 0
          : t !== 0 &&
              t !== l &&
              (t & s) === 0 &&
              ((s = l & -l),
              (i = t & -t),
              s >= i || (s === 32 && (i & 4194048) !== 0))
            ? t
            : l
      );
    }
    function yu(e, t) {
      return (e.pendingLanes & ~(e.suspendedLanes & ~e.pingedLanes) & t) === 0;
    }
    function V_(e, t) {
      switch (e) {
        case 1:
        case 2:
        case 4:
        case 8:
        case 64:
          return t + 250;
        case 16:
        case 32:
        case 128:
        case 256:
        case 512:
        case 1024:
        case 2048:
        case 4096:
        case 8192:
        case 16384:
        case 32768:
        case 65536:
        case 131072:
        case 262144:
        case 524288:
        case 1048576:
        case 2097152:
          return t + 5e3;
        case 4194304:
        case 8388608:
        case 16777216:
        case 33554432:
          return -1;
        case 67108864:
        case 134217728:
        case 268435456:
        case 536870912:
        case 1073741824:
          return -1;
        default:
          return -1;
      }
    }
    function o2() {
      var e = Ms;
      return ((Ms <<= 1), (Ms & 62914560) === 0 && (Ms = 4194304), e);
    }
    function Hf(e) {
      for (var t = [], i = 0; 31 > i; i++) t.push(e);
      return t;
    }
    function xu(e, t) {
      ((e.pendingLanes |= t),
        t !== 268435456 &&
          ((e.suspendedLanes = 0), (e.pingedLanes = 0), (e.warmLanes = 0)));
    }
    function X_(e, t, i, o, l, s) {
      var f = e.pendingLanes;
      ((e.pendingLanes = i),
        (e.suspendedLanes = 0),
        (e.pingedLanes = 0),
        (e.warmLanes = 0),
        (e.expiredLanes &= i),
        (e.entangledLanes &= i),
        (e.errorRecoveryDisabledLanes &= i),
        (e.shellSuspendCounter = 0));
      var c = e.entanglements,
        g = e.expirationTimes,
        y = e.hiddenUpdates;
      for (i = f & ~i; 0 < i;) {
        var p = 31 - Zt(i),
          _ = 1 << p;
        ((c[p] = 0), (g[p] = -1));
        var v = y[p];
        if (v !== null)
          for (y[p] = null, p = 0; p < v.length; p++) {
            var x = v[p];
            x !== null && (x.lane &= -536870913);
          }
        i &= ~_;
      }
      (o !== 0 && n2(e, o, 0),
        s !== 0 &&
          l === 0 &&
          e.tag !== 0 &&
          (e.suspendedLanes |= s & ~(f & ~t)));
    }
    function n2(e, t, i) {
      ((e.pendingLanes |= t), (e.suspendedLanes &= ~t));
      var o = 31 - Zt(t);
      ((e.entangledLanes |= t),
        (e.entanglements[o] = e.entanglements[o] | 1073741824 | (i & 261930)));
    }
    function l2(e, t) {
      var i = (e.entangledLanes |= t);
      for (e = e.entanglements; i;) {
        var o = 31 - Zt(i),
          l = 1 << o;
        ((l & t) | (e[o] & t) && (e[o] |= t), (i &= ~l));
      }
    }
    function u2(e, t) {
      var i = t & -t;
      return (
        (i = (i & 42) !== 0 ? 1 : hc(i)),
        (i & (e.suspendedLanes | t)) !== 0 ? 0 : i
      );
    }
    function hc(e) {
      switch (e) {
        case 2:
          e = 1;
          break;
        case 8:
          e = 4;
          break;
        case 32:
          e = 16;
          break;
        case 256:
        case 512:
        case 1024:
        case 2048:
        case 4096:
        case 8192:
        case 16384:
        case 32768:
        case 65536:
        case 131072:
        case 262144:
        case 524288:
        case 1048576:
        case 2097152:
        case 4194304:
        case 8388608:
        case 16777216:
        case 33554432:
          e = 128;
          break;
        case 268435456:
          e = 134217728;
          break;
        default:
          e = 0;
      }
      return e;
    }
    function mc(e) {
      return (
        (e &= -e),
        2 < e ? (8 < e ? ((e & 134217727) !== 0 ? 32 : 268435456) : 8) : 2
      );
    }
    function s2() {
      var e = xe.p;
      return e !== 0 ? e : ((e = window.event), e === void 0 ? 32 : B1(e.type));
    }
    function Mm(e, t) {
      var i = xe.p;
      try {
        return ((xe.p = e), t());
      } finally {
        xe.p = i;
      }
    }
    var lo = Math.random().toString(36).slice(2),
      ft = "__reactFiber$" + lo,
      Pt = "__reactProps$" + lo,
      Wn = "__reactContainer$" + lo,
      Cd = "__reactEvents$" + lo,
      j_ = "__reactListeners$" + lo,
      Y_ = "__reactHandles$" + lo,
      Tm = "__reactResources$" + lo,
      Su = "__reactMarker$" + lo;
    function pc(e) {
      (delete e[ft], delete e[Pt], delete e[Cd], delete e[j_], delete e[Y_]);
    }
    function Cn(e) {
      var t = e[ft];
      if (t) return t;
      for (var i = e.parentNode; i;) {
        if ((t = i[Wn] || i[ft])) {
          if (
            ((i = t.alternate),
            t.child !== null || (i !== null && i.child !== null))
          )
            for (e = Rp(e); e !== null;) {
              if ((i = e[ft])) return i;
              e = Rp(e);
            }
          return t;
        }
        ((e = i), (i = e.parentNode));
      }
      return null;
    }
    function Jn(e) {
      if ((e = e[ft] || e[Wn])) {
        var t = e.tag;
        if (
          t === 5 ||
          t === 6 ||
          t === 13 ||
          t === 31 ||
          t === 26 ||
          t === 27 ||
          t === 3
        )
          return e;
      }
      return null;
    }
    function Fl(e) {
      var t = e.tag;
      if (t === 5 || t === 26 || t === 27 || t === 6) return e.stateNode;
      throw Error(k(33));
    }
    function kn(e) {
      var t = e[Tm];
      return (
        t ||
          (t = e[Tm] =
            { hoistableStyles: new Map(), hoistableScripts: new Map() }),
        t
      );
    }
    function nt(e) {
      e[Su] = !0;
    }
    var r2 = new Set(),
      f2 = {};
    function Ro(e, t) {
      (Nn(e, t), Nn(e + "Capture", t));
    }
    function Nn(e, t) {
      for (f2[e] = t, e = 0; e < t.length; e++) r2.add(t[e]);
    }
    var K_ = RegExp(
        "^[:A-Z_a-z\\u00C0-\\u00D6\\u00D8-\\u00F6\\u00F8-\\u02FF\\u0370-\\u037D\\u037F-\\u1FFF\\u200C-\\u200D\\u2070-\\u218F\\u2C00-\\u2FEF\\u3001-\\uD7FF\\uF900-\\uFDCF\\uFDF0-\\uFFFD][:A-Z_a-z\\u00C0-\\u00D6\\u00D8-\\u00F6\\u00F8-\\u02FF\\u0370-\\u037D\\u037F-\\u1FFF\\u200C-\\u200D\\u2070-\\u218F\\u2C00-\\u2FEF\\u3001-\\uD7FF\\uF900-\\uFDCF\\uFDF0-\\uFFFD\\-.0-9\\u00B7\\u0300-\\u036F\\u203F-\\u2040]*$",
      ),
      Am = {},
      Dm = {};
    function Q_(e) {
      return Sd.call(Dm, e)
        ? !0
        : Sd.call(Am, e)
          ? !1
          : K_.test(e)
            ? (Dm[e] = !0)
            : ((Am[e] = !0), !1);
    }
    function Fs(e, t, i) {
      if (Q_(t))
        if (i === null) e.removeAttribute(t);
        else {
          switch (typeof i) {
            case "undefined":
            case "function":
            case "symbol":
              e.removeAttribute(t);
              return;
            case "boolean":
              var o = t.toLowerCase().slice(0, 5);
              if (o !== "data-" && o !== "aria-") {
                e.removeAttribute(t);
                return;
              }
          }
          e.setAttribute(t, "" + i);
        }
    }
    function Ts(e, t, i) {
      if (i === null) e.removeAttribute(t);
      else {
        switch (typeof i) {
          case "undefined":
          case "function":
          case "symbol":
          case "boolean":
            e.removeAttribute(t);
            return;
        }
        e.setAttribute(t, "" + i);
      }
    }
    function oi(e, t, i, o) {
      if (o === null) e.removeAttribute(i);
      else {
        switch (typeof o) {
          case "undefined":
          case "function":
          case "symbol":
          case "boolean":
            e.removeAttribute(i);
            return;
        }
        e.setAttributeNS(t, i, "" + o);
      }
    }
    function aa(e) {
      switch (typeof e) {
        case "bigint":
        case "boolean":
        case "number":
        case "string":
        case "undefined":
          return e;
        case "object":
          return e;
        default:
          return "";
      }
    }
    function d2(e) {
      var t = e.type;
      return (
        (e = e.nodeName) &&
        e.toLowerCase() === "input" &&
        (t === "checkbox" || t === "radio")
      );
    }
    function W_(e, t, i) {
      var o = Object.getOwnPropertyDescriptor(e.constructor.prototype, t);
      if (
        !e.hasOwnProperty(t) &&
        typeof o < "u" &&
        typeof o.get == "function" &&
        typeof o.set == "function"
      ) {
        var l = o.get,
          s = o.set;
        return (
          Object.defineProperty(e, t, {
            configurable: !0,
            get: function () {
              return l.call(this);
            },
            set: function (f) {
              ((i = "" + f), s.call(this, f));
            },
          }),
          Object.defineProperty(e, t, { enumerable: o.enumerable }),
          {
            getValue: function () {
              return i;
            },
            setValue: function (f) {
              i = "" + f;
            },
            stopTracking: function () {
              ((e._valueTracker = null), delete e[t]);
            },
          }
        );
      }
    }
    function Id(e) {
      if (!e._valueTracker) {
        var t = d2(e) ? "checked" : "value";
        e._valueTracker = W_(e, t, "" + e[t]);
      }
    }
    function c2(e) {
      if (!e) return !1;
      var t = e._valueTracker;
      if (!t) return !0;
      var i = t.getValue(),
        o = "";
      return (
        e && (o = d2(e) ? (e.checked ? "true" : "false") : e.value),
        (e = o),
        e !== i ? (t.setValue(e), !0) : !1
      );
    }
    function ur(e) {
      if (
        ((e = e || (typeof document < "u" ? document : void 0)), typeof e > "u")
      )
        return null;
      try {
        return e.activeElement || e.body;
      } catch {
        return e.body;
      }
    }
    var J_ = /[\n"\\]/g;
    function na(e) {
      return e.replace(J_, function (t) {
        return "\\" + t.charCodeAt(0).toString(16) + " ";
      });
    }
    function bd(e, t, i, o, l, s, f, c) {
      ((e.name = ""),
        f != null &&
        typeof f != "function" &&
        typeof f != "symbol" &&
        typeof f != "boolean"
          ? (e.type = f)
          : e.removeAttribute("type"),
        t != null
          ? f === "number"
            ? ((t === 0 && e.value === "") || e.value != t) &&
              (e.value = "" + aa(t))
            : e.value !== "" + aa(t) && (e.value = "" + aa(t))
          : (f !== "submit" && f !== "reset") || e.removeAttribute("value"),
        t != null
          ? wd(e, f, aa(t))
          : i != null
            ? wd(e, f, aa(i))
            : o != null && e.removeAttribute("value"),
        l == null && s != null && (e.defaultChecked = !!s),
        l != null &&
          (e.checked = l && typeof l != "function" && typeof l != "symbol"),
        c != null &&
        typeof c != "function" &&
        typeof c != "symbol" &&
        typeof c != "boolean"
          ? (e.name = "" + aa(c))
          : e.removeAttribute("name"));
    }
    function h2(e, t, i, o, l, s, f, c) {
      if (
        (s != null &&
          typeof s != "function" &&
          typeof s != "symbol" &&
          typeof s != "boolean" &&
          (e.type = s),
        t != null || i != null)
      ) {
        if (!((s !== "submit" && s !== "reset") || t != null)) {
          Id(e);
          return;
        }
        ((i = i != null ? "" + aa(i) : ""),
          (t = t != null ? "" + aa(t) : i),
          c || t === e.value || (e.value = t),
          (e.defaultValue = t));
      }
      ((o = o ?? l),
        (o = typeof o != "function" && typeof o != "symbol" && !!o),
        (e.checked = c ? e.checked : !!o),
        (e.defaultChecked = !!o),
        f != null &&
          typeof f != "function" &&
          typeof f != "symbol" &&
          typeof f != "boolean" &&
          (e.name = f),
        Id(e));
    }
    function wd(e, t, i) {
      (t === "number" && ur(e.ownerDocument) === e) ||
        e.defaultValue === "" + i ||
        (e.defaultValue = "" + i);
    }
    function zn(e, t, i, o) {
      if (((e = e.options), t)) {
        t = {};
        for (var l = 0; l < i.length; l++) t["$" + i[l]] = !0;
        for (i = 0; i < e.length; i++)
          ((l = t.hasOwnProperty("$" + e[i].value)),
            e[i].selected !== l && (e[i].selected = l),
            l && o && (e[i].defaultSelected = !0));
      } else {
        for (i = "" + aa(i), t = null, l = 0; l < e.length; l++) {
          if (e[l].value === i) {
            ((e[l].selected = !0), o && (e[l].defaultSelected = !0));
            return;
          }
          t !== null || e[l].disabled || (t = e[l]);
        }
        t !== null && (t.selected = !0);
      }
    }
    function m2(e, t, i) {
      if (
        t != null &&
        ((t = "" + aa(t)), t !== e.value && (e.value = t), i == null)
      ) {
        e.defaultValue !== t && (e.defaultValue = t);
        return;
      }
      e.defaultValue = i != null ? "" + aa(i) : "";
    }
    function p2(e, t, i, o) {
      if (t == null) {
        if (o != null) {
          if (i != null) throw Error(k(92));
          if (Nl(o)) {
            if (1 < o.length) throw Error(k(93));
            o = o[0];
          }
          i = o;
        }
        (i == null && (i = ""), (t = i));
      }
      ((i = aa(t)),
        (e.defaultValue = i),
        (o = e.textContent),
        o === i && o !== "" && o !== null && (e.value = o),
        Id(e));
    }
    function Fn(e, t) {
      if (t) {
        var i = e.firstChild;
        if (i && i === e.lastChild && i.nodeType === 3) {
          i.nodeValue = t;
          return;
        }
      }
      e.textContent = t;
    }
    var $_ = new Set(
      "animationIterationCount aspectRatio borderImageOutset borderImageSlice borderImageWidth boxFlex boxFlexGroup boxOrdinalGroup columnCount columns flex flexGrow flexPositive flexShrink flexNegative flexOrder gridArea gridRow gridRowEnd gridRowSpan gridRowStart gridColumn gridColumnEnd gridColumnSpan gridColumnStart fontWeight lineClamp lineHeight opacity order orphans scale tabSize widows zIndex zoom fillOpacity floodOpacity stopOpacity strokeDasharray strokeDashoffset strokeMiterlimit strokeOpacity strokeWidth MozAnimationIterationCount MozBoxFlex MozBoxFlexGroup MozLineClamp msAnimationIterationCount msFlex msZoom msFlexGrow msFlexNegative msFlexOrder msFlexPositive msFlexShrink msGridColumn msGridColumnSpan msGridRow msGridRowSpan WebkitAnimationIterationCount WebkitBoxFlex WebKitBoxFlexGroup WebkitBoxOrdinalGroup WebkitColumnCount WebkitColumns WebkitFlex WebkitFlexGrow WebkitFlexPositive WebkitFlexShrink WebkitLineClamp".split(
        " ",
      ),
    );
    function Bm(e, t, i) {
      var o = t.indexOf("--") === 0;
      i == null || typeof i == "boolean" || i === ""
        ? o
          ? e.setProperty(t, "")
          : t === "float"
            ? (e.cssFloat = "")
            : (e[t] = "")
        : o
          ? e.setProperty(t, i)
          : typeof i != "number" || i === 0 || $_.has(t)
            ? t === "float"
              ? (e.cssFloat = i)
              : (e[t] = ("" + i).trim())
            : (e[t] = i + "px");
    }
    function g2(e, t, i) {
      if (t != null && typeof t != "object") throw Error(k(62));
      if (((e = e.style), i != null)) {
        for (var o in i)
          !i.hasOwnProperty(o) ||
            (t != null && t.hasOwnProperty(o)) ||
            (o.indexOf("--") === 0
              ? e.setProperty(o, "")
              : o === "float"
                ? (e.cssFloat = "")
                : (e[o] = ""));
        for (var l in t)
          ((o = t[l]), t.hasOwnProperty(l) && i[l] !== o && Bm(e, l, o));
      } else for (var s in t) t.hasOwnProperty(s) && Bm(e, s, t[s]);
    }
    function gc(e) {
      if (e.indexOf("-") === -1) return !1;
      switch (e) {
        case "annotation-xml":
        case "color-profile":
        case "font-face":
        case "font-face-src":
        case "font-face-uri":
        case "font-face-format":
        case "font-face-name":
        case "missing-glyph":
          return !1;
        default:
          return !0;
      }
    }
    var e0 = new Map([
        ["acceptCharset", "accept-charset"],
        ["htmlFor", "for"],
        ["httpEquiv", "http-equiv"],
        ["crossOrigin", "crossorigin"],
        ["accentHeight", "accent-height"],
        ["alignmentBaseline", "alignment-baseline"],
        ["arabicForm", "arabic-form"],
        ["baselineShift", "baseline-shift"],
        ["capHeight", "cap-height"],
        ["clipPath", "clip-path"],
        ["clipRule", "clip-rule"],
        ["colorInterpolation", "color-interpolation"],
        ["colorInterpolationFilters", "color-interpolation-filters"],
        ["colorProfile", "color-profile"],
        ["colorRendering", "color-rendering"],
        ["dominantBaseline", "dominant-baseline"],
        ["enableBackground", "enable-background"],
        ["fillOpacity", "fill-opacity"],
        ["fillRule", "fill-rule"],
        ["floodColor", "flood-color"],
        ["floodOpacity", "flood-opacity"],
        ["fontFamily", "font-family"],
        ["fontSize", "font-size"],
        ["fontSizeAdjust", "font-size-adjust"],
        ["fontStretch", "font-stretch"],
        ["fontStyle", "font-style"],
        ["fontVariant", "font-variant"],
        ["fontWeight", "font-weight"],
        ["glyphName", "glyph-name"],
        ["glyphOrientationHorizontal", "glyph-orientation-horizontal"],
        ["glyphOrientationVertical", "glyph-orientation-vertical"],
        ["horizAdvX", "horiz-adv-x"],
        ["horizOriginX", "horiz-origin-x"],
        ["imageRendering", "image-rendering"],
        ["letterSpacing", "letter-spacing"],
        ["lightingColor", "lighting-color"],
        ["markerEnd", "marker-end"],
        ["markerMid", "marker-mid"],
        ["markerStart", "marker-start"],
        ["overlinePosition", "overline-position"],
        ["overlineThickness", "overline-thickness"],
        ["paintOrder", "paint-order"],
        ["panose-1", "panose-1"],
        ["pointerEvents", "pointer-events"],
        ["renderingIntent", "rendering-intent"],
        ["shapeRendering", "shape-rendering"],
        ["stopColor", "stop-color"],
        ["stopOpacity", "stop-opacity"],
        ["strikethroughPosition", "strikethrough-position"],
        ["strikethroughThickness", "strikethrough-thickness"],
        ["strokeDasharray", "stroke-dasharray"],
        ["strokeDashoffset", "stroke-dashoffset"],
        ["strokeLinecap", "stroke-linecap"],
        ["strokeLinejoin", "stroke-linejoin"],
        ["strokeMiterlimit", "stroke-miterlimit"],
        ["strokeOpacity", "stroke-opacity"],
        ["strokeWidth", "stroke-width"],
        ["textAnchor", "text-anchor"],
        ["textDecoration", "text-decoration"],
        ["textRendering", "text-rendering"],
        ["transformOrigin", "transform-origin"],
        ["underlinePosition", "underline-position"],
        ["underlineThickness", "underline-thickness"],
        ["unicodeBidi", "unicode-bidi"],
        ["unicodeRange", "unicode-range"],
        ["unitsPerEm", "units-per-em"],
        ["vAlphabetic", "v-alphabetic"],
        ["vHanging", "v-hanging"],
        ["vIdeographic", "v-ideographic"],
        ["vMathematical", "v-mathematical"],
        ["vectorEffect", "vector-effect"],
        ["vertAdvY", "vert-adv-y"],
        ["vertOriginX", "vert-origin-x"],
        ["vertOriginY", "vert-origin-y"],
        ["wordSpacing", "word-spacing"],
        ["writingMode", "writing-mode"],
        ["xmlnsXlink", "xmlns:xlink"],
        ["xHeight", "x-height"],
      ]),
      t0 =
        /^[\u0000-\u001F ]*j[\r\n\t]*a[\r\n\t]*v[\r\n\t]*a[\r\n\t]*s[\r\n\t]*c[\r\n\t]*r[\r\n\t]*i[\r\n\t]*p[\r\n\t]*t[\r\n\t]*:/i;
    function Zs(e) {
      return t0.test("" + e)
        ? "javascript:throw new Error('React has blocked a javascript: URL as a security precaution.')"
        : e;
    }
    function ci() {}
    var Md = null;
    function Lc(e) {
      return (
        (e = e.target || e.srcElement || window),
        e.correspondingUseElement && (e = e.correspondingUseElement),
        e.nodeType === 3 ? e.parentNode : e
      );
    }
    var In = null,
      On = null;
    function Pm(e) {
      var t = Jn(e);
      if (t && (e = t.stateNode)) {
        var i = e[Pt] || null;
        e: switch (((e = t.stateNode), t.type)) {
          case "input":
            if (
              (bd(
                e,
                i.value,
                i.defaultValue,
                i.defaultValue,
                i.checked,
                i.defaultChecked,
                i.type,
                i.name,
              ),
              (t = i.name),
              i.type === "radio" && t != null)
            ) {
              for (i = e; i.parentNode;) i = i.parentNode;
              for (
                i = i.querySelectorAll(
                  'input[name="' + na("" + t) + '"][type="radio"]',
                ),
                  t = 0;
                t < i.length;
                t++
              ) {
                var o = i[t];
                if (o !== e && o.form === e.form) {
                  var l = o[Pt] || null;
                  if (!l) throw Error(k(90));
                  bd(
                    o,
                    l.value,
                    l.defaultValue,
                    l.defaultValue,
                    l.checked,
                    l.defaultChecked,
                    l.type,
                    l.name,
                  );
                }
              }
              for (t = 0; t < i.length; t++)
                ((o = i[t]), o.form === e.form && c2(o));
            }
            break e;
          case "textarea":
            m2(e, i.value, i.defaultValue);
            break e;
          case "select":
            ((t = i.value), t != null && zn(e, !!i.multiple, t, !1));
        }
      }
    }
    var Nf = !1;
    function L2(e, t, i) {
      if (Nf) return e(t, i);
      Nf = !0;
      try {
        var o = e(t);
        return o;
      } finally {
        if (
          ((Nf = !1),
          (In !== null || On !== null) &&
            (Gr(), In && ((t = In), (e = On), (On = In = null), Pm(t), e)))
        )
          for (t = 0; t < e.length; t++) Pm(e[t]);
      }
    }
    function nu(e, t) {
      var i = e.stateNode;
      if (i === null) return null;
      var o = i[Pt] || null;
      if (o === null) return null;
      i = o[t];
      e: switch (t) {
        case "onClick":
        case "onClickCapture":
        case "onDoubleClick":
        case "onDoubleClickCapture":
        case "onMouseDown":
        case "onMouseDownCapture":
        case "onMouseMove":
        case "onMouseMoveCapture":
        case "onMouseUp":
        case "onMouseUpCapture":
        case "onMouseEnter":
          ((o = !o.disabled) ||
            ((e = e.type),
            (o = !(
              e === "button" ||
              e === "input" ||
              e === "select" ||
              e === "textarea"
            ))),
            (e = !o));
          break e;
        default:
          e = !1;
      }
      if (e) return null;
      if (i && typeof i != "function") throw Error(k(231, t, typeof i));
      return i;
    }
    var Li = !(
        typeof window > "u" ||
        typeof window.document > "u" ||
        typeof window.document.createElement > "u"
      ),
      Td = !1;
    if (Li)
      try {
        ((gn = {}),
          Object.defineProperty(gn, "passive", {
            get: function () {
              Td = !0;
            },
          }),
          window.addEventListener("test", gn, gn),
          window.removeEventListener("test", gn, gn));
      } catch {
        Td = !1;
      }
    var gn,
      Zi = null,
      _c = null,
      Gs = null;
    function _2() {
      if (Gs) return Gs;
      var e,
        t = _c,
        i = t.length,
        o,
        l = "value" in Zi ? Zi.value : Zi.textContent,
        s = l.length;
      for (e = 0; e < i && t[e] === l[e]; e++);
      var f = i - e;
      for (o = 1; o <= f && t[i - o] === l[s - o]; o++);
      return (Gs = l.slice(e, 1 < o ? 1 - o : void 0));
    }
    function Vs(e) {
      var t = e.keyCode;
      return (
        "charCode" in e
          ? ((e = e.charCode), e === 0 && t === 13 && (e = 13))
          : (e = t),
        e === 10 && (e = 13),
        32 <= e || e === 13 ? e : 0
      );
    }
    function As() {
      return !0;
    }
    function km() {
      return !1;
    }
    function kt(e) {
      function t(i, o, l, s, f) {
        ((this._reactName = i),
          (this._targetInst = l),
          (this.type = o),
          (this.nativeEvent = s),
          (this.target = f),
          (this.currentTarget = null));
        for (var c in e)
          e.hasOwnProperty(c) && ((i = e[c]), (this[c] = i ? i(s) : s[c]));
        return (
          (this.isDefaultPrevented = (
            s.defaultPrevented != null
              ? s.defaultPrevented
              : s.returnValue === !1
          )
            ? As
            : km),
          (this.isPropagationStopped = km),
          this
        );
      }
      return (
        Oe(t.prototype, {
          preventDefault: function () {
            this.defaultPrevented = !0;
            var i = this.nativeEvent;
            i &&
              (i.preventDefault
                ? i.preventDefault()
                : typeof i.returnValue != "unknown" && (i.returnValue = !1),
              (this.isDefaultPrevented = As));
          },
          stopPropagation: function () {
            var i = this.nativeEvent;
            i &&
              (i.stopPropagation
                ? i.stopPropagation()
                : typeof i.cancelBubble != "unknown" && (i.cancelBubble = !0),
              (this.isPropagationStopped = As));
          },
          persist: function () {},
          isPersistent: As,
        }),
        t
      );
    }
    var Eo = {
        eventPhase: 0,
        bubbles: 0,
        cancelable: 0,
        timeStamp: function (e) {
          return e.timeStamp || Date.now();
        },
        defaultPrevented: 0,
        isTrusted: 0,
      },
      kr = kt(Eo),
      Cu = Oe({}, Eo, { view: 0, detail: 0 }),
      a0 = kt(Cu),
      Ff,
      Zf,
      zl,
      zr = Oe({}, Cu, {
        screenX: 0,
        screenY: 0,
        clientX: 0,
        clientY: 0,
        pageX: 0,
        pageY: 0,
        ctrlKey: 0,
        shiftKey: 0,
        altKey: 0,
        metaKey: 0,
        getModifierState: vc,
        button: 0,
        buttons: 0,
        relatedTarget: function (e) {
          return e.relatedTarget === void 0
            ? e.fromElement === e.srcElement
              ? e.toElement
              : e.fromElement
            : e.relatedTarget;
        },
        movementX: function (e) {
          return "movementX" in e
            ? e.movementX
            : (e !== zl &&
                (zl && e.type === "mousemove"
                  ? ((Ff = e.screenX - zl.screenX),
                    (Zf = e.screenY - zl.screenY))
                  : (Zf = Ff = 0),
                (zl = e)),
              Ff);
        },
        movementY: function (e) {
          return "movementY" in e ? e.movementY : Zf;
        },
      }),
      zm = kt(zr),
      i0 = Oe({}, zr, { dataTransfer: 0 }),
      o0 = kt(i0),
      n0 = Oe({}, Cu, { relatedTarget: 0 }),
      Gf = kt(n0),
      l0 = Oe({}, Eo, { animationName: 0, elapsedTime: 0, pseudoElement: 0 }),
      u0 = kt(l0),
      s0 = Oe({}, Eo, {
        clipboardData: function (e) {
          return "clipboardData" in e ? e.clipboardData : window.clipboardData;
        },
      }),
      r0 = kt(s0),
      f0 = Oe({}, Eo, { data: 0 }),
      Om = kt(f0),
      d0 = {
        Esc: "Escape",
        Spacebar: " ",
        Left: "ArrowLeft",
        Up: "ArrowUp",
        Right: "ArrowRight",
        Down: "ArrowDown",
        Del: "Delete",
        Win: "OS",
        Menu: "ContextMenu",
        Apps: "ContextMenu",
        Scroll: "ScrollLock",
        MozPrintableKey: "Unidentified",
      },
      c0 = {
        8: "Backspace",
        9: "Tab",
        12: "Clear",
        13: "Enter",
        16: "Shift",
        17: "Control",
        18: "Alt",
        19: "Pause",
        20: "CapsLock",
        27: "Escape",
        32: " ",
        33: "PageUp",
        34: "PageDown",
        35: "End",
        36: "Home",
        37: "ArrowLeft",
        38: "ArrowUp",
        39: "ArrowRight",
        40: "ArrowDown",
        45: "Insert",
        46: "Delete",
        112: "F1",
        113: "F2",
        114: "F3",
        115: "F4",
        116: "F5",
        117: "F6",
        118: "F7",
        119: "F8",
        120: "F9",
        121: "F10",
        122: "F11",
        123: "F12",
        144: "NumLock",
        145: "ScrollLock",
        224: "Meta",
      },
      h0 = {
        Alt: "altKey",
        Control: "ctrlKey",
        Meta: "metaKey",
        Shift: "shiftKey",
      };
    function m0(e) {
      var t = this.nativeEvent;
      return t.getModifierState
        ? t.getModifierState(e)
        : (e = h0[e])
          ? !!t[e]
          : !1;
    }
    function vc() {
      return m0;
    }
    var p0 = Oe({}, Cu, {
        key: function (e) {
          if (e.key) {
            var t = d0[e.key] || e.key;
            if (t !== "Unidentified") return t;
          }
          return e.type === "keypress"
            ? ((e = Vs(e)), e === 13 ? "Enter" : String.fromCharCode(e))
            : e.type === "keydown" || e.type === "keyup"
              ? c0[e.keyCode] || "Unidentified"
              : "";
        },
        code: 0,
        location: 0,
        ctrlKey: 0,
        shiftKey: 0,
        altKey: 0,
        metaKey: 0,
        repeat: 0,
        locale: 0,
        getModifierState: vc,
        charCode: function (e) {
          return e.type === "keypress" ? Vs(e) : 0;
        },
        keyCode: function (e) {
          return e.type === "keydown" || e.type === "keyup" ? e.keyCode : 0;
        },
        which: function (e) {
          return e.type === "keypress"
            ? Vs(e)
            : e.type === "keydown" || e.type === "keyup"
              ? e.keyCode
              : 0;
        },
      }),
      g0 = kt(p0),
      L0 = Oe({}, zr, {
        pointerId: 0,
        width: 0,
        height: 0,
        pressure: 0,
        tangentialPressure: 0,
        tiltX: 0,
        tiltY: 0,
        twist: 0,
        pointerType: 0,
        isPrimary: 0,
      }),
      Rm = kt(L0),
      _0 = Oe({}, Cu, {
        touches: 0,
        targetTouches: 0,
        changedTouches: 0,
        altKey: 0,
        metaKey: 0,
        ctrlKey: 0,
        shiftKey: 0,
        getModifierState: vc,
      }),
      v0 = kt(_0),
      y0 = Oe({}, Eo, { propertyName: 0, elapsedTime: 0, pseudoElement: 0 }),
      x0 = kt(y0),
      S0 = Oe({}, zr, {
        deltaX: function (e) {
          return "deltaX" in e
            ? e.deltaX
            : "wheelDeltaX" in e
              ? -e.wheelDeltaX
              : 0;
        },
        deltaY: function (e) {
          return "deltaY" in e
            ? e.deltaY
            : "wheelDeltaY" in e
              ? -e.wheelDeltaY
              : "wheelDelta" in e
                ? -e.wheelDelta
                : 0;
        },
        deltaZ: 0,
        deltaMode: 0,
      }),
      C0 = kt(S0),
      I0 = Oe({}, Eo, { newState: 0, oldState: 0 }),
      b0 = kt(I0),
      w0 = [9, 13, 27, 32],
      yc = Li && "CompositionEvent" in window,
      Vl = null;
    Li && "documentMode" in document && (Vl = document.documentMode);
    var M0 = Li && "TextEvent" in window && !Vl,
      v2 = Li && (!yc || (Vl && 8 < Vl && 11 >= Vl)),
      Em = " ",
      Um = !1;
    function y2(e, t) {
      switch (e) {
        case "keyup":
          return w0.indexOf(t.keyCode) !== -1;
        case "keydown":
          return t.keyCode !== 229;
        case "keypress":
        case "mousedown":
        case "focusout":
          return !0;
        default:
          return !1;
      }
    }
    function x2(e) {
      return (
        (e = e.detail),
        typeof e == "object" && "data" in e ? e.data : null
      );
    }
    var bn = !1;
    function T0(e, t) {
      switch (e) {
        case "compositionend":
          return x2(t);
        case "keypress":
          return t.which !== 32 ? null : ((Um = !0), Em);
        case "textInput":
          return ((e = t.data), e === Em && Um ? null : e);
        default:
          return null;
      }
    }
    function A0(e, t) {
      if (bn)
        return e === "compositionend" || (!yc && y2(e, t))
          ? ((e = _2()), (Gs = _c = Zi = null), (bn = !1), e)
          : null;
      switch (e) {
        case "paste":
          return null;
        case "keypress":
          if (
            !(t.ctrlKey || t.altKey || t.metaKey) ||
            (t.ctrlKey && t.altKey)
          ) {
            if (t.char && 1 < t.char.length) return t.char;
            if (t.which) return String.fromCharCode(t.which);
          }
          return null;
        case "compositionend":
          return v2 && t.locale !== "ko" ? null : t.data;
        default:
          return null;
      }
    }
    var D0 = {
      color: !0,
      date: !0,
      datetime: !0,
      "datetime-local": !0,
      email: !0,
      month: !0,
      number: !0,
      password: !0,
      range: !0,
      search: !0,
      tel: !0,
      text: !0,
      time: !0,
      url: !0,
      week: !0,
    };
    function qm(e) {
      var t = e && e.nodeName && e.nodeName.toLowerCase();
      return t === "input" ? !!D0[e.type] : t === "textarea";
    }
    function S2(e, t, i, o) {
      (In ? (On ? On.push(o) : (On = [o])) : (In = o),
        (t = br(t, "onChange")),
        0 < t.length &&
          ((i = new kr("onChange", "change", null, i, o)),
          e.push({ event: i, listeners: t })));
    }
    var Xl = null,
      lu = null;
    function B0(e) {
      L1(e, 0);
    }
    function Or(e) {
      var t = Fl(e);
      if (c2(t)) return e;
    }
    function Hm(e, t) {
      if (e === "change") return t;
    }
    var C2 = !1;
    Li &&
      (Li
        ? ((Bs = "oninput" in document),
          Bs ||
            ((Vf = document.createElement("div")),
            Vf.setAttribute("oninput", "return;"),
            (Bs = typeof Vf.oninput == "function")),
          (Ds = Bs))
        : (Ds = !1),
      (C2 = Ds && (!document.documentMode || 9 < document.documentMode)));
    var Ds, Bs, Vf;
    function Nm() {
      Xl && (Xl.detachEvent("onpropertychange", I2), (lu = Xl = null));
    }
    function I2(e) {
      if (e.propertyName === "value" && Or(lu)) {
        var t = [];
        (S2(t, lu, e, Lc(e)), L2(B0, t));
      }
    }
    function P0(e, t, i) {
      e === "focusin"
        ? (Nm(), (Xl = t), (lu = i), Xl.attachEvent("onpropertychange", I2))
        : e === "focusout" && Nm();
    }
    function k0(e) {
      if (e === "selectionchange" || e === "keyup" || e === "keydown")
        return Or(lu);
    }
    function z0(e, t) {
      if (e === "click") return Or(t);
    }
    function O0(e, t) {
      if (e === "input" || e === "change") return Or(t);
    }
    function R0(e, t) {
      return (e === t && (e !== 0 || 1 / e === 1 / t)) || (e !== e && t !== t);
    }
    var Vt = typeof Object.is == "function" ? Object.is : R0;
    function uu(e, t) {
      if (Vt(e, t)) return !0;
      if (
        typeof e != "object" ||
        e === null ||
        typeof t != "object" ||
        t === null
      )
        return !1;
      var i = Object.keys(e),
        o = Object.keys(t);
      if (i.length !== o.length) return !1;
      for (o = 0; o < i.length; o++) {
        var l = i[o];
        if (!Sd.call(t, l) || !Vt(e[l], t[l])) return !1;
      }
      return !0;
    }
    function Fm(e) {
      for (; e && e.firstChild;) e = e.firstChild;
      return e;
    }
    function Zm(e, t) {
      var i = Fm(e);
      e = 0;
      for (var o; i;) {
        if (i.nodeType === 3) {
          if (((o = e + i.textContent.length), e <= t && o >= t))
            return { node: i, offset: t - e };
          e = o;
        }
        e: {
          for (; i;) {
            if (i.nextSibling) {
              i = i.nextSibling;
              break e;
            }
            i = i.parentNode;
          }
          i = void 0;
        }
        i = Fm(i);
      }
    }
    function b2(e, t) {
      return e && t
        ? e === t
          ? !0
          : e && e.nodeType === 3
            ? !1
            : t && t.nodeType === 3
              ? b2(e, t.parentNode)
              : "contains" in e
                ? e.contains(t)
                : e.compareDocumentPosition
                  ? !!(e.compareDocumentPosition(t) & 16)
                  : !1
        : !1;
    }
    function w2(e) {
      e =
        e != null &&
        e.ownerDocument != null &&
        e.ownerDocument.defaultView != null
          ? e.ownerDocument.defaultView
          : window;
      for (var t = ur(e.document); t instanceof e.HTMLIFrameElement;) {
        try {
          var i = typeof t.contentWindow.location.href == "string";
        } catch {
          i = !1;
        }
        if (i) e = t.contentWindow;
        else break;
        t = ur(e.document);
      }
      return t;
    }
    function xc(e) {
      var t = e && e.nodeName && e.nodeName.toLowerCase();
      return (
        t &&
        ((t === "input" &&
          (e.type === "text" ||
            e.type === "search" ||
            e.type === "tel" ||
            e.type === "url" ||
            e.type === "password")) ||
          t === "textarea" ||
          e.contentEditable === "true")
      );
    }
    var E0 = Li && "documentMode" in document && 11 >= document.documentMode,
      wn = null,
      Ad = null,
      jl = null,
      Dd = !1;
    function Gm(e, t, i) {
      var o =
        i.window === i ? i.document : i.nodeType === 9 ? i : i.ownerDocument;
      Dd ||
        wn == null ||
        wn !== ur(o) ||
        ((o = wn),
        "selectionStart" in o && xc(o)
          ? (o = { start: o.selectionStart, end: o.selectionEnd })
          : ((o = (
              (o.ownerDocument && o.ownerDocument.defaultView) ||
              window
            ).getSelection()),
            (o = {
              anchorNode: o.anchorNode,
              anchorOffset: o.anchorOffset,
              focusNode: o.focusNode,
              focusOffset: o.focusOffset,
            })),
        (jl && uu(jl, o)) ||
          ((jl = o),
          (o = br(Ad, "onSelect")),
          0 < o.length &&
            ((t = new kr("onSelect", "select", null, t, i)),
            e.push({ event: t, listeners: o }),
            (t.target = wn))));
    }
    function xo(e, t) {
      var i = {};
      return (
        (i[e.toLowerCase()] = t.toLowerCase()),
        (i["Webkit" + e] = "webkit" + t),
        (i["Moz" + e] = "moz" + t),
        i
      );
    }
    var Mn = {
        animationend: xo("Animation", "AnimationEnd"),
        animationiteration: xo("Animation", "AnimationIteration"),
        animationstart: xo("Animation", "AnimationStart"),
        transitionrun: xo("Transition", "TransitionRun"),
        transitionstart: xo("Transition", "TransitionStart"),
        transitioncancel: xo("Transition", "TransitionCancel"),
        transitionend: xo("Transition", "TransitionEnd"),
      },
      Xf = {},
      M2 = {};
    Li &&
      ((M2 = document.createElement("div").style),
      "AnimationEvent" in window ||
        (delete Mn.animationend.animation,
        delete Mn.animationiteration.animation,
        delete Mn.animationstart.animation),
      "TransitionEvent" in window || delete Mn.transitionend.transition);
    function Uo(e) {
      if (Xf[e]) return Xf[e];
      if (!Mn[e]) return e;
      var t = Mn[e],
        i;
      for (i in t) if (t.hasOwnProperty(i) && i in M2) return (Xf[e] = t[i]);
      return e;
    }
    var T2 = Uo("animationend"),
      A2 = Uo("animationiteration"),
      D2 = Uo("animationstart"),
      U0 = Uo("transitionrun"),
      q0 = Uo("transitionstart"),
      H0 = Uo("transitioncancel"),
      B2 = Uo("transitionend"),
      P2 = new Map(),
      Bd =
        "abort auxClick beforeToggle cancel canPlay canPlayThrough click close contextMenu copy cut drag dragEnd dragEnter dragExit dragLeave dragOver dragStart drop durationChange emptied encrypted ended error gotPointerCapture input invalid keyDown keyPress keyUp load loadedData loadedMetadata loadStart lostPointerCapture mouseDown mouseMove mouseOut mouseOver mouseUp paste pause play playing pointerCancel pointerDown pointerMove pointerOut pointerOver pointerUp progress rateChange reset resize seeked seeking stalled submit suspend timeUpdate touchCancel touchEnd touchStart volumeChange scroll toggle touchMove waiting wheel".split(
          " ",
        );
    Bd.push("scrollEnd");
    function Sa(e, t) {
      (P2.set(e, t), Ro(t, [e]));
    }
    var sr =
        typeof reportError == "function"
          ? reportError
          : function (e) {
              if (
                typeof window == "object" &&
                typeof window.ErrorEvent == "function"
              ) {
                var t = new window.ErrorEvent("error", {
                  bubbles: !0,
                  cancelable: !0,
                  message:
                    typeof e == "object" &&
                    e !== null &&
                    typeof e.message == "string"
                      ? String(e.message)
                      : String(e),
                  error: e,
                });
                if (!window.dispatchEvent(t)) return;
              } else if (
                typeof process == "object" &&
                typeof process.emit == "function"
              ) {
                process.emit("uncaughtException", e);
                return;
              }
              console.error(e);
            },
      ta = [],
      Tn = 0,
      Sc = 0;
    function Rr() {
      for (var e = Tn, t = (Sc = Tn = 0); t < e;) {
        var i = ta[t];
        ta[t++] = null;
        var o = ta[t];
        ta[t++] = null;
        var l = ta[t];
        ta[t++] = null;
        var s = ta[t];
        if (((ta[t++] = null), o !== null && l !== null)) {
          var f = o.pending;
          (f === null ? (l.next = l) : ((l.next = f.next), (f.next = l)),
            (o.pending = l));
        }
        s !== 0 && k2(i, l, s);
      }
    }
    function Er(e, t, i, o) {
      ((ta[Tn++] = e),
        (ta[Tn++] = t),
        (ta[Tn++] = i),
        (ta[Tn++] = o),
        (Sc |= o),
        (e.lanes |= o),
        (e = e.alternate),
        e !== null && (e.lanes |= o));
    }
    function Cc(e, t, i, o) {
      return (Er(e, t, i, o), rr(e));
    }
    function qo(e, t) {
      return (Er(e, null, null, t), rr(e));
    }
    function k2(e, t, i) {
      e.lanes |= i;
      var o = e.alternate;
      o !== null && (o.lanes |= i);
      for (var l = !1, s = e.return; s !== null;)
        ((s.childLanes |= i),
          (o = s.alternate),
          o !== null && (o.childLanes |= i),
          s.tag === 22 &&
            ((e = s.stateNode), e === null || e._visibility & 1 || (l = !0)),
          (e = s),
          (s = s.return));
      return e.tag === 3
        ? ((s = e.stateNode),
          l &&
            t !== null &&
            ((l = 31 - Zt(i)),
            (e = s.hiddenUpdates),
            (o = e[l]),
            o === null ? (e[l] = [t]) : o.push(t),
            (t.lane = i | 536870912)),
          s)
        : null;
    }
    function rr(e) {
      if (50 < au) throw ((au = 0), (Jd = null), Error(k(185)));
      for (var t = e.return; t !== null;) ((e = t), (t = e.return));
      return e.tag === 3 ? e.stateNode : null;
    }
    var An = {};
    function N0(e, t, i, o) {
      ((this.tag = e),
        (this.key = i),
        (this.sibling =
          this.child =
          this.return =
          this.stateNode =
          this.type =
          this.elementType =
            null),
        (this.index = 0),
        (this.refCleanup = this.ref = null),
        (this.pendingProps = t),
        (this.dependencies =
          this.memoizedState =
          this.updateQueue =
          this.memoizedProps =
            null),
        (this.mode = o),
        (this.subtreeFlags = this.flags = 0),
        (this.deletions = null),
        (this.childLanes = this.lanes = 0),
        (this.alternate = null));
    }
    function qt(e, t, i, o) {
      return new N0(e, t, i, o);
    }
    function Ic(e) {
      return ((e = e.prototype), !(!e || !e.isReactComponent));
    }
    function mi(e, t) {
      var i = e.alternate;
      return (
        i === null
          ? ((i = qt(e.tag, t, e.key, e.mode)),
            (i.elementType = e.elementType),
            (i.type = e.type),
            (i.stateNode = e.stateNode),
            (i.alternate = e),
            (e.alternate = i))
          : ((i.pendingProps = t),
            (i.type = e.type),
            (i.flags = 0),
            (i.subtreeFlags = 0),
            (i.deletions = null)),
        (i.flags = e.flags & 65011712),
        (i.childLanes = e.childLanes),
        (i.lanes = e.lanes),
        (i.child = e.child),
        (i.memoizedProps = e.memoizedProps),
        (i.memoizedState = e.memoizedState),
        (i.updateQueue = e.updateQueue),
        (t = e.dependencies),
        (i.dependencies =
          t === null ? null : { lanes: t.lanes, firstContext: t.firstContext }),
        (i.sibling = e.sibling),
        (i.index = e.index),
        (i.ref = e.ref),
        (i.refCleanup = e.refCleanup),
        i
      );
    }
    function z2(e, t) {
      e.flags &= 65011714;
      var i = e.alternate;
      return (
        i === null
          ? ((e.childLanes = 0),
            (e.lanes = t),
            (e.child = null),
            (e.subtreeFlags = 0),
            (e.memoizedProps = null),
            (e.memoizedState = null),
            (e.updateQueue = null),
            (e.dependencies = null),
            (e.stateNode = null))
          : ((e.childLanes = i.childLanes),
            (e.lanes = i.lanes),
            (e.child = i.child),
            (e.subtreeFlags = 0),
            (e.deletions = null),
            (e.memoizedProps = i.memoizedProps),
            (e.memoizedState = i.memoizedState),
            (e.updateQueue = i.updateQueue),
            (e.type = i.type),
            (t = i.dependencies),
            (e.dependencies =
              t === null
                ? null
                : { lanes: t.lanes, firstContext: t.firstContext })),
        e
      );
    }
    function Xs(e, t, i, o, l, s) {
      var f = 0;
      if (((o = e), typeof e == "function")) Ic(e) && (f = 1);
      else if (typeof e == "string")
        f = Gv(e, i, Ua.current)
          ? 26
          : e === "html" || e === "head" || e === "body"
            ? 27
            : 5;
      else
        e: switch (e) {
          case _d:
            return (
              (e = qt(31, i, t, l)),
              (e.elementType = _d),
              (e.lanes = s),
              e
            );
          case xn:
            return Mo(i.children, l, s, t);
          case $p:
            ((f = 8), (l |= 24));
            break;
          case pd:
            return (
              (e = qt(12, i, t, l | 2)),
              (e.elementType = pd),
              (e.lanes = s),
              e
            );
          case gd:
            return (
              (e = qt(13, i, t, l)),
              (e.elementType = gd),
              (e.lanes = s),
              e
            );
          case Ld:
            return (
              (e = qt(19, i, t, l)),
              (e.elementType = Ld),
              (e.lanes = s),
              e
            );
          default:
            if (typeof e == "object" && e !== null)
              switch (e.$$typeof) {
                case di:
                  f = 10;
                  break e;
                case e2:
                  f = 9;
                  break e;
                case fc:
                  f = 11;
                  break e;
                case dc:
                  f = 14;
                  break e;
                case Ri:
                  ((f = 16), (o = null));
                  break e;
              }
            ((f = 29),
              (i = Error(k(130, e === null ? "null" : typeof e, ""))),
              (o = null));
        }
      return (
        (t = qt(f, i, t, l)),
        (t.elementType = e),
        (t.type = o),
        (t.lanes = s),
        t
      );
    }
    function Mo(e, t, i, o) {
      return ((e = qt(7, e, o, t)), (e.lanes = i), e);
    }
    function jf(e, t, i) {
      return ((e = qt(6, e, null, t)), (e.lanes = i), e);
    }
    function O2(e) {
      var t = qt(18, null, null, 0);
      return ((t.stateNode = e), t);
    }
    function Yf(e, t, i) {
      return (
        (t = qt(4, e.children !== null ? e.children : [], e.key, t)),
        (t.lanes = i),
        (t.stateNode = {
          containerInfo: e.containerInfo,
          pendingChildren: null,
          implementation: e.implementation,
        }),
        t
      );
    }
    var Vm = new WeakMap();
    function la(e, t) {
      if (typeof e == "object" && e !== null) {
        var i = Vm.get(e);
        return i !== void 0
          ? i
          : ((t = { value: e, source: t, stack: wm(t) }), Vm.set(e, t), t);
      }
      return { value: e, source: t, stack: wm(t) };
    }
    var Dn = [],
      Bn = 0,
      fr = null,
      su = 0,
      ia = [],
      oa = 0,
      ao = null,
      Oa = 1,
      Ra = "";
    function ri(e, t) {
      ((Dn[Bn++] = su), (Dn[Bn++] = fr), (fr = e), (su = t));
    }
    function R2(e, t, i) {
      ((ia[oa++] = Oa), (ia[oa++] = Ra), (ia[oa++] = ao), (ao = e));
      var o = Oa;
      e = Ra;
      var l = 32 - Zt(o) - 1;
      ((o &= ~(1 << l)), (i += 1));
      var s = 32 - Zt(t) + l;
      if (30 < s) {
        var f = l - (l % 5);
        ((s = (o & ((1 << f) - 1)).toString(32)),
          (o >>= f),
          (l -= f),
          (Oa = (1 << (32 - Zt(t) + l)) | (i << l) | o),
          (Ra = s + e));
      } else ((Oa = (1 << s) | (i << l) | o), (Ra = e));
    }
    function bc(e) {
      e.return !== null && (ri(e, 1), R2(e, 1, 0));
    }
    function wc(e) {
      for (; e === fr;)
        ((fr = Dn[--Bn]), (Dn[Bn] = null), (su = Dn[--Bn]), (Dn[Bn] = null));
      for (; e === ao;)
        ((ao = ia[--oa]),
          (ia[oa] = null),
          (Ra = ia[--oa]),
          (ia[oa] = null),
          (Oa = ia[--oa]),
          (ia[oa] = null));
    }
    function E2(e, t) {
      ((ia[oa++] = Oa),
        (ia[oa++] = Ra),
        (ia[oa++] = ao),
        (Oa = t.id),
        (Ra = t.overflow),
        (ao = e));
    }
    var dt = null,
      ze = null,
      ge = !1,
      Yi = null,
      ua = !1,
      Pd = Error(k(519));
    function io(e) {
      var t = Error(
        k(
          418,
          1 < arguments.length && arguments[1] !== void 0 && arguments[1]
            ? "text"
            : "HTML",
          "",
        ),
      );
      throw (ru(la(t, e)), Pd);
    }
    function Xm(e) {
      var t = e.stateNode,
        i = e.type,
        o = e.memoizedProps;
      switch (((t[ft] = e), (t[Pt] = o), i)) {
        case "dialog":
          (de("cancel", t), de("close", t));
          break;
        case "iframe":
        case "object":
        case "embed":
          de("load", t);
          break;
        case "video":
        case "audio":
          for (i = 0; i < hu.length; i++) de(hu[i], t);
          break;
        case "source":
          de("error", t);
          break;
        case "img":
        case "image":
        case "link":
          (de("error", t), de("load", t));
          break;
        case "details":
          de("toggle", t);
          break;
        case "input":
          (de("invalid", t),
            h2(
              t,
              o.value,
              o.defaultValue,
              o.checked,
              o.defaultChecked,
              o.type,
              o.name,
              !0,
            ));
          break;
        case "select":
          de("invalid", t);
          break;
        case "textarea":
          (de("invalid", t), p2(t, o.value, o.defaultValue, o.children));
      }
      ((i = o.children),
        (typeof i != "string" &&
          typeof i != "number" &&
          typeof i != "bigint") ||
        t.textContent === "" + i ||
        o.suppressHydrationWarning === !0 ||
        v1(t.textContent, i)
          ? (o.popover != null && (de("beforetoggle", t), de("toggle", t)),
            o.onScroll != null && de("scroll", t),
            o.onScrollEnd != null && de("scrollend", t),
            o.onClick != null && (t.onclick = ci),
            (t = !0))
          : (t = !1),
        t || io(e, !0));
    }
    function jm(e) {
      for (dt = e.return; dt;)
        switch (dt.tag) {
          case 5:
          case 31:
          case 13:
            ua = !1;
            return;
          case 27:
          case 3:
            ua = !0;
            return;
          default:
            dt = dt.return;
        }
    }
    function Ln(e) {
      if (e !== dt) return !1;
      if (!ge) return (jm(e), (ge = !0), !1);
      var t = e.tag,
        i;
      if (
        ((i = t !== 3 && t !== 27) &&
          ((i = t === 5) &&
            ((i = e.type),
            (i =
              !(i !== "form" && i !== "button") ||
              ic(e.type, e.memoizedProps))),
          (i = !i)),
        i && ze && io(e),
        jm(e),
        t === 13)
      ) {
        if (((e = e.memoizedState), (e = e !== null ? e.dehydrated : null), !e))
          throw Error(k(317));
        ze = Op(e);
      } else if (t === 31) {
        if (((e = e.memoizedState), (e = e !== null ? e.dehydrated : null), !e))
          throw Error(k(317));
        ze = Op(e);
      } else
        t === 27
          ? ((t = ze),
            uo(e.type) ? ((e = uc), (uc = null), (ze = e)) : (ze = t))
          : (ze = dt ? ra(e.stateNode.nextSibling) : null);
      return !0;
    }
    function Bo() {
      ((ze = dt = null), (ge = !1));
    }
    function Kf() {
      var e = Yi;
      return (
        e !== null &&
          (Dt === null ? (Dt = e) : Dt.push.apply(Dt, e), (Yi = null)),
        e
      );
    }
    function ru(e) {
      Yi === null ? (Yi = [e]) : Yi.push(e);
    }
    var kd = qa(null),
      Ho = null,
      hi = null;
    function Ui(e, t, i) {
      (Ae(kd, t._currentValue), (t._currentValue = i));
    }
    function pi(e) {
      ((e._currentValue = kd.current), lt(kd));
    }
    function zd(e, t, i) {
      for (; e !== null;) {
        var o = e.alternate;
        if (
          ((e.childLanes & t) !== t
            ? ((e.childLanes |= t), o !== null && (o.childLanes |= t))
            : o !== null && (o.childLanes & t) !== t && (o.childLanes |= t),
          e === i)
        )
          break;
        e = e.return;
      }
    }
    function Od(e, t, i, o) {
      var l = e.child;
      for (l !== null && (l.return = e); l !== null;) {
        var s = l.dependencies;
        if (s !== null) {
          var f = l.child;
          s = s.firstContext;
          e: for (; s !== null;) {
            var c = s;
            s = l;
            for (var g = 0; g < t.length; g++)
              if (c.context === t[g]) {
                ((s.lanes |= i),
                  (c = s.alternate),
                  c !== null && (c.lanes |= i),
                  zd(s.return, i, e),
                  o || (f = null));
                break e;
              }
            s = c.next;
          }
        } else if (l.tag === 18) {
          if (((f = l.return), f === null)) throw Error(k(341));
          ((f.lanes |= i),
            (s = f.alternate),
            s !== null && (s.lanes |= i),
            zd(f, i, e),
            (f = null));
        } else f = l.child;
        if (f !== null) f.return = l;
        else
          for (f = l; f !== null;) {
            if (f === e) {
              f = null;
              break;
            }
            if (((l = f.sibling), l !== null)) {
              ((l.return = f.return), (f = l));
              break;
            }
            f = f.return;
          }
        l = f;
      }
    }
    function $n(e, t, i, o) {
      e = null;
      for (var l = t, s = !1; l !== null;) {
        if (!s) {
          if ((l.flags & 524288) !== 0) s = !0;
          else if ((l.flags & 262144) !== 0) break;
        }
        if (l.tag === 10) {
          var f = l.alternate;
          if (f === null) throw Error(k(387));
          if (((f = f.memoizedProps), f !== null)) {
            var c = l.type;
            Vt(l.pendingProps.value, f.value) ||
              (e !== null ? e.push(c) : (e = [c]));
          }
        } else if (l === ir.current) {
          if (((f = l.alternate), f === null)) throw Error(k(387));
          f.memoizedState.memoizedState !== l.memoizedState.memoizedState &&
            (e !== null ? e.push(pu) : (e = [pu]));
        }
        l = l.return;
      }
      (e !== null && Od(t, e, i, o), (t.flags |= 262144));
    }
    function dr(e) {
      for (e = e.firstContext; e !== null;) {
        if (!Vt(e.context._currentValue, e.memoizedValue)) return !0;
        e = e.next;
      }
      return !1;
    }
    function Po(e) {
      ((Ho = e),
        (hi = null),
        (e = e.dependencies),
        e !== null && (e.firstContext = null));
    }
    function ct(e) {
      return U2(Ho, e);
    }
    function Ps(e, t) {
      return (Ho === null && Po(e), U2(e, t));
    }
    function U2(e, t) {
      var i = t._currentValue;
      if (((t = { context: t, memoizedValue: i, next: null }), hi === null)) {
        if (e === null) throw Error(k(308));
        ((hi = t),
          (e.dependencies = { lanes: 0, firstContext: t }),
          (e.flags |= 524288));
      } else hi = hi.next = t;
      return i;
    }
    var F0 =
        typeof AbortController < "u"
          ? AbortController
          : function () {
              var e = [],
                t = (this.signal = {
                  aborted: !1,
                  addEventListener: function (i, o) {
                    e.push(o);
                  },
                });
              this.abort = function () {
                ((t.aborted = !0),
                  e.forEach(function (i) {
                    return i();
                  }));
              };
            },
      Z0 = at.unstable_scheduleCallback,
      G0 = at.unstable_NormalPriority,
      Je = {
        $$typeof: di,
        Consumer: null,
        Provider: null,
        _currentValue: null,
        _currentValue2: null,
        _threadCount: 0,
      };
    function Mc() {
      return { controller: new F0(), data: new Map(), refCount: 0 };
    }
    function Iu(e) {
      (e.refCount--,
        e.refCount === 0 &&
          Z0(G0, function () {
            e.controller.abort();
          }));
    }
    var Yl = null,
      Rd = 0,
      Zn = 0,
      Rn = null;
    function V0(e, t) {
      if (Yl === null) {
        var i = (Yl = []);
        ((Rd = 0),
          (Zn = Jc()),
          (Rn = {
            status: "pending",
            value: void 0,
            then: function (o) {
              i.push(o);
            },
          }));
      }
      return (Rd++, t.then(Ym, Ym), t);
    }
    function Ym() {
      if (--Rd === 0 && Yl !== null) {
        Rn !== null && (Rn.status = "fulfilled");
        var e = Yl;
        ((Yl = null), (Zn = 0), (Rn = null));
        for (var t = 0; t < e.length; t++) (0, e[t])();
      }
    }
    function X0(e, t) {
      var i = [],
        o = {
          status: "pending",
          value: null,
          reason: null,
          then: function (l) {
            i.push(l);
          },
        };
      return (
        e.then(
          function () {
            ((o.status = "fulfilled"), (o.value = t));
            for (var l = 0; l < i.length; l++) (0, i[l])(t);
          },
          function (l) {
            for (o.status = "rejected", o.reason = l, l = 0; l < i.length; l++)
              (0, i[l])(void 0);
          },
        ),
        o
      );
    }
    var Km = J.S;
    J.S = function (e, t) {
      ((Jg = Nt()),
        typeof t == "object" &&
          t !== null &&
          typeof t.then == "function" &&
          V0(e, t),
        Km !== null && Km(e, t));
    };
    var To = qa(null);
    function Tc() {
      var e = To.current;
      return e !== null ? e : Te.pooledCache;
    }
    function js(e, t) {
      t === null ? Ae(To, To.current) : Ae(To, t.pool);
    }
    function q2() {
      var e = Tc();
      return e === null ? null : { parent: Je._currentValue, pool: e };
    }
    var el = Error(k(460)),
      Ac = Error(k(474)),
      Ur = Error(k(542)),
      cr = { then: function () {} };
    function Qm(e) {
      return ((e = e.status), e === "fulfilled" || e === "rejected");
    }
    function H2(e, t, i) {
      switch (
        ((i = e[i]),
        i === void 0 ? e.push(t) : i !== t && (t.then(ci, ci), (t = i)),
        t.status)
      ) {
        case "fulfilled":
          return t.value;
        case "rejected":
          throw ((e = t.reason), Jm(e), e);
        default:
          if (typeof t.status == "string") t.then(ci, ci);
          else {
            if (((e = Te), e !== null && 100 < e.shellSuspendCounter))
              throw Error(k(482));
            ((e = t),
              (e.status = "pending"),
              e.then(
                function (o) {
                  if (t.status === "pending") {
                    var l = t;
                    ((l.status = "fulfilled"), (l.value = o));
                  }
                },
                function (o) {
                  if (t.status === "pending") {
                    var l = t;
                    ((l.status = "rejected"), (l.reason = o));
                  }
                },
              ));
          }
          switch (t.status) {
            case "fulfilled":
              return t.value;
            case "rejected":
              throw ((e = t.reason), Jm(e), e);
          }
          throw ((Ao = t), el);
      }
    }
    function Io(e) {
      try {
        var t = e._init;
        return t(e._payload);
      } catch (i) {
        throw i !== null && typeof i == "object" && typeof i.then == "function"
          ? ((Ao = i), el)
          : i;
      }
    }
    var Ao = null;
    function Wm() {
      if (Ao === null) throw Error(k(459));
      var e = Ao;
      return ((Ao = null), e);
    }
    function Jm(e) {
      if (e === el || e === Ur) throw Error(k(483));
    }
    var En = null,
      fu = 0;
    function ks(e) {
      var t = fu;
      return ((fu += 1), En === null && (En = []), H2(En, e, t));
    }
    function Ol(e, t) {
      ((t = t.props.ref), (e.ref = t !== void 0 ? t : null));
    }
    function zs(e, t) {
      throw t.$$typeof === P_
        ? Error(k(525))
        : ((e = Object.prototype.toString.call(t)),
          Error(
            k(
              31,
              e === "[object Object]"
                ? "object with keys {" + Object.keys(t).join(", ") + "}"
                : e,
            ),
          ));
    }
    function N2(e) {
      function t(b, C) {
        if (e) {
          var w = b.deletions;
          w === null ? ((b.deletions = [C]), (b.flags |= 16)) : w.push(C);
        }
      }
      function i(b, C) {
        if (!e) return null;
        for (; C !== null;) (t(b, C), (C = C.sibling));
        return null;
      }
      function o(b) {
        for (var C = new Map(); b !== null;)
          (b.key !== null ? C.set(b.key, b) : C.set(b.index, b),
            (b = b.sibling));
        return C;
      }
      function l(b, C) {
        return ((b = mi(b, C)), (b.index = 0), (b.sibling = null), b);
      }
      function s(b, C, w) {
        return (
          (b.index = w),
          e
            ? ((w = b.alternate),
              w !== null
                ? ((w = w.index), w < C ? ((b.flags |= 67108866), C) : w)
                : ((b.flags |= 67108866), C))
            : ((b.flags |= 1048576), C)
        );
      }
      function f(b) {
        return (e && b.alternate === null && (b.flags |= 67108866), b);
      }
      function c(b, C, w, T) {
        return C === null || C.tag !== 6
          ? ((C = jf(w, b.mode, T)), (C.return = b), C)
          : ((C = l(C, w)), (C.return = b), C);
      }
      function g(b, C, w, T) {
        var z = w.type;
        return z === xn
          ? p(b, C, w.props.children, T, w.key)
          : C !== null &&
              (C.elementType === z ||
                (typeof z == "object" &&
                  z !== null &&
                  z.$$typeof === Ri &&
                  Io(z) === C.type))
            ? ((C = l(C, w.props)), Ol(C, w), (C.return = b), C)
            : ((C = Xs(w.type, w.key, w.props, null, b.mode, T)),
              Ol(C, w),
              (C.return = b),
              C);
      }
      function y(b, C, w, T) {
        return C === null ||
          C.tag !== 4 ||
          C.stateNode.containerInfo !== w.containerInfo ||
          C.stateNode.implementation !== w.implementation
          ? ((C = Yf(w, b.mode, T)), (C.return = b), C)
          : ((C = l(C, w.children || [])), (C.return = b), C);
      }
      function p(b, C, w, T, z) {
        return C === null || C.tag !== 7
          ? ((C = Mo(w, b.mode, T, z)), (C.return = b), C)
          : ((C = l(C, w)), (C.return = b), C);
      }
      function _(b, C, w) {
        if (
          (typeof C == "string" && C !== "") ||
          typeof C == "number" ||
          typeof C == "bigint"
        )
          return ((C = jf("" + C, b.mode, w)), (C.return = b), C);
        if (typeof C == "object" && C !== null) {
          switch (C.$$typeof) {
            case Is:
              return (
                (w = Xs(C.type, C.key, C.props, null, b.mode, w)),
                Ol(w, C),
                (w.return = b),
                w
              );
            case Hl:
              return ((C = Yf(C, b.mode, w)), (C.return = b), C);
            case Ri:
              return ((C = Io(C)), _(b, C, w));
          }
          if (Nl(C) || kl(C))
            return ((C = Mo(C, b.mode, w, null)), (C.return = b), C);
          if (typeof C.then == "function") return _(b, ks(C), w);
          if (C.$$typeof === di) return _(b, Ps(b, C), w);
          zs(b, C);
        }
        return null;
      }
      function v(b, C, w, T) {
        var z = C !== null ? C.key : null;
        if (
          (typeof w == "string" && w !== "") ||
          typeof w == "number" ||
          typeof w == "bigint"
        )
          return z !== null ? null : c(b, C, "" + w, T);
        if (typeof w == "object" && w !== null) {
          switch (w.$$typeof) {
            case Is:
              return w.key === z ? g(b, C, w, T) : null;
            case Hl:
              return w.key === z ? y(b, C, w, T) : null;
            case Ri:
              return ((w = Io(w)), v(b, C, w, T));
          }
          if (Nl(w) || kl(w)) return z !== null ? null : p(b, C, w, T, null);
          if (typeof w.then == "function") return v(b, C, ks(w), T);
          if (w.$$typeof === di) return v(b, C, Ps(b, w), T);
          zs(b, w);
        }
        return null;
      }
      function x(b, C, w, T, z) {
        if (
          (typeof T == "string" && T !== "") ||
          typeof T == "number" ||
          typeof T == "bigint"
        )
          return ((b = b.get(w) || null), c(C, b, "" + T, z));
        if (typeof T == "object" && T !== null) {
          switch (T.$$typeof) {
            case Is:
              return (
                (b = b.get(T.key === null ? w : T.key) || null),
                g(C, b, T, z)
              );
            case Hl:
              return (
                (b = b.get(T.key === null ? w : T.key) || null),
                y(C, b, T, z)
              );
            case Ri:
              return ((T = Io(T)), x(b, C, w, T, z));
          }
          if (Nl(T) || kl(T))
            return ((b = b.get(w) || null), p(C, b, T, z, null));
          if (typeof T.then == "function") return x(b, C, w, ks(T), z);
          if (T.$$typeof === di) return x(b, C, w, Ps(C, T), z);
          zs(C, T);
        }
        return null;
      }
      function B(b, C, w, T) {
        for (
          var z = null, ue = null, F = C, j = (C = 0), V = null;
          F !== null && j < w.length;
          j++
        ) {
          F.index > j ? ((V = F), (F = null)) : (V = F.sibling);
          var W = v(b, F, w[j], T);
          if (W === null) {
            F === null && (F = V);
            break;
          }
          (e && F && W.alternate === null && t(b, F),
            (C = s(W, C, j)),
            ue === null ? (z = W) : (ue.sibling = W),
            (ue = W),
            (F = V));
        }
        if (j === w.length) return (i(b, F), ge && ri(b, j), z);
        if (F === null) {
          for (; j < w.length; j++)
            ((F = _(b, w[j], T)),
              F !== null &&
                ((C = s(F, C, j)),
                ue === null ? (z = F) : (ue.sibling = F),
                (ue = F)));
          return (ge && ri(b, j), z);
        }
        for (F = o(F); j < w.length; j++)
          ((V = x(F, b, j, w[j], T)),
            V !== null &&
              (e &&
                V.alternate !== null &&
                F.delete(V.key === null ? j : V.key),
              (C = s(V, C, j)),
              ue === null ? (z = V) : (ue.sibling = V),
              (ue = V)));
        return (
          e &&
            F.forEach(function (Y) {
              return t(b, Y);
            }),
          ge && ri(b, j),
          z
        );
      }
      function P(b, C, w, T) {
        if (w == null) throw Error(k(151));
        for (
          var z = null, ue = null, F = C, j = (C = 0), V = null, W = w.next();
          F !== null && !W.done;
          j++, W = w.next()
        ) {
          F.index > j ? ((V = F), (F = null)) : (V = F.sibling);
          var Y = v(b, F, W.value, T);
          if (Y === null) {
            F === null && (F = V);
            break;
          }
          (e && F && Y.alternate === null && t(b, F),
            (C = s(Y, C, j)),
            ue === null ? (z = Y) : (ue.sibling = Y),
            (ue = Y),
            (F = V));
        }
        if (W.done) return (i(b, F), ge && ri(b, j), z);
        if (F === null) {
          for (; !W.done; j++, W = w.next())
            ((W = _(b, W.value, T)),
              W !== null &&
                ((C = s(W, C, j)),
                ue === null ? (z = W) : (ue.sibling = W),
                (ue = W)));
          return (ge && ri(b, j), z);
        }
        for (F = o(F); !W.done; j++, W = w.next())
          ((W = x(F, b, j, W.value, T)),
            W !== null &&
              (e &&
                W.alternate !== null &&
                F.delete(W.key === null ? j : W.key),
              (C = s(W, C, j)),
              ue === null ? (z = W) : (ue.sibling = W),
              (ue = W)));
        return (
          e &&
            F.forEach(function (Ze) {
              return t(b, Ze);
            }),
          ge && ri(b, j),
          z
        );
      }
      function Z(b, C, w, T) {
        if (
          (typeof w == "object" &&
            w !== null &&
            w.type === xn &&
            w.key === null &&
            (w = w.props.children),
          typeof w == "object" && w !== null)
        ) {
          switch (w.$$typeof) {
            case Is:
              e: {
                for (var z = w.key; C !== null;) {
                  if (C.key === z) {
                    if (((z = w.type), z === xn)) {
                      if (C.tag === 7) {
                        (i(b, C.sibling),
                          (T = l(C, w.props.children)),
                          (T.return = b),
                          (b = T));
                        break e;
                      }
                    } else if (
                      C.elementType === z ||
                      (typeof z == "object" &&
                        z !== null &&
                        z.$$typeof === Ri &&
                        Io(z) === C.type)
                    ) {
                      (i(b, C.sibling),
                        (T = l(C, w.props)),
                        Ol(T, w),
                        (T.return = b),
                        (b = T));
                      break e;
                    }
                    i(b, C);
                    break;
                  } else t(b, C);
                  C = C.sibling;
                }
                w.type === xn
                  ? ((T = Mo(w.props.children, b.mode, T, w.key)),
                    (T.return = b),
                    (b = T))
                  : ((T = Xs(w.type, w.key, w.props, null, b.mode, T)),
                    Ol(T, w),
                    (T.return = b),
                    (b = T));
              }
              return f(b);
            case Hl:
              e: {
                for (z = w.key; C !== null;) {
                  if (C.key === z)
                    if (
                      C.tag === 4 &&
                      C.stateNode.containerInfo === w.containerInfo &&
                      C.stateNode.implementation === w.implementation
                    ) {
                      (i(b, C.sibling),
                        (T = l(C, w.children || [])),
                        (T.return = b),
                        (b = T));
                      break e;
                    } else {
                      i(b, C);
                      break;
                    }
                  else t(b, C);
                  C = C.sibling;
                }
                ((T = Yf(w, b.mode, T)), (T.return = b), (b = T));
              }
              return f(b);
            case Ri:
              return ((w = Io(w)), Z(b, C, w, T));
          }
          if (Nl(w)) return B(b, C, w, T);
          if (kl(w)) {
            if (((z = kl(w)), typeof z != "function")) throw Error(k(150));
            return ((w = z.call(w)), P(b, C, w, T));
          }
          if (typeof w.then == "function") return Z(b, C, ks(w), T);
          if (w.$$typeof === di) return Z(b, C, Ps(b, w), T);
          zs(b, w);
        }
        return (typeof w == "string" && w !== "") ||
          typeof w == "number" ||
          typeof w == "bigint"
          ? ((w = "" + w),
            C !== null && C.tag === 6
              ? (i(b, C.sibling), (T = l(C, w)), (T.return = b), (b = T))
              : (i(b, C), (T = jf(w, b.mode, T)), (T.return = b), (b = T)),
            f(b))
          : i(b, C);
      }
      return function (b, C, w, T) {
        try {
          fu = 0;
          var z = Z(b, C, w, T);
          return ((En = null), z);
        } catch (F) {
          if (F === el || F === Ur) throw F;
          var ue = qt(29, F, null, b.mode);
          return ((ue.lanes = T), (ue.return = b), ue);
        }
      };
    }
    var ko = N2(!0),
      F2 = N2(!1),
      Ei = !1;
    function Dc(e) {
      e.updateQueue = {
        baseState: e.memoizedState,
        firstBaseUpdate: null,
        lastBaseUpdate: null,
        shared: { pending: null, lanes: 0, hiddenCallbacks: null },
        callbacks: null,
      };
    }
    function Ed(e, t) {
      ((e = e.updateQueue),
        t.updateQueue === e &&
          (t.updateQueue = {
            baseState: e.baseState,
            firstBaseUpdate: e.firstBaseUpdate,
            lastBaseUpdate: e.lastBaseUpdate,
            shared: e.shared,
            callbacks: null,
          }));
    }
    function Ki(e) {
      return { lane: e, tag: 0, payload: null, callback: null, next: null };
    }
    function Qi(e, t, i) {
      var o = e.updateQueue;
      if (o === null) return null;
      if (((o = o.shared), (ye & 2) !== 0)) {
        var l = o.pending;
        return (
          l === null ? (t.next = t) : ((t.next = l.next), (l.next = t)),
          (o.pending = t),
          (t = rr(e)),
          k2(e, null, i),
          t
        );
      }
      return (Er(e, o, t, i), rr(e));
    }
    function Kl(e, t, i) {
      if (
        ((t = t.updateQueue),
        t !== null && ((t = t.shared), (i & 4194048) !== 0))
      ) {
        var o = t.lanes;
        ((o &= e.pendingLanes), (i |= o), (t.lanes = i), l2(e, i));
      }
    }
    function Qf(e, t) {
      var i = e.updateQueue,
        o = e.alternate;
      if (o !== null && ((o = o.updateQueue), i === o)) {
        var l = null,
          s = null;
        if (((i = i.firstBaseUpdate), i !== null)) {
          do {
            var f = {
              lane: i.lane,
              tag: i.tag,
              payload: i.payload,
              callback: null,
              next: null,
            };
            (s === null ? (l = s = f) : (s = s.next = f), (i = i.next));
          } while (i !== null);
          s === null ? (l = s = t) : (s = s.next = t);
        } else l = s = t;
        ((i = {
          baseState: o.baseState,
          firstBaseUpdate: l,
          lastBaseUpdate: s,
          shared: o.shared,
          callbacks: o.callbacks,
        }),
          (e.updateQueue = i));
        return;
      }
      ((e = i.lastBaseUpdate),
        e === null ? (i.firstBaseUpdate = t) : (e.next = t),
        (i.lastBaseUpdate = t));
    }
    var Ud = !1;
    function Ql() {
      if (Ud) {
        var e = Rn;
        if (e !== null) throw e;
      }
    }
    function Wl(e, t, i, o) {
      Ud = !1;
      var l = e.updateQueue;
      Ei = !1;
      var s = l.firstBaseUpdate,
        f = l.lastBaseUpdate,
        c = l.shared.pending;
      if (c !== null) {
        l.shared.pending = null;
        var g = c,
          y = g.next;
        ((g.next = null), f === null ? (s = y) : (f.next = y), (f = g));
        var p = e.alternate;
        p !== null &&
          ((p = p.updateQueue),
          (c = p.lastBaseUpdate),
          c !== f &&
            (c === null ? (p.firstBaseUpdate = y) : (c.next = y),
            (p.lastBaseUpdate = g)));
      }
      if (s !== null) {
        var _ = l.baseState;
        ((f = 0), (p = y = g = null), (c = s));
        do {
          var v = c.lane & -536870913,
            x = v !== c.lane;
          if (x ? (pe & v) === v : (o & v) === v) {
            (v !== 0 && v === Zn && (Ud = !0),
              p !== null &&
                (p = p.next =
                  {
                    lane: 0,
                    tag: c.tag,
                    payload: c.payload,
                    callback: null,
                    next: null,
                  }));
            e: {
              var B = e,
                P = c;
              v = t;
              var Z = i;
              switch (P.tag) {
                case 1:
                  if (((B = P.payload), typeof B == "function")) {
                    _ = B.call(Z, _, v);
                    break e;
                  }
                  _ = B;
                  break e;
                case 3:
                  B.flags = (B.flags & -65537) | 128;
                case 0:
                  if (
                    ((B = P.payload),
                    (v = typeof B == "function" ? B.call(Z, _, v) : B),
                    v == null)
                  )
                    break e;
                  _ = Oe({}, _, v);
                  break e;
                case 2:
                  Ei = !0;
              }
            }
            ((v = c.callback),
              v !== null &&
                ((e.flags |= 64),
                x && (e.flags |= 8192),
                (x = l.callbacks),
                x === null ? (l.callbacks = [v]) : x.push(v)));
          } else
            ((x = {
              lane: v,
              tag: c.tag,
              payload: c.payload,
              callback: c.callback,
              next: null,
            }),
              p === null ? ((y = p = x), (g = _)) : (p = p.next = x),
              (f |= v));
          if (((c = c.next), c === null)) {
            if (((c = l.shared.pending), c === null)) break;
            ((x = c),
              (c = x.next),
              (x.next = null),
              (l.lastBaseUpdate = x),
              (l.shared.pending = null));
          }
        } while (!0);
        (p === null && (g = _),
          (l.baseState = g),
          (l.firstBaseUpdate = y),
          (l.lastBaseUpdate = p),
          s === null && (l.shared.lanes = 0),
          (no |= f),
          (e.lanes = f),
          (e.memoizedState = _));
      }
    }
    function Z2(e, t) {
      if (typeof e != "function") throw Error(k(191, e));
      e.call(t);
    }
    function G2(e, t) {
      var i = e.callbacks;
      if (i !== null)
        for (e.callbacks = null, e = 0; e < i.length; e++) Z2(i[e], t);
    }
    var Gn = qa(null),
      hr = qa(0);
    function $m(e, t) {
      ((e = xi), Ae(hr, e), Ae(Gn, t), (xi = e | t.baseLanes));
    }
    function qd() {
      (Ae(hr, xi), Ae(Gn, Gn.current));
    }
    function Bc() {
      ((xi = hr.current), lt(Gn), lt(hr));
    }
    var Xt = qa(null),
      sa = null;
    function qi(e) {
      var t = e.alternate;
      (Ae(Ge, Ge.current & 1),
        Ae(Xt, e),
        sa === null &&
          (t === null || Gn.current !== null || t.memoizedState !== null) &&
          (sa = e));
    }
    function Hd(e) {
      (Ae(Ge, Ge.current), Ae(Xt, e), sa === null && (sa = e));
    }
    function V2(e) {
      e.tag === 22
        ? (Ae(Ge, Ge.current), Ae(Xt, e), sa === null && (sa = e))
        : Hi(e);
    }
    function Hi() {
      (Ae(Ge, Ge.current), Ae(Xt, Xt.current));
    }
    function Ut(e) {
      (lt(Xt), sa === e && (sa = null), lt(Ge));
    }
    var Ge = qa(0);
    function mr(e) {
      for (var t = e; t !== null;) {
        if (t.tag === 13) {
          var i = t.memoizedState;
          if (i !== null && ((i = i.dehydrated), i === null || nc(i) || lc(i)))
            return t;
        } else if (
          t.tag === 19 &&
          (t.memoizedProps.revealOrder === "forwards" ||
            t.memoizedProps.revealOrder === "backwards" ||
            t.memoizedProps.revealOrder === "unstable_legacy-backwards" ||
            t.memoizedProps.revealOrder === "together")
        ) {
          if ((t.flags & 128) !== 0) return t;
        } else if (t.child !== null) {
          ((t.child.return = t), (t = t.child));
          continue;
        }
        if (t === e) break;
        for (; t.sibling === null;) {
          if (t.return === null || t.return === e) return null;
          t = t.return;
        }
        ((t.sibling.return = t.return), (t = t.sibling));
      }
      return null;
    }
    var _i = 0,
      le = null,
      we = null,
      Qe = null,
      pr = !1,
      Un = !1,
      zo = !1,
      gr = 0,
      du = 0,
      qn = null,
      j0 = 0;
    function Ne() {
      throw Error(k(321));
    }
    function Pc(e, t) {
      if (t === null) return !1;
      for (var i = 0; i < t.length && i < e.length; i++)
        if (!Vt(e[i], t[i])) return !1;
      return !0;
    }
    function kc(e, t, i, o, l, s) {
      return (
        (_i = s),
        (le = t),
        (t.memoizedState = null),
        (t.updateQueue = null),
        (t.lanes = 0),
        (J.H = e === null || e.memoizedState === null ? Sg : Gc),
        (zo = !1),
        (s = i(o, l)),
        (zo = !1),
        Un && (s = j2(t, i, o, l)),
        X2(e),
        s
      );
    }
    function X2(e) {
      J.H = cu;
      var t = we !== null && we.next !== null;
      if (
        ((_i = 0), (Qe = we = le = null), (pr = !1), (du = 0), (qn = null), t)
      )
        throw Error(k(300));
      e === null ||
        $e ||
        ((e = e.dependencies), e !== null && dr(e) && ($e = !0));
    }
    function j2(e, t, i, o) {
      le = e;
      var l = 0;
      do {
        if ((Un && (qn = null), (du = 0), (Un = !1), 25 <= l))
          throw Error(k(301));
        if (((l += 1), (Qe = we = null), e.updateQueue != null)) {
          var s = e.updateQueue;
          ((s.lastEffect = null),
            (s.events = null),
            (s.stores = null),
            s.memoCache != null && (s.memoCache.index = 0));
        }
        ((J.H = Cg), (s = t(i, o)));
      } while (Un);
      return s;
    }
    function Y0() {
      var e = J.H,
        t = e.useState()[0];
      return (
        (t = typeof t.then == "function" ? bu(t) : t),
        (e = e.useState()[0]),
        (we !== null ? we.memoizedState : null) !== e && (le.flags |= 1024),
        t
      );
    }
    function zc() {
      var e = gr !== 0;
      return ((gr = 0), e);
    }
    function Oc(e, t, i) {
      ((t.updateQueue = e.updateQueue), (t.flags &= -2053), (e.lanes &= ~i));
    }
    function Rc(e) {
      if (pr) {
        for (e = e.memoizedState; e !== null;) {
          var t = e.queue;
          (t !== null && (t.pending = null), (e = e.next));
        }
        pr = !1;
      }
      ((_i = 0), (Qe = we = le = null), (Un = !1), (du = gr = 0), (qn = null));
    }
    function xt() {
      var e = {
        memoizedState: null,
        baseState: null,
        baseQueue: null,
        queue: null,
        next: null,
      };
      return (
        Qe === null ? (le.memoizedState = Qe = e) : (Qe = Qe.next = e),
        Qe
      );
    }
    function Ve() {
      if (we === null) {
        var e = le.alternate;
        e = e !== null ? e.memoizedState : null;
      } else e = we.next;
      var t = Qe === null ? le.memoizedState : Qe.next;
      if (t !== null) ((Qe = t), (we = e));
      else {
        if (e === null)
          throw le.alternate === null ? Error(k(467)) : Error(k(310));
        ((we = e),
          (e = {
            memoizedState: we.memoizedState,
            baseState: we.baseState,
            baseQueue: we.baseQueue,
            queue: we.queue,
            next: null,
          }),
          Qe === null ? (le.memoizedState = Qe = e) : (Qe = Qe.next = e));
      }
      return Qe;
    }
    function qr() {
      return { lastEffect: null, events: null, stores: null, memoCache: null };
    }
    function bu(e) {
      var t = du;
      return (
        (du += 1),
        qn === null && (qn = []),
        (e = H2(qn, e, t)),
        (t = le),
        (Qe === null ? t.memoizedState : Qe.next) === null &&
          ((t = t.alternate),
          (J.H = t === null || t.memoizedState === null ? Sg : Gc)),
        e
      );
    }
    function Hr(e) {
      if (e !== null && typeof e == "object") {
        if (typeof e.then == "function") return bu(e);
        if (e.$$typeof === di) return ct(e);
      }
      throw Error(k(438, String(e)));
    }
    function Ec(e) {
      var t = null,
        i = le.updateQueue;
      if ((i !== null && (t = i.memoCache), t == null)) {
        var o = le.alternate;
        o !== null &&
          ((o = o.updateQueue),
          o !== null &&
            ((o = o.memoCache),
            o != null &&
              (t = {
                data: o.data.map(function (l) {
                  return l.slice();
                }),
                index: 0,
              })));
      }
      if (
        (t == null && (t = { data: [], index: 0 }),
        i === null && ((i = qr()), (le.updateQueue = i)),
        (i.memoCache = t),
        (i = t.data[t.index]),
        i === void 0)
      )
        for (i = t.data[t.index] = Array(e), o = 0; o < e; o++) i[o] = k_;
      return (t.index++, i);
    }
    function vi(e, t) {
      return typeof t == "function" ? t(e) : t;
    }
    function Ys(e) {
      var t = Ve();
      return Uc(t, we, e);
    }
    function Uc(e, t, i) {
      var o = e.queue;
      if (o === null) throw Error(k(311));
      o.lastRenderedReducer = i;
      var l = e.baseQueue,
        s = o.pending;
      if (s !== null) {
        if (l !== null) {
          var f = l.next;
          ((l.next = s.next), (s.next = f));
        }
        ((t.baseQueue = l = s), (o.pending = null));
      }
      if (((s = e.baseState), l === null)) e.memoizedState = s;
      else {
        t = l.next;
        var c = (f = null),
          g = null,
          y = t,
          p = !1;
        do {
          var _ = y.lane & -536870913;
          if (_ !== y.lane ? (pe & _) === _ : (_i & _) === _) {
            var v = y.revertLane;
            if (v === 0)
              (g !== null &&
                (g = g.next =
                  {
                    lane: 0,
                    revertLane: 0,
                    gesture: null,
                    action: y.action,
                    hasEagerState: y.hasEagerState,
                    eagerState: y.eagerState,
                    next: null,
                  }),
                _ === Zn && (p = !0));
            else if ((_i & v) === v) {
              ((y = y.next), v === Zn && (p = !0));
              continue;
            } else
              ((_ = {
                lane: 0,
                revertLane: y.revertLane,
                gesture: null,
                action: y.action,
                hasEagerState: y.hasEagerState,
                eagerState: y.eagerState,
                next: null,
              }),
                g === null ? ((c = g = _), (f = s)) : (g = g.next = _),
                (le.lanes |= v),
                (no |= v));
            ((_ = y.action),
              zo && i(s, _),
              (s = y.hasEagerState ? y.eagerState : i(s, _)));
          } else
            ((v = {
              lane: _,
              revertLane: y.revertLane,
              gesture: y.gesture,
              action: y.action,
              hasEagerState: y.hasEagerState,
              eagerState: y.eagerState,
              next: null,
            }),
              g === null ? ((c = g = v), (f = s)) : (g = g.next = v),
              (le.lanes |= _),
              (no |= _));
          y = y.next;
        } while (y !== null && y !== t);
        if (
          (g === null ? (f = s) : (g.next = c),
          !Vt(s, e.memoizedState) && (($e = !0), p && ((i = Rn), i !== null)))
        )
          throw i;
        ((e.memoizedState = s),
          (e.baseState = f),
          (e.baseQueue = g),
          (o.lastRenderedState = s));
      }
      return (l === null && (o.lanes = 0), [e.memoizedState, o.dispatch]);
    }
    function Wf(e) {
      var t = Ve(),
        i = t.queue;
      if (i === null) throw Error(k(311));
      i.lastRenderedReducer = e;
      var o = i.dispatch,
        l = i.pending,
        s = t.memoizedState;
      if (l !== null) {
        i.pending = null;
        var f = (l = l.next);
        do ((s = e(s, f.action)), (f = f.next));
        while (f !== l);
        (Vt(s, t.memoizedState) || ($e = !0),
          (t.memoizedState = s),
          t.baseQueue === null && (t.baseState = s),
          (i.lastRenderedState = s));
      }
      return [s, o];
    }
    function Y2(e, t, i) {
      var o = le,
        l = Ve(),
        s = ge;
      if (s) {
        if (i === void 0) throw Error(k(407));
        i = i();
      } else i = t();
      var f = !Vt((we || l).memoizedState, i);
      if (
        (f && ((l.memoizedState = i), ($e = !0)),
        (l = l.queue),
        qc(W2.bind(null, o, l, e), [e]),
        l.getSnapshot !== t || f || (Qe !== null && Qe.memoizedState.tag & 1))
      ) {
        if (
          ((o.flags |= 2048),
          Vn(9, { destroy: void 0 }, Q2.bind(null, o, l, i, t), null),
          Te === null)
        )
          throw Error(k(349));
        s || (_i & 127) !== 0 || K2(o, t, i);
      }
      return i;
    }
    function K2(e, t, i) {
      ((e.flags |= 16384),
        (e = { getSnapshot: t, value: i }),
        (t = le.updateQueue),
        t === null
          ? ((t = qr()), (le.updateQueue = t), (t.stores = [e]))
          : ((i = t.stores), i === null ? (t.stores = [e]) : i.push(e)));
    }
    function Q2(e, t, i, o) {
      ((t.value = i), (t.getSnapshot = o), J2(t) && $2(e));
    }
    function W2(e, t, i) {
      return i(function () {
        J2(t) && $2(e);
      });
    }
    function J2(e) {
      var t = e.getSnapshot;
      e = e.value;
      try {
        var i = t();
        return !Vt(e, i);
      } catch {
        return !0;
      }
    }
    function $2(e) {
      var t = qo(e, 2);
      t !== null && Bt(t, e, 2);
    }
    function Nd(e) {
      var t = xt();
      if (typeof e == "function") {
        var i = e;
        if (((e = i()), zo)) {
          Fi(!0);
          try {
            i();
          } finally {
            Fi(!1);
          }
        }
      }
      return (
        (t.memoizedState = t.baseState = e),
        (t.queue = {
          pending: null,
          lanes: 0,
          dispatch: null,
          lastRenderedReducer: vi,
          lastRenderedState: e,
        }),
        t
      );
    }
    function eg(e, t, i, o) {
      return ((e.baseState = i), Uc(e, we, typeof o == "function" ? o : vi));
    }
    function K0(e, t, i, o, l) {
      if (Fr(e)) throw Error(k(485));
      if (((e = t.action), e !== null)) {
        var s = {
          payload: l,
          action: e,
          next: null,
          isTransition: !0,
          status: "pending",
          value: null,
          reason: null,
          listeners: [],
          then: function (f) {
            s.listeners.push(f);
          },
        };
        (J.T !== null ? i(!0) : (s.isTransition = !1),
          o(s),
          (i = t.pending),
          i === null
            ? ((s.next = t.pending = s), tg(t, s))
            : ((s.next = i.next), (t.pending = i.next = s)));
      }
    }
    function tg(e, t) {
      var i = t.action,
        o = t.payload,
        l = e.state;
      if (t.isTransition) {
        var s = J.T,
          f = {};
        J.T = f;
        try {
          var c = i(l, o),
            g = J.S;
          (g !== null && g(f, c), ep(e, t, c));
        } catch (y) {
          Fd(e, t, y);
        } finally {
          (s !== null && f.types !== null && (s.types = f.types), (J.T = s));
        }
      } else
        try {
          ((s = i(l, o)), ep(e, t, s));
        } catch (y) {
          Fd(e, t, y);
        }
    }
    function ep(e, t, i) {
      i !== null && typeof i == "object" && typeof i.then == "function"
        ? i.then(
            function (o) {
              tp(e, t, o);
            },
            function (o) {
              return Fd(e, t, o);
            },
          )
        : tp(e, t, i);
    }
    function tp(e, t, i) {
      ((t.status = "fulfilled"),
        (t.value = i),
        ag(t),
        (e.state = i),
        (t = e.pending),
        t !== null &&
          ((i = t.next),
          i === t
            ? (e.pending = null)
            : ((i = i.next), (t.next = i), tg(e, i))));
    }
    function Fd(e, t, i) {
      var o = e.pending;
      if (((e.pending = null), o !== null)) {
        o = o.next;
        do ((t.status = "rejected"), (t.reason = i), ag(t), (t = t.next));
        while (t !== o);
      }
      e.action = null;
    }
    function ag(e) {
      e = e.listeners;
      for (var t = 0; t < e.length; t++) (0, e[t])();
    }
    function ig(e, t) {
      return t;
    }
    function ap(e, t) {
      if (ge) {
        var i = Te.formState;
        if (i !== null) {
          e: {
            var o = le;
            if (ge) {
              if (ze) {
                t: {
                  for (var l = ze, s = ua; l.nodeType !== 8;) {
                    if (!s) {
                      l = null;
                      break t;
                    }
                    if (((l = ra(l.nextSibling)), l === null)) {
                      l = null;
                      break t;
                    }
                  }
                  ((s = l.data), (l = s === "F!" || s === "F" ? l : null));
                }
                if (l) {
                  ((ze = ra(l.nextSibling)), (o = l.data === "F!"));
                  break e;
                }
              }
              io(o);
            }
            o = !1;
          }
          o && (t = i[0]);
        }
      }
      return (
        (i = xt()),
        (i.memoizedState = i.baseState = t),
        (o = {
          pending: null,
          lanes: 0,
          dispatch: null,
          lastRenderedReducer: ig,
          lastRenderedState: t,
        }),
        (i.queue = o),
        (i = vg.bind(null, le, o)),
        (o.dispatch = i),
        (o = Nd(!1)),
        (s = Zc.bind(null, le, !1, o.queue)),
        (o = xt()),
        (l = { state: t, dispatch: null, action: e, pending: null }),
        (o.queue = l),
        (i = K0.bind(null, le, l, s, i)),
        (l.dispatch = i),
        (o.memoizedState = e),
        [t, i, !1]
      );
    }
    function ip(e) {
      var t = Ve();
      return og(t, we, e);
    }
    function og(e, t, i) {
      if (
        ((t = Uc(e, t, ig)[0]),
        (e = Ys(vi)[0]),
        typeof t == "object" && t !== null && typeof t.then == "function")
      )
        try {
          var o = bu(t);
        } catch (f) {
          throw f === el ? Ur : f;
        }
      else o = t;
      t = Ve();
      var l = t.queue,
        s = l.dispatch;
      return (
        i !== t.memoizedState &&
          ((le.flags |= 2048),
          Vn(9, { destroy: void 0 }, Q0.bind(null, l, i), null)),
        [o, s, e]
      );
    }
    function Q0(e, t) {
      e.action = t;
    }
    function op(e) {
      var t = Ve(),
        i = we;
      if (i !== null) return og(t, i, e);
      (Ve(), (t = t.memoizedState), (i = Ve()));
      var o = i.queue.dispatch;
      return ((i.memoizedState = e), [t, o, !1]);
    }
    function Vn(e, t, i, o) {
      return (
        (e = { tag: e, create: i, deps: o, inst: t, next: null }),
        (t = le.updateQueue),
        t === null && ((t = qr()), (le.updateQueue = t)),
        (i = t.lastEffect),
        i === null
          ? (t.lastEffect = e.next = e)
          : ((o = i.next), (i.next = e), (e.next = o), (t.lastEffect = e)),
        e
      );
    }
    function ng() {
      return Ve().memoizedState;
    }
    function Ks(e, t, i, o) {
      var l = xt();
      ((le.flags |= e),
        (l.memoizedState = Vn(
          1 | t,
          { destroy: void 0 },
          i,
          o === void 0 ? null : o,
        )));
    }
    function Nr(e, t, i, o) {
      var l = Ve();
      o = o === void 0 ? null : o;
      var s = l.memoizedState.inst;
      we !== null && o !== null && Pc(o, we.memoizedState.deps)
        ? (l.memoizedState = Vn(t, s, i, o))
        : ((le.flags |= e), (l.memoizedState = Vn(1 | t, s, i, o)));
    }
    function np(e, t) {
      Ks(8390656, 8, e, t);
    }
    function qc(e, t) {
      Nr(2048, 8, e, t);
    }
    function W0(e) {
      le.flags |= 4;
      var t = le.updateQueue;
      if (t === null) ((t = qr()), (le.updateQueue = t), (t.events = [e]));
      else {
        var i = t.events;
        i === null ? (t.events = [e]) : i.push(e);
      }
    }
    function lg(e) {
      var t = Ve().memoizedState;
      return (
        W0({ ref: t, nextImpl: e }),
        function () {
          if ((ye & 2) !== 0) throw Error(k(440));
          return t.impl.apply(void 0, arguments);
        }
      );
    }
    function ug(e, t) {
      return Nr(4, 2, e, t);
    }
    function sg(e, t) {
      return Nr(4, 4, e, t);
    }
    function rg(e, t) {
      if (typeof t == "function") {
        e = e();
        var i = t(e);
        return function () {
          typeof i == "function" ? i() : t(null);
        };
      }
      if (t != null)
        return (
          (e = e()),
          (t.current = e),
          function () {
            t.current = null;
          }
        );
    }
    function fg(e, t, i) {
      ((i = i != null ? i.concat([e]) : null),
        Nr(4, 4, rg.bind(null, t, e), i));
    }
    function Hc() {}
    function dg(e, t) {
      var i = Ve();
      t = t === void 0 ? null : t;
      var o = i.memoizedState;
      return t !== null && Pc(t, o[1]) ? o[0] : ((i.memoizedState = [e, t]), e);
    }
    function cg(e, t) {
      var i = Ve();
      t = t === void 0 ? null : t;
      var o = i.memoizedState;
      if (t !== null && Pc(t, o[1])) return o[0];
      if (((o = e()), zo)) {
        Fi(!0);
        try {
          e();
        } finally {
          Fi(!1);
        }
      }
      return ((i.memoizedState = [o, t]), o);
    }
    function Nc(e, t, i) {
      return i === void 0 || ((_i & 1073741824) !== 0 && (pe & 261930) === 0)
        ? (e.memoizedState = t)
        : ((e.memoizedState = i), (e = e1()), (le.lanes |= e), (no |= e), i);
    }
    function hg(e, t, i, o) {
      return Vt(i, t)
        ? i
        : Gn.current !== null
          ? ((e = Nc(e, i, o)), Vt(e, t) || ($e = !0), e)
          : (_i & 42) === 0 || ((_i & 1073741824) !== 0 && (pe & 261930) === 0)
            ? (($e = !0), (e.memoizedState = i))
            : ((e = e1()), (le.lanes |= e), (no |= e), t);
    }
    function mg(e, t, i, o, l) {
      var s = xe.p;
      xe.p = s !== 0 && 8 > s ? s : 8;
      var f = J.T,
        c = {};
      ((J.T = c), Zc(e, !1, t, i));
      try {
        var g = l(),
          y = J.S;
        if (
          (y !== null && y(c, g),
          g !== null && typeof g == "object" && typeof g.then == "function")
        ) {
          var p = X0(g, o);
          Jl(e, t, p, Gt(e));
        } else Jl(e, t, o, Gt(e));
      } catch (_) {
        Jl(e, t, { then: function () {}, status: "rejected", reason: _ }, Gt());
      } finally {
        ((xe.p = s),
          f !== null && c.types !== null && (f.types = c.types),
          (J.T = f));
      }
    }
    function J0() {}
    function Zd(e, t, i, o) {
      if (e.tag !== 5) throw Error(k(476));
      var l = pg(e).queue;
      mg(
        e,
        l,
        t,
        wo,
        i === null
          ? J0
          : function () {
              return (gg(e), i(o));
            },
      );
    }
    function pg(e) {
      var t = e.memoizedState;
      if (t !== null) return t;
      t = {
        memoizedState: wo,
        baseState: wo,
        baseQueue: null,
        queue: {
          pending: null,
          lanes: 0,
          dispatch: null,
          lastRenderedReducer: vi,
          lastRenderedState: wo,
        },
        next: null,
      };
      var i = {};
      return (
        (t.next = {
          memoizedState: i,
          baseState: i,
          baseQueue: null,
          queue: {
            pending: null,
            lanes: 0,
            dispatch: null,
            lastRenderedReducer: vi,
            lastRenderedState: i,
          },
          next: null,
        }),
        (e.memoizedState = t),
        (e = e.alternate),
        e !== null && (e.memoizedState = t),
        t
      );
    }
    function gg(e) {
      var t = pg(e);
      (t.next === null && (t = e.alternate.memoizedState),
        Jl(e, t.next.queue, {}, Gt()));
    }
    function Fc() {
      return ct(pu);
    }
    function Lg() {
      return Ve().memoizedState;
    }
    function _g() {
      return Ve().memoizedState;
    }
    function $0(e) {
      for (var t = e.return; t !== null;) {
        switch (t.tag) {
          case 24:
          case 3:
            var i = Gt();
            e = Ki(i);
            var o = Qi(t, e, i);
            (o !== null && (Bt(o, t, i), Kl(o, t, i)),
              (t = { cache: Mc() }),
              (e.payload = t));
            return;
        }
        t = t.return;
      }
    }
    function ev(e, t, i) {
      var o = Gt();
      ((i = {
        lane: o,
        revertLane: 0,
        gesture: null,
        action: i,
        hasEagerState: !1,
        eagerState: null,
        next: null,
      }),
        Fr(e)
          ? yg(t, i)
          : ((i = Cc(e, t, i, o)), i !== null && (Bt(i, e, o), xg(i, t, o))));
    }
    function vg(e, t, i) {
      var o = Gt();
      Jl(e, t, i, o);
    }
    function Jl(e, t, i, o) {
      var l = {
        lane: o,
        revertLane: 0,
        gesture: null,
        action: i,
        hasEagerState: !1,
        eagerState: null,
        next: null,
      };
      if (Fr(e)) yg(t, l);
      else {
        var s = e.alternate;
        if (
          e.lanes === 0 &&
          (s === null || s.lanes === 0) &&
          ((s = t.lastRenderedReducer), s !== null)
        )
          try {
            var f = t.lastRenderedState,
              c = s(f, i);
            if (((l.hasEagerState = !0), (l.eagerState = c), Vt(c, f)))
              return (Er(e, t, l, 0), Te === null && Rr(), !1);
          } catch {}
        if (((i = Cc(e, t, l, o)), i !== null))
          return (Bt(i, e, o), xg(i, t, o), !0);
      }
      return !1;
    }
    function Zc(e, t, i, o) {
      if (
        ((o = {
          lane: 2,
          revertLane: Jc(),
          gesture: null,
          action: o,
          hasEagerState: !1,
          eagerState: null,
          next: null,
        }),
        Fr(e))
      ) {
        if (t) throw Error(k(479));
      } else ((t = Cc(e, i, o, 2)), t !== null && Bt(t, e, 2));
    }
    function Fr(e) {
      var t = e.alternate;
      return e === le || (t !== null && t === le);
    }
    function yg(e, t) {
      Un = pr = !0;
      var i = e.pending;
      (i === null ? (t.next = t) : ((t.next = i.next), (i.next = t)),
        (e.pending = t));
    }
    function xg(e, t, i) {
      if ((i & 4194048) !== 0) {
        var o = t.lanes;
        ((o &= e.pendingLanes), (i |= o), (t.lanes = i), l2(e, i));
      }
    }
    var cu = {
      readContext: ct,
      use: Hr,
      useCallback: Ne,
      useContext: Ne,
      useEffect: Ne,
      useImperativeHandle: Ne,
      useLayoutEffect: Ne,
      useInsertionEffect: Ne,
      useMemo: Ne,
      useReducer: Ne,
      useRef: Ne,
      useState: Ne,
      useDebugValue: Ne,
      useDeferredValue: Ne,
      useTransition: Ne,
      useSyncExternalStore: Ne,
      useId: Ne,
      useHostTransitionStatus: Ne,
      useFormState: Ne,
      useActionState: Ne,
      useOptimistic: Ne,
      useMemoCache: Ne,
      useCacheRefresh: Ne,
    };
    cu.useEffectEvent = Ne;
    var Sg = {
        readContext: ct,
        use: Hr,
        useCallback: function (e, t) {
          return ((xt().memoizedState = [e, t === void 0 ? null : t]), e);
        },
        useContext: ct,
        useEffect: np,
        useImperativeHandle: function (e, t, i) {
          ((i = i != null ? i.concat([e]) : null),
            Ks(4194308, 4, rg.bind(null, t, e), i));
        },
        useLayoutEffect: function (e, t) {
          return Ks(4194308, 4, e, t);
        },
        useInsertionEffect: function (e, t) {
          Ks(4, 2, e, t);
        },
        useMemo: function (e, t) {
          var i = xt();
          t = t === void 0 ? null : t;
          var o = e();
          if (zo) {
            Fi(!0);
            try {
              e();
            } finally {
              Fi(!1);
            }
          }
          return ((i.memoizedState = [o, t]), o);
        },
        useReducer: function (e, t, i) {
          var o = xt();
          if (i !== void 0) {
            var l = i(t);
            if (zo) {
              Fi(!0);
              try {
                i(t);
              } finally {
                Fi(!1);
              }
            }
          } else l = t;
          return (
            (o.memoizedState = o.baseState = l),
            (e = {
              pending: null,
              lanes: 0,
              dispatch: null,
              lastRenderedReducer: e,
              lastRenderedState: l,
            }),
            (o.queue = e),
            (e = e.dispatch = ev.bind(null, le, e)),
            [o.memoizedState, e]
          );
        },
        useRef: function (e) {
          var t = xt();
          return ((e = { current: e }), (t.memoizedState = e));
        },
        useState: function (e) {
          e = Nd(e);
          var t = e.queue,
            i = vg.bind(null, le, t);
          return ((t.dispatch = i), [e.memoizedState, i]);
        },
        useDebugValue: Hc,
        useDeferredValue: function (e, t) {
          var i = xt();
          return Nc(i, e, t);
        },
        useTransition: function () {
          var e = Nd(!1);
          return (
            (e = mg.bind(null, le, e.queue, !0, !1)),
            (xt().memoizedState = e),
            [!1, e]
          );
        },
        useSyncExternalStore: function (e, t, i) {
          var o = le,
            l = xt();
          if (ge) {
            if (i === void 0) throw Error(k(407));
            i = i();
          } else {
            if (((i = t()), Te === null)) throw Error(k(349));
            (pe & 127) !== 0 || K2(o, t, i);
          }
          l.memoizedState = i;
          var s = { value: i, getSnapshot: t };
          return (
            (l.queue = s),
            np(W2.bind(null, o, s, e), [e]),
            (o.flags |= 2048),
            Vn(9, { destroy: void 0 }, Q2.bind(null, o, s, i, t), null),
            i
          );
        },
        useId: function () {
          var e = xt(),
            t = Te.identifierPrefix;
          if (ge) {
            var i = Ra,
              o = Oa;
            ((i = (o & ~(1 << (32 - Zt(o) - 1))).toString(32) + i),
              (t = "_" + t + "R_" + i),
              (i = gr++),
              0 < i && (t += "H" + i.toString(32)),
              (t += "_"));
          } else ((i = j0++), (t = "_" + t + "r_" + i.toString(32) + "_"));
          return (e.memoizedState = t);
        },
        useHostTransitionStatus: Fc,
        useFormState: ap,
        useActionState: ap,
        useOptimistic: function (e) {
          var t = xt();
          t.memoizedState = t.baseState = e;
          var i = {
            pending: null,
            lanes: 0,
            dispatch: null,
            lastRenderedReducer: null,
            lastRenderedState: null,
          };
          return (
            (t.queue = i),
            (t = Zc.bind(null, le, !0, i)),
            (i.dispatch = t),
            [e, t]
          );
        },
        useMemoCache: Ec,
        useCacheRefresh: function () {
          return (xt().memoizedState = $0.bind(null, le));
        },
        useEffectEvent: function (e) {
          var t = xt(),
            i = { impl: e };
          return (
            (t.memoizedState = i),
            function () {
              if ((ye & 2) !== 0) throw Error(k(440));
              return i.impl.apply(void 0, arguments);
            }
          );
        },
      },
      Gc = {
        readContext: ct,
        use: Hr,
        useCallback: dg,
        useContext: ct,
        useEffect: qc,
        useImperativeHandle: fg,
        useInsertionEffect: ug,
        useLayoutEffect: sg,
        useMemo: cg,
        useReducer: Ys,
        useRef: ng,
        useState: function () {
          return Ys(vi);
        },
        useDebugValue: Hc,
        useDeferredValue: function (e, t) {
          var i = Ve();
          return hg(i, we.memoizedState, e, t);
        },
        useTransition: function () {
          var e = Ys(vi)[0],
            t = Ve().memoizedState;
          return [typeof e == "boolean" ? e : bu(e), t];
        },
        useSyncExternalStore: Y2,
        useId: Lg,
        useHostTransitionStatus: Fc,
        useFormState: ip,
        useActionState: ip,
        useOptimistic: function (e, t) {
          var i = Ve();
          return eg(i, we, e, t);
        },
        useMemoCache: Ec,
        useCacheRefresh: _g,
      };
    Gc.useEffectEvent = lg;
    var Cg = {
      readContext: ct,
      use: Hr,
      useCallback: dg,
      useContext: ct,
      useEffect: qc,
      useImperativeHandle: fg,
      useInsertionEffect: ug,
      useLayoutEffect: sg,
      useMemo: cg,
      useReducer: Wf,
      useRef: ng,
      useState: function () {
        return Wf(vi);
      },
      useDebugValue: Hc,
      useDeferredValue: function (e, t) {
        var i = Ve();
        return we === null ? Nc(i, e, t) : hg(i, we.memoizedState, e, t);
      },
      useTransition: function () {
        var e = Wf(vi)[0],
          t = Ve().memoizedState;
        return [typeof e == "boolean" ? e : bu(e), t];
      },
      useSyncExternalStore: Y2,
      useId: Lg,
      useHostTransitionStatus: Fc,
      useFormState: op,
      useActionState: op,
      useOptimistic: function (e, t) {
        var i = Ve();
        return we !== null
          ? eg(i, we, e, t)
          : ((i.baseState = e), [e, i.queue.dispatch]);
      },
      useMemoCache: Ec,
      useCacheRefresh: _g,
    };
    Cg.useEffectEvent = lg;
    function Jf(e, t, i, o) {
      ((t = e.memoizedState),
        (i = i(o, t)),
        (i = i == null ? t : Oe({}, t, i)),
        (e.memoizedState = i),
        e.lanes === 0 && (e.updateQueue.baseState = i));
    }
    var Gd = {
      enqueueSetState: function (e, t, i) {
        e = e._reactInternals;
        var o = Gt(),
          l = Ki(o);
        ((l.payload = t),
          i != null && (l.callback = i),
          (t = Qi(e, l, o)),
          t !== null && (Bt(t, e, o), Kl(t, e, o)));
      },
      enqueueReplaceState: function (e, t, i) {
        e = e._reactInternals;
        var o = Gt(),
          l = Ki(o);
        ((l.tag = 1),
          (l.payload = t),
          i != null && (l.callback = i),
          (t = Qi(e, l, o)),
          t !== null && (Bt(t, e, o), Kl(t, e, o)));
      },
      enqueueForceUpdate: function (e, t) {
        e = e._reactInternals;
        var i = Gt(),
          o = Ki(i);
        ((o.tag = 2),
          t != null && (o.callback = t),
          (t = Qi(e, o, i)),
          t !== null && (Bt(t, e, i), Kl(t, e, i)));
      },
    };
    function lp(e, t, i, o, l, s, f) {
      return (
        (e = e.stateNode),
        typeof e.shouldComponentUpdate == "function"
          ? e.shouldComponentUpdate(o, s, f)
          : t.prototype && t.prototype.isPureReactComponent
            ? !uu(i, o) || !uu(l, s)
            : !0
      );
    }
    function up(e, t, i, o) {
      ((e = t.state),
        typeof t.componentWillReceiveProps == "function" &&
          t.componentWillReceiveProps(i, o),
        typeof t.UNSAFE_componentWillReceiveProps == "function" &&
          t.UNSAFE_componentWillReceiveProps(i, o),
        t.state !== e && Gd.enqueueReplaceState(t, t.state, null));
    }
    function Oo(e, t) {
      var i = t;
      if ("ref" in t) {
        i = {};
        for (var o in t) o !== "ref" && (i[o] = t[o]);
      }
      if ((e = e.defaultProps)) {
        i === t && (i = Oe({}, i));
        for (var l in e) i[l] === void 0 && (i[l] = e[l]);
      }
      return i;
    }
    function Ig(e) {
      sr(e);
    }
    function bg(e) {
      console.error(e);
    }
    function wg(e) {
      sr(e);
    }
    function Lr(e, t) {
      try {
        var i = e.onUncaughtError;
        i(t.value, { componentStack: t.stack });
      } catch (o) {
        setTimeout(function () {
          throw o;
        });
      }
    }
    function sp(e, t, i) {
      try {
        var o = e.onCaughtError;
        o(i.value, {
          componentStack: i.stack,
          errorBoundary: t.tag === 1 ? t.stateNode : null,
        });
      } catch (l) {
        setTimeout(function () {
          throw l;
        });
      }
    }
    function Vd(e, t, i) {
      return (
        (i = Ki(i)),
        (i.tag = 3),
        (i.payload = { element: null }),
        (i.callback = function () {
          Lr(e, t);
        }),
        i
      );
    }
    function Mg(e) {
      return ((e = Ki(e)), (e.tag = 3), e);
    }
    function Tg(e, t, i, o) {
      var l = i.type.getDerivedStateFromError;
      if (typeof l == "function") {
        var s = o.value;
        ((e.payload = function () {
          return l(s);
        }),
          (e.callback = function () {
            sp(t, i, o);
          }));
      }
      var f = i.stateNode;
      f !== null &&
        typeof f.componentDidCatch == "function" &&
        (e.callback = function () {
          (sp(t, i, o),
            typeof l != "function" &&
              (Wi === null ? (Wi = new Set([this])) : Wi.add(this)));
          var c = o.stack;
          this.componentDidCatch(o.value, {
            componentStack: c !== null ? c : "",
          });
        });
    }
    function tv(e, t, i, o, l) {
      if (
        ((i.flags |= 32768),
        o !== null && typeof o == "object" && typeof o.then == "function")
      ) {
        if (
          ((t = i.alternate),
          t !== null && $n(t, i, l, !0),
          (i = Xt.current),
          i !== null)
        ) {
          switch (i.tag) {
            case 31:
            case 13:
              return (
                sa === null
                  ? Sr()
                  : i.alternate === null && Fe === 0 && (Fe = 3),
                (i.flags &= -257),
                (i.flags |= 65536),
                (i.lanes = l),
                o === cr
                  ? (i.flags |= 16384)
                  : ((t = i.updateQueue),
                    t === null ? (i.updateQueue = new Set([o])) : t.add(o),
                    rd(e, o, l)),
                !1
              );
            case 22:
              return (
                (i.flags |= 65536),
                o === cr
                  ? (i.flags |= 16384)
                  : ((t = i.updateQueue),
                    t === null
                      ? ((t = {
                          transitions: null,
                          markerInstances: null,
                          retryQueue: new Set([o]),
                        }),
                        (i.updateQueue = t))
                      : ((i = t.retryQueue),
                        i === null ? (t.retryQueue = new Set([o])) : i.add(o)),
                    rd(e, o, l)),
                !1
              );
          }
          throw Error(k(435, i.tag));
        }
        return (rd(e, o, l), Sr(), !1);
      }
      if (ge)
        return (
          (t = Xt.current),
          t !== null
            ? ((t.flags & 65536) === 0 && (t.flags |= 256),
              (t.flags |= 65536),
              (t.lanes = l),
              o !== Pd && ((e = Error(k(422), { cause: o })), ru(la(e, i))))
            : (o !== Pd && ((t = Error(k(423), { cause: o })), ru(la(t, i))),
              (e = e.current.alternate),
              (e.flags |= 65536),
              (l &= -l),
              (e.lanes |= l),
              (o = la(o, i)),
              (l = Vd(e.stateNode, o, l)),
              Qf(e, l),
              Fe !== 4 && (Fe = 2)),
          !1
        );
      var s = Error(k(520), { cause: o });
      if (
        ((s = la(s, i)),
        tu === null ? (tu = [s]) : tu.push(s),
        Fe !== 4 && (Fe = 2),
        t === null)
      )
        return !0;
      ((o = la(o, i)), (i = t));
      do {
        switch (i.tag) {
          case 3:
            return (
              (i.flags |= 65536),
              (e = l & -l),
              (i.lanes |= e),
              (e = Vd(i.stateNode, o, e)),
              Qf(i, e),
              !1
            );
          case 1:
            if (
              ((t = i.type),
              (s = i.stateNode),
              (i.flags & 128) === 0 &&
                (typeof t.getDerivedStateFromError == "function" ||
                  (s !== null &&
                    typeof s.componentDidCatch == "function" &&
                    (Wi === null || !Wi.has(s)))))
            )
              return (
                (i.flags |= 65536),
                (l &= -l),
                (i.lanes |= l),
                (l = Mg(l)),
                Tg(l, e, i, o),
                Qf(i, l),
                !1
              );
        }
        i = i.return;
      } while (i !== null);
      return !1;
    }
    var Vc = Error(k(461)),
      $e = !1;
    function rt(e, t, i, o) {
      t.child = e === null ? F2(t, null, i, o) : ko(t, e.child, i, o);
    }
    function rp(e, t, i, o, l) {
      i = i.render;
      var s = t.ref;
      if ("ref" in o) {
        var f = {};
        for (var c in o) c !== "ref" && (f[c] = o[c]);
      } else f = o;
      return (
        Po(t),
        (o = kc(e, t, i, f, s, l)),
        (c = zc()),
        e !== null && !$e
          ? (Oc(e, t, l), yi(e, t, l))
          : (ge && c && bc(t), (t.flags |= 1), rt(e, t, o, l), t.child)
      );
    }
    function fp(e, t, i, o, l) {
      if (e === null) {
        var s = i.type;
        return typeof s == "function" &&
          !Ic(s) &&
          s.defaultProps === void 0 &&
          i.compare === null
          ? ((t.tag = 15), (t.type = s), Ag(e, t, s, o, l))
          : ((e = Xs(i.type, null, o, t, t.mode, l)),
            (e.ref = t.ref),
            (e.return = t),
            (t.child = e));
      }
      if (((s = e.child), !Xc(e, l))) {
        var f = s.memoizedProps;
        if (
          ((i = i.compare),
          (i = i !== null ? i : uu),
          i(f, o) && e.ref === t.ref)
        )
          return yi(e, t, l);
      }
      return (
        (t.flags |= 1),
        (e = mi(s, o)),
        (e.ref = t.ref),
        (e.return = t),
        (t.child = e)
      );
    }
    function Ag(e, t, i, o, l) {
      if (e !== null) {
        var s = e.memoizedProps;
        if (uu(s, o) && e.ref === t.ref)
          if ((($e = !1), (t.pendingProps = o = s), Xc(e, l)))
            (e.flags & 131072) !== 0 && ($e = !0);
          else return ((t.lanes = e.lanes), yi(e, t, l));
      }
      return Xd(e, t, i, o, l);
    }
    function Dg(e, t, i, o) {
      var l = o.children,
        s = e !== null ? e.memoizedState : null;
      if (
        (e === null &&
          t.stateNode === null &&
          (t.stateNode = {
            _visibility: 1,
            _pendingMarkers: null,
            _retryCache: null,
            _transitions: null,
          }),
        o.mode === "hidden")
      ) {
        if ((t.flags & 128) !== 0) {
          if (((s = s !== null ? s.baseLanes | i : i), e !== null)) {
            for (o = t.child = e.child, l = 0; o !== null;)
              ((l = l | o.lanes | o.childLanes), (o = o.sibling));
            o = l & ~s;
          } else ((o = 0), (t.child = null));
          return dp(e, t, s, i, o);
        }
        if ((i & 536870912) !== 0)
          ((t.memoizedState = { baseLanes: 0, cachePool: null }),
            e !== null && js(t, s !== null ? s.cachePool : null),
            s !== null ? $m(t, s) : qd(),
            V2(t));
        else
          return (
            (o = t.lanes = 536870912),
            dp(e, t, s !== null ? s.baseLanes | i : i, i, o)
          );
      } else
        s !== null
          ? (js(t, s.cachePool), $m(t, s), Hi(t), (t.memoizedState = null))
          : (e !== null && js(t, null), qd(), Hi(t));
      return (rt(e, t, l, i), t.child);
    }
    function Zl(e, t) {
      return (
        (e !== null && e.tag === 22) ||
          t.stateNode !== null ||
          (t.stateNode = {
            _visibility: 1,
            _pendingMarkers: null,
            _retryCache: null,
            _transitions: null,
          }),
        t.sibling
      );
    }
    function dp(e, t, i, o, l) {
      var s = Tc();
      return (
        (s = s === null ? null : { parent: Je._currentValue, pool: s }),
        (t.memoizedState = { baseLanes: i, cachePool: s }),
        e !== null && js(t, null),
        qd(),
        V2(t),
        e !== null && $n(e, t, o, !0),
        (t.childLanes = l),
        null
      );
    }
    function Qs(e, t) {
      return (
        (t = _r({ mode: t.mode, children: t.children }, e.mode)),
        (t.ref = e.ref),
        (e.child = t),
        (t.return = e),
        t
      );
    }
    function cp(e, t, i) {
      return (
        ko(t, e.child, null, i),
        (e = Qs(t, t.pendingProps)),
        (e.flags |= 2),
        Ut(t),
        (t.memoizedState = null),
        e
      );
    }
    function av(e, t, i) {
      var o = t.pendingProps,
        l = (t.flags & 128) !== 0;
      if (((t.flags &= -129), e === null)) {
        if (ge) {
          if (o.mode === "hidden")
            return ((e = Qs(t, o)), (t.lanes = 536870912), Zl(null, e));
          if (
            (Hd(t),
            (e = ze)
              ? ((e = S1(e, ua)),
                (e = e !== null && e.data === "&" ? e : null),
                e !== null &&
                  ((t.memoizedState = {
                    dehydrated: e,
                    treeContext: ao !== null ? { id: Oa, overflow: Ra } : null,
                    retryLane: 536870912,
                    hydrationErrors: null,
                  }),
                  (i = O2(e)),
                  (i.return = t),
                  (t.child = i),
                  (dt = t),
                  (ze = null)))
              : (e = null),
            e === null)
          )
            throw io(t);
          return ((t.lanes = 536870912), null);
        }
        return Qs(t, o);
      }
      var s = e.memoizedState;
      if (s !== null) {
        var f = s.dehydrated;
        if ((Hd(t), l))
          if (t.flags & 256) ((t.flags &= -257), (t = cp(e, t, i)));
          else if (t.memoizedState !== null)
            ((t.child = e.child), (t.flags |= 128), (t = null));
          else throw Error(k(558));
        else if (
          ($e || $n(e, t, i, !1), (l = (i & e.childLanes) !== 0), $e || l)
        ) {
          if (
            ((o = Te),
            o !== null && ((f = u2(o, i)), f !== 0 && f !== s.retryLane))
          )
            throw ((s.retryLane = f), qo(e, f), Bt(o, e, f), Vc);
          (Sr(), (t = cp(e, t, i)));
        } else
          ((e = s.treeContext),
            (ze = ra(f.nextSibling)),
            (dt = t),
            (ge = !0),
            (Yi = null),
            (ua = !1),
            e !== null && E2(t, e),
            (t = Qs(t, o)),
            (t.flags |= 4096));
        return t;
      }
      return (
        (e = mi(e.child, { mode: o.mode, children: o.children })),
        (e.ref = t.ref),
        (t.child = e),
        (e.return = t),
        e
      );
    }
    function Ws(e, t) {
      var i = t.ref;
      if (i === null) e !== null && e.ref !== null && (t.flags |= 4194816);
      else {
        if (typeof i != "function" && typeof i != "object") throw Error(k(284));
        (e === null || e.ref !== i) && (t.flags |= 4194816);
      }
    }
    function Xd(e, t, i, o, l) {
      return (
        Po(t),
        (i = kc(e, t, i, o, void 0, l)),
        (o = zc()),
        e !== null && !$e
          ? (Oc(e, t, l), yi(e, t, l))
          : (ge && o && bc(t), (t.flags |= 1), rt(e, t, i, l), t.child)
      );
    }
    function hp(e, t, i, o, l, s) {
      return (
        Po(t),
        (t.updateQueue = null),
        (i = j2(t, o, i, l)),
        X2(e),
        (o = zc()),
        e !== null && !$e
          ? (Oc(e, t, s), yi(e, t, s))
          : (ge && o && bc(t), (t.flags |= 1), rt(e, t, i, s), t.child)
      );
    }
    function mp(e, t, i, o, l) {
      if ((Po(t), t.stateNode === null)) {
        var s = An,
          f = i.contextType;
        (typeof f == "object" && f !== null && (s = ct(f)),
          (s = new i(o, s)),
          (t.memoizedState =
            s.state !== null && s.state !== void 0 ? s.state : null),
          (s.updater = Gd),
          (t.stateNode = s),
          (s._reactInternals = t),
          (s = t.stateNode),
          (s.props = o),
          (s.state = t.memoizedState),
          (s.refs = {}),
          Dc(t),
          (f = i.contextType),
          (s.context = typeof f == "object" && f !== null ? ct(f) : An),
          (s.state = t.memoizedState),
          (f = i.getDerivedStateFromProps),
          typeof f == "function" &&
            (Jf(t, i, f, o), (s.state = t.memoizedState)),
          typeof i.getDerivedStateFromProps == "function" ||
            typeof s.getSnapshotBeforeUpdate == "function" ||
            (typeof s.UNSAFE_componentWillMount != "function" &&
              typeof s.componentWillMount != "function") ||
            ((f = s.state),
            typeof s.componentWillMount == "function" && s.componentWillMount(),
            typeof s.UNSAFE_componentWillMount == "function" &&
              s.UNSAFE_componentWillMount(),
            f !== s.state && Gd.enqueueReplaceState(s, s.state, null),
            Wl(t, o, s, l),
            Ql(),
            (s.state = t.memoizedState)),
          typeof s.componentDidMount == "function" && (t.flags |= 4194308),
          (o = !0));
      } else if (e === null) {
        s = t.stateNode;
        var c = t.memoizedProps,
          g = Oo(i, c);
        s.props = g;
        var y = s.context,
          p = i.contextType;
        ((f = An), typeof p == "object" && p !== null && (f = ct(p)));
        var _ = i.getDerivedStateFromProps;
        ((p =
          typeof _ == "function" ||
          typeof s.getSnapshotBeforeUpdate == "function"),
          (c = t.pendingProps !== c),
          p ||
            (typeof s.UNSAFE_componentWillReceiveProps != "function" &&
              typeof s.componentWillReceiveProps != "function") ||
            ((c || y !== f) && up(t, s, o, f)),
          (Ei = !1));
        var v = t.memoizedState;
        ((s.state = v),
          Wl(t, o, s, l),
          Ql(),
          (y = t.memoizedState),
          c || v !== y || Ei
            ? (typeof _ == "function" &&
                (Jf(t, i, _, o), (y = t.memoizedState)),
              (g = Ei || lp(t, i, g, o, v, y, f))
                ? (p ||
                    (typeof s.UNSAFE_componentWillMount != "function" &&
                      typeof s.componentWillMount != "function") ||
                    (typeof s.componentWillMount == "function" &&
                      s.componentWillMount(),
                    typeof s.UNSAFE_componentWillMount == "function" &&
                      s.UNSAFE_componentWillMount()),
                  typeof s.componentDidMount == "function" &&
                    (t.flags |= 4194308))
                : (typeof s.componentDidMount == "function" &&
                    (t.flags |= 4194308),
                  (t.memoizedProps = o),
                  (t.memoizedState = y)),
              (s.props = o),
              (s.state = y),
              (s.context = f),
              (o = g))
            : (typeof s.componentDidMount == "function" && (t.flags |= 4194308),
              (o = !1)));
      } else {
        ((s = t.stateNode),
          Ed(e, t),
          (f = t.memoizedProps),
          (p = Oo(i, f)),
          (s.props = p),
          (_ = t.pendingProps),
          (v = s.context),
          (y = i.contextType),
          (g = An),
          typeof y == "object" && y !== null && (g = ct(y)),
          (c = i.getDerivedStateFromProps),
          (y =
            typeof c == "function" ||
            typeof s.getSnapshotBeforeUpdate == "function") ||
            (typeof s.UNSAFE_componentWillReceiveProps != "function" &&
              typeof s.componentWillReceiveProps != "function") ||
            ((f !== _ || v !== g) && up(t, s, o, g)),
          (Ei = !1),
          (v = t.memoizedState),
          (s.state = v),
          Wl(t, o, s, l),
          Ql());
        var x = t.memoizedState;
        f !== _ ||
        v !== x ||
        Ei ||
        (e !== null && e.dependencies !== null && dr(e.dependencies))
          ? (typeof c == "function" && (Jf(t, i, c, o), (x = t.memoizedState)),
            (p =
              Ei ||
              lp(t, i, p, o, v, x, g) ||
              (e !== null && e.dependencies !== null && dr(e.dependencies)))
              ? (y ||
                  (typeof s.UNSAFE_componentWillUpdate != "function" &&
                    typeof s.componentWillUpdate != "function") ||
                  (typeof s.componentWillUpdate == "function" &&
                    s.componentWillUpdate(o, x, g),
                  typeof s.UNSAFE_componentWillUpdate == "function" &&
                    s.UNSAFE_componentWillUpdate(o, x, g)),
                typeof s.componentDidUpdate == "function" && (t.flags |= 4),
                typeof s.getSnapshotBeforeUpdate == "function" &&
                  (t.flags |= 1024))
              : (typeof s.componentDidUpdate != "function" ||
                  (f === e.memoizedProps && v === e.memoizedState) ||
                  (t.flags |= 4),
                typeof s.getSnapshotBeforeUpdate != "function" ||
                  (f === e.memoizedProps && v === e.memoizedState) ||
                  (t.flags |= 1024),
                (t.memoizedProps = o),
                (t.memoizedState = x)),
            (s.props = o),
            (s.state = x),
            (s.context = g),
            (o = p))
          : (typeof s.componentDidUpdate != "function" ||
              (f === e.memoizedProps && v === e.memoizedState) ||
              (t.flags |= 4),
            typeof s.getSnapshotBeforeUpdate != "function" ||
              (f === e.memoizedProps && v === e.memoizedState) ||
              (t.flags |= 1024),
            (o = !1));
      }
      return (
        (s = o),
        Ws(e, t),
        (o = (t.flags & 128) !== 0),
        s || o
          ? ((s = t.stateNode),
            (i =
              o && typeof i.getDerivedStateFromError != "function"
                ? null
                : s.render()),
            (t.flags |= 1),
            e !== null && o
              ? ((t.child = ko(t, e.child, null, l)),
                (t.child = ko(t, null, i, l)))
              : rt(e, t, i, l),
            (t.memoizedState = s.state),
            (e = t.child))
          : (e = yi(e, t, l)),
        e
      );
    }
    function pp(e, t, i, o) {
      return (Bo(), (t.flags |= 256), rt(e, t, i, o), t.child);
    }
    var $f = {
      dehydrated: null,
      treeContext: null,
      retryLane: 0,
      hydrationErrors: null,
    };
    function ed(e) {
      return { baseLanes: e, cachePool: q2() };
    }
    function td(e, t, i) {
      return ((e = e !== null ? e.childLanes & ~i : 0), t && (e |= Ht), e);
    }
    function Bg(e, t, i) {
      var o = t.pendingProps,
        l = !1,
        s = (t.flags & 128) !== 0,
        f;
      if (
        ((f = s) ||
          (f =
            e !== null && e.memoizedState === null
              ? !1
              : (Ge.current & 2) !== 0),
        f && ((l = !0), (t.flags &= -129)),
        (f = (t.flags & 32) !== 0),
        (t.flags &= -33),
        e === null)
      ) {
        if (ge) {
          if (
            (l ? qi(t) : Hi(t),
            (e = ze)
              ? ((e = S1(e, ua)),
                (e = e !== null && e.data !== "&" ? e : null),
                e !== null &&
                  ((t.memoizedState = {
                    dehydrated: e,
                    treeContext: ao !== null ? { id: Oa, overflow: Ra } : null,
                    retryLane: 536870912,
                    hydrationErrors: null,
                  }),
                  (i = O2(e)),
                  (i.return = t),
                  (t.child = i),
                  (dt = t),
                  (ze = null)))
              : (e = null),
            e === null)
          )
            throw io(t);
          return (lc(e) ? (t.lanes = 32) : (t.lanes = 536870912), null);
        }
        var c = o.children;
        return (
          (o = o.fallback),
          l
            ? (Hi(t),
              (l = t.mode),
              (c = _r({ mode: "hidden", children: c }, l)),
              (o = Mo(o, l, i, null)),
              (c.return = t),
              (o.return = t),
              (c.sibling = o),
              (t.child = c),
              (o = t.child),
              (o.memoizedState = ed(i)),
              (o.childLanes = td(e, f, i)),
              (t.memoizedState = $f),
              Zl(null, o))
            : (qi(t), jd(t, c))
        );
      }
      var g = e.memoizedState;
      if (g !== null && ((c = g.dehydrated), c !== null)) {
        if (s)
          t.flags & 256
            ? (qi(t), (t.flags &= -257), (t = ad(e, t, i)))
            : t.memoizedState !== null
              ? (Hi(t), (t.child = e.child), (t.flags |= 128), (t = null))
              : (Hi(t),
                (c = o.fallback),
                (l = t.mode),
                (o = _r({ mode: "visible", children: o.children }, l)),
                (c = Mo(c, l, i, null)),
                (c.flags |= 2),
                (o.return = t),
                (c.return = t),
                (o.sibling = c),
                (t.child = o),
                ko(t, e.child, null, i),
                (o = t.child),
                (o.memoizedState = ed(i)),
                (o.childLanes = td(e, f, i)),
                (t.memoizedState = $f),
                (t = Zl(null, o)));
        else if ((qi(t), lc(c))) {
          if (((f = c.nextSibling && c.nextSibling.dataset), f)) var y = f.dgst;
          ((f = y),
            (o = Error(k(419))),
            (o.stack = ""),
            (o.digest = f),
            ru({ value: o, source: null, stack: null }),
            (t = ad(e, t, i)));
        } else if (
          ($e || $n(e, t, i, !1), (f = (i & e.childLanes) !== 0), $e || f)
        ) {
          if (
            ((f = Te),
            f !== null && ((o = u2(f, i)), o !== 0 && o !== g.retryLane))
          )
            throw ((g.retryLane = o), qo(e, o), Bt(f, e, o), Vc);
          (nc(c) || Sr(), (t = ad(e, t, i)));
        } else
          nc(c)
            ? ((t.flags |= 192), (t.child = e.child), (t = null))
            : ((e = g.treeContext),
              (ze = ra(c.nextSibling)),
              (dt = t),
              (ge = !0),
              (Yi = null),
              (ua = !1),
              e !== null && E2(t, e),
              (t = jd(t, o.children)),
              (t.flags |= 4096));
        return t;
      }
      return l
        ? (Hi(t),
          (c = o.fallback),
          (l = t.mode),
          (g = e.child),
          (y = g.sibling),
          (o = mi(g, { mode: "hidden", children: o.children })),
          (o.subtreeFlags = g.subtreeFlags & 65011712),
          y !== null
            ? (c = mi(y, c))
            : ((c = Mo(c, l, i, null)), (c.flags |= 2)),
          (c.return = t),
          (o.return = t),
          (o.sibling = c),
          (t.child = o),
          Zl(null, o),
          (o = t.child),
          (c = e.child.memoizedState),
          c === null
            ? (c = ed(i))
            : ((l = c.cachePool),
              l !== null
                ? ((g = Je._currentValue),
                  (l = l.parent !== g ? { parent: g, pool: g } : l))
                : (l = q2()),
              (c = { baseLanes: c.baseLanes | i, cachePool: l })),
          (o.memoizedState = c),
          (o.childLanes = td(e, f, i)),
          (t.memoizedState = $f),
          Zl(e.child, o))
        : (qi(t),
          (i = e.child),
          (e = i.sibling),
          (i = mi(i, { mode: "visible", children: o.children })),
          (i.return = t),
          (i.sibling = null),
          e !== null &&
            ((f = t.deletions),
            f === null ? ((t.deletions = [e]), (t.flags |= 16)) : f.push(e)),
          (t.child = i),
          (t.memoizedState = null),
          i);
    }
    function jd(e, t) {
      return (
        (t = _r({ mode: "visible", children: t }, e.mode)),
        (t.return = e),
        (e.child = t)
      );
    }
    function _r(e, t) {
      return ((e = qt(22, e, null, t)), (e.lanes = 0), e);
    }
    function ad(e, t, i) {
      return (
        ko(t, e.child, null, i),
        (e = jd(t, t.pendingProps.children)),
        (e.flags |= 2),
        (t.memoizedState = null),
        e
      );
    }
    function gp(e, t, i) {
      e.lanes |= t;
      var o = e.alternate;
      (o !== null && (o.lanes |= t), zd(e.return, t, i));
    }
    function id(e, t, i, o, l, s) {
      var f = e.memoizedState;
      f === null
        ? (e.memoizedState = {
            isBackwards: t,
            rendering: null,
            renderingStartTime: 0,
            last: o,
            tail: i,
            tailMode: l,
            treeForkCount: s,
          })
        : ((f.isBackwards = t),
          (f.rendering = null),
          (f.renderingStartTime = 0),
          (f.last = o),
          (f.tail = i),
          (f.tailMode = l),
          (f.treeForkCount = s));
    }
    function Pg(e, t, i) {
      var o = t.pendingProps,
        l = o.revealOrder,
        s = o.tail;
      o = o.children;
      var f = Ge.current,
        c = (f & 2) !== 0;
      if (
        (c ? ((f = (f & 1) | 2), (t.flags |= 128)) : (f &= 1),
        Ae(Ge, f),
        rt(e, t, o, i),
        (o = ge ? su : 0),
        !c && e !== null && (e.flags & 128) !== 0)
      )
        e: for (e = t.child; e !== null;) {
          if (e.tag === 13) e.memoizedState !== null && gp(e, i, t);
          else if (e.tag === 19) gp(e, i, t);
          else if (e.child !== null) {
            ((e.child.return = e), (e = e.child));
            continue;
          }
          if (e === t) break e;
          for (; e.sibling === null;) {
            if (e.return === null || e.return === t) break e;
            e = e.return;
          }
          ((e.sibling.return = e.return), (e = e.sibling));
        }
      switch (l) {
        case "forwards":
          for (i = t.child, l = null; i !== null;)
            ((e = i.alternate),
              e !== null && mr(e) === null && (l = i),
              (i = i.sibling));
          ((i = l),
            i === null
              ? ((l = t.child), (t.child = null))
              : ((l = i.sibling), (i.sibling = null)),
            id(t, !1, l, i, s, o));
          break;
        case "backwards":
        case "unstable_legacy-backwards":
          for (i = null, l = t.child, t.child = null; l !== null;) {
            if (((e = l.alternate), e !== null && mr(e) === null)) {
              t.child = l;
              break;
            }
            ((e = l.sibling), (l.sibling = i), (i = l), (l = e));
          }
          id(t, !0, i, null, s, o);
          break;
        case "together":
          id(t, !1, null, null, void 0, o);
          break;
        default:
          t.memoizedState = null;
      }
      return t.child;
    }
    function yi(e, t, i) {
      if (
        (e !== null && (t.dependencies = e.dependencies),
        (no |= t.lanes),
        (i & t.childLanes) === 0)
      )
        if (e !== null) {
          if (($n(e, t, i, !1), (i & t.childLanes) === 0)) return null;
        } else return null;
      if (e !== null && t.child !== e.child) throw Error(k(153));
      if (t.child !== null) {
        for (
          e = t.child, i = mi(e, e.pendingProps), t.child = i, i.return = t;
          e.sibling !== null;
        )
          ((e = e.sibling),
            (i = i.sibling = mi(e, e.pendingProps)),
            (i.return = t));
        i.sibling = null;
      }
      return t.child;
    }
    function Xc(e, t) {
      return (e.lanes & t) !== 0
        ? !0
        : ((e = e.dependencies), !!(e !== null && dr(e)));
    }
    function iv(e, t, i) {
      switch (t.tag) {
        case 3:
          (or(t, t.stateNode.containerInfo),
            Ui(t, Je, e.memoizedState.cache),
            Bo());
          break;
        case 27:
        case 5:
          xd(t);
          break;
        case 4:
          or(t, t.stateNode.containerInfo);
          break;
        case 10:
          Ui(t, t.type, t.memoizedProps.value);
          break;
        case 31:
          if (t.memoizedState !== null) return ((t.flags |= 128), Hd(t), null);
          break;
        case 13:
          var o = t.memoizedState;
          if (o !== null)
            return o.dehydrated !== null
              ? (qi(t), (t.flags |= 128), null)
              : (i & t.child.childLanes) !== 0
                ? Bg(e, t, i)
                : (qi(t), (e = yi(e, t, i)), e !== null ? e.sibling : null);
          qi(t);
          break;
        case 19:
          var l = (e.flags & 128) !== 0;
          if (
            ((o = (i & t.childLanes) !== 0),
            o || ($n(e, t, i, !1), (o = (i & t.childLanes) !== 0)),
            l)
          ) {
            if (o) return Pg(e, t, i);
            t.flags |= 128;
          }
          if (
            ((l = t.memoizedState),
            l !== null &&
              ((l.rendering = null), (l.tail = null), (l.lastEffect = null)),
            Ae(Ge, Ge.current),
            o)
          )
            break;
          return null;
        case 22:
          return ((t.lanes = 0), Dg(e, t, i, t.pendingProps));
        case 24:
          Ui(t, Je, e.memoizedState.cache);
      }
      return yi(e, t, i);
    }
    function kg(e, t, i) {
      if (e !== null)
        if (e.memoizedProps !== t.pendingProps) $e = !0;
        else {
          if (!Xc(e, i) && (t.flags & 128) === 0)
            return (($e = !1), iv(e, t, i));
          $e = (e.flags & 131072) !== 0;
        }
      else (($e = !1), ge && (t.flags & 1048576) !== 0 && R2(t, su, t.index));
      switch (((t.lanes = 0), t.tag)) {
        case 16:
          e: {
            var o = t.pendingProps;
            if (((e = Io(t.elementType)), (t.type = e), typeof e == "function"))
              Ic(e)
                ? ((o = Oo(e, o)), (t.tag = 1), (t = mp(null, t, e, o, i)))
                : ((t.tag = 0), (t = Xd(null, t, e, o, i)));
            else {
              if (e != null) {
                var l = e.$$typeof;
                if (l === fc) {
                  ((t.tag = 11), (t = rp(null, t, e, o, i)));
                  break e;
                } else if (l === dc) {
                  ((t.tag = 14), (t = fp(null, t, e, o, i)));
                  break e;
                }
              }
              throw ((t = vd(e) || e), Error(k(306, t, "")));
            }
          }
          return t;
        case 0:
          return Xd(e, t, t.type, t.pendingProps, i);
        case 1:
          return ((o = t.type), (l = Oo(o, t.pendingProps)), mp(e, t, o, l, i));
        case 3:
          e: {
            if ((or(t, t.stateNode.containerInfo), e === null))
              throw Error(k(387));
            o = t.pendingProps;
            var s = t.memoizedState;
            ((l = s.element), Ed(e, t), Wl(t, o, null, i));
            var f = t.memoizedState;
            if (
              ((o = f.cache),
              Ui(t, Je, o),
              o !== s.cache && Od(t, [Je], i, !0),
              Ql(),
              (o = f.element),
              s.isDehydrated)
            )
              if (
                ((s = { element: o, isDehydrated: !1, cache: f.cache }),
                (t.updateQueue.baseState = s),
                (t.memoizedState = s),
                t.flags & 256)
              ) {
                t = pp(e, t, o, i);
                break e;
              } else if (o !== l) {
                ((l = la(Error(k(424)), t)), ru(l), (t = pp(e, t, o, i)));
                break e;
              } else
                for (
                  e = t.stateNode.containerInfo,
                    e.nodeType === 9
                      ? (e = e.body)
                      : (e = e.nodeName === "HTML" ? e.ownerDocument.body : e),
                    ze = ra(e.firstChild),
                    dt = t,
                    ge = !0,
                    Yi = null,
                    ua = !0,
                    i = F2(t, null, o, i),
                    t.child = i;
                  i;
                )
                  ((i.flags = (i.flags & -3) | 4096), (i = i.sibling));
            else {
              if ((Bo(), o === l)) {
                t = yi(e, t, i);
                break e;
              }
              rt(e, t, o, i);
            }
            t = t.child;
          }
          return t;
        case 26:
          return (
            Ws(e, t),
            e === null
              ? (i = Up(t.type, null, t.pendingProps, null))
                ? (t.memoizedState = i)
                : ge ||
                  ((i = t.type),
                  (e = t.pendingProps),
                  (o = wr(ji.current).createElement(i)),
                  (o[ft] = t),
                  (o[Pt] = e),
                  ht(o, i, e),
                  nt(o),
                  (t.stateNode = o))
              : (t.memoizedState = Up(
                  t.type,
                  e.memoizedProps,
                  t.pendingProps,
                  e.memoizedState,
                )),
            null
          );
        case 27:
          return (
            xd(t),
            e === null &&
              ge &&
              ((o = t.stateNode = C1(t.type, t.pendingProps, ji.current)),
              (dt = t),
              (ua = !0),
              (l = ze),
              uo(t.type) ? ((uc = l), (ze = ra(o.firstChild))) : (ze = l)),
            rt(e, t, t.pendingProps.children, i),
            Ws(e, t),
            e === null && (t.flags |= 4194304),
            t.child
          );
        case 5:
          return (
            e === null &&
              ge &&
              ((l = o = ze) &&
                ((o = Bv(o, t.type, t.pendingProps, ua)),
                o !== null
                  ? ((t.stateNode = o),
                    (dt = t),
                    (ze = ra(o.firstChild)),
                    (ua = !1),
                    (l = !0))
                  : (l = !1)),
              l || io(t)),
            xd(t),
            (l = t.type),
            (s = t.pendingProps),
            (f = e !== null ? e.memoizedProps : null),
            (o = s.children),
            ic(l, s) ? (o = null) : f !== null && ic(l, f) && (t.flags |= 32),
            t.memoizedState !== null &&
              ((l = kc(e, t, Y0, null, null, i)), (pu._currentValue = l)),
            Ws(e, t),
            rt(e, t, o, i),
            t.child
          );
        case 6:
          return (
            e === null &&
              ge &&
              ((e = i = ze) &&
                ((i = Pv(i, t.pendingProps, ua)),
                i !== null
                  ? ((t.stateNode = i), (dt = t), (ze = null), (e = !0))
                  : (e = !1)),
              e || io(t)),
            null
          );
        case 13:
          return Bg(e, t, i);
        case 4:
          return (
            or(t, t.stateNode.containerInfo),
            (o = t.pendingProps),
            e === null ? (t.child = ko(t, null, o, i)) : rt(e, t, o, i),
            t.child
          );
        case 11:
          return rp(e, t, t.type, t.pendingProps, i);
        case 7:
          return (rt(e, t, t.pendingProps, i), t.child);
        case 8:
          return (rt(e, t, t.pendingProps.children, i), t.child);
        case 12:
          return (rt(e, t, t.pendingProps.children, i), t.child);
        case 10:
          return (
            (o = t.pendingProps),
            Ui(t, t.type, o.value),
            rt(e, t, o.children, i),
            t.child
          );
        case 9:
          return (
            (l = t.type._context),
            (o = t.pendingProps.children),
            Po(t),
            (l = ct(l)),
            (o = o(l)),
            (t.flags |= 1),
            rt(e, t, o, i),
            t.child
          );
        case 14:
          return fp(e, t, t.type, t.pendingProps, i);
        case 15:
          return Ag(e, t, t.type, t.pendingProps, i);
        case 19:
          return Pg(e, t, i);
        case 31:
          return av(e, t, i);
        case 22:
          return Dg(e, t, i, t.pendingProps);
        case 24:
          return (
            Po(t),
            (o = ct(Je)),
            e === null
              ? ((l = Tc()),
                l === null &&
                  ((l = Te),
                  (s = Mc()),
                  (l.pooledCache = s),
                  s.refCount++,
                  s !== null && (l.pooledCacheLanes |= i),
                  (l = s)),
                (t.memoizedState = { parent: o, cache: l }),
                Dc(t),
                Ui(t, Je, l))
              : ((e.lanes & i) !== 0 && (Ed(e, t), Wl(t, null, null, i), Ql()),
                (l = e.memoizedState),
                (s = t.memoizedState),
                l.parent !== o
                  ? ((l = { parent: o, cache: o }),
                    (t.memoizedState = l),
                    t.lanes === 0 &&
                      (t.memoizedState = t.updateQueue.baseState = l),
                    Ui(t, Je, o))
                  : ((o = s.cache),
                    Ui(t, Je, o),
                    o !== l.cache && Od(t, [Je], i, !0))),
            rt(e, t, t.pendingProps.children, i),
            t.child
          );
        case 29:
          throw t.pendingProps;
      }
      throw Error(k(156, t.tag));
    }
    function ni(e) {
      e.flags |= 4;
    }
    function od(e, t, i, o, l) {
      if (((t = (e.mode & 32) !== 0) && (t = !1), t)) {
        if (((e.flags |= 16777216), (l & 335544128) === l))
          if (e.stateNode.complete) e.flags |= 8192;
          else if (i1()) e.flags |= 8192;
          else throw ((Ao = cr), Ac);
      } else e.flags &= -16777217;
    }
    function Lp(e, t) {
      if (t.type !== "stylesheet" || (t.state.loading & 4) !== 0)
        e.flags &= -16777217;
      else if (((e.flags |= 16777216), !w1(t)))
        if (i1()) e.flags |= 8192;
        else throw ((Ao = cr), Ac);
    }
    function Os(e, t) {
      (t !== null && (e.flags |= 4),
        e.flags & 16384 &&
          ((t = e.tag !== 22 ? o2() : 536870912), (e.lanes |= t), (Xn |= t)));
    }
    function Rl(e, t) {
      if (!ge)
        switch (e.tailMode) {
          case "hidden":
            t = e.tail;
            for (var i = null; t !== null;)
              (t.alternate !== null && (i = t), (t = t.sibling));
            i === null ? (e.tail = null) : (i.sibling = null);
            break;
          case "collapsed":
            i = e.tail;
            for (var o = null; i !== null;)
              (i.alternate !== null && (o = i), (i = i.sibling));
            o === null
              ? t || e.tail === null
                ? (e.tail = null)
                : (e.tail.sibling = null)
              : (o.sibling = null);
        }
    }
    function ke(e) {
      var t = e.alternate !== null && e.alternate.child === e.child,
        i = 0,
        o = 0;
      if (t)
        for (var l = e.child; l !== null;)
          ((i |= l.lanes | l.childLanes),
            (o |= l.subtreeFlags & 65011712),
            (o |= l.flags & 65011712),
            (l.return = e),
            (l = l.sibling));
      else
        for (l = e.child; l !== null;)
          ((i |= l.lanes | l.childLanes),
            (o |= l.subtreeFlags),
            (o |= l.flags),
            (l.return = e),
            (l = l.sibling));
      return ((e.subtreeFlags |= o), (e.childLanes = i), t);
    }
    function ov(e, t, i) {
      var o = t.pendingProps;
      switch ((wc(t), t.tag)) {
        case 16:
        case 15:
        case 0:
        case 11:
        case 7:
        case 8:
        case 12:
        case 9:
        case 14:
          return (ke(t), null);
        case 1:
          return (ke(t), null);
        case 3:
          return (
            (i = t.stateNode),
            (o = null),
            e !== null && (o = e.memoizedState.cache),
            t.memoizedState.cache !== o && (t.flags |= 2048),
            pi(Je),
            Hn(),
            i.pendingContext &&
              ((i.context = i.pendingContext), (i.pendingContext = null)),
            (e === null || e.child === null) &&
              (Ln(t)
                ? ni(t)
                : e === null ||
                  (e.memoizedState.isDehydrated && (t.flags & 256) === 0) ||
                  ((t.flags |= 1024), Kf())),
            ke(t),
            null
          );
        case 26:
          var l = t.type,
            s = t.memoizedState;
          return (
            e === null
              ? (ni(t),
                s !== null ? (ke(t), Lp(t, s)) : (ke(t), od(t, l, null, o, i)))
              : s
                ? s !== e.memoizedState
                  ? (ni(t), ke(t), Lp(t, s))
                  : (ke(t), (t.flags &= -16777217))
                : ((e = e.memoizedProps),
                  e !== o && ni(t),
                  ke(t),
                  od(t, l, e, o, i)),
            null
          );
        case 27:
          if (
            (nr(t),
            (i = ji.current),
            (l = t.type),
            e !== null && t.stateNode != null)
          )
            e.memoizedProps !== o && ni(t);
          else {
            if (!o) {
              if (t.stateNode === null) throw Error(k(166));
              return (ke(t), null);
            }
            ((e = Ua.current),
              Ln(t) ? Xm(t, e) : ((e = C1(l, o, i)), (t.stateNode = e), ni(t)));
          }
          return (ke(t), null);
        case 5:
          if ((nr(t), (l = t.type), e !== null && t.stateNode != null))
            e.memoizedProps !== o && ni(t);
          else {
            if (!o) {
              if (t.stateNode === null) throw Error(k(166));
              return (ke(t), null);
            }
            if (((s = Ua.current), Ln(t))) Xm(t, s);
            else {
              var f = wr(ji.current);
              switch (s) {
                case 1:
                  s = f.createElementNS("http://www.w3.org/2000/svg", l);
                  break;
                case 2:
                  s = f.createElementNS(
                    "http://www.w3.org/1998/Math/MathML",
                    l,
                  );
                  break;
                default:
                  switch (l) {
                    case "svg":
                      s = f.createElementNS("http://www.w3.org/2000/svg", l);
                      break;
                    case "math":
                      s = f.createElementNS(
                        "http://www.w3.org/1998/Math/MathML",
                        l,
                      );
                      break;
                    case "script":
                      ((s = f.createElement("div")),
                        (s.innerHTML = "<script><\/script>"),
                        (s = s.removeChild(s.firstChild)));
                      break;
                    case "select":
                      ((s =
                        typeof o.is == "string"
                          ? f.createElement("select", { is: o.is })
                          : f.createElement("select")),
                        o.multiple
                          ? (s.multiple = !0)
                          : o.size && (s.size = o.size));
                      break;
                    default:
                      s =
                        typeof o.is == "string"
                          ? f.createElement(l, { is: o.is })
                          : f.createElement(l);
                  }
              }
              ((s[ft] = t), (s[Pt] = o));
              e: for (f = t.child; f !== null;) {
                if (f.tag === 5 || f.tag === 6) s.appendChild(f.stateNode);
                else if (f.tag !== 4 && f.tag !== 27 && f.child !== null) {
                  ((f.child.return = f), (f = f.child));
                  continue;
                }
                if (f === t) break e;
                for (; f.sibling === null;) {
                  if (f.return === null || f.return === t) break e;
                  f = f.return;
                }
                ((f.sibling.return = f.return), (f = f.sibling));
              }
              t.stateNode = s;
              e: switch ((ht(s, l, o), l)) {
                case "button":
                case "input":
                case "select":
                case "textarea":
                  o = !!o.autoFocus;
                  break e;
                case "img":
                  o = !0;
                  break e;
                default:
                  o = !1;
              }
              o && ni(t);
            }
          }
          return (
            ke(t),
            od(
              t,
              t.type,
              e === null ? null : e.memoizedProps,
              t.pendingProps,
              i,
            ),
            null
          );
        case 6:
          if (e && t.stateNode != null) e.memoizedProps !== o && ni(t);
          else {
            if (typeof o != "string" && t.stateNode === null)
              throw Error(k(166));
            if (((e = ji.current), Ln(t))) {
              if (
                ((e = t.stateNode),
                (i = t.memoizedProps),
                (o = null),
                (l = dt),
                l !== null)
              )
                switch (l.tag) {
                  case 27:
                  case 5:
                    o = l.memoizedProps;
                }
              ((e[ft] = t),
                (e = !!(
                  e.nodeValue === i ||
                  (o !== null && o.suppressHydrationWarning === !0) ||
                  v1(e.nodeValue, i)
                )),
                e || io(t, !0));
            } else
              ((e = wr(e).createTextNode(o)), (e[ft] = t), (t.stateNode = e));
          }
          return (ke(t), null);
        case 31:
          if (((i = t.memoizedState), e === null || e.memoizedState !== null)) {
            if (((o = Ln(t)), i !== null)) {
              if (e === null) {
                if (!o) throw Error(k(318));
                if (
                  ((e = t.memoizedState),
                  (e = e !== null ? e.dehydrated : null),
                  !e)
                )
                  throw Error(k(557));
                e[ft] = t;
              } else
                (Bo(),
                  (t.flags & 128) === 0 && (t.memoizedState = null),
                  (t.flags |= 4));
              (ke(t), (e = !1));
            } else
              ((i = Kf()),
                e !== null &&
                  e.memoizedState !== null &&
                  (e.memoizedState.hydrationErrors = i),
                (e = !0));
            if (!e) return t.flags & 256 ? (Ut(t), t) : (Ut(t), null);
            if ((t.flags & 128) !== 0) throw Error(k(558));
          }
          return (ke(t), null);
        case 13:
          if (
            ((o = t.memoizedState),
            e === null ||
              (e.memoizedState !== null && e.memoizedState.dehydrated !== null))
          ) {
            if (((l = Ln(t)), o !== null && o.dehydrated !== null)) {
              if (e === null) {
                if (!l) throw Error(k(318));
                if (
                  ((l = t.memoizedState),
                  (l = l !== null ? l.dehydrated : null),
                  !l)
                )
                  throw Error(k(317));
                l[ft] = t;
              } else
                (Bo(),
                  (t.flags & 128) === 0 && (t.memoizedState = null),
                  (t.flags |= 4));
              (ke(t), (l = !1));
            } else
              ((l = Kf()),
                e !== null &&
                  e.memoizedState !== null &&
                  (e.memoizedState.hydrationErrors = l),
                (l = !0));
            if (!l) return t.flags & 256 ? (Ut(t), t) : (Ut(t), null);
          }
          return (
            Ut(t),
            (t.flags & 128) !== 0
              ? ((t.lanes = i), t)
              : ((i = o !== null),
                (e = e !== null && e.memoizedState !== null),
                i &&
                  ((o = t.child),
                  (l = null),
                  o.alternate !== null &&
                    o.alternate.memoizedState !== null &&
                    o.alternate.memoizedState.cachePool !== null &&
                    (l = o.alternate.memoizedState.cachePool.pool),
                  (s = null),
                  o.memoizedState !== null &&
                    o.memoizedState.cachePool !== null &&
                    (s = o.memoizedState.cachePool.pool),
                  s !== l && (o.flags |= 2048)),
                i !== e && i && (t.child.flags |= 8192),
                Os(t, t.updateQueue),
                ke(t),
                null)
          );
        case 4:
          return (
            Hn(),
            e === null && $c(t.stateNode.containerInfo),
            ke(t),
            null
          );
        case 10:
          return (pi(t.type), ke(t), null);
        case 19:
          if ((lt(Ge), (o = t.memoizedState), o === null)) return (ke(t), null);
          if (((l = (t.flags & 128) !== 0), (s = o.rendering), s === null))
            if (l) Rl(o, !1);
            else {
              if (Fe !== 0 || (e !== null && (e.flags & 128) !== 0))
                for (e = t.child; e !== null;) {
                  if (((s = mr(e)), s !== null)) {
                    for (
                      t.flags |= 128,
                        Rl(o, !1),
                        e = s.updateQueue,
                        t.updateQueue = e,
                        Os(t, e),
                        t.subtreeFlags = 0,
                        e = i,
                        i = t.child;
                      i !== null;
                    )
                      (z2(i, e), (i = i.sibling));
                    return (
                      Ae(Ge, (Ge.current & 1) | 2),
                      ge && ri(t, o.treeForkCount),
                      t.child
                    );
                  }
                  e = e.sibling;
                }
              o.tail !== null &&
                Nt() > yr &&
                ((t.flags |= 128), (l = !0), Rl(o, !1), (t.lanes = 4194304));
            }
          else {
            if (!l)
              if (((e = mr(s)), e !== null)) {
                if (
                  ((t.flags |= 128),
                  (l = !0),
                  (e = e.updateQueue),
                  (t.updateQueue = e),
                  Os(t, e),
                  Rl(o, !0),
                  o.tail === null &&
                    o.tailMode === "hidden" &&
                    !s.alternate &&
                    !ge)
                )
                  return (ke(t), null);
              } else
                2 * Nt() - o.renderingStartTime > yr &&
                  i !== 536870912 &&
                  ((t.flags |= 128), (l = !0), Rl(o, !1), (t.lanes = 4194304));
            o.isBackwards
              ? ((s.sibling = t.child), (t.child = s))
              : ((e = o.last),
                e !== null ? (e.sibling = s) : (t.child = s),
                (o.last = s));
          }
          return o.tail !== null
            ? ((e = o.tail),
              (o.rendering = e),
              (o.tail = e.sibling),
              (o.renderingStartTime = Nt()),
              (e.sibling = null),
              (i = Ge.current),
              Ae(Ge, l ? (i & 1) | 2 : i & 1),
              ge && ri(t, o.treeForkCount),
              e)
            : (ke(t), null);
        case 22:
        case 23:
          return (
            Ut(t),
            Bc(),
            (o = t.memoizedState !== null),
            e !== null
              ? (e.memoizedState !== null) !== o && (t.flags |= 8192)
              : o && (t.flags |= 8192),
            o
              ? (i & 536870912) !== 0 &&
                (t.flags & 128) === 0 &&
                (ke(t), t.subtreeFlags & 6 && (t.flags |= 8192))
              : ke(t),
            (i = t.updateQueue),
            i !== null && Os(t, i.retryQueue),
            (i = null),
            e !== null &&
              e.memoizedState !== null &&
              e.memoizedState.cachePool !== null &&
              (i = e.memoizedState.cachePool.pool),
            (o = null),
            t.memoizedState !== null &&
              t.memoizedState.cachePool !== null &&
              (o = t.memoizedState.cachePool.pool),
            o !== i && (t.flags |= 2048),
            e !== null && lt(To),
            null
          );
        case 24:
          return (
            (i = null),
            e !== null && (i = e.memoizedState.cache),
            t.memoizedState.cache !== i && (t.flags |= 2048),
            pi(Je),
            ke(t),
            null
          );
        case 25:
          return null;
        case 30:
          return null;
      }
      throw Error(k(156, t.tag));
    }
    function nv(e, t) {
      switch ((wc(t), t.tag)) {
        case 1:
          return (
            (e = t.flags),
            e & 65536 ? ((t.flags = (e & -65537) | 128), t) : null
          );
        case 3:
          return (
            pi(Je),
            Hn(),
            (e = t.flags),
            (e & 65536) !== 0 && (e & 128) === 0
              ? ((t.flags = (e & -65537) | 128), t)
              : null
          );
        case 26:
        case 27:
        case 5:
          return (nr(t), null);
        case 31:
          if (t.memoizedState !== null) {
            if ((Ut(t), t.alternate === null)) throw Error(k(340));
            Bo();
          }
          return (
            (e = t.flags),
            e & 65536 ? ((t.flags = (e & -65537) | 128), t) : null
          );
        case 13:
          if (
            (Ut(t), (e = t.memoizedState), e !== null && e.dehydrated !== null)
          ) {
            if (t.alternate === null) throw Error(k(340));
            Bo();
          }
          return (
            (e = t.flags),
            e & 65536 ? ((t.flags = (e & -65537) | 128), t) : null
          );
        case 19:
          return (lt(Ge), null);
        case 4:
          return (Hn(), null);
        case 10:
          return (pi(t.type), null);
        case 22:
        case 23:
          return (
            Ut(t),
            Bc(),
            e !== null && lt(To),
            (e = t.flags),
            e & 65536 ? ((t.flags = (e & -65537) | 128), t) : null
          );
        case 24:
          return (pi(Je), null);
        case 25:
          return null;
        default:
          return null;
      }
    }
    function zg(e, t) {
      switch ((wc(t), t.tag)) {
        case 3:
          (pi(Je), Hn());
          break;
        case 26:
        case 27:
        case 5:
          nr(t);
          break;
        case 4:
          Hn();
          break;
        case 31:
          t.memoizedState !== null && Ut(t);
          break;
        case 13:
          Ut(t);
          break;
        case 19:
          lt(Ge);
          break;
        case 10:
          pi(t.type);
          break;
        case 22:
        case 23:
          (Ut(t), Bc(), e !== null && lt(To));
          break;
        case 24:
          pi(Je);
      }
    }
    function wu(e, t) {
      try {
        var i = t.updateQueue,
          o = i !== null ? i.lastEffect : null;
        if (o !== null) {
          var l = o.next;
          i = l;
          do {
            if ((i.tag & e) === e) {
              o = void 0;
              var s = i.create,
                f = i.inst;
              ((o = s()), (f.destroy = o));
            }
            i = i.next;
          } while (i !== l);
        }
      } catch (c) {
        Ce(t, t.return, c);
      }
    }
    function oo(e, t, i) {
      try {
        var o = t.updateQueue,
          l = o !== null ? o.lastEffect : null;
        if (l !== null) {
          var s = l.next;
          o = s;
          do {
            if ((o.tag & e) === e) {
              var f = o.inst,
                c = f.destroy;
              if (c !== void 0) {
                ((f.destroy = void 0), (l = t));
                var g = i,
                  y = c;
                try {
                  y();
                } catch (p) {
                  Ce(l, g, p);
                }
              }
            }
            o = o.next;
          } while (o !== s);
        }
      } catch (p) {
        Ce(t, t.return, p);
      }
    }
    function Og(e) {
      var t = e.updateQueue;
      if (t !== null) {
        var i = e.stateNode;
        try {
          G2(t, i);
        } catch (o) {
          Ce(e, e.return, o);
        }
      }
    }
    function Rg(e, t, i) {
      ((i.props = Oo(e.type, e.memoizedProps)), (i.state = e.memoizedState));
      try {
        i.componentWillUnmount();
      } catch (o) {
        Ce(e, t, o);
      }
    }
    function $l(e, t) {
      try {
        var i = e.ref;
        if (i !== null) {
          switch (e.tag) {
            case 26:
            case 27:
            case 5:
              var o = e.stateNode;
              break;
            case 30:
              o = e.stateNode;
              break;
            default:
              o = e.stateNode;
          }
          typeof i == "function" ? (e.refCleanup = i(o)) : (i.current = o);
        }
      } catch (l) {
        Ce(e, t, l);
      }
    }
    function Ea(e, t) {
      var i = e.ref,
        o = e.refCleanup;
      if (i !== null)
        if (typeof o == "function")
          try {
            o();
          } catch (l) {
            Ce(e, t, l);
          } finally {
            ((e.refCleanup = null),
              (e = e.alternate),
              e != null && (e.refCleanup = null));
          }
        else if (typeof i == "function")
          try {
            i(null);
          } catch (l) {
            Ce(e, t, l);
          }
        else i.current = null;
    }
    function Eg(e) {
      var t = e.type,
        i = e.memoizedProps,
        o = e.stateNode;
      try {
        e: switch (t) {
          case "button":
          case "input":
          case "select":
          case "textarea":
            i.autoFocus && o.focus();
            break e;
          case "img":
            i.src ? (o.src = i.src) : i.srcSet && (o.srcset = i.srcSet);
        }
      } catch (l) {
        Ce(e, e.return, l);
      }
    }
    function nd(e, t, i) {
      try {
        var o = e.stateNode;
        (bv(o, e.type, i, t), (o[Pt] = t));
      } catch (l) {
        Ce(e, e.return, l);
      }
    }
    function Ug(e) {
      return (
        e.tag === 5 ||
        e.tag === 3 ||
        e.tag === 26 ||
        (e.tag === 27 && uo(e.type)) ||
        e.tag === 4
      );
    }
    function ld(e) {
      e: for (;;) {
        for (; e.sibling === null;) {
          if (e.return === null || Ug(e.return)) return null;
          e = e.return;
        }
        for (
          e.sibling.return = e.return, e = e.sibling;
          e.tag !== 5 && e.tag !== 6 && e.tag !== 18;
        ) {
          if (
            (e.tag === 27 && uo(e.type)) ||
            e.flags & 2 ||
            e.child === null ||
            e.tag === 4
          )
            continue e;
          ((e.child.return = e), (e = e.child));
        }
        if (!(e.flags & 2)) return e.stateNode;
      }
    }
    function Yd(e, t, i) {
      var o = e.tag;
      if (o === 5 || o === 6)
        ((e = e.stateNode),
          t
            ? (i.nodeType === 9
                ? i.body
                : i.nodeName === "HTML"
                  ? i.ownerDocument.body
                  : i
              ).insertBefore(e, t)
            : ((t =
                i.nodeType === 9
                  ? i.body
                  : i.nodeName === "HTML"
                    ? i.ownerDocument.body
                    : i),
              t.appendChild(e),
              (i = i._reactRootContainer),
              i != null || t.onclick !== null || (t.onclick = ci)));
      else if (
        o !== 4 &&
        (o === 27 && uo(e.type) && ((i = e.stateNode), (t = null)),
        (e = e.child),
        e !== null)
      )
        for (Yd(e, t, i), e = e.sibling; e !== null;)
          (Yd(e, t, i), (e = e.sibling));
    }
    function vr(e, t, i) {
      var o = e.tag;
      if (o === 5 || o === 6)
        ((e = e.stateNode), t ? i.insertBefore(e, t) : i.appendChild(e));
      else if (
        o !== 4 &&
        (o === 27 && uo(e.type) && (i = e.stateNode), (e = e.child), e !== null)
      )
        for (vr(e, t, i), e = e.sibling; e !== null;)
          (vr(e, t, i), (e = e.sibling));
    }
    function qg(e) {
      var t = e.stateNode,
        i = e.memoizedProps;
      try {
        for (var o = e.type, l = t.attributes; l.length;)
          t.removeAttributeNode(l[0]);
        (ht(t, o, i), (t[ft] = e), (t[Pt] = i));
      } catch (s) {
        Ce(e, e.return, s);
      }
    }
    var fi = !1,
      We = !1,
      ud = !1,
      _p = typeof WeakSet == "function" ? WeakSet : Set,
      ot = null;
    function lv(e, t) {
      if (((e = e.containerInfo), (tc = Dr), (e = w2(e)), xc(e))) {
        if ("selectionStart" in e)
          var i = { start: e.selectionStart, end: e.selectionEnd };
        else
          e: {
            i = ((i = e.ownerDocument) && i.defaultView) || window;
            var o = i.getSelection && i.getSelection();
            if (o && o.rangeCount !== 0) {
              i = o.anchorNode;
              var l = o.anchorOffset,
                s = o.focusNode;
              o = o.focusOffset;
              try {
                (i.nodeType, s.nodeType);
              } catch {
                i = null;
                break e;
              }
              var f = 0,
                c = -1,
                g = -1,
                y = 0,
                p = 0,
                _ = e,
                v = null;
              t: for (;;) {
                for (
                  var x;
                  _ !== i || (l !== 0 && _.nodeType !== 3) || (c = f + l),
                    _ !== s || (o !== 0 && _.nodeType !== 3) || (g = f + o),
                    _.nodeType === 3 && (f += _.nodeValue.length),
                    (x = _.firstChild) !== null;
                )
                  ((v = _), (_ = x));
                for (;;) {
                  if (_ === e) break t;
                  if (
                    (v === i && ++y === l && (c = f),
                    v === s && ++p === o && (g = f),
                    (x = _.nextSibling) !== null)
                  )
                    break;
                  ((_ = v), (v = _.parentNode));
                }
                _ = x;
              }
              i = c === -1 || g === -1 ? null : { start: c, end: g };
            } else i = null;
          }
        i = i || { start: 0, end: 0 };
      } else i = null;
      for (
        ac = { focusedElem: e, selectionRange: i }, Dr = !1, ot = t;
        ot !== null;
      )
        if (
          ((t = ot), (e = t.child), (t.subtreeFlags & 1028) !== 0 && e !== null)
        )
          ((e.return = t), (ot = e));
        else
          for (; ot !== null;) {
            switch (((t = ot), (s = t.alternate), (e = t.flags), t.tag)) {
              case 0:
                if (
                  (e & 4) !== 0 &&
                  ((e = t.updateQueue),
                  (e = e !== null ? e.events : null),
                  e !== null)
                )
                  for (i = 0; i < e.length; i++)
                    ((l = e[i]), (l.ref.impl = l.nextImpl));
                break;
              case 11:
              case 15:
                break;
              case 1:
                if ((e & 1024) !== 0 && s !== null) {
                  ((e = void 0),
                    (i = t),
                    (l = s.memoizedProps),
                    (s = s.memoizedState),
                    (o = i.stateNode));
                  try {
                    var B = Oo(i.type, l);
                    ((e = o.getSnapshotBeforeUpdate(B, s)),
                      (o.__reactInternalSnapshotBeforeUpdate = e));
                  } catch (P) {
                    Ce(i, i.return, P);
                  }
                }
                break;
              case 3:
                if ((e & 1024) !== 0) {
                  if (
                    ((e = t.stateNode.containerInfo), (i = e.nodeType), i === 9)
                  )
                    oc(e);
                  else if (i === 1)
                    switch (e.nodeName) {
                      case "HEAD":
                      case "HTML":
                      case "BODY":
                        oc(e);
                        break;
                      default:
                        e.textContent = "";
                    }
                }
                break;
              case 5:
              case 26:
              case 27:
              case 6:
              case 4:
              case 17:
                break;
              default:
                if ((e & 1024) !== 0) throw Error(k(163));
            }
            if (((e = t.sibling), e !== null)) {
              ((e.return = t.return), (ot = e));
              break;
            }
            ot = t.return;
          }
    }
    function Hg(e, t, i) {
      var o = i.flags;
      switch (i.tag) {
        case 0:
        case 11:
        case 15:
          (ui(e, i), o & 4 && wu(5, i));
          break;
        case 1:
          if ((ui(e, i), o & 4))
            if (((e = i.stateNode), t === null))
              try {
                e.componentDidMount();
              } catch (f) {
                Ce(i, i.return, f);
              }
            else {
              var l = Oo(i.type, t.memoizedProps);
              t = t.memoizedState;
              try {
                e.componentDidUpdate(
                  l,
                  t,
                  e.__reactInternalSnapshotBeforeUpdate,
                );
              } catch (f) {
                Ce(i, i.return, f);
              }
            }
          (o & 64 && Og(i), o & 512 && $l(i, i.return));
          break;
        case 3:
          if ((ui(e, i), o & 64 && ((e = i.updateQueue), e !== null))) {
            if (((t = null), i.child !== null))
              switch (i.child.tag) {
                case 27:
                case 5:
                  t = i.child.stateNode;
                  break;
                case 1:
                  t = i.child.stateNode;
              }
            try {
              G2(e, t);
            } catch (f) {
              Ce(i, i.return, f);
            }
          }
          break;
        case 27:
          t === null && o & 4 && qg(i);
        case 26:
        case 5:
          (ui(e, i), t === null && o & 4 && Eg(i), o & 512 && $l(i, i.return));
          break;
        case 12:
          ui(e, i);
          break;
        case 31:
          (ui(e, i), o & 4 && Zg(e, i));
          break;
        case 13:
          (ui(e, i),
            o & 4 && Gg(e, i),
            o & 64 &&
              ((e = i.memoizedState),
              e !== null &&
                ((e = e.dehydrated),
                e !== null && ((i = pv.bind(null, i)), kv(e, i)))));
          break;
        case 22:
          if (((o = i.memoizedState !== null || fi), !o)) {
            ((t = (t !== null && t.memoizedState !== null) || We), (l = fi));
            var s = We;
            ((fi = o),
              (We = t) && !s
                ? si(e, i, (i.subtreeFlags & 8772) !== 0)
                : ui(e, i),
              (fi = l),
              (We = s));
          }
          break;
        case 30:
          break;
        default:
          ui(e, i);
      }
    }
    function Ng(e) {
      var t = e.alternate;
      (t !== null && ((e.alternate = null), Ng(t)),
        (e.child = null),
        (e.deletions = null),
        (e.sibling = null),
        e.tag === 5 && ((t = e.stateNode), t !== null && pc(t)),
        (e.stateNode = null),
        (e.return = null),
        (e.dependencies = null),
        (e.memoizedProps = null),
        (e.memoizedState = null),
        (e.pendingProps = null),
        (e.stateNode = null),
        (e.updateQueue = null));
    }
    var Ue = null,
      At = !1;
    function li(e, t, i) {
      for (i = i.child; i !== null;) (Fg(e, t, i), (i = i.sibling));
    }
    function Fg(e, t, i) {
      if (Ft && typeof Ft.onCommitFiberUnmount == "function")
        try {
          Ft.onCommitFiberUnmount(vu, i);
        } catch {}
      switch (i.tag) {
        case 26:
          (We || Ea(i, t),
            li(e, t, i),
            i.memoizedState
              ? i.memoizedState.count--
              : i.stateNode &&
                ((i = i.stateNode), i.parentNode.removeChild(i)));
          break;
        case 27:
          We || Ea(i, t);
          var o = Ue,
            l = At;
          (uo(i.type) && ((Ue = i.stateNode), (At = !1)),
            li(e, t, i),
            iu(i.stateNode),
            (Ue = o),
            (At = l));
          break;
        case 5:
          We || Ea(i, t);
        case 6:
          if (
            ((o = Ue),
            (l = At),
            (Ue = null),
            li(e, t, i),
            (Ue = o),
            (At = l),
            Ue !== null)
          )
            if (At)
              try {
                (Ue.nodeType === 9
                  ? Ue.body
                  : Ue.nodeName === "HTML"
                    ? Ue.ownerDocument.body
                    : Ue
                ).removeChild(i.stateNode);
              } catch (s) {
                Ce(i, t, s);
              }
            else
              try {
                Ue.removeChild(i.stateNode);
              } catch (s) {
                Ce(i, t, s);
              }
          break;
        case 18:
          Ue !== null &&
            (At
              ? ((e = Ue),
                kp(
                  e.nodeType === 9
                    ? e.body
                    : e.nodeName === "HTML"
                      ? e.ownerDocument.body
                      : e,
                  i.stateNode,
                ),
                Qn(e))
              : kp(Ue, i.stateNode));
          break;
        case 4:
          ((o = Ue),
            (l = At),
            (Ue = i.stateNode.containerInfo),
            (At = !0),
            li(e, t, i),
            (Ue = o),
            (At = l));
          break;
        case 0:
        case 11:
        case 14:
        case 15:
          (oo(2, i, t), We || oo(4, i, t), li(e, t, i));
          break;
        case 1:
          (We ||
            (Ea(i, t),
            (o = i.stateNode),
            typeof o.componentWillUnmount == "function" && Rg(i, t, o)),
            li(e, t, i));
          break;
        case 21:
          li(e, t, i);
          break;
        case 22:
          ((We = (o = We) || i.memoizedState !== null), li(e, t, i), (We = o));
          break;
        default:
          li(e, t, i);
      }
    }
    function Zg(e, t) {
      if (
        t.memoizedState === null &&
        ((e = t.alternate), e !== null && ((e = e.memoizedState), e !== null))
      ) {
        e = e.dehydrated;
        try {
          Qn(e);
        } catch (i) {
          Ce(t, t.return, i);
        }
      }
    }
    function Gg(e, t) {
      if (
        t.memoizedState === null &&
        ((e = t.alternate),
        e !== null &&
          ((e = e.memoizedState),
          e !== null && ((e = e.dehydrated), e !== null)))
      )
        try {
          Qn(e);
        } catch (i) {
          Ce(t, t.return, i);
        }
    }
    function uv(e) {
      switch (e.tag) {
        case 31:
        case 13:
        case 19:
          var t = e.stateNode;
          return (t === null && (t = e.stateNode = new _p()), t);
        case 22:
          return (
            (e = e.stateNode),
            (t = e._retryCache),
            t === null && (t = e._retryCache = new _p()),
            t
          );
        default:
          throw Error(k(435, e.tag));
      }
    }
    function Rs(e, t) {
      var i = uv(e);
      t.forEach(function (o) {
        if (!i.has(o)) {
          i.add(o);
          var l = gv.bind(null, e, o);
          o.then(l, l);
        }
      });
    }
    function Mt(e, t) {
      var i = t.deletions;
      if (i !== null)
        for (var o = 0; o < i.length; o++) {
          var l = i[o],
            s = e,
            f = t,
            c = f;
          e: for (; c !== null;) {
            switch (c.tag) {
              case 27:
                if (uo(c.type)) {
                  ((Ue = c.stateNode), (At = !1));
                  break e;
                }
                break;
              case 5:
                ((Ue = c.stateNode), (At = !1));
                break e;
              case 3:
              case 4:
                ((Ue = c.stateNode.containerInfo), (At = !0));
                break e;
            }
            c = c.return;
          }
          if (Ue === null) throw Error(k(160));
          (Fg(s, f, l),
            (Ue = null),
            (At = !1),
            (s = l.alternate),
            s !== null && (s.return = null),
            (l.return = null));
        }
      if (t.subtreeFlags & 13886)
        for (t = t.child; t !== null;) (Vg(t, e), (t = t.sibling));
    }
    var xa = null;
    function Vg(e, t) {
      var i = e.alternate,
        o = e.flags;
      switch (e.tag) {
        case 0:
        case 11:
        case 14:
        case 15:
          (Mt(t, e),
            Tt(e),
            o & 4 && (oo(3, e, e.return), wu(3, e), oo(5, e, e.return)));
          break;
        case 1:
          (Mt(t, e),
            Tt(e),
            o & 512 && (We || i === null || Ea(i, i.return)),
            o & 64 &&
              fi &&
              ((e = e.updateQueue),
              e !== null &&
                ((o = e.callbacks),
                o !== null &&
                  ((i = e.shared.hiddenCallbacks),
                  (e.shared.hiddenCallbacks = i === null ? o : i.concat(o))))));
          break;
        case 26:
          var l = xa;
          if (
            (Mt(t, e),
            Tt(e),
            o & 512 && (We || i === null || Ea(i, i.return)),
            o & 4)
          ) {
            var s = i !== null ? i.memoizedState : null;
            if (((o = e.memoizedState), i === null))
              if (o === null)
                if (e.stateNode === null) {
                  e: {
                    ((o = e.type),
                      (i = e.memoizedProps),
                      (l = l.ownerDocument || l));
                    t: switch (o) {
                      case "title":
                        ((s = l.getElementsByTagName("title")[0]),
                          (!s ||
                            s[Su] ||
                            s[ft] ||
                            s.namespaceURI === "http://www.w3.org/2000/svg" ||
                            s.hasAttribute("itemprop")) &&
                            ((s = l.createElement(o)),
                            l.head.insertBefore(
                              s,
                              l.querySelector("head > title"),
                            )),
                          ht(s, o, i),
                          (s[ft] = e),
                          nt(s),
                          (o = s));
                        break e;
                      case "link":
                        var f = Hp("link", "href", l).get(o + (i.href || ""));
                        if (f) {
                          for (var c = 0; c < f.length; c++)
                            if (
                              ((s = f[c]),
                              s.getAttribute("href") ===
                                (i.href == null || i.href === ""
                                  ? null
                                  : i.href) &&
                                s.getAttribute("rel") ===
                                  (i.rel == null ? null : i.rel) &&
                                s.getAttribute("title") ===
                                  (i.title == null ? null : i.title) &&
                                s.getAttribute("crossorigin") ===
                                  (i.crossOrigin == null
                                    ? null
                                    : i.crossOrigin))
                            ) {
                              f.splice(c, 1);
                              break t;
                            }
                        }
                        ((s = l.createElement(o)),
                          ht(s, o, i),
                          l.head.appendChild(s));
                        break;
                      case "meta":
                        if (
                          (f = Hp("meta", "content", l).get(
                            o + (i.content || ""),
                          ))
                        ) {
                          for (c = 0; c < f.length; c++)
                            if (
                              ((s = f[c]),
                              s.getAttribute("content") ===
                                (i.content == null ? null : "" + i.content) &&
                                s.getAttribute("name") ===
                                  (i.name == null ? null : i.name) &&
                                s.getAttribute("property") ===
                                  (i.property == null ? null : i.property) &&
                                s.getAttribute("http-equiv") ===
                                  (i.httpEquiv == null ? null : i.httpEquiv) &&
                                s.getAttribute("charset") ===
                                  (i.charSet == null ? null : i.charSet))
                            ) {
                              f.splice(c, 1);
                              break t;
                            }
                        }
                        ((s = l.createElement(o)),
                          ht(s, o, i),
                          l.head.appendChild(s));
                        break;
                      default:
                        throw Error(k(468, o));
                    }
                    ((s[ft] = e), nt(s), (o = s));
                  }
                  e.stateNode = o;
                } else Np(l, e.type, e.stateNode);
              else e.stateNode = qp(l, o, e.memoizedProps);
            else
              s !== o
                ? (s === null
                    ? i.stateNode !== null &&
                      ((i = i.stateNode), i.parentNode.removeChild(i))
                    : s.count--,
                  o === null
                    ? Np(l, e.type, e.stateNode)
                    : qp(l, o, e.memoizedProps))
                : o === null &&
                  e.stateNode !== null &&
                  nd(e, e.memoizedProps, i.memoizedProps);
          }
          break;
        case 27:
          (Mt(t, e),
            Tt(e),
            o & 512 && (We || i === null || Ea(i, i.return)),
            i !== null && o & 4 && nd(e, e.memoizedProps, i.memoizedProps));
          break;
        case 5:
          if (
            (Mt(t, e),
            Tt(e),
            o & 512 && (We || i === null || Ea(i, i.return)),
            e.flags & 32)
          ) {
            l = e.stateNode;
            try {
              Fn(l, "");
            } catch (B) {
              Ce(e, e.return, B);
            }
          }
          (o & 4 &&
            e.stateNode != null &&
            ((l = e.memoizedProps), nd(e, l, i !== null ? i.memoizedProps : l)),
            o & 1024 && (ud = !0));
          break;
        case 6:
          if ((Mt(t, e), Tt(e), o & 4)) {
            if (e.stateNode === null) throw Error(k(162));
            ((o = e.memoizedProps), (i = e.stateNode));
            try {
              i.nodeValue = o;
            } catch (B) {
              Ce(e, e.return, B);
            }
          }
          break;
        case 3:
          if (
            ((er = null),
            (l = xa),
            (xa = Mr(t.containerInfo)),
            Mt(t, e),
            (xa = l),
            Tt(e),
            o & 4 && i !== null && i.memoizedState.isDehydrated)
          )
            try {
              Qn(t.containerInfo);
            } catch (B) {
              Ce(e, e.return, B);
            }
          ud && ((ud = !1), Xg(e));
          break;
        case 4:
          ((o = xa),
            (xa = Mr(e.stateNode.containerInfo)),
            Mt(t, e),
            Tt(e),
            (xa = o));
          break;
        case 12:
          (Mt(t, e), Tt(e));
          break;
        case 31:
          (Mt(t, e),
            Tt(e),
            o & 4 &&
              ((o = e.updateQueue),
              o !== null && ((e.updateQueue = null), Rs(e, o))));
          break;
        case 13:
          (Mt(t, e),
            Tt(e),
            e.child.flags & 8192 &&
              (e.memoizedState !== null) !=
                (i !== null && i.memoizedState !== null) &&
              (Zr = Nt()),
            o & 4 &&
              ((o = e.updateQueue),
              o !== null && ((e.updateQueue = null), Rs(e, o))));
          break;
        case 22:
          l = e.memoizedState !== null;
          var g = i !== null && i.memoizedState !== null,
            y = fi,
            p = We;
          if (
            ((fi = y || l),
            (We = p || g),
            Mt(t, e),
            (We = p),
            (fi = y),
            Tt(e),
            o & 8192)
          )
            e: for (
              t = e.stateNode,
                t._visibility = l ? t._visibility & -2 : t._visibility | 1,
                l && (i === null || g || fi || We || bo(e)),
                i = null,
                t = e;
              ;
            ) {
              if (t.tag === 5 || t.tag === 26) {
                if (i === null) {
                  g = i = t;
                  try {
                    if (((s = g.stateNode), l))
                      ((f = s.style),
                        typeof f.setProperty == "function"
                          ? f.setProperty("display", "none", "important")
                          : (f.display = "none"));
                    else {
                      c = g.stateNode;
                      var _ = g.memoizedProps.style,
                        v =
                          _ != null && _.hasOwnProperty("display")
                            ? _.display
                            : null;
                      c.style.display =
                        v == null || typeof v == "boolean"
                          ? ""
                          : ("" + v).trim();
                    }
                  } catch (B) {
                    Ce(g, g.return, B);
                  }
                }
              } else if (t.tag === 6) {
                if (i === null) {
                  g = t;
                  try {
                    g.stateNode.nodeValue = l ? "" : g.memoizedProps;
                  } catch (B) {
                    Ce(g, g.return, B);
                  }
                }
              } else if (t.tag === 18) {
                if (i === null) {
                  g = t;
                  try {
                    var x = g.stateNode;
                    l ? zp(x, !0) : zp(g.stateNode, !1);
                  } catch (B) {
                    Ce(g, g.return, B);
                  }
                }
              } else if (
                ((t.tag !== 22 && t.tag !== 23) ||
                  t.memoizedState === null ||
                  t === e) &&
                t.child !== null
              ) {
                ((t.child.return = t), (t = t.child));
                continue;
              }
              if (t === e) break e;
              for (; t.sibling === null;) {
                if (t.return === null || t.return === e) break e;
                (i === t && (i = null), (t = t.return));
              }
              (i === t && (i = null),
                (t.sibling.return = t.return),
                (t = t.sibling));
            }
          o & 4 &&
            ((o = e.updateQueue),
            o !== null &&
              ((i = o.retryQueue),
              i !== null && ((o.retryQueue = null), Rs(e, i))));
          break;
        case 19:
          (Mt(t, e),
            Tt(e),
            o & 4 &&
              ((o = e.updateQueue),
              o !== null && ((e.updateQueue = null), Rs(e, o))));
          break;
        case 30:
          break;
        case 21:
          break;
        default:
          (Mt(t, e), Tt(e));
      }
    }
    function Tt(e) {
      var t = e.flags;
      if (t & 2) {
        try {
          for (var i, o = e.return; o !== null;) {
            if (Ug(o)) {
              i = o;
              break;
            }
            o = o.return;
          }
          if (i == null) throw Error(k(160));
          switch (i.tag) {
            case 27:
              var l = i.stateNode,
                s = ld(e);
              vr(e, s, l);
              break;
            case 5:
              var f = i.stateNode;
              i.flags & 32 && (Fn(f, ""), (i.flags &= -33));
              var c = ld(e);
              vr(e, c, f);
              break;
            case 3:
            case 4:
              var g = i.stateNode.containerInfo,
                y = ld(e);
              Yd(e, y, g);
              break;
            default:
              throw Error(k(161));
          }
        } catch (p) {
          Ce(e, e.return, p);
        }
        e.flags &= -3;
      }
      t & 4096 && (e.flags &= -4097);
    }
    function Xg(e) {
      if (e.subtreeFlags & 1024)
        for (e = e.child; e !== null;) {
          var t = e;
          (Xg(t),
            t.tag === 5 && t.flags & 1024 && t.stateNode.reset(),
            (e = e.sibling));
        }
    }
    function ui(e, t) {
      if (t.subtreeFlags & 8772)
        for (t = t.child; t !== null;) (Hg(e, t.alternate, t), (t = t.sibling));
    }
    function bo(e) {
      for (e = e.child; e !== null;) {
        var t = e;
        switch (t.tag) {
          case 0:
          case 11:
          case 14:
          case 15:
            (oo(4, t, t.return), bo(t));
            break;
          case 1:
            Ea(t, t.return);
            var i = t.stateNode;
            (typeof i.componentWillUnmount == "function" && Rg(t, t.return, i),
              bo(t));
            break;
          case 27:
            iu(t.stateNode);
          case 26:
          case 5:
            (Ea(t, t.return), bo(t));
            break;
          case 22:
            t.memoizedState === null && bo(t);
            break;
          case 30:
            bo(t);
            break;
          default:
            bo(t);
        }
        e = e.sibling;
      }
    }
    function si(e, t, i) {
      for (i = i && (t.subtreeFlags & 8772) !== 0, t = t.child; t !== null;) {
        var o = t.alternate,
          l = e,
          s = t,
          f = s.flags;
        switch (s.tag) {
          case 0:
          case 11:
          case 15:
            (si(l, s, i), wu(4, s));
            break;
          case 1:
            if (
              (si(l, s, i),
              (o = s),
              (l = o.stateNode),
              typeof l.componentDidMount == "function")
            )
              try {
                l.componentDidMount();
              } catch (y) {
                Ce(o, o.return, y);
              }
            if (((o = s), (l = o.updateQueue), l !== null)) {
              var c = o.stateNode;
              try {
                var g = l.shared.hiddenCallbacks;
                if (g !== null)
                  for (
                    l.shared.hiddenCallbacks = null, l = 0;
                    l < g.length;
                    l++
                  )
                    Z2(g[l], c);
              } catch (y) {
                Ce(o, o.return, y);
              }
            }
            (i && f & 64 && Og(s), $l(s, s.return));
            break;
          case 27:
            qg(s);
          case 26:
          case 5:
            (si(l, s, i), i && o === null && f & 4 && Eg(s), $l(s, s.return));
            break;
          case 12:
            si(l, s, i);
            break;
          case 31:
            (si(l, s, i), i && f & 4 && Zg(l, s));
            break;
          case 13:
            (si(l, s, i), i && f & 4 && Gg(l, s));
            break;
          case 22:
            (s.memoizedState === null && si(l, s, i), $l(s, s.return));
            break;
          case 30:
            break;
          default:
            si(l, s, i);
        }
        t = t.sibling;
      }
    }
    function jc(e, t) {
      var i = null;
      (e !== null &&
        e.memoizedState !== null &&
        e.memoizedState.cachePool !== null &&
        (i = e.memoizedState.cachePool.pool),
        (e = null),
        t.memoizedState !== null &&
          t.memoizedState.cachePool !== null &&
          (e = t.memoizedState.cachePool.pool),
        e !== i && (e != null && e.refCount++, i != null && Iu(i)));
    }
    function Yc(e, t) {
      ((e = null),
        t.alternate !== null && (e = t.alternate.memoizedState.cache),
        (t = t.memoizedState.cache),
        t !== e && (t.refCount++, e != null && Iu(e)));
    }
    function ya(e, t, i, o) {
      if (t.subtreeFlags & 10256)
        for (t = t.child; t !== null;) (jg(e, t, i, o), (t = t.sibling));
    }
    function jg(e, t, i, o) {
      var l = t.flags;
      switch (t.tag) {
        case 0:
        case 11:
        case 15:
          (ya(e, t, i, o), l & 2048 && wu(9, t));
          break;
        case 1:
          ya(e, t, i, o);
          break;
        case 3:
          (ya(e, t, i, o),
            l & 2048 &&
              ((e = null),
              t.alternate !== null && (e = t.alternate.memoizedState.cache),
              (t = t.memoizedState.cache),
              t !== e && (t.refCount++, e != null && Iu(e))));
          break;
        case 12:
          if (l & 2048) {
            (ya(e, t, i, o), (e = t.stateNode));
            try {
              var s = t.memoizedProps,
                f = s.id,
                c = s.onPostCommit;
              typeof c == "function" &&
                c(
                  f,
                  t.alternate === null ? "mount" : "update",
                  e.passiveEffectDuration,
                  -0,
                );
            } catch (g) {
              Ce(t, t.return, g);
            }
          } else ya(e, t, i, o);
          break;
        case 31:
          ya(e, t, i, o);
          break;
        case 13:
          ya(e, t, i, o);
          break;
        case 23:
          break;
        case 22:
          ((s = t.stateNode),
            (f = t.alternate),
            t.memoizedState !== null
              ? s._visibility & 2
                ? ya(e, t, i, o)
                : eu(e, t)
              : s._visibility & 2
                ? ya(e, t, i, o)
                : ((s._visibility |= 2),
                  vn(e, t, i, o, (t.subtreeFlags & 10256) !== 0 || !1)),
            l & 2048 && jc(f, t));
          break;
        case 24:
          (ya(e, t, i, o), l & 2048 && Yc(t.alternate, t));
          break;
        default:
          ya(e, t, i, o);
      }
    }
    function vn(e, t, i, o, l) {
      for (
        l = l && ((t.subtreeFlags & 10256) !== 0 || !1), t = t.child;
        t !== null;
      ) {
        var s = e,
          f = t,
          c = i,
          g = o,
          y = f.flags;
        switch (f.tag) {
          case 0:
          case 11:
          case 15:
            (vn(s, f, c, g, l), wu(8, f));
            break;
          case 23:
            break;
          case 22:
            var p = f.stateNode;
            (f.memoizedState !== null
              ? p._visibility & 2
                ? vn(s, f, c, g, l)
                : eu(s, f)
              : ((p._visibility |= 2), vn(s, f, c, g, l)),
              l && y & 2048 && jc(f.alternate, f));
            break;
          case 24:
            (vn(s, f, c, g, l), l && y & 2048 && Yc(f.alternate, f));
            break;
          default:
            vn(s, f, c, g, l);
        }
        t = t.sibling;
      }
    }
    function eu(e, t) {
      if (t.subtreeFlags & 10256)
        for (t = t.child; t !== null;) {
          var i = e,
            o = t,
            l = o.flags;
          switch (o.tag) {
            case 22:
              (eu(i, o), l & 2048 && jc(o.alternate, o));
              break;
            case 24:
              (eu(i, o), l & 2048 && Yc(o.alternate, o));
              break;
            default:
              eu(i, o);
          }
          t = t.sibling;
        }
    }
    var Gl = 8192;
    function _n(e, t, i) {
      if (e.subtreeFlags & Gl)
        for (e = e.child; e !== null;) (Yg(e, t, i), (e = e.sibling));
    }
    function Yg(e, t, i) {
      switch (e.tag) {
        case 26:
          (_n(e, t, i),
            e.flags & Gl &&
              e.memoizedState !== null &&
              Vv(i, xa, e.memoizedState, e.memoizedProps));
          break;
        case 5:
          _n(e, t, i);
          break;
        case 3:
        case 4:
          var o = xa;
          ((xa = Mr(e.stateNode.containerInfo)), _n(e, t, i), (xa = o));
          break;
        case 22:
          e.memoizedState === null &&
            ((o = e.alternate),
            o !== null && o.memoizedState !== null
              ? ((o = Gl), (Gl = 16777216), _n(e, t, i), (Gl = o))
              : _n(e, t, i));
          break;
        default:
          _n(e, t, i);
      }
    }
    function Kg(e) {
      var t = e.alternate;
      if (t !== null && ((e = t.child), e !== null)) {
        t.child = null;
        do ((t = e.sibling), (e.sibling = null), (e = t));
        while (e !== null);
      }
    }
    function El(e) {
      var t = e.deletions;
      if ((e.flags & 16) !== 0) {
        if (t !== null)
          for (var i = 0; i < t.length; i++) {
            var o = t[i];
            ((ot = o), Wg(o, e));
          }
        Kg(e);
      }
      if (e.subtreeFlags & 10256)
        for (e = e.child; e !== null;) (Qg(e), (e = e.sibling));
    }
    function Qg(e) {
      switch (e.tag) {
        case 0:
        case 11:
        case 15:
          (El(e), e.flags & 2048 && oo(9, e, e.return));
          break;
        case 3:
          El(e);
          break;
        case 12:
          El(e);
          break;
        case 22:
          var t = e.stateNode;
          e.memoizedState !== null &&
          t._visibility & 2 &&
          (e.return === null || e.return.tag !== 13)
            ? ((t._visibility &= -3), Js(e))
            : El(e);
          break;
        default:
          El(e);
      }
    }
    function Js(e) {
      var t = e.deletions;
      if ((e.flags & 16) !== 0) {
        if (t !== null)
          for (var i = 0; i < t.length; i++) {
            var o = t[i];
            ((ot = o), Wg(o, e));
          }
        Kg(e);
      }
      for (e = e.child; e !== null;) {
        switch (((t = e), t.tag)) {
          case 0:
          case 11:
          case 15:
            (oo(8, t, t.return), Js(t));
            break;
          case 22:
            ((i = t.stateNode),
              i._visibility & 2 && ((i._visibility &= -3), Js(t)));
            break;
          default:
            Js(t);
        }
        e = e.sibling;
      }
    }
    function Wg(e, t) {
      for (; ot !== null;) {
        var i = ot;
        switch (i.tag) {
          case 0:
          case 11:
          case 15:
            oo(8, i, t);
            break;
          case 23:
          case 22:
            if (
              i.memoizedState !== null &&
              i.memoizedState.cachePool !== null
            ) {
              var o = i.memoizedState.cachePool.pool;
              o != null && o.refCount++;
            }
            break;
          case 24:
            Iu(i.memoizedState.cache);
        }
        if (((o = i.child), o !== null)) ((o.return = i), (ot = o));
        else
          e: for (i = e; ot !== null;) {
            o = ot;
            var l = o.sibling,
              s = o.return;
            if ((Ng(o), o === i)) {
              ot = null;
              break e;
            }
            if (l !== null) {
              ((l.return = s), (ot = l));
              break e;
            }
            ot = s;
          }
      }
    }
    var sv = {
        getCacheForType: function (e) {
          var t = ct(Je),
            i = t.data.get(e);
          return (i === void 0 && ((i = e()), t.data.set(e, i)), i);
        },
        cacheSignal: function () {
          return ct(Je).controller.signal;
        },
      },
      rv = typeof WeakMap == "function" ? WeakMap : Map,
      ye = 0,
      Te = null,
      ce = null,
      pe = 0,
      Se = 0,
      Et = null,
      Gi = !1,
      tl = !1,
      Kc = !1,
      xi = 0,
      Fe = 0,
      no = 0,
      Do = 0,
      Qc = 0,
      Ht = 0,
      Xn = 0,
      tu = null,
      Dt = null,
      Kd = !1,
      Zr = 0,
      Jg = 0,
      yr = 1 / 0,
      xr = null,
      Wi = null,
      tt = 0,
      Ji = null,
      jn = null,
      gi = 0,
      Qd = 0,
      Wd = null,
      $g = null,
      au = 0,
      Jd = null;
    function Gt() {
      return (ye & 2) !== 0 && pe !== 0 ? pe & -pe : J.T !== null ? Jc() : s2();
    }
    function e1() {
      if (Ht === 0)
        if ((pe & 536870912) === 0 || ge) {
          var e = ws;
          ((ws <<= 1), (ws & 3932160) === 0 && (ws = 262144), (Ht = e));
        } else Ht = 536870912;
      return ((e = Xt.current), e !== null && (e.flags |= 32), Ht);
    }
    function Bt(e, t, i) {
      (((e === Te && (Se === 2 || Se === 9)) ||
        e.cancelPendingCommit !== null) &&
        (Yn(e, 0), Vi(e, pe, Ht, !1)),
        xu(e, i),
        ((ye & 2) === 0 || e !== Te) &&
          (e === Te &&
            ((ye & 2) === 0 && (Do |= i), Fe === 4 && Vi(e, pe, Ht, !1)),
          Ha(e)));
    }
    function t1(e, t, i) {
      if ((ye & 6) !== 0) throw Error(k(327));
      var o = (!i && (t & 127) === 0 && (t & e.expiredLanes) === 0) || yu(e, t),
        l = o ? cv(e, t) : sd(e, t, !0),
        s = o;
      do {
        if (l === 0) {
          tl && !o && Vi(e, t, 0, !1);
          break;
        } else {
          if (((i = e.current.alternate), s && !fv(i))) {
            ((l = sd(e, t, !1)), (s = !1));
            continue;
          }
          if (l === 2) {
            if (((s = t), e.errorRecoveryDisabledLanes & s)) var f = 0;
            else
              ((f = e.pendingLanes & -536870913),
                (f = f !== 0 ? f : f & 536870912 ? 536870912 : 0));
            if (f !== 0) {
              t = f;
              e: {
                var c = e;
                l = tu;
                var g = c.current.memoizedState.isDehydrated;
                if (
                  (g && (Yn(c, f).flags |= 256), (f = sd(c, f, !1)), f !== 2)
                ) {
                  if (Kc && !g) {
                    ((c.errorRecoveryDisabledLanes |= s), (Do |= s), (l = 4));
                    break e;
                  }
                  ((s = Dt),
                    (Dt = l),
                    s !== null &&
                      (Dt === null ? (Dt = s) : Dt.push.apply(Dt, s)));
                }
                l = f;
              }
              if (((s = !1), l !== 2)) continue;
            }
          }
          if (l === 1) {
            (Yn(e, 0), Vi(e, t, 0, !0));
            break;
          }
          e: {
            switch (((o = e), (s = l), s)) {
              case 0:
              case 1:
                throw Error(k(345));
              case 4:
                if ((t & 4194048) !== t) break;
              case 6:
                Vi(o, t, Ht, !Gi);
                break e;
              case 2:
                Dt = null;
                break;
              case 3:
              case 5:
                break;
              default:
                throw Error(k(329));
            }
            if ((t & 62914560) === t && ((l = Zr + 300 - Nt()), 10 < l)) {
              if ((Vi(o, t, Ht, !Gi), Pr(o, 0, !0) !== 0)) break e;
              ((gi = t),
                (o.timeoutHandle = x1(
                  vp.bind(
                    null,
                    o,
                    i,
                    Dt,
                    xr,
                    Kd,
                    t,
                    Ht,
                    Do,
                    Xn,
                    Gi,
                    s,
                    "Throttled",
                    -0,
                    0,
                  ),
                  l,
                )));
              break e;
            }
            vp(o, i, Dt, xr, Kd, t, Ht, Do, Xn, Gi, s, null, -0, 0);
          }
        }
        break;
      } while (!0);
      Ha(e);
    }
    function vp(e, t, i, o, l, s, f, c, g, y, p, _, v, x) {
      if (
        ((e.timeoutHandle = -1),
        (_ = t.subtreeFlags),
        _ & 8192 || (_ & 16785408) === 16785408)
      ) {
        ((_ = {
          stylesheets: null,
          count: 0,
          imgCount: 0,
          imgBytes: 0,
          suspenseyImages: [],
          waitingForImages: !0,
          waitingForViewTransition: !1,
          unsuspend: ci,
        }),
          Yg(t, s, _));
        var B =
          (s & 62914560) === s
            ? Zr - Nt()
            : (s & 4194048) === s
              ? Jg - Nt()
              : 0;
        if (((B = Xv(_, B)), B !== null)) {
          ((gi = s),
            (e.cancelPendingCommit = B(
              xp.bind(null, e, t, s, i, o, l, f, c, g, p, _, null, v, x),
            )),
            Vi(e, s, f, !y));
          return;
        }
      }
      xp(e, t, s, i, o, l, f, c, g);
    }
    function fv(e) {
      for (var t = e; ;) {
        var i = t.tag;
        if (
          (i === 0 || i === 11 || i === 15) &&
          t.flags & 16384 &&
          ((i = t.updateQueue), i !== null && ((i = i.stores), i !== null))
        )
          for (var o = 0; o < i.length; o++) {
            var l = i[o],
              s = l.getSnapshot;
            l = l.value;
            try {
              if (!Vt(s(), l)) return !1;
            } catch {
              return !1;
            }
          }
        if (((i = t.child), t.subtreeFlags & 16384 && i !== null))
          ((i.return = t), (t = i));
        else {
          if (t === e) break;
          for (; t.sibling === null;) {
            if (t.return === null || t.return === e) return !0;
            t = t.return;
          }
          ((t.sibling.return = t.return), (t = t.sibling));
        }
      }
      return !0;
    }
    function Vi(e, t, i, o) {
      ((t &= ~Qc),
        (t &= ~Do),
        (e.suspendedLanes |= t),
        (e.pingedLanes &= ~t),
        o && (e.warmLanes |= t),
        (o = e.expirationTimes));
      for (var l = t; 0 < l;) {
        var s = 31 - Zt(l),
          f = 1 << s;
        ((o[s] = -1), (l &= ~f));
      }
      i !== 0 && n2(e, i, t);
    }
    function Gr() {
      return (ye & 6) === 0 ? (Mu(0, !1), !1) : !0;
    }
    function Wc() {
      if (ce !== null) {
        if (Se === 0) var e = ce.return;
        else
          ((e = ce), (hi = Ho = null), Rc(e), (En = null), (fu = 0), (e = ce));
        for (; e !== null;) (zg(e.alternate, e), (e = e.return));
        ce = null;
      }
    }
    function Yn(e, t) {
      var i = e.timeoutHandle;
      (i !== -1 && ((e.timeoutHandle = -1), Tv(i)),
        (i = e.cancelPendingCommit),
        i !== null && ((e.cancelPendingCommit = null), i()),
        (gi = 0),
        Wc(),
        (Te = e),
        (ce = i = mi(e.current, null)),
        (pe = t),
        (Se = 0),
        (Et = null),
        (Gi = !1),
        (tl = yu(e, t)),
        (Kc = !1),
        (Xn = Ht = Qc = Do = no = Fe = 0),
        (Dt = tu = null),
        (Kd = !1),
        (t & 8) !== 0 && (t |= t & 32));
      var o = e.entangledLanes;
      if (o !== 0)
        for (e = e.entanglements, o &= t; 0 < o;) {
          var l = 31 - Zt(o),
            s = 1 << l;
          ((t |= e[l]), (o &= ~s));
        }
      return ((xi = t), Rr(), i);
    }
    function a1(e, t) {
      ((le = null),
        (J.H = cu),
        t === el || t === Ur
          ? ((t = Wm()), (Se = 3))
          : t === Ac
            ? ((t = Wm()), (Se = 4))
            : (Se =
                t === Vc
                  ? 8
                  : t !== null &&
                      typeof t == "object" &&
                      typeof t.then == "function"
                    ? 6
                    : 1),
        (Et = t),
        ce === null && ((Fe = 1), Lr(e, la(t, e.current))));
    }
    function i1() {
      var e = Xt.current;
      return e === null
        ? !0
        : (pe & 4194048) === pe
          ? sa === null
          : (pe & 62914560) === pe || (pe & 536870912) !== 0
            ? e === sa
            : !1;
    }
    function o1() {
      var e = J.H;
      return ((J.H = cu), e === null ? cu : e);
    }
    function n1() {
      var e = J.A;
      return ((J.A = sv), e);
    }
    function Sr() {
      ((Fe = 4),
        Gi || ((pe & 4194048) !== pe && Xt.current !== null) || (tl = !0),
        ((no & 134217727) === 0 && (Do & 134217727) === 0) ||
          Te === null ||
          Vi(Te, pe, Ht, !1));
    }
    function sd(e, t, i) {
      var o = ye;
      ye |= 2;
      var l = o1(),
        s = n1();
      ((Te !== e || pe !== t) && ((xr = null), Yn(e, t)), (t = !1));
      var f = Fe;
      e: do
        try {
          if (Se !== 0 && ce !== null) {
            var c = ce,
              g = Et;
            switch (Se) {
              case 8:
                (Wc(), (f = 6));
                break e;
              case 3:
              case 2:
              case 9:
              case 6:
                Xt.current === null && (t = !0);
                var y = Se;
                if (((Se = 0), (Et = null), Pn(e, c, g, y), i && tl)) {
                  f = 0;
                  break e;
                }
                break;
              default:
                ((y = Se), (Se = 0), (Et = null), Pn(e, c, g, y));
            }
          }
          (dv(), (f = Fe));
          break;
        } catch (p) {
          a1(e, p);
        }
      while (!0);
      return (
        t && e.shellSuspendCounter++,
        (hi = Ho = null),
        (ye = o),
        (J.H = l),
        (J.A = s),
        ce === null && ((Te = null), (pe = 0), Rr()),
        f
      );
    }
    function dv() {
      for (; ce !== null;) l1(ce);
    }
    function cv(e, t) {
      var i = ye;
      ye |= 2;
      var o = o1(),
        l = n1();
      Te !== e || pe !== t
        ? ((xr = null), (yr = Nt() + 500), Yn(e, t))
        : (tl = yu(e, t));
      e: do
        try {
          if (Se !== 0 && ce !== null) {
            t = ce;
            var s = Et;
            t: switch (Se) {
              case 1:
                ((Se = 0), (Et = null), Pn(e, t, s, 1));
                break;
              case 2:
              case 9:
                if (Qm(s)) {
                  ((Se = 0), (Et = null), yp(t));
                  break;
                }
                ((t = function () {
                  ((Se !== 2 && Se !== 9) || Te !== e || (Se = 7), Ha(e));
                }),
                  s.then(t, t));
                break e;
              case 3:
                Se = 7;
                break e;
              case 4:
                Se = 5;
                break e;
              case 7:
                Qm(s)
                  ? ((Se = 0), (Et = null), yp(t))
                  : ((Se = 0), (Et = null), Pn(e, t, s, 7));
                break;
              case 5:
                var f = null;
                switch (ce.tag) {
                  case 26:
                    f = ce.memoizedState;
                  case 5:
                  case 27:
                    var c = ce;
                    if (f ? w1(f) : c.stateNode.complete) {
                      ((Se = 0), (Et = null));
                      var g = c.sibling;
                      if (g !== null) ce = g;
                      else {
                        var y = c.return;
                        y !== null ? ((ce = y), Vr(y)) : (ce = null);
                      }
                      break t;
                    }
                }
                ((Se = 0), (Et = null), Pn(e, t, s, 5));
                break;
              case 6:
                ((Se = 0), (Et = null), Pn(e, t, s, 6));
                break;
              case 8:
                (Wc(), (Fe = 6));
                break e;
              default:
                throw Error(k(462));
            }
          }
          hv();
          break;
        } catch (p) {
          a1(e, p);
        }
      while (!0);
      return (
        (hi = Ho = null),
        (J.H = o),
        (J.A = l),
        (ye = i),
        ce !== null ? 0 : ((Te = null), (pe = 0), Rr(), Fe)
      );
    }
    function hv() {
      for (; ce !== null && !R_();) l1(ce);
    }
    function l1(e) {
      var t = kg(e.alternate, e, xi);
      ((e.memoizedProps = e.pendingProps), t === null ? Vr(e) : (ce = t));
    }
    function yp(e) {
      var t = e,
        i = t.alternate;
      switch (t.tag) {
        case 15:
        case 0:
          t = hp(i, t, t.pendingProps, t.type, void 0, pe);
          break;
        case 11:
          t = hp(i, t, t.pendingProps, t.type.render, t.ref, pe);
          break;
        case 5:
          Rc(t);
        default:
          (zg(i, t), (t = ce = z2(t, xi)), (t = kg(i, t, xi)));
      }
      ((e.memoizedProps = e.pendingProps), t === null ? Vr(e) : (ce = t));
    }
    function Pn(e, t, i, o) {
      ((hi = Ho = null), Rc(t), (En = null), (fu = 0));
      var l = t.return;
      try {
        if (tv(e, l, t, i, pe)) {
          ((Fe = 1), Lr(e, la(i, e.current)), (ce = null));
          return;
        }
      } catch (s) {
        if (l !== null) throw ((ce = l), s);
        ((Fe = 1), Lr(e, la(i, e.current)), (ce = null));
        return;
      }
      t.flags & 32768
        ? (ge || o === 1
            ? (e = !0)
            : tl || (pe & 536870912) !== 0
              ? (e = !1)
              : ((Gi = e = !0),
                (o === 2 || o === 9 || o === 3 || o === 6) &&
                  ((o = Xt.current),
                  o !== null && o.tag === 13 && (o.flags |= 16384))),
          u1(t, e))
        : Vr(t);
    }
    function Vr(e) {
      var t = e;
      do {
        if ((t.flags & 32768) !== 0) {
          u1(t, Gi);
          return;
        }
        e = t.return;
        var i = ov(t.alternate, t, xi);
        if (i !== null) {
          ce = i;
          return;
        }
        if (((t = t.sibling), t !== null)) {
          ce = t;
          return;
        }
        ce = t = e;
      } while (t !== null);
      Fe === 0 && (Fe = 5);
    }
    function u1(e, t) {
      do {
        var i = nv(e.alternate, e);
        if (i !== null) {
          ((i.flags &= 32767), (ce = i));
          return;
        }
        if (
          ((i = e.return),
          i !== null &&
            ((i.flags |= 32768), (i.subtreeFlags = 0), (i.deletions = null)),
          !t && ((e = e.sibling), e !== null))
        ) {
          ce = e;
          return;
        }
        ce = e = i;
      } while (e !== null);
      ((Fe = 6), (ce = null));
    }
    function xp(e, t, i, o, l, s, f, c, g) {
      e.cancelPendingCommit = null;
      do Xr();
      while (tt !== 0);
      if ((ye & 6) !== 0) throw Error(k(327));
      if (t !== null) {
        if (t === e.current) throw Error(k(177));
        if (
          ((s = t.lanes | t.childLanes),
          (s |= Sc),
          X_(e, i, s, f, c, g),
          e === Te && ((ce = Te = null), (pe = 0)),
          (jn = t),
          (Ji = e),
          (gi = i),
          (Qd = s),
          (Wd = l),
          ($g = o),
          (t.subtreeFlags & 10256) !== 0 || (t.flags & 10256) !== 0
            ? ((e.callbackNode = null),
              (e.callbackPriority = 0),
              Lv(lr, function () {
                return (c1(), null);
              }))
            : ((e.callbackNode = null), (e.callbackPriority = 0)),
          (o = (t.flags & 13878) !== 0),
          (t.subtreeFlags & 13878) !== 0 || o)
        ) {
          ((o = J.T),
            (J.T = null),
            (l = xe.p),
            (xe.p = 2),
            (f = ye),
            (ye |= 4));
          try {
            lv(e, t, i);
          } finally {
            ((ye = f), (xe.p = l), (J.T = o));
          }
        }
        ((tt = 1), s1(), r1(), f1());
      }
    }
    function s1() {
      if (tt === 1) {
        tt = 0;
        var e = Ji,
          t = jn,
          i = (t.flags & 13878) !== 0;
        if ((t.subtreeFlags & 13878) !== 0 || i) {
          ((i = J.T), (J.T = null));
          var o = xe.p;
          xe.p = 2;
          var l = ye;
          ye |= 4;
          try {
            Vg(t, e);
            var s = ac,
              f = w2(e.containerInfo),
              c = s.focusedElem,
              g = s.selectionRange;
            if (
              f !== c &&
              c &&
              c.ownerDocument &&
              b2(c.ownerDocument.documentElement, c)
            ) {
              if (g !== null && xc(c)) {
                var y = g.start,
                  p = g.end;
                if ((p === void 0 && (p = y), "selectionStart" in c))
                  ((c.selectionStart = y),
                    (c.selectionEnd = Math.min(p, c.value.length)));
                else {
                  var _ = c.ownerDocument || document,
                    v = (_ && _.defaultView) || window;
                  if (v.getSelection) {
                    var x = v.getSelection(),
                      B = c.textContent.length,
                      P = Math.min(g.start, B),
                      Z = g.end === void 0 ? P : Math.min(g.end, B);
                    !x.extend && P > Z && ((f = Z), (Z = P), (P = f));
                    var b = Zm(c, P),
                      C = Zm(c, Z);
                    if (
                      b &&
                      C &&
                      (x.rangeCount !== 1 ||
                        x.anchorNode !== b.node ||
                        x.anchorOffset !== b.offset ||
                        x.focusNode !== C.node ||
                        x.focusOffset !== C.offset)
                    ) {
                      var w = _.createRange();
                      (w.setStart(b.node, b.offset),
                        x.removeAllRanges(),
                        P > Z
                          ? (x.addRange(w), x.extend(C.node, C.offset))
                          : (w.setEnd(C.node, C.offset), x.addRange(w)));
                    }
                  }
                }
              }
              for (_ = [], x = c; (x = x.parentNode);)
                x.nodeType === 1 &&
                  _.push({ element: x, left: x.scrollLeft, top: x.scrollTop });
              for (
                typeof c.focus == "function" && c.focus(), c = 0;
                c < _.length;
                c++
              ) {
                var T = _[c];
                ((T.element.scrollLeft = T.left),
                  (T.element.scrollTop = T.top));
              }
            }
            ((Dr = !!tc), (ac = tc = null));
          } finally {
            ((ye = l), (xe.p = o), (J.T = i));
          }
        }
        ((e.current = t), (tt = 2));
      }
    }
    function r1() {
      if (tt === 2) {
        tt = 0;
        var e = Ji,
          t = jn,
          i = (t.flags & 8772) !== 0;
        if ((t.subtreeFlags & 8772) !== 0 || i) {
          ((i = J.T), (J.T = null));
          var o = xe.p;
          xe.p = 2;
          var l = ye;
          ye |= 4;
          try {
            Hg(e, t.alternate, t);
          } finally {
            ((ye = l), (xe.p = o), (J.T = i));
          }
        }
        tt = 3;
      }
    }
    function f1() {
      if (tt === 4 || tt === 3) {
        ((tt = 0), E_());
        var e = Ji,
          t = jn,
          i = gi,
          o = $g;
        (t.subtreeFlags & 10256) !== 0 || (t.flags & 10256) !== 0
          ? (tt = 5)
          : ((tt = 0), (jn = Ji = null), d1(e, e.pendingLanes));
        var l = e.pendingLanes;
        if (
          (l === 0 && (Wi = null),
          mc(i),
          (t = t.stateNode),
          Ft && typeof Ft.onCommitFiberRoot == "function")
        )
          try {
            Ft.onCommitFiberRoot(
              vu,
              t,
              void 0,
              (t.current.flags & 128) === 128,
            );
          } catch {}
        if (o !== null) {
          ((t = J.T), (l = xe.p), (xe.p = 2), (J.T = null));
          try {
            for (var s = e.onRecoverableError, f = 0; f < o.length; f++) {
              var c = o[f];
              s(c.value, { componentStack: c.stack });
            }
          } finally {
            ((J.T = t), (xe.p = l));
          }
        }
        ((gi & 3) !== 0 && Xr(),
          Ha(e),
          (l = e.pendingLanes),
          (i & 261930) !== 0 && (l & 42) !== 0
            ? e === Jd
              ? au++
              : ((au = 0), (Jd = e))
            : (au = 0),
          Mu(0, !1));
      }
    }
    function d1(e, t) {
      (e.pooledCacheLanes &= t) === 0 &&
        ((t = e.pooledCache), t != null && ((e.pooledCache = null), Iu(t)));
    }
    function Xr() {
      return (s1(), r1(), f1(), c1());
    }
    function c1() {
      if (tt !== 5) return !1;
      var e = Ji,
        t = Qd;
      Qd = 0;
      var i = mc(gi),
        o = J.T,
        l = xe.p;
      try {
        ((xe.p = 32 > i ? 32 : i), (J.T = null), (i = Wd), (Wd = null));
        var s = Ji,
          f = gi;
        if (((tt = 0), (jn = Ji = null), (gi = 0), (ye & 6) !== 0))
          throw Error(k(331));
        var c = ye;
        if (
          ((ye |= 4),
          Qg(s.current),
          jg(s, s.current, f, i),
          (ye = c),
          Mu(0, !1),
          Ft && typeof Ft.onPostCommitFiberRoot == "function")
        )
          try {
            Ft.onPostCommitFiberRoot(vu, s);
          } catch {}
        return !0;
      } finally {
        ((xe.p = l), (J.T = o), d1(e, t));
      }
    }
    function Sp(e, t, i) {
      ((t = la(i, t)),
        (t = Vd(e.stateNode, t, 2)),
        (e = Qi(e, t, 2)),
        e !== null && (xu(e, 2), Ha(e)));
    }
    function Ce(e, t, i) {
      if (e.tag === 3) Sp(e, e, i);
      else
        for (; t !== null;) {
          if (t.tag === 3) {
            Sp(t, e, i);
            break;
          } else if (t.tag === 1) {
            var o = t.stateNode;
            if (
              typeof t.type.getDerivedStateFromError == "function" ||
              (typeof o.componentDidCatch == "function" &&
                (Wi === null || !Wi.has(o)))
            ) {
              ((e = la(i, e)),
                (i = Mg(2)),
                (o = Qi(t, i, 2)),
                o !== null && (Tg(i, o, t, e), xu(o, 2), Ha(o)));
              break;
            }
          }
          t = t.return;
        }
    }
    function rd(e, t, i) {
      var o = e.pingCache;
      if (o === null) {
        o = e.pingCache = new rv();
        var l = new Set();
        o.set(t, l);
      } else ((l = o.get(t)), l === void 0 && ((l = new Set()), o.set(t, l)));
      l.has(i) ||
        ((Kc = !0), l.add(i), (e = mv.bind(null, e, t, i)), t.then(e, e));
    }
    function mv(e, t, i) {
      var o = e.pingCache;
      (o !== null && o.delete(t),
        (e.pingedLanes |= e.suspendedLanes & i),
        (e.warmLanes &= ~i),
        Te === e &&
          (pe & i) === i &&
          (Fe === 4 || (Fe === 3 && (pe & 62914560) === pe && 300 > Nt() - Zr)
            ? (ye & 2) === 0 && Yn(e, 0)
            : (Qc |= i),
          Xn === pe && (Xn = 0)),
        Ha(e));
    }
    function h1(e, t) {
      (t === 0 && (t = o2()), (e = qo(e, t)), e !== null && (xu(e, t), Ha(e)));
    }
    function pv(e) {
      var t = e.memoizedState,
        i = 0;
      (t !== null && (i = t.retryLane), h1(e, i));
    }
    function gv(e, t) {
      var i = 0;
      switch (e.tag) {
        case 31:
        case 13:
          var o = e.stateNode,
            l = e.memoizedState;
          l !== null && (i = l.retryLane);
          break;
        case 19:
          o = e.stateNode;
          break;
        case 22:
          o = e.stateNode._retryCache;
          break;
        default:
          throw Error(k(314));
      }
      (o !== null && o.delete(t), h1(e, i));
    }
    function Lv(e, t) {
      return cc(e, t);
    }
    var Cr = null,
      yn = null,
      $d = !1,
      Ir = !1,
      fd = !1,
      Xi = 0;
    function Ha(e) {
      (e !== yn &&
        e.next === null &&
        (yn === null ? (Cr = yn = e) : (yn = yn.next = e)),
        (Ir = !0),
        $d || (($d = !0), vv()));
    }
    function Mu(e, t) {
      if (!fd && Ir) {
        fd = !0;
        do
          for (var i = !1, o = Cr; o !== null;) {
            if (!t)
              if (e !== 0) {
                var l = o.pendingLanes;
                if (l === 0) var s = 0;
                else {
                  var f = o.suspendedLanes,
                    c = o.pingedLanes;
                  ((s = (1 << (31 - Zt(42 | e) + 1)) - 1),
                    (s &= l & ~(f & ~c)),
                    (s = s & 201326741 ? (s & 201326741) | 1 : s ? s | 2 : 0));
                }
                s !== 0 && ((i = !0), Cp(o, s));
              } else
                ((s = pe),
                  (s = Pr(
                    o,
                    o === Te ? s : 0,
                    o.cancelPendingCommit !== null || o.timeoutHandle !== -1,
                  )),
                  (s & 3) === 0 || yu(o, s) || ((i = !0), Cp(o, s)));
            o = o.next;
          }
        while (i);
        fd = !1;
      }
    }
    function _v() {
      m1();
    }
    function m1() {
      Ir = $d = !1;
      var e = 0;
      Xi !== 0 && Mv() && (e = Xi);
      for (var t = Nt(), i = null, o = Cr; o !== null;) {
        var l = o.next,
          s = p1(o, t);
        (s === 0
          ? ((o.next = null),
            i === null ? (Cr = l) : (i.next = l),
            l === null && (yn = i))
          : ((i = o), (e !== 0 || (s & 3) !== 0) && (Ir = !0)),
          (o = l));
      }
      ((tt !== 0 && tt !== 5) || Mu(e, !1), Xi !== 0 && (Xi = 0));
    }
    function p1(e, t) {
      for (
        var i = e.suspendedLanes,
          o = e.pingedLanes,
          l = e.expirationTimes,
          s = e.pendingLanes & -62914561;
        0 < s;
      ) {
        var f = 31 - Zt(s),
          c = 1 << f,
          g = l[f];
        (g === -1
          ? ((c & i) === 0 || (c & o) !== 0) && (l[f] = V_(c, t))
          : g <= t && (e.expiredLanes |= c),
          (s &= ~c));
      }
      if (
        ((t = Te),
        (i = pe),
        (i = Pr(
          e,
          e === t ? i : 0,
          e.cancelPendingCommit !== null || e.timeoutHandle !== -1,
        )),
        (o = e.callbackNode),
        i === 0 ||
          (e === t && (Se === 2 || Se === 9)) ||
          e.cancelPendingCommit !== null)
      )
        return (
          o !== null && o !== null && qf(o),
          (e.callbackNode = null),
          (e.callbackPriority = 0)
        );
      if ((i & 3) === 0 || yu(e, i)) {
        if (((t = i & -i), t === e.callbackPriority)) return t;
        switch ((o !== null && qf(o), mc(i))) {
          case 2:
          case 8:
            i = a2;
            break;
          case 32:
            i = lr;
            break;
          case 268435456:
            i = i2;
            break;
          default:
            i = lr;
        }
        return (
          (o = g1.bind(null, e)),
          (i = cc(i, o)),
          (e.callbackPriority = t),
          (e.callbackNode = i),
          t
        );
      }
      return (
        o !== null && o !== null && qf(o),
        (e.callbackPriority = 2),
        (e.callbackNode = null),
        2
      );
    }
    function g1(e, t) {
      if (tt !== 0 && tt !== 5)
        return ((e.callbackNode = null), (e.callbackPriority = 0), null);
      var i = e.callbackNode;
      if (Xr() && e.callbackNode !== i) return null;
      var o = pe;
      return (
        (o = Pr(
          e,
          e === Te ? o : 0,
          e.cancelPendingCommit !== null || e.timeoutHandle !== -1,
        )),
        o === 0
          ? null
          : (t1(e, o, t),
            p1(e, Nt()),
            e.callbackNode != null && e.callbackNode === i
              ? g1.bind(null, e)
              : null)
      );
    }
    function Cp(e, t) {
      if (Xr()) return null;
      t1(e, t, !0);
    }
    function vv() {
      Av(function () {
        (ye & 6) !== 0 ? cc(t2, _v) : m1();
      });
    }
    function Jc() {
      if (Xi === 0) {
        var e = Zn;
        (e === 0 && ((e = bs), (bs <<= 1), (bs & 261888) === 0 && (bs = 256)),
          (Xi = e));
      }
      return Xi;
    }
    function Ip(e) {
      return e == null || typeof e == "symbol" || typeof e == "boolean"
        ? null
        : typeof e == "function"
          ? e
          : Zs("" + e);
    }
    function bp(e, t) {
      var i = t.ownerDocument.createElement("input");
      return (
        (i.name = t.name),
        (i.value = t.value),
        e.id && i.setAttribute("form", e.id),
        t.parentNode.insertBefore(i, t),
        (e = new FormData(e)),
        i.parentNode.removeChild(i),
        e
      );
    }
    function yv(e, t, i, o, l) {
      if (t === "submit" && i && i.stateNode === l) {
        var s = Ip((l[Pt] || null).action),
          f = o.submitter;
        f &&
          ((t = (t = f[Pt] || null)
            ? Ip(t.formAction)
            : f.getAttribute("formAction")),
          t !== null && ((s = t), (f = null)));
        var c = new kr("action", "action", null, o, l);
        e.push({
          event: c,
          listeners: [
            {
              instance: null,
              listener: function () {
                if (o.defaultPrevented) {
                  if (Xi !== 0) {
                    var g = f ? bp(l, f) : new FormData(l);
                    Zd(
                      i,
                      { pending: !0, data: g, method: l.method, action: s },
                      null,
                      g,
                    );
                  }
                } else
                  typeof s == "function" &&
                    (c.preventDefault(),
                    (g = f ? bp(l, f) : new FormData(l)),
                    Zd(
                      i,
                      { pending: !0, data: g, method: l.method, action: s },
                      s,
                      g,
                    ));
              },
              currentTarget: l,
            },
          ],
        });
      }
    }
    for (Es = 0; Es < Bd.length; Es++)
      ((Us = Bd[Es]),
        (wp = Us.toLowerCase()),
        (Mp = Us[0].toUpperCase() + Us.slice(1)),
        Sa(wp, "on" + Mp));
    var Us, wp, Mp, Es;
    Sa(T2, "onAnimationEnd");
    Sa(A2, "onAnimationIteration");
    Sa(D2, "onAnimationStart");
    Sa("dblclick", "onDoubleClick");
    Sa("focusin", "onFocus");
    Sa("focusout", "onBlur");
    Sa(U0, "onTransitionRun");
    Sa(q0, "onTransitionStart");
    Sa(H0, "onTransitionCancel");
    Sa(B2, "onTransitionEnd");
    Nn("onMouseEnter", ["mouseout", "mouseover"]);
    Nn("onMouseLeave", ["mouseout", "mouseover"]);
    Nn("onPointerEnter", ["pointerout", "pointerover"]);
    Nn("onPointerLeave", ["pointerout", "pointerover"]);
    Ro(
      "onChange",
      "change click focusin focusout input keydown keyup selectionchange".split(
        " ",
      ),
    );
    Ro(
      "onSelect",
      "focusout contextmenu dragend focusin keydown keyup mousedown mouseup selectionchange".split(
        " ",
      ),
    );
    Ro("onBeforeInput", ["compositionend", "keypress", "textInput", "paste"]);
    Ro(
      "onCompositionEnd",
      "compositionend focusout keydown keypress keyup mousedown".split(" "),
    );
    Ro(
      "onCompositionStart",
      "compositionstart focusout keydown keypress keyup mousedown".split(" "),
    );
    Ro(
      "onCompositionUpdate",
      "compositionupdate focusout keydown keypress keyup mousedown".split(" "),
    );
    var hu =
        "abort canplay canplaythrough durationchange emptied encrypted ended error loadeddata loadedmetadata loadstart pause play playing progress ratechange resize seeked seeking stalled suspend timeupdate volumechange waiting".split(
          " ",
        ),
      xv = new Set(
        "beforetoggle cancel close invalid load scroll scrollend toggle"
          .split(" ")
          .concat(hu),
      );
    function L1(e, t) {
      t = (t & 4) !== 0;
      for (var i = 0; i < e.length; i++) {
        var o = e[i],
          l = o.event;
        o = o.listeners;
        e: {
          var s = void 0;
          if (t)
            for (var f = o.length - 1; 0 <= f; f--) {
              var c = o[f],
                g = c.instance,
                y = c.currentTarget;
              if (((c = c.listener), g !== s && l.isPropagationStopped()))
                break e;
              ((s = c), (l.currentTarget = y));
              try {
                s(l);
              } catch (p) {
                sr(p);
              }
              ((l.currentTarget = null), (s = g));
            }
          else
            for (f = 0; f < o.length; f++) {
              if (
                ((c = o[f]),
                (g = c.instance),
                (y = c.currentTarget),
                (c = c.listener),
                g !== s && l.isPropagationStopped())
              )
                break e;
              ((s = c), (l.currentTarget = y));
              try {
                s(l);
              } catch (p) {
                sr(p);
              }
              ((l.currentTarget = null), (s = g));
            }
        }
      }
    }
    function de(e, t) {
      var i = t[Cd];
      i === void 0 && (i = t[Cd] = new Set());
      var o = e + "__bubble";
      i.has(o) || (_1(t, e, 2, !1), i.add(o));
    }
    function dd(e, t, i) {
      var o = 0;
      (t && (o |= 4), _1(i, e, o, t));
    }
    var qs = "_reactListening" + Math.random().toString(36).slice(2);
    function $c(e) {
      if (!e[qs]) {
        ((e[qs] = !0),
          r2.forEach(function (i) {
            i !== "selectionchange" &&
              (xv.has(i) || dd(i, !1, e), dd(i, !0, e));
          }));
        var t = e.nodeType === 9 ? e : e.ownerDocument;
        t === null || t[qs] || ((t[qs] = !0), dd("selectionchange", !1, t));
      }
    }
    function _1(e, t, i, o) {
      switch (B1(t)) {
        case 2:
          var l = Kv;
          break;
        case 8:
          l = Qv;
          break;
        default:
          l = ih;
      }
      ((i = l.bind(null, t, i, e)),
        (l = void 0),
        !Td ||
          (t !== "touchstart" && t !== "touchmove" && t !== "wheel") ||
          (l = !0),
        o
          ? l !== void 0
            ? e.addEventListener(t, i, { capture: !0, passive: l })
            : e.addEventListener(t, i, !0)
          : l !== void 0
            ? e.addEventListener(t, i, { passive: l })
            : e.addEventListener(t, i, !1));
    }
    function cd(e, t, i, o, l) {
      var s = o;
      if ((t & 1) === 0 && (t & 2) === 0 && o !== null)
        e: for (;;) {
          if (o === null) return;
          var f = o.tag;
          if (f === 3 || f === 4) {
            var c = o.stateNode.containerInfo;
            if (c === l) break;
            if (f === 4)
              for (f = o.return; f !== null;) {
                var g = f.tag;
                if ((g === 3 || g === 4) && f.stateNode.containerInfo === l)
                  return;
                f = f.return;
              }
            for (; c !== null;) {
              if (((f = Cn(c)), f === null)) return;
              if (((g = f.tag), g === 5 || g === 6 || g === 26 || g === 27)) {
                o = s = f;
                continue e;
              }
              c = c.parentNode;
            }
          }
          o = o.return;
        }
      L2(function () {
        var y = s,
          p = Lc(i),
          _ = [];
        e: {
          var v = P2.get(e);
          if (v !== void 0) {
            var x = kr,
              B = e;
            switch (e) {
              case "keypress":
                if (Vs(i) === 0) break e;
              case "keydown":
              case "keyup":
                x = g0;
                break;
              case "focusin":
                ((B = "focus"), (x = Gf));
                break;
              case "focusout":
                ((B = "blur"), (x = Gf));
                break;
              case "beforeblur":
              case "afterblur":
                x = Gf;
                break;
              case "click":
                if (i.button === 2) break e;
              case "auxclick":
              case "dblclick":
              case "mousedown":
              case "mousemove":
              case "mouseup":
              case "mouseout":
              case "mouseover":
              case "contextmenu":
                x = zm;
                break;
              case "drag":
              case "dragend":
              case "dragenter":
              case "dragexit":
              case "dragleave":
              case "dragover":
              case "dragstart":
              case "drop":
                x = o0;
                break;
              case "touchcancel":
              case "touchend":
              case "touchmove":
              case "touchstart":
                x = v0;
                break;
              case T2:
              case A2:
              case D2:
                x = u0;
                break;
              case B2:
                x = x0;
                break;
              case "scroll":
              case "scrollend":
                x = a0;
                break;
              case "wheel":
                x = C0;
                break;
              case "copy":
              case "cut":
              case "paste":
                x = r0;
                break;
              case "gotpointercapture":
              case "lostpointercapture":
              case "pointercancel":
              case "pointerdown":
              case "pointermove":
              case "pointerout":
              case "pointerover":
              case "pointerup":
                x = Rm;
                break;
              case "toggle":
              case "beforetoggle":
                x = b0;
            }
            var P = (t & 4) !== 0,
              Z = !P && (e === "scroll" || e === "scrollend"),
              b = P ? (v !== null ? v + "Capture" : null) : v;
            P = [];
            for (var C = y, w; C !== null;) {
              var T = C;
              if (
                ((w = T.stateNode),
                (T = T.tag),
                (T !== 5 && T !== 26 && T !== 27) ||
                  w === null ||
                  b === null ||
                  ((T = nu(C, b)), T != null && P.push(mu(C, T, w))),
                Z)
              )
                break;
              C = C.return;
            }
            0 < P.length &&
              ((v = new x(v, B, null, i, p)),
              _.push({ event: v, listeners: P }));
          }
        }
        if ((t & 7) === 0) {
          e: {
            if (
              ((v = e === "mouseover" || e === "pointerover"),
              (x = e === "mouseout" || e === "pointerout"),
              v &&
                i !== Md &&
                (B = i.relatedTarget || i.fromElement) &&
                (Cn(B) || B[Wn]))
            )
              break e;
            if (
              (x || v) &&
              ((v =
                p.window === p
                  ? p
                  : (v = p.ownerDocument)
                    ? v.defaultView || v.parentWindow
                    : window),
              x
                ? ((B = i.relatedTarget || i.toElement),
                  (x = y),
                  (B = B ? Cn(B) : null),
                  B !== null &&
                    ((Z = _u(B)),
                    (P = B.tag),
                    B !== Z || (P !== 5 && P !== 27 && P !== 6)) &&
                    (B = null))
                : ((x = null), (B = y)),
              x !== B)
            ) {
              if (
                ((P = zm),
                (T = "onMouseLeave"),
                (b = "onMouseEnter"),
                (C = "mouse"),
                (e === "pointerout" || e === "pointerover") &&
                  ((P = Rm),
                  (T = "onPointerLeave"),
                  (b = "onPointerEnter"),
                  (C = "pointer")),
                (Z = x == null ? v : Fl(x)),
                (w = B == null ? v : Fl(B)),
                (v = new P(T, C + "leave", x, i, p)),
                (v.target = Z),
                (v.relatedTarget = w),
                (T = null),
                Cn(p) === y &&
                  ((P = new P(b, C + "enter", B, i, p)),
                  (P.target = w),
                  (P.relatedTarget = Z),
                  (T = P)),
                (Z = T),
                x && B)
              )
                t: {
                  for (P = Sv, b = x, C = B, w = 0, T = b; T; T = P(T)) w++;
                  T = 0;
                  for (var z = C; z; z = P(z)) T++;
                  for (; 0 < w - T;) ((b = P(b)), w--);
                  for (; 0 < T - w;) ((C = P(C)), T--);
                  for (; w--;) {
                    if (b === C || (C !== null && b === C.alternate)) {
                      P = b;
                      break t;
                    }
                    ((b = P(b)), (C = P(C)));
                  }
                  P = null;
                }
              else P = null;
              (x !== null && Tp(_, v, x, P, !1),
                B !== null && Z !== null && Tp(_, Z, B, P, !0));
            }
          }
          e: {
            if (
              ((v = y ? Fl(y) : window),
              (x = v.nodeName && v.nodeName.toLowerCase()),
              x === "select" || (x === "input" && v.type === "file"))
            )
              var ue = Hm;
            else if (qm(v))
              if (C2) ue = O0;
              else {
                ue = k0;
                var F = P0;
              }
            else
              ((x = v.nodeName),
                !x ||
                x.toLowerCase() !== "input" ||
                (v.type !== "checkbox" && v.type !== "radio")
                  ? y && gc(y.elementType) && (ue = Hm)
                  : (ue = z0));
            if (ue && (ue = ue(e, y))) {
              S2(_, ue, i, p);
              break e;
            }
            (F && F(e, v, y),
              e === "focusout" &&
                y &&
                v.type === "number" &&
                y.memoizedProps.value != null &&
                wd(v, "number", v.value));
          }
          switch (((F = y ? Fl(y) : window), e)) {
            case "focusin":
              (qm(F) || F.contentEditable === "true") &&
                ((wn = F), (Ad = y), (jl = null));
              break;
            case "focusout":
              jl = Ad = wn = null;
              break;
            case "mousedown":
              Dd = !0;
              break;
            case "contextmenu":
            case "mouseup":
            case "dragend":
              ((Dd = !1), Gm(_, i, p));
              break;
            case "selectionchange":
              if (E0) break;
            case "keydown":
            case "keyup":
              Gm(_, i, p);
          }
          var j;
          if (yc)
            e: {
              switch (e) {
                case "compositionstart":
                  var V = "onCompositionStart";
                  break e;
                case "compositionend":
                  V = "onCompositionEnd";
                  break e;
                case "compositionupdate":
                  V = "onCompositionUpdate";
                  break e;
              }
              V = void 0;
            }
          else
            bn
              ? y2(e, i) && (V = "onCompositionEnd")
              : e === "keydown" &&
                i.keyCode === 229 &&
                (V = "onCompositionStart");
          (V &&
            (v2 &&
              i.locale !== "ko" &&
              (bn || V !== "onCompositionStart"
                ? V === "onCompositionEnd" && bn && (j = _2())
                : ((Zi = p),
                  (_c = "value" in Zi ? Zi.value : Zi.textContent),
                  (bn = !0))),
            (F = br(y, V)),
            0 < F.length &&
              ((V = new Om(V, e, null, i, p)),
              _.push({ event: V, listeners: F }),
              j ? (V.data = j) : ((j = x2(i)), j !== null && (V.data = j)))),
            (j = M0 ? T0(e, i) : A0(e, i)) &&
              ((V = br(y, "onBeforeInput")),
              0 < V.length &&
                ((F = new Om("onBeforeInput", "beforeinput", null, i, p)),
                _.push({ event: F, listeners: V }),
                (F.data = j))),
            yv(_, e, y, i, p));
        }
        L1(_, t);
      });
    }
    function mu(e, t, i) {
      return { instance: e, listener: t, currentTarget: i };
    }
    function br(e, t) {
      for (var i = t + "Capture", o = []; e !== null;) {
        var l = e,
          s = l.stateNode;
        if (
          ((l = l.tag),
          (l !== 5 && l !== 26 && l !== 27) ||
            s === null ||
            ((l = nu(e, i)),
            l != null && o.unshift(mu(e, l, s)),
            (l = nu(e, t)),
            l != null && o.push(mu(e, l, s))),
          e.tag === 3)
        )
          return o;
        e = e.return;
      }
      return [];
    }
    function Sv(e) {
      if (e === null) return null;
      do e = e.return;
      while (e && e.tag !== 5 && e.tag !== 27);
      return e || null;
    }
    function Tp(e, t, i, o, l) {
      for (var s = t._reactName, f = []; i !== null && i !== o;) {
        var c = i,
          g = c.alternate,
          y = c.stateNode;
        if (((c = c.tag), g !== null && g === o)) break;
        ((c !== 5 && c !== 26 && c !== 27) ||
          y === null ||
          ((g = y),
          l
            ? ((y = nu(i, s)), y != null && f.unshift(mu(i, y, g)))
            : l || ((y = nu(i, s)), y != null && f.push(mu(i, y, g)))),
          (i = i.return));
      }
      f.length !== 0 && e.push({ event: t, listeners: f });
    }
    var Cv = /\r\n?/g,
      Iv = /\u0000|\uFFFD/g;
    function Ap(e) {
      return (typeof e == "string" ? e : "" + e)
        .replace(
          Cv,
          `
`,
        )
        .replace(Iv, "");
    }
    function v1(e, t) {
      return ((t = Ap(t)), Ap(e) === t);
    }
    function be(e, t, i, o, l, s) {
      switch (i) {
        case "children":
          typeof o == "string"
            ? t === "body" || (t === "textarea" && o === "") || Fn(e, o)
            : (typeof o == "number" || typeof o == "bigint") &&
              t !== "body" &&
              Fn(e, "" + o);
          break;
        case "className":
          Ts(e, "class", o);
          break;
        case "tabIndex":
          Ts(e, "tabindex", o);
          break;
        case "dir":
        case "role":
        case "viewBox":
        case "width":
        case "height":
          Ts(e, i, o);
          break;
        case "style":
          g2(e, o, s);
          break;
        case "data":
          if (t !== "object") {
            Ts(e, "data", o);
            break;
          }
        case "src":
        case "href":
          if (o === "" && (t !== "a" || i !== "href")) {
            e.removeAttribute(i);
            break;
          }
          if (
            o == null ||
            typeof o == "function" ||
            typeof o == "symbol" ||
            typeof o == "boolean"
          ) {
            e.removeAttribute(i);
            break;
          }
          ((o = Zs("" + o)), e.setAttribute(i, o));
          break;
        case "action":
        case "formAction":
          if (typeof o == "function") {
            e.setAttribute(
              i,
              "javascript:throw new Error('A React form was unexpectedly submitted. If you called form.submit() manually, consider using form.requestSubmit() instead. If you\\'re trying to use event.stopPropagation() in a submit event handler, consider also calling event.preventDefault().')",
            );
            break;
          } else
            typeof s == "function" &&
              (i === "formAction"
                ? (t !== "input" && be(e, t, "name", l.name, l, null),
                  be(e, t, "formEncType", l.formEncType, l, null),
                  be(e, t, "formMethod", l.formMethod, l, null),
                  be(e, t, "formTarget", l.formTarget, l, null))
                : (be(e, t, "encType", l.encType, l, null),
                  be(e, t, "method", l.method, l, null),
                  be(e, t, "target", l.target, l, null)));
          if (o == null || typeof o == "symbol" || typeof o == "boolean") {
            e.removeAttribute(i);
            break;
          }
          ((o = Zs("" + o)), e.setAttribute(i, o));
          break;
        case "onClick":
          o != null && (e.onclick = ci);
          break;
        case "onScroll":
          o != null && de("scroll", e);
          break;
        case "onScrollEnd":
          o != null && de("scrollend", e);
          break;
        case "dangerouslySetInnerHTML":
          if (o != null) {
            if (typeof o != "object" || !("__html" in o)) throw Error(k(61));
            if (((i = o.__html), i != null)) {
              if (l.children != null) throw Error(k(60));
              e.innerHTML = i;
            }
          }
          break;
        case "multiple":
          e.multiple = o && typeof o != "function" && typeof o != "symbol";
          break;
        case "muted":
          e.muted = o && typeof o != "function" && typeof o != "symbol";
          break;
        case "suppressContentEditableWarning":
        case "suppressHydrationWarning":
        case "defaultValue":
        case "defaultChecked":
        case "innerHTML":
        case "ref":
          break;
        case "autoFocus":
          break;
        case "xlinkHref":
          if (
            o == null ||
            typeof o == "function" ||
            typeof o == "boolean" ||
            typeof o == "symbol"
          ) {
            e.removeAttribute("xlink:href");
            break;
          }
          ((i = Zs("" + o)),
            e.setAttributeNS("http://www.w3.org/1999/xlink", "xlink:href", i));
          break;
        case "contentEditable":
        case "spellCheck":
        case "draggable":
        case "value":
        case "autoReverse":
        case "externalResourcesRequired":
        case "focusable":
        case "preserveAlpha":
          o != null && typeof o != "function" && typeof o != "symbol"
            ? e.setAttribute(i, "" + o)
            : e.removeAttribute(i);
          break;
        case "inert":
        case "allowFullScreen":
        case "async":
        case "autoPlay":
        case "controls":
        case "default":
        case "defer":
        case "disabled":
        case "disablePictureInPicture":
        case "disableRemotePlayback":
        case "formNoValidate":
        case "hidden":
        case "loop":
        case "noModule":
        case "noValidate":
        case "open":
        case "playsInline":
        case "readOnly":
        case "required":
        case "reversed":
        case "scoped":
        case "seamless":
        case "itemScope":
          o && typeof o != "function" && typeof o != "symbol"
            ? e.setAttribute(i, "")
            : e.removeAttribute(i);
          break;
        case "capture":
        case "download":
          o === !0
            ? e.setAttribute(i, "")
            : o !== !1 &&
                o != null &&
                typeof o != "function" &&
                typeof o != "symbol"
              ? e.setAttribute(i, o)
              : e.removeAttribute(i);
          break;
        case "cols":
        case "rows":
        case "size":
        case "span":
          o != null &&
          typeof o != "function" &&
          typeof o != "symbol" &&
          !isNaN(o) &&
          1 <= o
            ? e.setAttribute(i, o)
            : e.removeAttribute(i);
          break;
        case "rowSpan":
        case "start":
          o == null ||
          typeof o == "function" ||
          typeof o == "symbol" ||
          isNaN(o)
            ? e.removeAttribute(i)
            : e.setAttribute(i, o);
          break;
        case "popover":
          (de("beforetoggle", e), de("toggle", e), Fs(e, "popover", o));
          break;
        case "xlinkActuate":
          oi(e, "http://www.w3.org/1999/xlink", "xlink:actuate", o);
          break;
        case "xlinkArcrole":
          oi(e, "http://www.w3.org/1999/xlink", "xlink:arcrole", o);
          break;
        case "xlinkRole":
          oi(e, "http://www.w3.org/1999/xlink", "xlink:role", o);
          break;
        case "xlinkShow":
          oi(e, "http://www.w3.org/1999/xlink", "xlink:show", o);
          break;
        case "xlinkTitle":
          oi(e, "http://www.w3.org/1999/xlink", "xlink:title", o);
          break;
        case "xlinkType":
          oi(e, "http://www.w3.org/1999/xlink", "xlink:type", o);
          break;
        case "xmlBase":
          oi(e, "http://www.w3.org/XML/1998/namespace", "xml:base", o);
          break;
        case "xmlLang":
          oi(e, "http://www.w3.org/XML/1998/namespace", "xml:lang", o);
          break;
        case "xmlSpace":
          oi(e, "http://www.w3.org/XML/1998/namespace", "xml:space", o);
          break;
        case "is":
          Fs(e, "is", o);
          break;
        case "innerText":
        case "textContent":
          break;
        default:
          (!(2 < i.length) ||
            (i[0] !== "o" && i[0] !== "O") ||
            (i[1] !== "n" && i[1] !== "N")) &&
            ((i = e0.get(i) || i), Fs(e, i, o));
      }
    }
    function ec(e, t, i, o, l, s) {
      switch (i) {
        case "style":
          g2(e, o, s);
          break;
        case "dangerouslySetInnerHTML":
          if (o != null) {
            if (typeof o != "object" || !("__html" in o)) throw Error(k(61));
            if (((i = o.__html), i != null)) {
              if (l.children != null) throw Error(k(60));
              e.innerHTML = i;
            }
          }
          break;
        case "children":
          typeof o == "string"
            ? Fn(e, o)
            : (typeof o == "number" || typeof o == "bigint") && Fn(e, "" + o);
          break;
        case "onScroll":
          o != null && de("scroll", e);
          break;
        case "onScrollEnd":
          o != null && de("scrollend", e);
          break;
        case "onClick":
          o != null && (e.onclick = ci);
          break;
        case "suppressContentEditableWarning":
        case "suppressHydrationWarning":
        case "innerHTML":
        case "ref":
          break;
        case "innerText":
        case "textContent":
          break;
        default:
          if (!f2.hasOwnProperty(i))
            e: {
              if (
                i[0] === "o" &&
                i[1] === "n" &&
                ((l = i.endsWith("Capture")),
                (t = i.slice(2, l ? i.length - 7 : void 0)),
                (s = e[Pt] || null),
                (s = s != null ? s[i] : null),
                typeof s == "function" && e.removeEventListener(t, s, l),
                typeof o == "function")
              ) {
                (typeof s != "function" &&
                  s !== null &&
                  (i in e
                    ? (e[i] = null)
                    : e.hasAttribute(i) && e.removeAttribute(i)),
                  e.addEventListener(t, o, l));
                break e;
              }
              i in e
                ? (e[i] = o)
                : o === !0
                  ? e.setAttribute(i, "")
                  : Fs(e, i, o);
            }
      }
    }
    function ht(e, t, i) {
      switch (t) {
        case "div":
        case "span":
        case "svg":
        case "path":
        case "a":
        case "g":
        case "p":
        case "li":
          break;
        case "img":
          (de("error", e), de("load", e));
          var o = !1,
            l = !1,
            s;
          for (s in i)
            if (i.hasOwnProperty(s)) {
              var f = i[s];
              if (f != null)
                switch (s) {
                  case "src":
                    o = !0;
                    break;
                  case "srcSet":
                    l = !0;
                    break;
                  case "children":
                  case "dangerouslySetInnerHTML":
                    throw Error(k(137, t));
                  default:
                    be(e, t, s, f, i, null);
                }
            }
          (l && be(e, t, "srcSet", i.srcSet, i, null),
            o && be(e, t, "src", i.src, i, null));
          return;
        case "input":
          de("invalid", e);
          var c = (s = f = l = null),
            g = null,
            y = null;
          for (o in i)
            if (i.hasOwnProperty(o)) {
              var p = i[o];
              if (p != null)
                switch (o) {
                  case "name":
                    l = p;
                    break;
                  case "type":
                    f = p;
                    break;
                  case "checked":
                    g = p;
                    break;
                  case "defaultChecked":
                    y = p;
                    break;
                  case "value":
                    s = p;
                    break;
                  case "defaultValue":
                    c = p;
                    break;
                  case "children":
                  case "dangerouslySetInnerHTML":
                    if (p != null) throw Error(k(137, t));
                    break;
                  default:
                    be(e, t, o, p, i, null);
                }
            }
          h2(e, s, c, g, y, f, l, !1);
          return;
        case "select":
          (de("invalid", e), (o = f = s = null));
          for (l in i)
            if (i.hasOwnProperty(l) && ((c = i[l]), c != null))
              switch (l) {
                case "value":
                  s = c;
                  break;
                case "defaultValue":
                  f = c;
                  break;
                case "multiple":
                  o = c;
                default:
                  be(e, t, l, c, i, null);
              }
          ((t = s),
            (i = f),
            (e.multiple = !!o),
            t != null ? zn(e, !!o, t, !1) : i != null && zn(e, !!o, i, !0));
          return;
        case "textarea":
          (de("invalid", e), (s = l = o = null));
          for (f in i)
            if (i.hasOwnProperty(f) && ((c = i[f]), c != null))
              switch (f) {
                case "value":
                  o = c;
                  break;
                case "defaultValue":
                  l = c;
                  break;
                case "children":
                  s = c;
                  break;
                case "dangerouslySetInnerHTML":
                  if (c != null) throw Error(k(91));
                  break;
                default:
                  be(e, t, f, c, i, null);
              }
          p2(e, o, l, s);
          return;
        case "option":
          for (g in i)
            i.hasOwnProperty(g) &&
              ((o = i[g]), o != null) &&
              (g === "selected"
                ? (e.selected =
                    o && typeof o != "function" && typeof o != "symbol")
                : be(e, t, g, o, i, null));
          return;
        case "dialog":
          (de("beforetoggle", e),
            de("toggle", e),
            de("cancel", e),
            de("close", e));
          break;
        case "iframe":
        case "object":
          de("load", e);
          break;
        case "video":
        case "audio":
          for (o = 0; o < hu.length; o++) de(hu[o], e);
          break;
        case "image":
          (de("error", e), de("load", e));
          break;
        case "details":
          de("toggle", e);
          break;
        case "embed":
        case "source":
        case "link":
          (de("error", e), de("load", e));
        case "area":
        case "base":
        case "br":
        case "col":
        case "hr":
        case "keygen":
        case "meta":
        case "param":
        case "track":
        case "wbr":
        case "menuitem":
          for (y in i)
            if (i.hasOwnProperty(y) && ((o = i[y]), o != null))
              switch (y) {
                case "children":
                case "dangerouslySetInnerHTML":
                  throw Error(k(137, t));
                default:
                  be(e, t, y, o, i, null);
              }
          return;
        default:
          if (gc(t)) {
            for (p in i)
              i.hasOwnProperty(p) &&
                ((o = i[p]), o !== void 0 && ec(e, t, p, o, i, void 0));
            return;
          }
      }
      for (c in i)
        i.hasOwnProperty(c) &&
          ((o = i[c]), o != null && be(e, t, c, o, i, null));
    }
    function bv(e, t, i, o) {
      switch (t) {
        case "div":
        case "span":
        case "svg":
        case "path":
        case "a":
        case "g":
        case "p":
        case "li":
          break;
        case "input":
          var l = null,
            s = null,
            f = null,
            c = null,
            g = null,
            y = null,
            p = null;
          for (x in i) {
            var _ = i[x];
            if (i.hasOwnProperty(x) && _ != null)
              switch (x) {
                case "checked":
                  break;
                case "value":
                  break;
                case "defaultValue":
                  g = _;
                default:
                  o.hasOwnProperty(x) || be(e, t, x, null, o, _);
              }
          }
          for (var v in o) {
            var x = o[v];
            if (((_ = i[v]), o.hasOwnProperty(v) && (x != null || _ != null)))
              switch (v) {
                case "type":
                  s = x;
                  break;
                case "name":
                  l = x;
                  break;
                case "checked":
                  y = x;
                  break;
                case "defaultChecked":
                  p = x;
                  break;
                case "value":
                  f = x;
                  break;
                case "defaultValue":
                  c = x;
                  break;
                case "children":
                case "dangerouslySetInnerHTML":
                  if (x != null) throw Error(k(137, t));
                  break;
                default:
                  x !== _ && be(e, t, v, x, o, _);
              }
          }
          bd(e, f, c, g, y, p, s, l);
          return;
        case "select":
          x = f = c = v = null;
          for (s in i)
            if (((g = i[s]), i.hasOwnProperty(s) && g != null))
              switch (s) {
                case "value":
                  break;
                case "multiple":
                  x = g;
                default:
                  o.hasOwnProperty(s) || be(e, t, s, null, o, g);
              }
          for (l in o)
            if (
              ((s = o[l]),
              (g = i[l]),
              o.hasOwnProperty(l) && (s != null || g != null))
            )
              switch (l) {
                case "value":
                  v = s;
                  break;
                case "defaultValue":
                  c = s;
                  break;
                case "multiple":
                  f = s;
                default:
                  s !== g && be(e, t, l, s, o, g);
              }
          ((t = c),
            (i = f),
            (o = x),
            v != null
              ? zn(e, !!i, v, !1)
              : !!o != !!i &&
                (t != null ? zn(e, !!i, t, !0) : zn(e, !!i, i ? [] : "", !1)));
          return;
        case "textarea":
          x = v = null;
          for (c in i)
            if (
              ((l = i[c]),
              i.hasOwnProperty(c) && l != null && !o.hasOwnProperty(c))
            )
              switch (c) {
                case "value":
                  break;
                case "children":
                  break;
                default:
                  be(e, t, c, null, o, l);
              }
          for (f in o)
            if (
              ((l = o[f]),
              (s = i[f]),
              o.hasOwnProperty(f) && (l != null || s != null))
            )
              switch (f) {
                case "value":
                  v = l;
                  break;
                case "defaultValue":
                  x = l;
                  break;
                case "children":
                  break;
                case "dangerouslySetInnerHTML":
                  if (l != null) throw Error(k(91));
                  break;
                default:
                  l !== s && be(e, t, f, l, o, s);
              }
          m2(e, v, x);
          return;
        case "option":
          for (var B in i)
            ((v = i[B]),
              i.hasOwnProperty(B) &&
                v != null &&
                !o.hasOwnProperty(B) &&
                (B === "selected"
                  ? (e.selected = !1)
                  : be(e, t, B, null, o, v)));
          for (g in o)
            ((v = o[g]),
              (x = i[g]),
              o.hasOwnProperty(g) &&
                v !== x &&
                (v != null || x != null) &&
                (g === "selected"
                  ? (e.selected =
                      v && typeof v != "function" && typeof v != "symbol")
                  : be(e, t, g, v, o, x)));
          return;
        case "img":
        case "link":
        case "area":
        case "base":
        case "br":
        case "col":
        case "embed":
        case "hr":
        case "keygen":
        case "meta":
        case "param":
        case "source":
        case "track":
        case "wbr":
        case "menuitem":
          for (var P in i)
            ((v = i[P]),
              i.hasOwnProperty(P) &&
                v != null &&
                !o.hasOwnProperty(P) &&
                be(e, t, P, null, o, v));
          for (y in o)
            if (
              ((v = o[y]),
              (x = i[y]),
              o.hasOwnProperty(y) && v !== x && (v != null || x != null))
            )
              switch (y) {
                case "children":
                case "dangerouslySetInnerHTML":
                  if (v != null) throw Error(k(137, t));
                  break;
                default:
                  be(e, t, y, v, o, x);
              }
          return;
        default:
          if (gc(t)) {
            for (var Z in i)
              ((v = i[Z]),
                i.hasOwnProperty(Z) &&
                  v !== void 0 &&
                  !o.hasOwnProperty(Z) &&
                  ec(e, t, Z, void 0, o, v));
            for (p in o)
              ((v = o[p]),
                (x = i[p]),
                !o.hasOwnProperty(p) ||
                  v === x ||
                  (v === void 0 && x === void 0) ||
                  ec(e, t, p, v, o, x));
            return;
          }
      }
      for (var b in i)
        ((v = i[b]),
          i.hasOwnProperty(b) &&
            v != null &&
            !o.hasOwnProperty(b) &&
            be(e, t, b, null, o, v));
      for (_ in o)
        ((v = o[_]),
          (x = i[_]),
          !o.hasOwnProperty(_) ||
            v === x ||
            (v == null && x == null) ||
            be(e, t, _, v, o, x));
    }
    function Dp(e) {
      switch (e) {
        case "css":
        case "script":
        case "font":
        case "img":
        case "image":
        case "input":
        case "link":
          return !0;
        default:
          return !1;
      }
    }
    function wv() {
      if (typeof performance.getEntriesByType == "function") {
        for (
          var e = 0, t = 0, i = performance.getEntriesByType("resource"), o = 0;
          o < i.length;
          o++
        ) {
          var l = i[o],
            s = l.transferSize,
            f = l.initiatorType,
            c = l.duration;
          if (s && c && Dp(f)) {
            for (f = 0, c = l.responseEnd, o += 1; o < i.length; o++) {
              var g = i[o],
                y = g.startTime;
              if (y > c) break;
              var p = g.transferSize,
                _ = g.initiatorType;
              p &&
                Dp(_) &&
                ((g = g.responseEnd),
                (f += p * (g < c ? 1 : (c - y) / (g - y))));
            }
            if ((--o, (t += (8 * (s + f)) / (l.duration / 1e3)), e++, 10 < e))
              break;
          }
        }
        if (0 < e) return t / e / 1e6;
      }
      return navigator.connection &&
        ((e = navigator.connection.downlink), typeof e == "number")
        ? e
        : 5;
    }
    var tc = null,
      ac = null;
    function wr(e) {
      return e.nodeType === 9 ? e : e.ownerDocument;
    }
    function Bp(e) {
      switch (e) {
        case "http://www.w3.org/2000/svg":
          return 1;
        case "http://www.w3.org/1998/Math/MathML":
          return 2;
        default:
          return 0;
      }
    }
    function y1(e, t) {
      if (e === 0)
        switch (t) {
          case "svg":
            return 1;
          case "math":
            return 2;
          default:
            return 0;
        }
      return e === 1 && t === "foreignObject" ? 0 : e;
    }
    function ic(e, t) {
      return (
        e === "textarea" ||
        e === "noscript" ||
        typeof t.children == "string" ||
        typeof t.children == "number" ||
        typeof t.children == "bigint" ||
        (typeof t.dangerouslySetInnerHTML == "object" &&
          t.dangerouslySetInnerHTML !== null &&
          t.dangerouslySetInnerHTML.__html != null)
      );
    }
    var hd = null;
    function Mv() {
      var e = window.event;
      return e && e.type === "popstate"
        ? e === hd
          ? !1
          : ((hd = e), !0)
        : ((hd = null), !1);
    }
    var x1 = typeof setTimeout == "function" ? setTimeout : void 0,
      Tv = typeof clearTimeout == "function" ? clearTimeout : void 0,
      Pp = typeof Promise == "function" ? Promise : void 0,
      Av =
        typeof queueMicrotask == "function"
          ? queueMicrotask
          : typeof Pp < "u"
            ? function (e) {
                return Pp.resolve(null).then(e).catch(Dv);
              }
            : x1;
    function Dv(e) {
      setTimeout(function () {
        throw e;
      });
    }
    function uo(e) {
      return e === "head";
    }
    function kp(e, t) {
      var i = t,
        o = 0;
      do {
        var l = i.nextSibling;
        if ((e.removeChild(i), l && l.nodeType === 8))
          if (((i = l.data), i === "/$" || i === "/&")) {
            if (o === 0) {
              (e.removeChild(l), Qn(t));
              return;
            }
            o--;
          } else if (
            i === "$" ||
            i === "$?" ||
            i === "$~" ||
            i === "$!" ||
            i === "&"
          )
            o++;
          else if (i === "html") iu(e.ownerDocument.documentElement);
          else if (i === "head") {
            ((i = e.ownerDocument.head), iu(i));
            for (var s = i.firstChild; s;) {
              var f = s.nextSibling,
                c = s.nodeName;
              (s[Su] ||
                c === "SCRIPT" ||
                c === "STYLE" ||
                (c === "LINK" && s.rel.toLowerCase() === "stylesheet") ||
                i.removeChild(s),
                (s = f));
            }
          } else i === "body" && iu(e.ownerDocument.body);
        i = l;
      } while (i);
      Qn(t);
    }
    function zp(e, t) {
      var i = e;
      e = 0;
      do {
        var o = i.nextSibling;
        if (
          (i.nodeType === 1
            ? t
              ? ((i._stashedDisplay = i.style.display),
                (i.style.display = "none"))
              : ((i.style.display = i._stashedDisplay || ""),
                i.getAttribute("style") === "" && i.removeAttribute("style"))
            : i.nodeType === 3 &&
              (t
                ? ((i._stashedText = i.nodeValue), (i.nodeValue = ""))
                : (i.nodeValue = i._stashedText || "")),
          o && o.nodeType === 8)
        )
          if (((i = o.data), i === "/$")) {
            if (e === 0) break;
            e--;
          } else (i !== "$" && i !== "$?" && i !== "$~" && i !== "$!") || e++;
        i = o;
      } while (i);
    }
    function oc(e) {
      var t = e.firstChild;
      for (t && t.nodeType === 10 && (t = t.nextSibling); t;) {
        var i = t;
        switch (((t = t.nextSibling), i.nodeName)) {
          case "HTML":
          case "HEAD":
          case "BODY":
            (oc(i), pc(i));
            continue;
          case "SCRIPT":
          case "STYLE":
            continue;
          case "LINK":
            if (i.rel.toLowerCase() === "stylesheet") continue;
        }
        e.removeChild(i);
      }
    }
    function Bv(e, t, i, o) {
      for (; e.nodeType === 1;) {
        var l = i;
        if (e.nodeName.toLowerCase() !== t.toLowerCase()) {
          if (!o && (e.nodeName !== "INPUT" || e.type !== "hidden")) break;
        } else if (o) {
          if (!e[Su])
            switch (t) {
              case "meta":
                if (!e.hasAttribute("itemprop")) break;
                return e;
              case "link":
                if (
                  ((s = e.getAttribute("rel")),
                  s === "stylesheet" && e.hasAttribute("data-precedence"))
                )
                  break;
                if (
                  s !== l.rel ||
                  e.getAttribute("href") !==
                    (l.href == null || l.href === "" ? null : l.href) ||
                  e.getAttribute("crossorigin") !==
                    (l.crossOrigin == null ? null : l.crossOrigin) ||
                  e.getAttribute("title") !== (l.title == null ? null : l.title)
                )
                  break;
                return e;
              case "style":
                if (e.hasAttribute("data-precedence")) break;
                return e;
              case "script":
                if (
                  ((s = e.getAttribute("src")),
                  (s !== (l.src == null ? null : l.src) ||
                    e.getAttribute("type") !==
                      (l.type == null ? null : l.type) ||
                    e.getAttribute("crossorigin") !==
                      (l.crossOrigin == null ? null : l.crossOrigin)) &&
                    s &&
                    e.hasAttribute("async") &&
                    !e.hasAttribute("itemprop"))
                )
                  break;
                return e;
              default:
                return e;
            }
        } else if (t === "input" && e.type === "hidden") {
          var s = l.name == null ? null : "" + l.name;
          if (l.type === "hidden" && e.getAttribute("name") === s) return e;
        } else return e;
        if (((e = ra(e.nextSibling)), e === null)) break;
      }
      return null;
    }
    function Pv(e, t, i) {
      if (t === "") return null;
      for (; e.nodeType !== 3;)
        if (
          ((e.nodeType !== 1 ||
            e.nodeName !== "INPUT" ||
            e.type !== "hidden") &&
            !i) ||
          ((e = ra(e.nextSibling)), e === null)
        )
          return null;
      return e;
    }
    function S1(e, t) {
      for (; e.nodeType !== 8;)
        if (
          ((e.nodeType !== 1 ||
            e.nodeName !== "INPUT" ||
            e.type !== "hidden") &&
            !t) ||
          ((e = ra(e.nextSibling)), e === null)
        )
          return null;
      return e;
    }
    function nc(e) {
      return e.data === "$?" || e.data === "$~";
    }
    function lc(e) {
      return (
        e.data === "$!" ||
        (e.data === "$?" && e.ownerDocument.readyState !== "loading")
      );
    }
    function kv(e, t) {
      var i = e.ownerDocument;
      if (e.data === "$~") e._reactRetry = t;
      else if (e.data !== "$?" || i.readyState !== "loading") t();
      else {
        var o = function () {
          (t(), i.removeEventListener("DOMContentLoaded", o));
        };
        (i.addEventListener("DOMContentLoaded", o), (e._reactRetry = o));
      }
    }
    function ra(e) {
      for (; e != null; e = e.nextSibling) {
        var t = e.nodeType;
        if (t === 1 || t === 3) break;
        if (t === 8) {
          if (
            ((t = e.data),
            t === "$" ||
              t === "$!" ||
              t === "$?" ||
              t === "$~" ||
              t === "&" ||
              t === "F!" ||
              t === "F")
          )
            break;
          if (t === "/$" || t === "/&") return null;
        }
      }
      return e;
    }
    var uc = null;
    function Op(e) {
      e = e.nextSibling;
      for (var t = 0; e;) {
        if (e.nodeType === 8) {
          var i = e.data;
          if (i === "/$" || i === "/&") {
            if (t === 0) return ra(e.nextSibling);
            t--;
          } else
            (i !== "$" &&
              i !== "$!" &&
              i !== "$?" &&
              i !== "$~" &&
              i !== "&") ||
              t++;
        }
        e = e.nextSibling;
      }
      return null;
    }
    function Rp(e) {
      e = e.previousSibling;
      for (var t = 0; e;) {
        if (e.nodeType === 8) {
          var i = e.data;
          if (
            i === "$" ||
            i === "$!" ||
            i === "$?" ||
            i === "$~" ||
            i === "&"
          ) {
            if (t === 0) return e;
            t--;
          } else (i !== "/$" && i !== "/&") || t++;
        }
        e = e.previousSibling;
      }
      return null;
    }
    function C1(e, t, i) {
      switch (((t = wr(i)), e)) {
        case "html":
          if (((e = t.documentElement), !e)) throw Error(k(452));
          return e;
        case "head":
          if (((e = t.head), !e)) throw Error(k(453));
          return e;
        case "body":
          if (((e = t.body), !e)) throw Error(k(454));
          return e;
        default:
          throw Error(k(451));
      }
    }
    function iu(e) {
      for (var t = e.attributes; t.length;) e.removeAttributeNode(t[0]);
      pc(e);
    }
    var fa = new Map(),
      Ep = new Set();
    function Mr(e) {
      return typeof e.getRootNode == "function"
        ? e.getRootNode()
        : e.nodeType === 9
          ? e
          : e.ownerDocument;
    }
    var Si = xe.d;
    xe.d = { f: zv, r: Ov, D: Rv, C: Ev, L: Uv, m: qv, X: Nv, S: Hv, M: Fv };
    function zv() {
      var e = Si.f(),
        t = Gr();
      return e || t;
    }
    function Ov(e) {
      var t = Jn(e);
      t !== null && t.tag === 5 && t.type === "form" ? gg(t) : Si.r(e);
    }
    var al = typeof document > "u" ? null : document;
    function I1(e, t, i) {
      var o = al;
      if (o && typeof t == "string" && t) {
        var l = na(t);
        ((l = 'link[rel="' + e + '"][href="' + l + '"]'),
          typeof i == "string" && (l += '[crossorigin="' + i + '"]'),
          Ep.has(l) ||
            (Ep.add(l),
            (e = { rel: e, crossOrigin: i, href: t }),
            o.querySelector(l) === null &&
              ((t = o.createElement("link")),
              ht(t, "link", e),
              nt(t),
              o.head.appendChild(t))));
      }
    }
    function Rv(e) {
      (Si.D(e), I1("dns-prefetch", e, null));
    }
    function Ev(e, t) {
      (Si.C(e, t), I1("preconnect", e, t));
    }
    function Uv(e, t, i) {
      Si.L(e, t, i);
      var o = al;
      if (o && e && t) {
        var l = 'link[rel="preload"][as="' + na(t) + '"]';
        t === "image" && i && i.imageSrcSet
          ? ((l += '[imagesrcset="' + na(i.imageSrcSet) + '"]'),
            typeof i.imageSizes == "string" &&
              (l += '[imagesizes="' + na(i.imageSizes) + '"]'))
          : (l += '[href="' + na(e) + '"]');
        var s = l;
        switch (t) {
          case "style":
            s = Kn(e);
            break;
          case "script":
            s = il(e);
        }
        fa.has(s) ||
          ((e = Oe(
            {
              rel: "preload",
              href: t === "image" && i && i.imageSrcSet ? void 0 : e,
              as: t,
            },
            i,
          )),
          fa.set(s, e),
          o.querySelector(l) !== null ||
            (t === "style" && o.querySelector(Tu(s))) ||
            (t === "script" && o.querySelector(Au(s))) ||
            ((t = o.createElement("link")),
            ht(t, "link", e),
            nt(t),
            o.head.appendChild(t)));
      }
    }
    function qv(e, t) {
      Si.m(e, t);
      var i = al;
      if (i && e) {
        var o = t && typeof t.as == "string" ? t.as : "script",
          l =
            'link[rel="modulepreload"][as="' +
            na(o) +
            '"][href="' +
            na(e) +
            '"]',
          s = l;
        switch (o) {
          case "audioworklet":
          case "paintworklet":
          case "serviceworker":
          case "sharedworker":
          case "worker":
          case "script":
            s = il(e);
        }
        if (
          !fa.has(s) &&
          ((e = Oe({ rel: "modulepreload", href: e }, t)),
          fa.set(s, e),
          i.querySelector(l) === null)
        ) {
          switch (o) {
            case "audioworklet":
            case "paintworklet":
            case "serviceworker":
            case "sharedworker":
            case "worker":
            case "script":
              if (i.querySelector(Au(s))) return;
          }
          ((o = i.createElement("link")),
            ht(o, "link", e),
            nt(o),
            i.head.appendChild(o));
        }
      }
    }
    function Hv(e, t, i) {
      Si.S(e, t, i);
      var o = al;
      if (o && e) {
        var l = kn(o).hoistableStyles,
          s = Kn(e);
        t = t || "default";
        var f = l.get(s);
        if (!f) {
          var c = { loading: 0, preload: null };
          if ((f = o.querySelector(Tu(s)))) c.loading = 5;
          else {
            ((e = Oe({ rel: "stylesheet", href: e, "data-precedence": t }, i)),
              (i = fa.get(s)) && eh(e, i));
            var g = (f = o.createElement("link"));
            (nt(g),
              ht(g, "link", e),
              (g._p = new Promise(function (y, p) {
                ((g.onload = y), (g.onerror = p));
              })),
              g.addEventListener("load", function () {
                c.loading |= 1;
              }),
              g.addEventListener("error", function () {
                c.loading |= 2;
              }),
              (c.loading |= 4),
              $s(f, t, o));
          }
          ((f = { type: "stylesheet", instance: f, count: 1, state: c }),
            l.set(s, f));
        }
      }
    }
    function Nv(e, t) {
      Si.X(e, t);
      var i = al;
      if (i && e) {
        var o = kn(i).hoistableScripts,
          l = il(e),
          s = o.get(l);
        s ||
          ((s = i.querySelector(Au(l))),
          s ||
            ((e = Oe({ src: e, async: !0 }, t)),
            (t = fa.get(l)) && th(e, t),
            (s = i.createElement("script")),
            nt(s),
            ht(s, "link", e),
            i.head.appendChild(s)),
          (s = { type: "script", instance: s, count: 1, state: null }),
          o.set(l, s));
      }
    }
    function Fv(e, t) {
      Si.M(e, t);
      var i = al;
      if (i && e) {
        var o = kn(i).hoistableScripts,
          l = il(e),
          s = o.get(l);
        s ||
          ((s = i.querySelector(Au(l))),
          s ||
            ((e = Oe({ src: e, async: !0, type: "module" }, t)),
            (t = fa.get(l)) && th(e, t),
            (s = i.createElement("script")),
            nt(s),
            ht(s, "link", e),
            i.head.appendChild(s)),
          (s = { type: "script", instance: s, count: 1, state: null }),
          o.set(l, s));
      }
    }
    function Up(e, t, i, o) {
      var l = (l = ji.current) ? Mr(l) : null;
      if (!l) throw Error(k(446));
      switch (e) {
        case "meta":
        case "title":
          return null;
        case "style":
          return typeof i.precedence == "string" && typeof i.href == "string"
            ? ((t = Kn(i.href)),
              (i = kn(l).hoistableStyles),
              (o = i.get(t)),
              o ||
                ((o = { type: "style", instance: null, count: 0, state: null }),
                i.set(t, o)),
              o)
            : { type: "void", instance: null, count: 0, state: null };
        case "link":
          if (
            i.rel === "stylesheet" &&
            typeof i.href == "string" &&
            typeof i.precedence == "string"
          ) {
            e = Kn(i.href);
            var s = kn(l).hoistableStyles,
              f = s.get(e);
            if (
              (f ||
                ((l = l.ownerDocument || l),
                (f = {
                  type: "stylesheet",
                  instance: null,
                  count: 0,
                  state: { loading: 0, preload: null },
                }),
                s.set(e, f),
                (s = l.querySelector(Tu(e))) &&
                  !s._p &&
                  ((f.instance = s), (f.state.loading = 5)),
                fa.has(e) ||
                  ((i = {
                    rel: "preload",
                    as: "style",
                    href: i.href,
                    crossOrigin: i.crossOrigin,
                    integrity: i.integrity,
                    media: i.media,
                    hrefLang: i.hrefLang,
                    referrerPolicy: i.referrerPolicy,
                  }),
                  fa.set(e, i),
                  s || Zv(l, e, i, f.state))),
              t && o === null)
            )
              throw Error(k(528, ""));
            return f;
          }
          if (t && o !== null) throw Error(k(529, ""));
          return null;
        case "script":
          return (
            (t = i.async),
            (i = i.src),
            typeof i == "string" &&
            t &&
            typeof t != "function" &&
            typeof t != "symbol"
              ? ((t = il(i)),
                (i = kn(l).hoistableScripts),
                (o = i.get(t)),
                o ||
                  ((o = {
                    type: "script",
                    instance: null,
                    count: 0,
                    state: null,
                  }),
                  i.set(t, o)),
                o)
              : { type: "void", instance: null, count: 0, state: null }
          );
        default:
          throw Error(k(444, e));
      }
    }
    function Kn(e) {
      return 'href="' + na(e) + '"';
    }
    function Tu(e) {
      return 'link[rel="stylesheet"][' + e + "]";
    }
    function b1(e) {
      return Oe({}, e, { "data-precedence": e.precedence, precedence: null });
    }
    function Zv(e, t, i, o) {
      e.querySelector('link[rel="preload"][as="style"][' + t + "]")
        ? (o.loading = 1)
        : ((t = e.createElement("link")),
          (o.preload = t),
          t.addEventListener("load", function () {
            return (o.loading |= 1);
          }),
          t.addEventListener("error", function () {
            return (o.loading |= 2);
          }),
          ht(t, "link", i),
          nt(t),
          e.head.appendChild(t));
    }
    function il(e) {
      return '[src="' + na(e) + '"]';
    }
    function Au(e) {
      return "script[async]" + e;
    }
    function qp(e, t, i) {
      if ((t.count++, t.instance === null))
        switch (t.type) {
          case "style":
            var o = e.querySelector('style[data-href~="' + na(i.href) + '"]');
            if (o) return ((t.instance = o), nt(o), o);
            var l = Oe({}, i, {
              "data-href": i.href,
              "data-precedence": i.precedence,
              href: null,
              precedence: null,
            });
            return (
              (o = (e.ownerDocument || e).createElement("style")),
              nt(o),
              ht(o, "style", l),
              $s(o, i.precedence, e),
              (t.instance = o)
            );
          case "stylesheet":
            l = Kn(i.href);
            var s = e.querySelector(Tu(l));
            if (s) return ((t.state.loading |= 4), (t.instance = s), nt(s), s);
            ((o = b1(i)),
              (l = fa.get(l)) && eh(o, l),
              (s = (e.ownerDocument || e).createElement("link")),
              nt(s));
            var f = s;
            return (
              (f._p = new Promise(function (c, g) {
                ((f.onload = c), (f.onerror = g));
              })),
              ht(s, "link", o),
              (t.state.loading |= 4),
              $s(s, i.precedence, e),
              (t.instance = s)
            );
          case "script":
            return (
              (s = il(i.src)),
              (l = e.querySelector(Au(s)))
                ? ((t.instance = l), nt(l), l)
                : ((o = i),
                  (l = fa.get(s)) && ((o = Oe({}, i)), th(o, l)),
                  (e = e.ownerDocument || e),
                  (l = e.createElement("script")),
                  nt(l),
                  ht(l, "link", o),
                  e.head.appendChild(l),
                  (t.instance = l))
            );
          case "void":
            return null;
          default:
            throw Error(k(443, t.type));
        }
      else
        t.type === "stylesheet" &&
          (t.state.loading & 4) === 0 &&
          ((o = t.instance), (t.state.loading |= 4), $s(o, i.precedence, e));
      return t.instance;
    }
    function $s(e, t, i) {
      for (
        var o = i.querySelectorAll(
            'link[rel="stylesheet"][data-precedence],style[data-precedence]',
          ),
          l = o.length ? o[o.length - 1] : null,
          s = l,
          f = 0;
        f < o.length;
        f++
      ) {
        var c = o[f];
        if (c.dataset.precedence === t) s = c;
        else if (s !== l) break;
      }
      s
        ? s.parentNode.insertBefore(e, s.nextSibling)
        : ((t = i.nodeType === 9 ? i.head : i),
          t.insertBefore(e, t.firstChild));
    }
    function eh(e, t) {
      (e.crossOrigin == null && (e.crossOrigin = t.crossOrigin),
        e.referrerPolicy == null && (e.referrerPolicy = t.referrerPolicy),
        e.title == null && (e.title = t.title));
    }
    function th(e, t) {
      (e.crossOrigin == null && (e.crossOrigin = t.crossOrigin),
        e.referrerPolicy == null && (e.referrerPolicy = t.referrerPolicy),
        e.integrity == null && (e.integrity = t.integrity));
    }
    var er = null;
    function Hp(e, t, i) {
      if (er === null) {
        var o = new Map(),
          l = (er = new Map());
        l.set(i, o);
      } else ((l = er), (o = l.get(i)), o || ((o = new Map()), l.set(i, o)));
      if (o.has(e)) return o;
      for (
        o.set(e, null), i = i.getElementsByTagName(e), l = 0;
        l < i.length;
        l++
      ) {
        var s = i[l];
        if (
          !(
            s[Su] ||
            s[ft] ||
            (e === "link" && s.getAttribute("rel") === "stylesheet")
          ) &&
          s.namespaceURI !== "http://www.w3.org/2000/svg"
        ) {
          var f = s.getAttribute(t) || "";
          f = e + f;
          var c = o.get(f);
          c ? c.push(s) : o.set(f, [s]);
        }
      }
      return o;
    }
    function Np(e, t, i) {
      ((e = e.ownerDocument || e),
        e.head.insertBefore(
          i,
          t === "title" ? e.querySelector("head > title") : null,
        ));
    }
    function Gv(e, t, i) {
      if (i === 1 || t.itemProp != null) return !1;
      switch (e) {
        case "meta":
        case "title":
          return !0;
        case "style":
          if (
            typeof t.precedence != "string" ||
            typeof t.href != "string" ||
            t.href === ""
          )
            break;
          return !0;
        case "link":
          if (
            typeof t.rel != "string" ||
            typeof t.href != "string" ||
            t.href === "" ||
            t.onLoad ||
            t.onError
          )
            break;
          return t.rel === "stylesheet"
            ? ((e = t.disabled), typeof t.precedence == "string" && e == null)
            : !0;
        case "script":
          if (
            t.async &&
            typeof t.async != "function" &&
            typeof t.async != "symbol" &&
            !t.onLoad &&
            !t.onError &&
            t.src &&
            typeof t.src == "string"
          )
            return !0;
      }
      return !1;
    }
    function w1(e) {
      return !(e.type === "stylesheet" && (e.state.loading & 3) === 0);
    }
    function Vv(e, t, i, o) {
      if (
        i.type === "stylesheet" &&
        (typeof o.media != "string" || matchMedia(o.media).matches !== !1) &&
        (i.state.loading & 4) === 0
      ) {
        if (i.instance === null) {
          var l = Kn(o.href),
            s = t.querySelector(Tu(l));
          if (s) {
            ((t = s._p),
              t !== null &&
                typeof t == "object" &&
                typeof t.then == "function" &&
                (e.count++, (e = Tr.bind(e)), t.then(e, e)),
              (i.state.loading |= 4),
              (i.instance = s),
              nt(s));
            return;
          }
          ((s = t.ownerDocument || t),
            (o = b1(o)),
            (l = fa.get(l)) && eh(o, l),
            (s = s.createElement("link")),
            nt(s));
          var f = s;
          ((f._p = new Promise(function (c, g) {
            ((f.onload = c), (f.onerror = g));
          })),
            ht(s, "link", o),
            (i.instance = s));
        }
        (e.stylesheets === null && (e.stylesheets = new Map()),
          e.stylesheets.set(i, t),
          (t = i.state.preload) &&
            (i.state.loading & 3) === 0 &&
            (e.count++,
            (i = Tr.bind(e)),
            t.addEventListener("load", i),
            t.addEventListener("error", i)));
      }
    }
    var md = 0;
    function Xv(e, t) {
      return (
        e.stylesheets && e.count === 0 && tr(e, e.stylesheets),
        0 < e.count || 0 < e.imgCount
          ? function (i) {
              var o = setTimeout(function () {
                if ((e.stylesheets && tr(e, e.stylesheets), e.unsuspend)) {
                  var s = e.unsuspend;
                  ((e.unsuspend = null), s());
                }
              }, 6e4 + t);
              0 < e.imgBytes && md === 0 && (md = 62500 * wv());
              var l = setTimeout(
                function () {
                  if (
                    ((e.waitingForImages = !1),
                    e.count === 0 &&
                      (e.stylesheets && tr(e, e.stylesheets), e.unsuspend))
                  ) {
                    var s = e.unsuspend;
                    ((e.unsuspend = null), s());
                  }
                },
                (e.imgBytes > md ? 50 : 800) + t,
              );
              return (
                (e.unsuspend = i),
                function () {
                  ((e.unsuspend = null), clearTimeout(o), clearTimeout(l));
                }
              );
            }
          : null
      );
    }
    function Tr() {
      if (
        (this.count--,
        this.count === 0 && (this.imgCount === 0 || !this.waitingForImages))
      ) {
        if (this.stylesheets) tr(this, this.stylesheets);
        else if (this.unsuspend) {
          var e = this.unsuspend;
          ((this.unsuspend = null), e());
        }
      }
    }
    var Ar = null;
    function tr(e, t) {
      ((e.stylesheets = null),
        e.unsuspend !== null &&
          (e.count++,
          (Ar = new Map()),
          t.forEach(jv, e),
          (Ar = null),
          Tr.call(e)));
    }
    function jv(e, t) {
      if (!(t.state.loading & 4)) {
        var i = Ar.get(e);
        if (i) var o = i.get(null);
        else {
          ((i = new Map()), Ar.set(e, i));
          for (
            var l = e.querySelectorAll(
                "link[data-precedence],style[data-precedence]",
              ),
              s = 0;
            s < l.length;
            s++
          ) {
            var f = l[s];
            (f.nodeName === "LINK" || f.getAttribute("media") !== "not all") &&
              (i.set(f.dataset.precedence, f), (o = f));
          }
          o && i.set(null, o);
        }
        ((l = t.instance),
          (f = l.getAttribute("data-precedence")),
          (s = i.get(f) || o),
          s === o && i.set(null, l),
          i.set(f, l),
          this.count++,
          (o = Tr.bind(this)),
          l.addEventListener("load", o),
          l.addEventListener("error", o),
          s
            ? s.parentNode.insertBefore(l, s.nextSibling)
            : ((e = e.nodeType === 9 ? e.head : e),
              e.insertBefore(l, e.firstChild)),
          (t.state.loading |= 4));
      }
    }
    var pu = {
      $$typeof: di,
      Provider: null,
      Consumer: null,
      _currentValue: wo,
      _currentValue2: wo,
      _threadCount: 0,
    };
    function Yv(e, t, i, o, l, s, f, c, g) {
      ((this.tag = 1),
        (this.containerInfo = e),
        (this.pingCache = this.current = this.pendingChildren = null),
        (this.timeoutHandle = -1),
        (this.callbackNode =
          this.next =
          this.pendingContext =
          this.context =
          this.cancelPendingCommit =
            null),
        (this.callbackPriority = 0),
        (this.expirationTimes = Hf(-1)),
        (this.entangledLanes =
          this.shellSuspendCounter =
          this.errorRecoveryDisabledLanes =
          this.expiredLanes =
          this.warmLanes =
          this.pingedLanes =
          this.suspendedLanes =
          this.pendingLanes =
            0),
        (this.entanglements = Hf(0)),
        (this.hiddenUpdates = Hf(null)),
        (this.identifierPrefix = o),
        (this.onUncaughtError = l),
        (this.onCaughtError = s),
        (this.onRecoverableError = f),
        (this.pooledCache = null),
        (this.pooledCacheLanes = 0),
        (this.formState = g),
        (this.incompleteTransitions = new Map()));
    }
    function M1(e, t, i, o, l, s, f, c, g, y, p, _) {
      return (
        (e = new Yv(e, t, i, f, g, y, p, _, c)),
        (t = 1),
        s === !0 && (t |= 24),
        (s = qt(3, null, null, t)),
        (e.current = s),
        (s.stateNode = e),
        (t = Mc()),
        t.refCount++,
        (e.pooledCache = t),
        t.refCount++,
        (s.memoizedState = { element: o, isDehydrated: i, cache: t }),
        Dc(s),
        e
      );
    }
    function T1(e) {
      return e ? ((e = An), e) : An;
    }
    function A1(e, t, i, o, l, s) {
      ((l = T1(l)),
        o.context === null ? (o.context = l) : (o.pendingContext = l),
        (o = Ki(t)),
        (o.payload = { element: i }),
        (s = s === void 0 ? null : s),
        s !== null && (o.callback = s),
        (i = Qi(e, o, t)),
        i !== null && (Bt(i, e, t), Kl(i, e, t)));
    }
    function Fp(e, t) {
      if (((e = e.memoizedState), e !== null && e.dehydrated !== null)) {
        var i = e.retryLane;
        e.retryLane = i !== 0 && i < t ? i : t;
      }
    }
    function ah(e, t) {
      (Fp(e, t), (e = e.alternate) && Fp(e, t));
    }
    function D1(e) {
      if (e.tag === 13 || e.tag === 31) {
        var t = qo(e, 67108864);
        (t !== null && Bt(t, e, 67108864), ah(e, 67108864));
      }
    }
    function Zp(e) {
      if (e.tag === 13 || e.tag === 31) {
        var t = Gt();
        t = hc(t);
        var i = qo(e, t);
        (i !== null && Bt(i, e, t), ah(e, t));
      }
    }
    var Dr = !0;
    function Kv(e, t, i, o) {
      var l = J.T;
      J.T = null;
      var s = xe.p;
      try {
        ((xe.p = 2), ih(e, t, i, o));
      } finally {
        ((xe.p = s), (J.T = l));
      }
    }
    function Qv(e, t, i, o) {
      var l = J.T;
      J.T = null;
      var s = xe.p;
      try {
        ((xe.p = 8), ih(e, t, i, o));
      } finally {
        ((xe.p = s), (J.T = l));
      }
    }
    function ih(e, t, i, o) {
      if (Dr) {
        var l = sc(o);
        if (l === null) (cd(e, t, o, Br, i), Gp(e, o));
        else if (Jv(l, e, t, i, o)) o.stopPropagation();
        else if ((Gp(e, o), t & 4 && -1 < Wv.indexOf(e))) {
          for (; l !== null;) {
            var s = Jn(l);
            if (s !== null)
              switch (s.tag) {
                case 3:
                  if (
                    ((s = s.stateNode), s.current.memoizedState.isDehydrated)
                  ) {
                    var f = Co(s.pendingLanes);
                    if (f !== 0) {
                      var c = s;
                      for (c.pendingLanes |= 2, c.entangledLanes |= 2; f;) {
                        var g = 1 << (31 - Zt(f));
                        ((c.entanglements[1] |= g), (f &= ~g));
                      }
                      (Ha(s), (ye & 6) === 0 && ((yr = Nt() + 500), Mu(0, !1)));
                    }
                  }
                  break;
                case 31:
                case 13:
                  ((c = qo(s, 2)), c !== null && Bt(c, s, 2), Gr(), ah(s, 2));
              }
            if (((s = sc(o)), s === null && cd(e, t, o, Br, i), s === l)) break;
            l = s;
          }
          l !== null && o.stopPropagation();
        } else cd(e, t, o, null, i);
      }
    }
    function sc(e) {
      return ((e = Lc(e)), oh(e));
    }
    var Br = null;
    function oh(e) {
      if (((Br = null), (e = Cn(e)), e !== null)) {
        var t = _u(e);
        if (t === null) e = null;
        else {
          var i = t.tag;
          if (i === 13) {
            if (((e = Qp(t)), e !== null)) return e;
            e = null;
          } else if (i === 31) {
            if (((e = Wp(t)), e !== null)) return e;
            e = null;
          } else if (i === 3) {
            if (t.stateNode.current.memoizedState.isDehydrated)
              return t.tag === 3 ? t.stateNode.containerInfo : null;
            e = null;
          } else t !== e && (e = null);
        }
      }
      return ((Br = e), null);
    }
    function B1(e) {
      switch (e) {
        case "beforetoggle":
        case "cancel":
        case "click":
        case "close":
        case "contextmenu":
        case "copy":
        case "cut":
        case "auxclick":
        case "dblclick":
        case "dragend":
        case "dragstart":
        case "drop":
        case "focusin":
        case "focusout":
        case "input":
        case "invalid":
        case "keydown":
        case "keypress":
        case "keyup":
        case "mousedown":
        case "mouseup":
        case "paste":
        case "pause":
        case "play":
        case "pointercancel":
        case "pointerdown":
        case "pointerup":
        case "ratechange":
        case "reset":
        case "resize":
        case "seeked":
        case "submit":
        case "toggle":
        case "touchcancel":
        case "touchend":
        case "touchstart":
        case "volumechange":
        case "change":
        case "selectionchange":
        case "textInput":
        case "compositionstart":
        case "compositionend":
        case "compositionupdate":
        case "beforeblur":
        case "afterblur":
        case "beforeinput":
        case "blur":
        case "fullscreenchange":
        case "focus":
        case "hashchange":
        case "popstate":
        case "select":
        case "selectstart":
          return 2;
        case "drag":
        case "dragenter":
        case "dragexit":
        case "dragleave":
        case "dragover":
        case "mousemove":
        case "mouseout":
        case "mouseover":
        case "pointermove":
        case "pointerout":
        case "pointerover":
        case "scroll":
        case "touchmove":
        case "wheel":
        case "mouseenter":
        case "mouseleave":
        case "pointerenter":
        case "pointerleave":
          return 8;
        case "message":
          switch (U_()) {
            case t2:
              return 2;
            case a2:
              return 8;
            case lr:
            case q_:
              return 32;
            case i2:
              return 268435456;
            default:
              return 32;
          }
        default:
          return 32;
      }
    }
    var rc = !1,
      $i = null,
      eo = null,
      to = null,
      gu = new Map(),
      Lu = new Map(),
      Ni = [],
      Wv =
        "mousedown mouseup touchcancel touchend touchstart auxclick dblclick pointercancel pointerdown pointerup dragend dragstart drop compositionend compositionstart keydown keypress keyup input textInput copy cut paste click change contextmenu reset".split(
          " ",
        );
    function Gp(e, t) {
      switch (e) {
        case "focusin":
        case "focusout":
          $i = null;
          break;
        case "dragenter":
        case "dragleave":
          eo = null;
          break;
        case "mouseover":
        case "mouseout":
          to = null;
          break;
        case "pointerover":
        case "pointerout":
          gu.delete(t.pointerId);
          break;
        case "gotpointercapture":
        case "lostpointercapture":
          Lu.delete(t.pointerId);
      }
    }
    function Ul(e, t, i, o, l, s) {
      return e === null || e.nativeEvent !== s
        ? ((e = {
            blockedOn: t,
            domEventName: i,
            eventSystemFlags: o,
            nativeEvent: s,
            targetContainers: [l],
          }),
          t !== null && ((t = Jn(t)), t !== null && D1(t)),
          e)
        : ((e.eventSystemFlags |= o),
          (t = e.targetContainers),
          l !== null && t.indexOf(l) === -1 && t.push(l),
          e);
    }
    function Jv(e, t, i, o, l) {
      switch (t) {
        case "focusin":
          return (($i = Ul($i, e, t, i, o, l)), !0);
        case "dragenter":
          return ((eo = Ul(eo, e, t, i, o, l)), !0);
        case "mouseover":
          return ((to = Ul(to, e, t, i, o, l)), !0);
        case "pointerover":
          var s = l.pointerId;
          return (gu.set(s, Ul(gu.get(s) || null, e, t, i, o, l)), !0);
        case "gotpointercapture":
          return (
            (s = l.pointerId),
            Lu.set(s, Ul(Lu.get(s) || null, e, t, i, o, l)),
            !0
          );
      }
      return !1;
    }
    function P1(e) {
      var t = Cn(e.target);
      if (t !== null) {
        var i = _u(t);
        if (i !== null) {
          if (((t = i.tag), t === 13)) {
            if (((t = Qp(i)), t !== null)) {
              ((e.blockedOn = t),
                Mm(e.priority, function () {
                  Zp(i);
                }));
              return;
            }
          } else if (t === 31) {
            if (((t = Wp(i)), t !== null)) {
              ((e.blockedOn = t),
                Mm(e.priority, function () {
                  Zp(i);
                }));
              return;
            }
          } else if (
            t === 3 &&
            i.stateNode.current.memoizedState.isDehydrated
          ) {
            e.blockedOn = i.tag === 3 ? i.stateNode.containerInfo : null;
            return;
          }
        }
      }
      e.blockedOn = null;
    }
    function ar(e) {
      if (e.blockedOn !== null) return !1;
      for (var t = e.targetContainers; 0 < t.length;) {
        var i = sc(e.nativeEvent);
        if (i === null) {
          i = e.nativeEvent;
          var o = new i.constructor(i.type, i);
          ((Md = o), i.target.dispatchEvent(o), (Md = null));
        } else return ((t = Jn(i)), t !== null && D1(t), (e.blockedOn = i), !1);
        t.shift();
      }
      return !0;
    }
    function Vp(e, t, i) {
      ar(e) && i.delete(t);
    }
    function $v() {
      ((rc = !1),
        $i !== null && ar($i) && ($i = null),
        eo !== null && ar(eo) && (eo = null),
        to !== null && ar(to) && (to = null),
        gu.forEach(Vp),
        Lu.forEach(Vp));
    }
    function Hs(e, t) {
      e.blockedOn === t &&
        ((e.blockedOn = null),
        rc ||
          ((rc = !0),
          at.unstable_scheduleCallback(at.unstable_NormalPriority, $v)));
    }
    var Ns = null;
    function Xp(e) {
      Ns !== e &&
        ((Ns = e),
        at.unstable_scheduleCallback(at.unstable_NormalPriority, function () {
          Ns === e && (Ns = null);
          for (var t = 0; t < e.length; t += 3) {
            var i = e[t],
              o = e[t + 1],
              l = e[t + 2];
            if (typeof o != "function") {
              if (oh(o || i) === null) continue;
              break;
            }
            var s = Jn(i);
            s !== null &&
              (e.splice(t, 3),
              (t -= 3),
              Zd(
                s,
                { pending: !0, data: l, method: i.method, action: o },
                o,
                l,
              ));
          }
        }));
    }
    function Qn(e) {
      function t(g) {
        return Hs(g, e);
      }
      ($i !== null && Hs($i, e),
        eo !== null && Hs(eo, e),
        to !== null && Hs(to, e),
        gu.forEach(t),
        Lu.forEach(t));
      for (var i = 0; i < Ni.length; i++) {
        var o = Ni[i];
        o.blockedOn === e && (o.blockedOn = null);
      }
      for (; 0 < Ni.length && ((i = Ni[0]), i.blockedOn === null);)
        (P1(i), i.blockedOn === null && Ni.shift());
      if (((i = (e.ownerDocument || e).$$reactFormReplay), i != null))
        for (o = 0; o < i.length; o += 3) {
          var l = i[o],
            s = i[o + 1],
            f = l[Pt] || null;
          if (typeof s == "function") f || Xp(i);
          else if (f) {
            var c = null;
            if (s && s.hasAttribute("formAction")) {
              if (((l = s), (f = s[Pt] || null))) c = f.formAction;
              else if (oh(l) !== null) continue;
            } else c = f.action;
            (typeof c == "function"
              ? (i[o + 1] = c)
              : (i.splice(o, 3), (o -= 3)),
              Xp(i));
          }
        }
    }
    function k1() {
      function e(s) {
        s.canIntercept &&
          s.info === "react-transition" &&
          s.intercept({
            handler: function () {
              return new Promise(function (f) {
                return (l = f);
              });
            },
            focusReset: "manual",
            scroll: "manual",
          });
      }
      function t() {
        (l !== null && (l(), (l = null)), o || setTimeout(i, 20));
      }
      function i() {
        if (!o && !navigation.transition) {
          var s = navigation.currentEntry;
          s &&
            s.url != null &&
            navigation.navigate(s.url, {
              state: s.getState(),
              info: "react-transition",
              history: "replace",
            });
        }
      }
      if (typeof navigation == "object") {
        var o = !1,
          l = null;
        return (
          navigation.addEventListener("navigate", e),
          navigation.addEventListener("navigatesuccess", t),
          navigation.addEventListener("navigateerror", t),
          setTimeout(i, 100),
          function () {
            ((o = !0),
              navigation.removeEventListener("navigate", e),
              navigation.removeEventListener("navigatesuccess", t),
              navigation.removeEventListener("navigateerror", t),
              l !== null && (l(), (l = null)));
          }
        );
      }
    }
    function nh(e) {
      this._internalRoot = e;
    }
    jr.prototype.render = nh.prototype.render = function (e) {
      var t = this._internalRoot;
      if (t === null) throw Error(k(409));
      var i = t.current,
        o = Gt();
      A1(i, o, e, t, null, null);
    };
    jr.prototype.unmount = nh.prototype.unmount = function () {
      var e = this._internalRoot;
      if (e !== null) {
        this._internalRoot = null;
        var t = e.containerInfo;
        (A1(e.current, 2, null, e, null, null), Gr(), (t[Wn] = null));
      }
    };
    function jr(e) {
      this._internalRoot = e;
    }
    jr.prototype.unstable_scheduleHydration = function (e) {
      if (e) {
        var t = s2();
        e = { blockedOn: null, target: e, priority: t };
        for (var i = 0; i < Ni.length && t !== 0 && t < Ni[i].priority; i++);
        (Ni.splice(i, 0, e), i === 0 && P1(e));
      }
    };
    var jp = Yp.version;
    if (jp !== "19.2.6") throw Error(k(527, jp, "19.2.6"));
    xe.findDOMNode = function (e) {
      var t = e._reactInternals;
      if (t === void 0)
        throw typeof e.render == "function"
          ? Error(k(188))
          : ((e = Object.keys(e).join(",")), Error(k(268, e)));
      return (
        (e = B_(t)),
        (e = e !== null ? Jp(e) : null),
        (e = e === null ? null : e.stateNode),
        e
      );
    };
    var ey = {
      bundleType: 0,
      version: "19.2.6",
      rendererPackageName: "react-dom",
      currentDispatcherRef: J,
      reconcilerVersion: "19.2.6",
    };
    if (
      typeof __REACT_DEVTOOLS_GLOBAL_HOOK__ < "u" &&
      ((ql = __REACT_DEVTOOLS_GLOBAL_HOOK__),
      !ql.isDisabled && ql.supportsFiber)
    )
      try {
        ((vu = ql.inject(ey)), (Ft = ql));
      } catch {}
    var ql;
    Yr.createRoot = function (e, t) {
      if (!Kp(e)) throw Error(k(299));
      var i = !1,
        o = "",
        l = Ig,
        s = bg,
        f = wg;
      return (
        t != null &&
          (t.unstable_strictMode === !0 && (i = !0),
          t.identifierPrefix !== void 0 && (o = t.identifierPrefix),
          t.onUncaughtError !== void 0 && (l = t.onUncaughtError),
          t.onCaughtError !== void 0 && (s = t.onCaughtError),
          t.onRecoverableError !== void 0 && (f = t.onRecoverableError)),
        (t = M1(e, 1, !1, null, null, i, o, null, l, s, f, k1)),
        (e[Wn] = t.current),
        $c(e),
        new nh(t)
      );
    };
    Yr.hydrateRoot = function (e, t, i) {
      if (!Kp(e)) throw Error(k(299));
      var o = !1,
        l = "",
        s = Ig,
        f = bg,
        c = wg,
        g = null;
      return (
        i != null &&
          (i.unstable_strictMode === !0 && (o = !0),
          i.identifierPrefix !== void 0 && (l = i.identifierPrefix),
          i.onUncaughtError !== void 0 && (s = i.onUncaughtError),
          i.onCaughtError !== void 0 && (f = i.onCaughtError),
          i.onRecoverableError !== void 0 && (c = i.onRecoverableError),
          i.formState !== void 0 && (g = i.formState)),
        (t = M1(e, 1, !0, t, i ?? null, o, l, g, s, f, c, k1)),
        (t.context = T1(null)),
        (i = t.current),
        (o = Gt()),
        (o = hc(o)),
        (l = Ki(o)),
        (l.callback = null),
        Qi(i, l, o),
        (i = o),
        (t.current.lanes = i),
        xu(t, i),
        Ha(t),
        (e[Wn] = t.current),
        $c(e),
        new jr(t)
      );
    };
    Yr.version = "19.2.6";
  });
  var E1 = va((Py, R1) => {
    "use strict";
    function O1() {
      if (!(
        typeof __REACT_DEVTOOLS_GLOBAL_HOOK__ > "u" ||
        typeof __REACT_DEVTOOLS_GLOBAL_HOOK__.checkDCE != "function"
      ))
        try {
          __REACT_DEVTOOLS_GLOBAL_HOOK__.checkDCE(O1);
        } catch (e) {
          console.error(e);
        }
    }
    (O1(), (R1.exports = z1()));
  });
  var lL = va((af) => {
    "use strict";
    var xy = Symbol.for("react.transitional.element"),
      Sy = Symbol.for("react.fragment");
    function nL(e, t, i) {
      var o = null;
      if (
        (i !== void 0 && (o = "" + i),
        t.key !== void 0 && (o = "" + t.key),
        "key" in t)
      ) {
        i = {};
        for (var l in t) l !== "key" && (i[l] = t[l]);
      } else i = t;
      return (
        (t = i.ref),
        {
          $$typeof: xy,
          type: e,
          key: o,
          ref: t !== void 0 ? t : null,
          props: i,
        }
      );
    }
    af.Fragment = Sy;
    af.jsx = nL;
    af.jsxs = nL;
  });
  var Vu = va((r4, uL) => {
    "use strict";
    uL.exports = lL();
  });
  var rL = va((of, sL) => {
    "use strict";
    (function (e, t) {
      typeof of == "object" && typeof sL < "u"
        ? t(of)
        : typeof define == "function" && define.amd
          ? define(["exports"], t)
          : ((e = typeof globalThis < "u" ? globalThis : e || self),
            t((e.leaflet = {})));
    })(of, function (e) {
      "use strict";
      var t = "1.9.4";
      function i(a) {
        var n, u, r, d;
        for (u = 1, r = arguments.length; u < r; u++) {
          d = arguments[u];
          for (n in d) a[n] = d[n];
        }
        return a;
      }
      var o =
        Object.create ||
        (function () {
          function a() {}
          return function (n) {
            return ((a.prototype = n), new a());
          };
        })();
      function l(a, n) {
        var u = Array.prototype.slice;
        if (a.bind) return a.bind.apply(a, u.call(arguments, 1));
        var r = u.call(arguments, 2);
        return function () {
          return a.apply(n, r.length ? r.concat(u.call(arguments)) : arguments);
        };
      }
      var s = 0;
      function f(a) {
        return ("_leaflet_id" in a || (a._leaflet_id = ++s), a._leaflet_id);
      }
      function c(a, n, u) {
        var r, d, h, I;
        return (
          (I = function () {
            ((r = !1), d && (h.apply(u, d), (d = !1)));
          }),
          (h = function () {
            r
              ? (d = arguments)
              : (a.apply(u, arguments), setTimeout(I, n), (r = !0));
          }),
          h
        );
      }
      function g(a, n, u) {
        var r = n[1],
          d = n[0],
          h = r - d;
        return a === r && u ? a : ((((a - d) % h) + h) % h) + d;
      }
      function y() {
        return !1;
      }
      function p(a, n) {
        if (n === !1) return a;
        var u = Math.pow(10, n === void 0 ? 6 : n);
        return Math.round(a * u) / u;
      }
      function _(a) {
        return a.trim ? a.trim() : a.replace(/^\s+|\s+$/g, "");
      }
      function v(a) {
        return _(a).split(/\s+/);
      }
      function x(a, n) {
        Object.prototype.hasOwnProperty.call(a, "options") ||
          (a.options = a.options ? o(a.options) : {});
        for (var u in n) a.options[u] = n[u];
        return a.options;
      }
      function B(a, n, u) {
        var r = [];
        for (var d in a)
          r.push(
            encodeURIComponent(u ? d.toUpperCase() : d) +
              "=" +
              encodeURIComponent(a[d]),
          );
        return (!n || n.indexOf("?") === -1 ? "?" : "&") + r.join("&");
      }
      var P = /\{ *([\w_ -]+) *\}/g;
      function Z(a, n) {
        return a.replace(P, function (u, r) {
          var d = n[r];
          if (d === void 0)
            throw new Error("No value provided for variable " + u);
          return (typeof d == "function" && (d = d(n)), d);
        });
      }
      var b =
        Array.isArray ||
        function (a) {
          return Object.prototype.toString.call(a) === "[object Array]";
        };
      function C(a, n) {
        for (var u = 0; u < a.length; u++) if (a[u] === n) return u;
        return -1;
      }
      var w = "data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=";
      function T(a) {
        return window["webkit" + a] || window["moz" + a] || window["ms" + a];
      }
      var z = 0;
      function ue(a) {
        var n = +new Date(),
          u = Math.max(0, 16 - (n - z));
        return ((z = n + u), window.setTimeout(a, u));
      }
      var F = window.requestAnimationFrame || T("RequestAnimationFrame") || ue,
        j =
          window.cancelAnimationFrame ||
          T("CancelAnimationFrame") ||
          T("CancelRequestAnimationFrame") ||
          function (a) {
            window.clearTimeout(a);
          };
      function V(a, n, u) {
        if (u && F === ue) a.call(n);
        else return F.call(window, l(a, n));
      }
      function W(a) {
        a && j.call(window, a);
      }
      var Y = {
        __proto__: null,
        extend: i,
        create: o,
        bind: l,
        get lastId() {
          return s;
        },
        stamp: f,
        throttle: c,
        wrapNum: g,
        falseFn: y,
        formatNum: p,
        trim: _,
        splitWords: v,
        setOptions: x,
        getParamString: B,
        template: Z,
        isArray: b,
        indexOf: C,
        emptyImageUrl: w,
        requestFn: F,
        cancelFn: j,
        requestAnimFrame: V,
        cancelAnimFrame: W,
      };
      function Ze() {}
      ((Ze.extend = function (a) {
        var n = function () {
            (x(this),
              this.initialize && this.initialize.apply(this, arguments),
              this.callInitHooks());
          },
          u = (n.__super__ = this.prototype),
          r = o(u);
        ((r.constructor = n), (n.prototype = r));
        for (var d in this)
          Object.prototype.hasOwnProperty.call(this, d) &&
            d !== "prototype" &&
            d !== "__super__" &&
            (n[d] = this[d]);
        return (
          a.statics && i(n, a.statics),
          a.includes && (Ca(a.includes), i.apply(null, [r].concat(a.includes))),
          i(r, a),
          delete r.statics,
          delete r.includes,
          r.options &&
            ((r.options = u.options ? o(u.options) : {}),
            i(r.options, a.options)),
          (r._initHooks = []),
          (r.callInitHooks = function () {
            if (!this._initHooksCalled) {
              (u.callInitHooks && u.callInitHooks.call(this),
                (this._initHooksCalled = !0));
              for (var h = 0, I = r._initHooks.length; h < I; h++)
                r._initHooks[h].call(this);
            }
          }),
          n
        );
      }),
        (Ze.include = function (a) {
          var n = this.prototype.options;
          return (
            i(this.prototype, a),
            a.options &&
              ((this.prototype.options = n), this.mergeOptions(a.options)),
            this
          );
        }),
        (Ze.mergeOptions = function (a) {
          return (i(this.prototype.options, a), this);
        }),
        (Ze.addInitHook = function (a) {
          var n = Array.prototype.slice.call(arguments, 1),
            u =
              typeof a == "function"
                ? a
                : function () {
                    this[a].apply(this, n);
                  };
          return (
            (this.prototype._initHooks = this.prototype._initHooks || []),
            this.prototype._initHooks.push(u),
            this
          );
        }));
      function Ca(a) {
        if (!(typeof L > "u" || !L || !L.Mixin)) {
          a = b(a) ? a : [a];
          for (var n = 0; n < a.length; n++)
            a[n] === L.Mixin.Events &&
              console.warn(
                "Deprecated include of L.Mixin.Events: this property will be removed in future releases, please inherit from L.Evented instead.",
                new Error().stack,
              );
        }
      }
      var et = {
        on: function (a, n, u) {
          if (typeof a == "object") for (var r in a) this._on(r, a[r], n);
          else {
            a = v(a);
            for (var d = 0, h = a.length; d < h; d++) this._on(a[d], n, u);
          }
          return this;
        },
        off: function (a, n, u) {
          if (!arguments.length) delete this._events;
          else if (typeof a == "object") for (var r in a) this._off(r, a[r], n);
          else {
            a = v(a);
            for (
              var d = arguments.length === 1, h = 0, I = a.length;
              h < I;
              h++
            )
              d ? this._off(a[h]) : this._off(a[h], n, u);
          }
          return this;
        },
        _on: function (a, n, u, r) {
          if (typeof n != "function") {
            console.warn("wrong listener type: " + typeof n);
            return;
          }
          if (this._listens(a, n, u) === !1) {
            u === this && (u = void 0);
            var d = { fn: n, ctx: u };
            (r && (d.once = !0),
              (this._events = this._events || {}),
              (this._events[a] = this._events[a] || []),
              this._events[a].push(d));
          }
        },
        _off: function (a, n, u) {
          var r, d, h;
          if (this._events && ((r = this._events[a]), !!r)) {
            if (arguments.length === 1) {
              if (this._firingCount)
                for (d = 0, h = r.length; d < h; d++) r[d].fn = y;
              delete this._events[a];
              return;
            }
            if (typeof n != "function") {
              console.warn("wrong listener type: " + typeof n);
              return;
            }
            var I = this._listens(a, n, u);
            if (I !== !1) {
              var M = r[I];
              (this._firingCount &&
                ((M.fn = y), (this._events[a] = r = r.slice())),
                r.splice(I, 1));
            }
          }
        },
        fire: function (a, n, u) {
          if (!this.listens(a, u)) return this;
          var r = i({}, n, {
            type: a,
            target: this,
            sourceTarget: (n && n.sourceTarget) || this,
          });
          if (this._events) {
            var d = this._events[a];
            if (d) {
              this._firingCount = this._firingCount + 1 || 1;
              for (var h = 0, I = d.length; h < I; h++) {
                var M = d[h],
                  D = M.fn;
                (M.once && this.off(a, D, M.ctx), D.call(M.ctx || this, r));
              }
              this._firingCount--;
            }
          }
          return (u && this._propagateEvent(r), this);
        },
        listens: function (a, n, u, r) {
          typeof a != "string" &&
            console.warn('"string" type argument expected');
          var d = n;
          typeof n != "function" && ((r = !!n), (d = void 0), (u = void 0));
          var h = this._events && this._events[a];
          if (h && h.length && this._listens(a, d, u) !== !1) return !0;
          if (r) {
            for (var I in this._eventParents)
              if (this._eventParents[I].listens(a, n, u, r)) return !0;
          }
          return !1;
        },
        _listens: function (a, n, u) {
          if (!this._events) return !1;
          var r = this._events[a] || [];
          if (!n) return !!r.length;
          u === this && (u = void 0);
          for (var d = 0, h = r.length; d < h; d++)
            if (r[d].fn === n && r[d].ctx === u) return d;
          return !1;
        },
        once: function (a, n, u) {
          if (typeof a == "object") for (var r in a) this._on(r, a[r], n, !0);
          else {
            a = v(a);
            for (var d = 0, h = a.length; d < h; d++) this._on(a[d], n, u, !0);
          }
          return this;
        },
        addEventParent: function (a) {
          return (
            (this._eventParents = this._eventParents || {}),
            (this._eventParents[f(a)] = a),
            this
          );
        },
        removeEventParent: function (a) {
          return (this._eventParents && delete this._eventParents[f(a)], this);
        },
        _propagateEvent: function (a) {
          for (var n in this._eventParents)
            this._eventParents[n].fire(
              a.type,
              i({ layer: a.target, propagatedFrom: a.target }, a),
              !0,
            );
        },
      };
      ((et.addEventListener = et.on),
        (et.removeEventListener = et.clearAllEventListeners = et.off),
        (et.addOneTimeEventListener = et.once),
        (et.fireEvent = et.fire),
        (et.hasEventListeners = et.listens));
      var Ii = Ze.extend(et);
      function $(a, n, u) {
        ((this.x = u ? Math.round(a) : a), (this.y = u ? Math.round(n) : n));
      }
      var Xu =
        Math.trunc ||
        function (a) {
          return a > 0 ? Math.floor(a) : Math.ceil(a);
        };
      $.prototype = {
        clone: function () {
          return new $(this.x, this.y);
        },
        add: function (a) {
          return this.clone()._add(ee(a));
        },
        _add: function (a) {
          return ((this.x += a.x), (this.y += a.y), this);
        },
        subtract: function (a) {
          return this.clone()._subtract(ee(a));
        },
        _subtract: function (a) {
          return ((this.x -= a.x), (this.y -= a.y), this);
        },
        divideBy: function (a) {
          return this.clone()._divideBy(a);
        },
        _divideBy: function (a) {
          return ((this.x /= a), (this.y /= a), this);
        },
        multiplyBy: function (a) {
          return this.clone()._multiplyBy(a);
        },
        _multiplyBy: function (a) {
          return ((this.x *= a), (this.y *= a), this);
        },
        scaleBy: function (a) {
          return new $(this.x * a.x, this.y * a.y);
        },
        unscaleBy: function (a) {
          return new $(this.x / a.x, this.y / a.y);
        },
        round: function () {
          return this.clone()._round();
        },
        _round: function () {
          return (
            (this.x = Math.round(this.x)),
            (this.y = Math.round(this.y)),
            this
          );
        },
        floor: function () {
          return this.clone()._floor();
        },
        _floor: function () {
          return (
            (this.x = Math.floor(this.x)),
            (this.y = Math.floor(this.y)),
            this
          );
        },
        ceil: function () {
          return this.clone()._ceil();
        },
        _ceil: function () {
          return (
            (this.x = Math.ceil(this.x)),
            (this.y = Math.ceil(this.y)),
            this
          );
        },
        trunc: function () {
          return this.clone()._trunc();
        },
        _trunc: function () {
          return ((this.x = Xu(this.x)), (this.y = Xu(this.y)), this);
        },
        distanceTo: function (a) {
          a = ee(a);
          var n = a.x - this.x,
            u = a.y - this.y;
          return Math.sqrt(n * n + u * u);
        },
        equals: function (a) {
          return ((a = ee(a)), a.x === this.x && a.y === this.y);
        },
        contains: function (a) {
          return (
            (a = ee(a)),
            Math.abs(a.x) <= Math.abs(this.x) &&
              Math.abs(a.y) <= Math.abs(this.y)
          );
        },
        toString: function () {
          return "Point(" + p(this.x) + ", " + p(this.y) + ")";
        },
      };
      function ee(a, n, u) {
        return a instanceof $
          ? a
          : b(a)
            ? new $(a[0], a[1])
            : a == null
              ? a
              : typeof a == "object" && "x" in a && "y" in a
                ? new $(a.x, a.y)
                : new $(a, n, u);
      }
      function De(a, n) {
        if (a)
          for (var u = n ? [a, n] : a, r = 0, d = u.length; r < d; r++)
            this.extend(u[r]);
      }
      De.prototype = {
        extend: function (a) {
          var n, u;
          if (!a) return this;
          if (a instanceof $ || typeof a[0] == "number" || "x" in a)
            n = u = ee(a);
          else if (((a = Xe(a)), (n = a.min), (u = a.max), !n || !u))
            return this;
          return (
            !this.min && !this.max
              ? ((this.min = n.clone()), (this.max = u.clone()))
              : ((this.min.x = Math.min(n.x, this.min.x)),
                (this.max.x = Math.max(u.x, this.max.x)),
                (this.min.y = Math.min(n.y, this.min.y)),
                (this.max.y = Math.max(u.y, this.max.y))),
            this
          );
        },
        getCenter: function (a) {
          return ee(
            (this.min.x + this.max.x) / 2,
            (this.min.y + this.max.y) / 2,
            a,
          );
        },
        getBottomLeft: function () {
          return ee(this.min.x, this.max.y);
        },
        getTopRight: function () {
          return ee(this.max.x, this.min.y);
        },
        getTopLeft: function () {
          return this.min;
        },
        getBottomRight: function () {
          return this.max;
        },
        getSize: function () {
          return this.max.subtract(this.min);
        },
        contains: function (a) {
          var n, u;
          return (
            typeof a[0] == "number" || a instanceof $
              ? (a = ee(a))
              : (a = Xe(a)),
            a instanceof De ? ((n = a.min), (u = a.max)) : (n = u = a),
            n.x >= this.min.x &&
              u.x <= this.max.x &&
              n.y >= this.min.y &&
              u.y <= this.max.y
          );
        },
        intersects: function (a) {
          a = Xe(a);
          var n = this.min,
            u = this.max,
            r = a.min,
            d = a.max,
            h = d.x >= n.x && r.x <= u.x,
            I = d.y >= n.y && r.y <= u.y;
          return h && I;
        },
        overlaps: function (a) {
          a = Xe(a);
          var n = this.min,
            u = this.max,
            r = a.min,
            d = a.max,
            h = d.x > n.x && r.x < u.x,
            I = d.y > n.y && r.y < u.y;
          return h && I;
        },
        isValid: function () {
          return !!(this.min && this.max);
        },
        pad: function (a) {
          var n = this.min,
            u = this.max,
            r = Math.abs(n.x - u.x) * a,
            d = Math.abs(n.y - u.y) * a;
          return Xe(ee(n.x - r, n.y - d), ee(u.x + r, u.y + d));
        },
        equals: function (a) {
          return a
            ? ((a = Xe(a)),
              this.min.equals(a.getTopLeft()) &&
                this.max.equals(a.getBottomRight()))
            : !1;
        },
      };
      function Xe(a, n) {
        return !a || a instanceof De ? a : new De(a, n);
      }
      function je(a, n) {
        if (a)
          for (var u = n ? [a, n] : a, r = 0, d = u.length; r < d; r++)
            this.extend(u[r]);
      }
      je.prototype = {
        extend: function (a) {
          var n = this._southWest,
            u = this._northEast,
            r,
            d;
          if (a instanceof q) ((r = a), (d = a));
          else if (a instanceof je) {
            if (((r = a._southWest), (d = a._northEast), !r || !d)) return this;
          } else return a ? this.extend(fe(a) || He(a)) : this;
          return (
            !n && !u
              ? ((this._southWest = new q(r.lat, r.lng)),
                (this._northEast = new q(d.lat, d.lng)))
              : ((n.lat = Math.min(r.lat, n.lat)),
                (n.lng = Math.min(r.lng, n.lng)),
                (u.lat = Math.max(d.lat, u.lat)),
                (u.lng = Math.max(d.lng, u.lng))),
            this
          );
        },
        pad: function (a) {
          var n = this._southWest,
            u = this._northEast,
            r = Math.abs(n.lat - u.lat) * a,
            d = Math.abs(n.lng - u.lng) * a;
          return new je(
            new q(n.lat - r, n.lng - d),
            new q(u.lat + r, u.lng + d),
          );
        },
        getCenter: function () {
          return new q(
            (this._southWest.lat + this._northEast.lat) / 2,
            (this._southWest.lng + this._northEast.lng) / 2,
          );
        },
        getSouthWest: function () {
          return this._southWest;
        },
        getNorthEast: function () {
          return this._northEast;
        },
        getNorthWest: function () {
          return new q(this.getNorth(), this.getWest());
        },
        getSouthEast: function () {
          return new q(this.getSouth(), this.getEast());
        },
        getWest: function () {
          return this._southWest.lng;
        },
        getSouth: function () {
          return this._southWest.lat;
        },
        getEast: function () {
          return this._northEast.lng;
        },
        getNorth: function () {
          return this._northEast.lat;
        },
        contains: function (a) {
          typeof a[0] == "number" || a instanceof q || "lat" in a
            ? (a = fe(a))
            : (a = He(a));
          var n = this._southWest,
            u = this._northEast,
            r,
            d;
          return (
            a instanceof je
              ? ((r = a.getSouthWest()), (d = a.getNorthEast()))
              : (r = d = a),
            r.lat >= n.lat && d.lat <= u.lat && r.lng >= n.lng && d.lng <= u.lng
          );
        },
        intersects: function (a) {
          a = He(a);
          var n = this._southWest,
            u = this._northEast,
            r = a.getSouthWest(),
            d = a.getNorthEast(),
            h = d.lat >= n.lat && r.lat <= u.lat,
            I = d.lng >= n.lng && r.lng <= u.lng;
          return h && I;
        },
        overlaps: function (a) {
          a = He(a);
          var n = this._southWest,
            u = this._northEast,
            r = a.getSouthWest(),
            d = a.getNorthEast(),
            h = d.lat > n.lat && r.lat < u.lat,
            I = d.lng > n.lng && r.lng < u.lng;
          return h && I;
        },
        toBBoxString: function () {
          return [
            this.getWest(),
            this.getSouth(),
            this.getEast(),
            this.getNorth(),
          ].join(",");
        },
        equals: function (a, n) {
          return a
            ? ((a = He(a)),
              this._southWest.equals(a.getSouthWest(), n) &&
                this._northEast.equals(a.getNorthEast(), n))
            : !1;
        },
        isValid: function () {
          return !!(this._southWest && this._northEast);
        },
      };
      function He(a, n) {
        return a instanceof je ? a : new je(a, n);
      }
      function q(a, n, u) {
        if (isNaN(a) || isNaN(n))
          throw new Error("Invalid LatLng object: (" + a + ", " + n + ")");
        ((this.lat = +a), (this.lng = +n), u !== void 0 && (this.alt = +u));
      }
      q.prototype = {
        equals: function (a, n) {
          if (!a) return !1;
          a = fe(a);
          var u = Math.max(
            Math.abs(this.lat - a.lat),
            Math.abs(this.lng - a.lng),
          );
          return u <= (n === void 0 ? 1e-9 : n);
        },
        toString: function (a) {
          return "LatLng(" + p(this.lat, a) + ", " + p(this.lng, a) + ")";
        },
        distanceTo: function (a) {
          return Yt.distance(this, fe(a));
        },
        wrap: function () {
          return Yt.wrapLatLng(this);
        },
        toBounds: function (a) {
          var n = (180 * a) / 40075017,
            u = n / Math.cos((Math.PI / 180) * this.lat);
          return He([this.lat - n, this.lng - u], [this.lat + n, this.lng + u]);
        },
        clone: function () {
          return new q(this.lat, this.lng, this.alt);
        },
      };
      function fe(a, n, u) {
        return a instanceof q
          ? a
          : b(a) && typeof a[0] != "object"
            ? a.length === 3
              ? new q(a[0], a[1], a[2])
              : a.length === 2
                ? new q(a[0], a[1])
                : null
            : a == null
              ? a
              : typeof a == "object" && "lat" in a
                ? new q(a.lat, "lng" in a ? a.lng : a.lon, a.alt)
                : n === void 0
                  ? null
                  : new q(a, n, u);
      }
      var ca = {
          latLngToPoint: function (a, n) {
            var u = this.projection.project(a),
              r = this.scale(n);
            return this.transformation._transform(u, r);
          },
          pointToLatLng: function (a, n) {
            var u = this.scale(n),
              r = this.transformation.untransform(a, u);
            return this.projection.unproject(r);
          },
          project: function (a) {
            return this.projection.project(a);
          },
          unproject: function (a) {
            return this.projection.unproject(a);
          },
          scale: function (a) {
            return 256 * Math.pow(2, a);
          },
          zoom: function (a) {
            return Math.log(a / 256) / Math.LN2;
          },
          getProjectedBounds: function (a) {
            if (this.infinite) return null;
            var n = this.projection.bounds,
              u = this.scale(a),
              r = this.transformation.transform(n.min, u),
              d = this.transformation.transform(n.max, u);
            return new De(r, d);
          },
          infinite: !1,
          wrapLatLng: function (a) {
            var n = this.wrapLng ? g(a.lng, this.wrapLng, !0) : a.lng,
              u = this.wrapLat ? g(a.lat, this.wrapLat, !0) : a.lat,
              r = a.alt;
            return new q(u, n, r);
          },
          wrapLatLngBounds: function (a) {
            var n = a.getCenter(),
              u = this.wrapLatLng(n),
              r = n.lat - u.lat,
              d = n.lng - u.lng;
            if (r === 0 && d === 0) return a;
            var h = a.getSouthWest(),
              I = a.getNorthEast(),
              M = new q(h.lat - r, h.lng - d),
              D = new q(I.lat - r, I.lng - d);
            return new je(M, D);
          },
        },
        Yt = i({}, ca, {
          wrapLng: [-180, 180],
          R: 6371e3,
          distance: function (a, n) {
            var u = Math.PI / 180,
              r = a.lat * u,
              d = n.lat * u,
              h = Math.sin(((n.lat - a.lat) * u) / 2),
              I = Math.sin(((n.lng - a.lng) * u) / 2),
              M = h * h + Math.cos(r) * Math.cos(d) * I * I,
              D = 2 * Math.atan2(Math.sqrt(M), Math.sqrt(1 - M));
            return this.R * D;
          },
        }),
        te = 6378137,
        Kt = {
          R: te,
          MAX_LATITUDE: 85.0511287798,
          project: function (a) {
            var n = Math.PI / 180,
              u = this.MAX_LATITUDE,
              r = Math.max(Math.min(u, a.lat), -u),
              d = Math.sin(r * n);
            return new $(
              this.R * a.lng * n,
              (this.R * Math.log((1 + d) / (1 - d))) / 2,
            );
          },
          unproject: function (a) {
            var n = 180 / Math.PI;
            return new q(
              (2 * Math.atan(Math.exp(a.y / this.R)) - Math.PI / 2) * n,
              (a.x * n) / this.R,
            );
          },
          bounds: (function () {
            var a = te * Math.PI;
            return new De([-a, -a], [a, a]);
          })(),
        };
      function Zo(a, n, u, r) {
        if (b(a)) {
          ((this._a = a[0]),
            (this._b = a[1]),
            (this._c = a[2]),
            (this._d = a[3]));
          return;
        }
        ((this._a = a), (this._b = n), (this._c = u), (this._d = r));
      }
      Zo.prototype = {
        transform: function (a, n) {
          return this._transform(a.clone(), n);
        },
        _transform: function (a, n) {
          return (
            (n = n || 1),
            (a.x = n * (this._a * a.x + this._b)),
            (a.y = n * (this._c * a.y + this._d)),
            a
          );
        },
        untransform: function (a, n) {
          return (
            (n = n || 1),
            new $((a.x / n - this._b) / this._a, (a.y / n - this._d) / this._c)
          );
        },
      };
      function bi(a, n, u, r) {
        return new Zo(a, n, u, r);
      }
      var Ye = i({}, Yt, {
          code: "EPSG:3857",
          projection: Kt,
          transformation: (function () {
            var a = 0.5 / (Math.PI * Kt.R);
            return bi(a, 0.5, -a, 0.5);
          })(),
        }),
        ju = i({}, Ye, { code: "EPSG:900913" });
      function K(a) {
        return document.createElementNS("http://www.w3.org/2000/svg", a);
      }
      function zt(a, n) {
        var u = "",
          r,
          d,
          h,
          I,
          M,
          D;
        for (r = 0, h = a.length; r < h; r++) {
          for (M = a[r], d = 0, I = M.length; d < I; d++)
            ((D = M[d]), (u += (d ? "L" : "M") + D.x + " " + D.y));
          u += n ? (X.svg ? "z" : "x") : "";
        }
        return u || "M0 0";
      }
      var Za = document.documentElement.style,
        fo = "ActiveXObject" in window,
        Ia = fo && !document.addEventListener,
        rl = "msLaunchUri" in navigator && !("documentMode" in document),
        co = ut("webkit"),
        ho = ut("android"),
        Yu = ut("android 2") || ut("android 3"),
        fl = parseInt(/WebKit\/([0-9]+)|$/.exec(navigator.userAgent)[1], 10),
        nf = ho && ut("Google") && fl < 537 && !("AudioNode" in window),
        Go = !!window.opera,
        Ku = !rl && ut("chrome"),
        Vo = ut("gecko") && !co && !Go && !fo,
        dl = !Ku && ut("safari"),
        Xo = ut("phantom"),
        Ga = "OTransition" in Za,
        cl = navigator.platform.indexOf("Win") === 0,
        wi = fo && "transition" in Za,
        mo =
          "WebKitCSSMatrix" in window &&
          "m11" in new window.WebKitCSSMatrix() &&
          !Yu,
        ba = "MozPerspective" in Za,
        Qu = !window.L_DISABLE_3D && (wi || mo || ba) && !Ga && !Xo,
        Va = typeof orientation < "u" || ut("mobile"),
        lf = Va && co,
        Wu = Va && mo,
        po = !window.PointerEvent && window.MSPointerEvent,
        jo = !!(window.PointerEvent || po),
        Ju = "ontouchstart" in window || !!window.TouchEvent,
        hl = !window.L_NO_TOUCH && (Ju || jo),
        uf = Va && Go,
        Yo = Va && Vo,
        ml =
          (window.devicePixelRatio ||
            window.screen.deviceXDPI / window.screen.logicalXDPI) > 1,
        $u = (function () {
          var a = !1;
          try {
            var n = Object.defineProperty({}, "passive", {
              get: function () {
                a = !0;
              },
            });
            (window.addEventListener("testPassiveEventSupport", y, n),
              window.removeEventListener("testPassiveEventSupport", y, n));
          } catch {}
          return a;
        })(),
        pl = (function () {
          return !!document.createElement("canvas").getContext;
        })(),
        wa = !!(document.createElementNS && K("svg").createSVGRect),
        gl =
          !!wa &&
          (function () {
            var a = document.createElement("div");
            return (
              (a.innerHTML = "<svg/>"),
              (a.firstChild && a.firstChild.namespaceURI) ===
                "http://www.w3.org/2000/svg"
            );
          })(),
        sf =
          !wa &&
          (function () {
            try {
              var a = document.createElement("div");
              a.innerHTML = '<v:shape adj="1"/>';
              var n = a.firstChild;
              return (
                (n.style.behavior = "url(#default#VML)"),
                n && typeof n.adj == "object"
              );
            } catch {
              return !1;
            }
          })(),
        rf = navigator.platform.indexOf("Mac") === 0,
        es = navigator.platform.indexOf("Linux") === 0;
      function ut(a) {
        return navigator.userAgent.toLowerCase().indexOf(a) >= 0;
      }
      var X = {
          ie: fo,
          ielt9: Ia,
          edge: rl,
          webkit: co,
          android: ho,
          android23: Yu,
          androidStock: nf,
          opera: Go,
          chrome: Ku,
          gecko: Vo,
          safari: dl,
          phantom: Xo,
          opera12: Ga,
          win: cl,
          ie3d: wi,
          webkit3d: mo,
          gecko3d: ba,
          any3d: Qu,
          mobile: Va,
          mobileWebkit: lf,
          mobileWebkit3d: Wu,
          msPointer: po,
          pointer: jo,
          touch: hl,
          touchNative: Ju,
          mobileOpera: uf,
          mobileGecko: Yo,
          retina: ml,
          passiveEvents: $u,
          canvas: pl,
          svg: wa,
          vml: sf,
          inlineSvg: gl,
          mac: rf,
          linux: es,
        },
        Ko = X.msPointer ? "MSPointerDown" : "pointerdown",
        Ll = X.msPointer ? "MSPointerMove" : "pointermove",
        Ot = X.msPointer ? "MSPointerUp" : "pointerup",
        ha = X.msPointer ? "MSPointerCancel" : "pointercancel",
        Ma = { touchstart: Ko, touchmove: Ll, touchend: Ot, touchcancel: ha },
        Qo = { touchstart: is, touchmove: Xa, touchend: Xa, touchcancel: Xa },
        Ta = {},
        Mi = !1;
      function ts(a, n, u) {
        return (
          n === "touchstart" && St(),
          Qo[n]
            ? ((u = Qo[n].bind(this, u)), a.addEventListener(Ma[n], u, !1), u)
            : (console.warn("wrong event specified:", n), y)
        );
      }
      function _l(a, n, u) {
        if (!Ma[n]) {
          console.warn("wrong event specified:", n);
          return;
        }
        a.removeEventListener(Ma[n], u, !1);
      }
      function as(a) {
        Ta[a.pointerId] = a;
      }
      function go(a) {
        Ta[a.pointerId] && (Ta[a.pointerId] = a);
      }
      function Wo(a) {
        delete Ta[a.pointerId];
      }
      function St() {
        Mi ||
          (document.addEventListener(Ko, as, !0),
          document.addEventListener(Ll, go, !0),
          document.addEventListener(Ot, Wo, !0),
          document.addEventListener(ha, Wo, !0),
          (Mi = !0));
      }
      function Xa(a, n) {
        if (n.pointerType !== (n.MSPOINTER_TYPE_MOUSE || "mouse")) {
          n.touches = [];
          for (var u in Ta) n.touches.push(Ta[u]);
          ((n.changedTouches = [n]), a(n));
        }
      }
      function is(a, n) {
        (n.MSPOINTER_TYPE_TOUCH &&
          n.pointerType === n.MSPOINTER_TYPE_TOUCH &&
          se(n),
          Xa(a, n));
      }
      function Ie(a) {
        var n = {},
          u,
          r;
        for (r in a) ((u = a[r]), (n[r] = u && u.bind ? u.bind(a) : u));
        return (
          (a = n),
          (n.type = "dblclick"),
          (n.detail = 2),
          (n.isTrusted = !1),
          (n._simulated = !0),
          n
        );
      }
      var Ti = 200;
      function Jo(a, n) {
        a.addEventListener("dblclick", n);
        var u = 0,
          r;
        function d(h) {
          if (h.detail !== 1) {
            r = h.detail;
            return;
          }
          if (!(
            h.pointerType === "mouse" ||
            (h.sourceCapabilities && !h.sourceCapabilities.firesTouchEvents)
          )) {
            var I = mt(h);
            if (!(
              I.some(function (D) {
                return D instanceof HTMLLabelElement && D.attributes.for;
              }) &&
              !I.some(function (D) {
                return (
                  D instanceof HTMLInputElement ||
                  D instanceof HTMLSelectElement
                );
              })
            )) {
              var M = Date.now();
              (M - u <= Ti ? (r++, r === 2 && n(Ie(h))) : (r = 1), (u = M));
            }
          }
        }
        return (
          a.addEventListener("click", d),
          { dblclick: n, simDblclick: d }
        );
      }
      function os(a, n) {
        (a.removeEventListener("dblclick", n.dblclick),
          a.removeEventListener("click", n.simDblclick));
      }
      var Ai = Ya([
          "transform",
          "webkitTransform",
          "OTransform",
          "MozTransform",
          "msTransform",
        ]),
        Aa = Ya([
          "webkitTransition",
          "transition",
          "OTransition",
          "MozTransition",
          "msTransition",
        ]),
        $o =
          Aa === "webkitTransition" || Aa === "OTransition"
            ? Aa + "End"
            : "transitionend";
      function en(a) {
        return typeof a == "string" ? document.getElementById(a) : a;
      }
      function Qt(a, n) {
        var u = a.style[n] || (a.currentStyle && a.currentStyle[n]);
        if ((!u || u === "auto") && document.defaultView) {
          var r = document.defaultView.getComputedStyle(a, null);
          u = r ? r[n] : null;
        }
        return u === "auto" ? null : u;
      }
      function he(a, n, u) {
        var r = document.createElement(a);
        return ((r.className = n || ""), u && u.appendChild(r), r);
      }
      function Me(a) {
        var n = a.parentNode;
        n && n.removeChild(a);
      }
      function Ct(a) {
        for (; a.firstChild;) a.removeChild(a.firstChild);
      }
      function st(a) {
        var n = a.parentNode;
        n && n.lastChild !== a && n.appendChild(a);
      }
      function Di(a) {
        var n = a.parentNode;
        n && n.firstChild !== a && n.insertBefore(a, n.firstChild);
      }
      function ma(a, n) {
        if (a.classList !== void 0) return a.classList.contains(n);
        var u = ja(a);
        return u.length > 0 && new RegExp("(^|\\s)" + n + "(\\s|$)").test(u);
      }
      function oe(a, n) {
        if (a.classList !== void 0)
          for (var u = v(n), r = 0, d = u.length; r < d; r++)
            a.classList.add(u[r]);
        else if (!ma(a, n)) {
          var h = ja(a);
          Lo(a, (h ? h + " " : "") + n);
        }
      }
      function Re(a, n) {
        a.classList !== void 0
          ? a.classList.remove(n)
          : Lo(a, _((" " + ja(a) + " ").replace(" " + n + " ", " ")));
      }
      function Lo(a, n) {
        a.className.baseVal === void 0
          ? (a.className = n)
          : (a.className.baseVal = n);
      }
      function ja(a) {
        return (
          a.correspondingElement && (a = a.correspondingElement),
          a.className.baseVal === void 0 ? a.className : a.className.baseVal
        );
      }
      function It(a, n) {
        "opacity" in a.style
          ? (a.style.opacity = n)
          : "filter" in a.style && vl(a, n);
      }
      function vl(a, n) {
        var u = !1,
          r = "DXImageTransform.Microsoft.Alpha";
        try {
          u = a.filters.item(r);
        } catch {
          if (n === 1) return;
        }
        ((n = Math.round(n * 100)),
          u
            ? ((u.Enabled = n !== 100), (u.Opacity = n))
            : (a.style.filter += " progid:" + r + "(opacity=" + n + ")"));
      }
      function Ya(a) {
        for (var n = document.documentElement.style, u = 0; u < a.length; u++)
          if (a[u] in n) return a[u];
        return !1;
      }
      function pa(a, n, u) {
        var r = n || new $(0, 0);
        a.style[Ai] =
          (X.ie3d
            ? "translate(" + r.x + "px," + r.y + "px)"
            : "translate3d(" + r.x + "px," + r.y + "px,0)") +
          (u ? " scale(" + u + ")" : "");
      }
      function qe(a, n) {
        ((a._leaflet_pos = n),
          X.any3d
            ? pa(a, n)
            : ((a.style.left = n.x + "px"), (a.style.top = n.y + "px")));
      }
      function Wt(a) {
        return a._leaflet_pos || new $(0, 0);
      }
      var Ka, Bi, yl;
      if ("onselectstart" in document)
        ((Ka = function () {
          ae(window, "selectstart", se);
        }),
          (Bi = function () {
            A(window, "selectstart", se);
          }));
      else {
        var Qa = Ya([
          "userSelect",
          "WebkitUserSelect",
          "OUserSelect",
          "MozUserSelect",
          "msUserSelect",
        ]);
        ((Ka = function () {
          if (Qa) {
            var a = document.documentElement.style;
            ((yl = a[Qa]), (a[Qa] = "none"));
          }
        }),
          (Bi = function () {
            Qa && ((document.documentElement.style[Qa] = yl), (yl = void 0));
          }));
      }
      function Da() {
        ae(window, "dragstart", se);
      }
      function xl() {
        A(window, "dragstart", se);
      }
      var Wa, tn;
      function an(a) {
        for (; a.tabIndex === -1;) a = a.parentNode;
        a.style &&
          (on(),
          (Wa = a),
          (tn = a.style.outlineStyle),
          (a.style.outlineStyle = "none"),
          ae(window, "keydown", on));
      }
      function on() {
        Wa &&
          ((Wa.style.outlineStyle = tn),
          (Wa = void 0),
          (tn = void 0),
          A(window, "keydown", on));
      }
      function ns(a) {
        do a = a.parentNode;
        while ((!a.offsetWidth || !a.offsetHeight) && a !== document.body);
        return a;
      }
      function Sl(a) {
        var n = a.getBoundingClientRect();
        return {
          x: n.width / a.offsetWidth || 1,
          y: n.height / a.offsetHeight || 1,
          boundingClientRect: n,
        };
      }
      var ls = {
        __proto__: null,
        TRANSFORM: Ai,
        TRANSITION: Aa,
        TRANSITION_END: $o,
        get: en,
        getStyle: Qt,
        create: he,
        remove: Me,
        empty: Ct,
        toFront: st,
        toBack: Di,
        hasClass: ma,
        addClass: oe,
        removeClass: Re,
        setClass: Lo,
        getClass: ja,
        setOpacity: It,
        testProp: Ya,
        setTransform: pa,
        setPosition: qe,
        getPosition: Wt,
        get disableTextSelection() {
          return Ka;
        },
        get enableTextSelection() {
          return Bi;
        },
        disableImageDrag: Da,
        enableImageDrag: xl,
        preventOutline: an,
        restoreOutline: on,
        getSizedParentNode: ns,
        getScale: Sl,
      };
      function ae(a, n, u, r) {
        if (n && typeof n == "object") for (var d in n) H(a, d, n[d], u);
        else {
          n = v(n);
          for (var h = 0, I = n.length; h < I; h++) H(a, n[h], u, r);
        }
        return this;
      }
      var m = "_leaflet_events";
      function A(a, n, u, r) {
        if (arguments.length === 1) (E(a), delete a[m]);
        else if (n && typeof n == "object") for (var d in n) G(a, d, n[d], u);
        else if (((n = v(n)), arguments.length === 2))
          E(a, function (M) {
            return C(n, M) !== -1;
          });
        else for (var h = 0, I = n.length; h < I; h++) G(a, n[h], u, r);
        return this;
      }
      function E(a, n) {
        for (var u in a[m]) {
          var r = u.split(/\d/)[0];
          (!n || n(r)) && G(a, r, null, null, u);
        }
      }
      var O = {
        mouseenter: "mouseover",
        mouseleave: "mouseout",
        wheel: !("onwheel" in window) && "mousewheel",
      };
      function H(a, n, u, r) {
        var d = n + f(u) + (r ? "_" + f(r) : "");
        if (a[m] && a[m][d]) return this;
        var h = function (M) {
            return u.call(r || a, M || window.event);
          },
          I = h;
        (!X.touchNative && X.pointer && n.indexOf("touch") === 0
          ? (h = ts(a, n, h))
          : X.touch && n === "dblclick"
            ? (h = Jo(a, h))
            : "addEventListener" in a
              ? n === "touchstart" ||
                n === "touchmove" ||
                n === "wheel" ||
                n === "mousewheel"
                ? a.addEventListener(
                    O[n] || n,
                    h,
                    X.passiveEvents ? { passive: !1 } : !1,
                  )
                : n === "mouseenter" || n === "mouseleave"
                  ? ((h = function (M) {
                      ((M = M || window.event), ga(a, M) && I(M));
                    }),
                    a.addEventListener(O[n], h, !1))
                  : a.addEventListener(n, I, !1)
              : a.attachEvent("on" + n, h),
          (a[m] = a[m] || {}),
          (a[m][d] = h));
      }
      function G(a, n, u, r, d) {
        d = d || n + f(u) + (r ? "_" + f(r) : "");
        var h = a[m] && a[m][d];
        if (!h) return this;
        (!X.touchNative && X.pointer && n.indexOf("touch") === 0
          ? _l(a, n, h)
          : X.touch && n === "dblclick"
            ? os(a, h)
            : "removeEventListener" in a
              ? a.removeEventListener(O[n] || n, h, !1)
              : a.detachEvent("on" + n, h),
          (a[m][d] = null));
      }
      function ne(a) {
        return (
          a.stopPropagation
            ? a.stopPropagation()
            : a.originalEvent
              ? (a.originalEvent._stopped = !0)
              : (a.cancelBubble = !0),
          this
        );
      }
      function _e(a) {
        return (H(a, "wheel", ne), this);
      }
      function Le(a) {
        return (
          ae(a, "mousedown touchstart dblclick contextmenu", ne),
          (a._leaflet_disable_click = !0),
          this
        );
      }
      function se(a) {
        return (
          a.preventDefault ? a.preventDefault() : (a.returnValue = !1),
          this
        );
      }
      function Be(a) {
        return (se(a), ne(a), this);
      }
      function mt(a) {
        if (a.composedPath) return a.composedPath();
        for (var n = [], u = a.target; u;) (n.push(u), (u = u.parentNode));
        return n;
      }
      function pt(a, n) {
        if (!n) return new $(a.clientX, a.clientY);
        var u = Sl(n),
          r = u.boundingClientRect;
        return new $(
          (a.clientX - r.left) / u.x - n.clientLeft,
          (a.clientY - r.top) / u.y - n.clientTop,
        );
      }
      var bt =
        X.linux && X.chrome
          ? window.devicePixelRatio
          : X.mac
            ? window.devicePixelRatio * 3
            : window.devicePixelRatio > 0
              ? 2 * window.devicePixelRatio
              : 1;
      function Rt(a) {
        return X.edge
          ? a.wheelDeltaY / 2
          : a.deltaY && a.deltaMode === 0
            ? -a.deltaY / bt
            : a.deltaY && a.deltaMode === 1
              ? -a.deltaY * 20
              : a.deltaY && a.deltaMode === 2
                ? -a.deltaY * 60
                : a.deltaX || a.deltaZ
                  ? 0
                  : a.wheelDelta
                    ? (a.wheelDeltaY || a.wheelDelta) / 2
                    : a.detail && Math.abs(a.detail) < 32765
                      ? -a.detail * 20
                      : a.detail
                        ? (a.detail / -32765) * 60
                        : 0;
      }
      function ga(a, n) {
        var u = n.relatedTarget;
        if (!u) return !0;
        try {
          for (; u && u !== a;) u = u.parentNode;
        } catch {
          return !1;
        }
        return u !== a;
      }
      var La = {
          __proto__: null,
          on: ae,
          off: A,
          stopPropagation: ne,
          disableScrollPropagation: _e,
          disableClickPropagation: Le,
          preventDefault: se,
          stop: Be,
          getPropagationPath: mt,
          getMousePosition: pt,
          getWheelDelta: Rt,
          isExternalTarget: ga,
          addListener: ae,
          removeListener: A,
        },
        _o = Ii.extend({
          run: function (a, n, u, r) {
            (this.stop(),
              (this._el = a),
              (this._inProgress = !0),
              (this._duration = u || 0.25),
              (this._easeOutPower = 1 / Math.max(r || 0.5, 0.2)),
              (this._startPos = Wt(a)),
              (this._offset = n.subtract(this._startPos)),
              (this._startTime = +new Date()),
              this.fire("start"),
              this._animate());
          },
          stop: function () {
            this._inProgress && (this._step(!0), this._complete());
          },
          _animate: function () {
            ((this._animId = V(this._animate, this)), this._step());
          },
          _step: function (a) {
            var n = +new Date() - this._startTime,
              u = this._duration * 1e3;
            n < u
              ? this._runFrame(this._easeOut(n / u), a)
              : (this._runFrame(1), this._complete());
          },
          _runFrame: function (a, n) {
            var u = this._startPos.add(this._offset.multiplyBy(a));
            (n && u._round(), qe(this._el, u), this.fire("step"));
          },
          _complete: function () {
            (W(this._animId), (this._inProgress = !1), this.fire("end"));
          },
          _easeOut: function (a) {
            return 1 - Math.pow(1 - a, this._easeOutPower);
          },
        }),
        me = Ii.extend({
          options: {
            crs: Ye,
            center: void 0,
            zoom: void 0,
            minZoom: void 0,
            maxZoom: void 0,
            layers: [],
            maxBounds: void 0,
            renderer: void 0,
            zoomAnimation: !0,
            zoomAnimationThreshold: 4,
            fadeAnimation: !0,
            markerZoomAnimation: !0,
            transform3DLimit: 8388608,
            zoomSnap: 1,
            zoomDelta: 1,
            trackResize: !0,
          },
          initialize: function (a, n) {
            ((n = x(this, n)),
              (this._handlers = []),
              (this._layers = {}),
              (this._zoomBoundLayers = {}),
              (this._sizeChanged = !0),
              this._initContainer(a),
              this._initLayout(),
              (this._onResize = l(this._onResize, this)),
              this._initEvents(),
              n.maxBounds && this.setMaxBounds(n.maxBounds),
              n.zoom !== void 0 && (this._zoom = this._limitZoom(n.zoom)),
              n.center &&
                n.zoom !== void 0 &&
                this.setView(fe(n.center), n.zoom, { reset: !0 }),
              this.callInitHooks(),
              (this._zoomAnimated =
                Aa && X.any3d && !X.mobileOpera && this.options.zoomAnimation),
              this._zoomAnimated &&
                (this._createAnimProxy(),
                ae(this._proxy, $o, this._catchTransitionEnd, this)),
              this._addLayers(this.options.layers));
          },
          setView: function (a, n, u) {
            if (
              ((n = n === void 0 ? this._zoom : this._limitZoom(n)),
              (a = this._limitCenter(fe(a), n, this.options.maxBounds)),
              (u = u || {}),
              this._stop(),
              this._loaded && !u.reset && u !== !0)
            ) {
              u.animate !== void 0 &&
                ((u.zoom = i({ animate: u.animate }, u.zoom)),
                (u.pan = i(
                  { animate: u.animate, duration: u.duration },
                  u.pan,
                )));
              var r =
                this._zoom !== n
                  ? this._tryAnimatedZoom && this._tryAnimatedZoom(a, n, u.zoom)
                  : this._tryAnimatedPan(a, u.pan);
              if (r) return (clearTimeout(this._sizeTimer), this);
            }
            return (this._resetView(a, n, u.pan && u.pan.noMoveStart), this);
          },
          setZoom: function (a, n) {
            return this._loaded
              ? this.setView(this.getCenter(), a, { zoom: n })
              : ((this._zoom = a), this);
          },
          zoomIn: function (a, n) {
            return (
              (a = a || (X.any3d ? this.options.zoomDelta : 1)),
              this.setZoom(this._zoom + a, n)
            );
          },
          zoomOut: function (a, n) {
            return (
              (a = a || (X.any3d ? this.options.zoomDelta : 1)),
              this.setZoom(this._zoom - a, n)
            );
          },
          setZoomAround: function (a, n, u) {
            var r = this.getZoomScale(n),
              d = this.getSize().divideBy(2),
              h = a instanceof $ ? a : this.latLngToContainerPoint(a),
              I = h.subtract(d).multiplyBy(1 - 1 / r),
              M = this.containerPointToLatLng(d.add(I));
            return this.setView(M, n, { zoom: u });
          },
          _getBoundsCenterZoom: function (a, n) {
            ((n = n || {}), (a = a.getBounds ? a.getBounds() : He(a)));
            var u = ee(n.paddingTopLeft || n.padding || [0, 0]),
              r = ee(n.paddingBottomRight || n.padding || [0, 0]),
              d = this.getBoundsZoom(a, !1, u.add(r));
            if (
              ((d = typeof n.maxZoom == "number" ? Math.min(n.maxZoom, d) : d),
              d === 1 / 0)
            )
              return { center: a.getCenter(), zoom: d };
            var h = r.subtract(u).divideBy(2),
              I = this.project(a.getSouthWest(), d),
              M = this.project(a.getNorthEast(), d),
              D = this.unproject(I.add(M).divideBy(2).add(h), d);
            return { center: D, zoom: d };
          },
          fitBounds: function (a, n) {
            if (((a = He(a)), !a.isValid()))
              throw new Error("Bounds are not valid.");
            var u = this._getBoundsCenterZoom(a, n);
            return this.setView(u.center, u.zoom, n);
          },
          fitWorld: function (a) {
            return this.fitBounds(
              [
                [-90, -180],
                [90, 180],
              ],
              a,
            );
          },
          panTo: function (a, n) {
            return this.setView(a, this._zoom, { pan: n });
          },
          panBy: function (a, n) {
            if (((a = ee(a).round()), (n = n || {}), !a.x && !a.y))
              return this.fire("moveend");
            if (n.animate !== !0 && !this.getSize().contains(a))
              return (
                this._resetView(
                  this.unproject(this.project(this.getCenter()).add(a)),
                  this.getZoom(),
                ),
                this
              );
            if (
              (this._panAnim ||
                ((this._panAnim = new _o()),
                this._panAnim.on(
                  {
                    step: this._onPanTransitionStep,
                    end: this._onPanTransitionEnd,
                  },
                  this,
                )),
              n.noMoveStart || this.fire("movestart"),
              n.animate !== !1)
            ) {
              oe(this._mapPane, "leaflet-pan-anim");
              var u = this._getMapPanePos().subtract(a).round();
              this._panAnim.run(
                this._mapPane,
                u,
                n.duration || 0.25,
                n.easeLinearity,
              );
            } else (this._rawPanBy(a), this.fire("move").fire("moveend"));
            return this;
          },
          flyTo: function (a, n, u) {
            if (((u = u || {}), u.animate === !1 || !X.any3d))
              return this.setView(a, n, u);
            this._stop();
            var r = this.project(this.getCenter()),
              d = this.project(a),
              h = this.getSize(),
              I = this._zoom;
            ((a = fe(a)), (n = n === void 0 ? I : n));
            var M = Math.max(h.x, h.y),
              D = M * this.getZoomScale(I, n),
              U = d.distanceTo(r) || 1,
              N = 1.42,
              Q = N * N;
            function re(Ke) {
              var _s = Ke ? -1 : 1,
                $L = Ke ? D : M,
                e_ = D * D - M * M + _s * Q * Q * U * U,
                t_ = 2 * $L * Q * U,
                yf = e_ / t_,
                Xh = Math.sqrt(yf * yf + 1) - yf,
                a_ = Xh < 1e-9 ? -18 : Math.log(Xh);
              return a_;
            }
            function _t(Ke) {
              return (Math.exp(Ke) - Math.exp(-Ke)) / 2;
            }
            function it(Ke) {
              return (Math.exp(Ke) + Math.exp(-Ke)) / 2;
            }
            function $t(Ke) {
              return _t(Ke) / it(Ke);
            }
            var wt = re(0);
            function dn(Ke) {
              return M * (it(wt) / it(wt + N * Ke));
            }
            function KL(Ke) {
              return (M * (it(wt) * $t(wt + N * Ke) - _t(wt))) / Q;
            }
            function QL(Ke) {
              return 1 - Math.pow(1 - Ke, 1.5);
            }
            var WL = Date.now(),
              Gh = (re(1) - wt) / N,
              JL = u.duration ? 1e3 * u.duration : 1e3 * Gh * 0.8;
            function Vh() {
              var Ke = (Date.now() - WL) / JL,
                _s = QL(Ke) * Gh;
              Ke <= 1
                ? ((this._flyToFrame = V(Vh, this)),
                  this._move(
                    this.unproject(
                      r.add(d.subtract(r).multiplyBy(KL(_s) / U)),
                      I,
                    ),
                    this.getScaleZoom(M / dn(_s), I),
                    { flyTo: !0 },
                  ))
                : this._move(a, n)._moveEnd(!0);
            }
            return (this._moveStart(!0, u.noMoveStart), Vh.call(this), this);
          },
          flyToBounds: function (a, n) {
            var u = this._getBoundsCenterZoom(a, n);
            return this.flyTo(u.center, u.zoom, n);
          },
          setMaxBounds: function (a) {
            return (
              (a = He(a)),
              this.listens("moveend", this._panInsideMaxBounds) &&
                this.off("moveend", this._panInsideMaxBounds),
              a.isValid()
                ? ((this.options.maxBounds = a),
                  this._loaded && this._panInsideMaxBounds(),
                  this.on("moveend", this._panInsideMaxBounds))
                : ((this.options.maxBounds = null), this)
            );
          },
          setMinZoom: function (a) {
            var n = this.options.minZoom;
            return (
              (this.options.minZoom = a),
              this._loaded &&
              n !== a &&
              (this.fire("zoomlevelschange"),
              this.getZoom() < this.options.minZoom)
                ? this.setZoom(a)
                : this
            );
          },
          setMaxZoom: function (a) {
            var n = this.options.maxZoom;
            return (
              (this.options.maxZoom = a),
              this._loaded &&
              n !== a &&
              (this.fire("zoomlevelschange"),
              this.getZoom() > this.options.maxZoom)
                ? this.setZoom(a)
                : this
            );
          },
          panInsideBounds: function (a, n) {
            this._enforcingBounds = !0;
            var u = this.getCenter(),
              r = this._limitCenter(u, this._zoom, He(a));
            return (
              u.equals(r) || this.panTo(r, n),
              (this._enforcingBounds = !1),
              this
            );
          },
          panInside: function (a, n) {
            n = n || {};
            var u = ee(n.paddingTopLeft || n.padding || [0, 0]),
              r = ee(n.paddingBottomRight || n.padding || [0, 0]),
              d = this.project(this.getCenter()),
              h = this.project(a),
              I = this.getPixelBounds(),
              M = Xe([I.min.add(u), I.max.subtract(r)]),
              D = M.getSize();
            if (!M.contains(h)) {
              this._enforcingBounds = !0;
              var U = h.subtract(M.getCenter()),
                N = M.extend(h).getSize().subtract(D);
              ((d.x += U.x < 0 ? -N.x : N.x),
                (d.y += U.y < 0 ? -N.y : N.y),
                this.panTo(this.unproject(d), n),
                (this._enforcingBounds = !1));
            }
            return this;
          },
          invalidateSize: function (a) {
            if (!this._loaded) return this;
            a = i({ animate: !1, pan: !0 }, a === !0 ? { animate: !0 } : a);
            var n = this.getSize();
            ((this._sizeChanged = !0), (this._lastCenter = null));
            var u = this.getSize(),
              r = n.divideBy(2).round(),
              d = u.divideBy(2).round(),
              h = r.subtract(d);
            return !h.x && !h.y
              ? this
              : (a.animate && a.pan
                  ? this.panBy(h)
                  : (a.pan && this._rawPanBy(h),
                    this.fire("move"),
                    a.debounceMoveend
                      ? (clearTimeout(this._sizeTimer),
                        (this._sizeTimer = setTimeout(
                          l(this.fire, this, "moveend"),
                          200,
                        )))
                      : this.fire("moveend")),
                this.fire("resize", { oldSize: n, newSize: u }));
          },
          stop: function () {
            return (
              this.setZoom(this._limitZoom(this._zoom)),
              this.options.zoomSnap || this.fire("viewreset"),
              this._stop()
            );
          },
          locate: function (a) {
            if (
              ((a = this._locateOptions = i({ timeout: 1e4, watch: !1 }, a)),
              !("geolocation" in navigator))
            )
              return (
                this._handleGeolocationError({
                  code: 0,
                  message: "Geolocation not supported.",
                }),
                this
              );
            var n = l(this._handleGeolocationResponse, this),
              u = l(this._handleGeolocationError, this);
            return (
              a.watch
                ? (this._locationWatchId = navigator.geolocation.watchPosition(
                    n,
                    u,
                    a,
                  ))
                : navigator.geolocation.getCurrentPosition(n, u, a),
              this
            );
          },
          stopLocate: function () {
            return (
              navigator.geolocation &&
                navigator.geolocation.clearWatch &&
                navigator.geolocation.clearWatch(this._locationWatchId),
              this._locateOptions && (this._locateOptions.setView = !1),
              this
            );
          },
          _handleGeolocationError: function (a) {
            if (this._container._leaflet_id) {
              var n = a.code,
                u =
                  a.message ||
                  (n === 1
                    ? "permission denied"
                    : n === 2
                      ? "position unavailable"
                      : "timeout");
              (this._locateOptions.setView && !this._loaded && this.fitWorld(),
                this.fire("locationerror", {
                  code: n,
                  message: "Geolocation error: " + u + ".",
                }));
            }
          },
          _handleGeolocationResponse: function (a) {
            if (this._container._leaflet_id) {
              var n = a.coords.latitude,
                u = a.coords.longitude,
                r = new q(n, u),
                d = r.toBounds(a.coords.accuracy * 2),
                h = this._locateOptions;
              if (h.setView) {
                var I = this.getBoundsZoom(d);
                this.setView(r, h.maxZoom ? Math.min(I, h.maxZoom) : I);
              }
              var M = { latlng: r, bounds: d, timestamp: a.timestamp };
              for (var D in a.coords)
                typeof a.coords[D] == "number" && (M[D] = a.coords[D]);
              this.fire("locationfound", M);
            }
          },
          addHandler: function (a, n) {
            if (!n) return this;
            var u = (this[a] = new n(this));
            return (
              this._handlers.push(u),
              this.options[a] && u.enable(),
              this
            );
          },
          remove: function () {
            if (
              (this._initEvents(!0),
              this.options.maxBounds &&
                this.off("moveend", this._panInsideMaxBounds),
              this._containerId !== this._container._leaflet_id)
            )
              throw new Error(
                "Map container is being reused by another instance",
              );
            try {
              (delete this._container._leaflet_id, delete this._containerId);
            } catch {
              ((this._container._leaflet_id = void 0),
                (this._containerId = void 0));
            }
            (this._locationWatchId !== void 0 && this.stopLocate(),
              this._stop(),
              Me(this._mapPane),
              this._clearControlPos && this._clearControlPos(),
              this._resizeRequest &&
                (W(this._resizeRequest), (this._resizeRequest = null)),
              this._clearHandlers(),
              this._loaded && this.fire("unload"));
            var a;
            for (a in this._layers) this._layers[a].remove();
            for (a in this._panes) Me(this._panes[a]);
            return (
              (this._layers = []),
              (this._panes = []),
              delete this._mapPane,
              delete this._renderer,
              this
            );
          },
          createPane: function (a, n) {
            var u =
                "leaflet-pane" +
                (a ? " leaflet-" + a.replace("Pane", "") + "-pane" : ""),
              r = he("div", u, n || this._mapPane);
            return (a && (this._panes[a] = r), r);
          },
          getCenter: function () {
            return (
              this._checkIfLoaded(),
              this._lastCenter && !this._moved()
                ? this._lastCenter.clone()
                : this.layerPointToLatLng(this._getCenterLayerPoint())
            );
          },
          getZoom: function () {
            return this._zoom;
          },
          getBounds: function () {
            var a = this.getPixelBounds(),
              n = this.unproject(a.getBottomLeft()),
              u = this.unproject(a.getTopRight());
            return new je(n, u);
          },
          getMinZoom: function () {
            return this.options.minZoom === void 0
              ? this._layersMinZoom || 0
              : this.options.minZoom;
          },
          getMaxZoom: function () {
            return this.options.maxZoom === void 0
              ? this._layersMaxZoom === void 0
                ? 1 / 0
                : this._layersMaxZoom
              : this.options.maxZoom;
          },
          getBoundsZoom: function (a, n, u) {
            ((a = He(a)), (u = ee(u || [0, 0])));
            var r = this.getZoom() || 0,
              d = this.getMinZoom(),
              h = this.getMaxZoom(),
              I = a.getNorthWest(),
              M = a.getSouthEast(),
              D = this.getSize().subtract(u),
              U = Xe(this.project(M, r), this.project(I, r)).getSize(),
              N = X.any3d ? this.options.zoomSnap : 1,
              Q = D.x / U.x,
              re = D.y / U.y,
              _t = n ? Math.max(Q, re) : Math.min(Q, re);
            return (
              (r = this.getScaleZoom(_t, r)),
              N &&
                ((r = Math.round(r / (N / 100)) * (N / 100)),
                (r = n ? Math.ceil(r / N) * N : Math.floor(r / N) * N)),
              Math.max(d, Math.min(h, r))
            );
          },
          getSize: function () {
            return (
              (!this._size || this._sizeChanged) &&
                ((this._size = new $(
                  this._container.clientWidth || 0,
                  this._container.clientHeight || 0,
                )),
                (this._sizeChanged = !1)),
              this._size.clone()
            );
          },
          getPixelBounds: function (a, n) {
            var u = this._getTopLeftPoint(a, n);
            return new De(u, u.add(this.getSize()));
          },
          getPixelOrigin: function () {
            return (this._checkIfLoaded(), this._pixelOrigin);
          },
          getPixelWorldBounds: function (a) {
            return this.options.crs.getProjectedBounds(
              a === void 0 ? this.getZoom() : a,
            );
          },
          getPane: function (a) {
            return typeof a == "string" ? this._panes[a] : a;
          },
          getPanes: function () {
            return this._panes;
          },
          getContainer: function () {
            return this._container;
          },
          getZoomScale: function (a, n) {
            var u = this.options.crs;
            return (
              (n = n === void 0 ? this._zoom : n),
              u.scale(a) / u.scale(n)
            );
          },
          getScaleZoom: function (a, n) {
            var u = this.options.crs;
            n = n === void 0 ? this._zoom : n;
            var r = u.zoom(a * u.scale(n));
            return isNaN(r) ? 1 / 0 : r;
          },
          project: function (a, n) {
            return (
              (n = n === void 0 ? this._zoom : n),
              this.options.crs.latLngToPoint(fe(a), n)
            );
          },
          unproject: function (a, n) {
            return (
              (n = n === void 0 ? this._zoom : n),
              this.options.crs.pointToLatLng(ee(a), n)
            );
          },
          layerPointToLatLng: function (a) {
            var n = ee(a).add(this.getPixelOrigin());
            return this.unproject(n);
          },
          latLngToLayerPoint: function (a) {
            var n = this.project(fe(a))._round();
            return n._subtract(this.getPixelOrigin());
          },
          wrapLatLng: function (a) {
            return this.options.crs.wrapLatLng(fe(a));
          },
          wrapLatLngBounds: function (a) {
            return this.options.crs.wrapLatLngBounds(He(a));
          },
          distance: function (a, n) {
            return this.options.crs.distance(fe(a), fe(n));
          },
          containerPointToLayerPoint: function (a) {
            return ee(a).subtract(this._getMapPanePos());
          },
          layerPointToContainerPoint: function (a) {
            return ee(a).add(this._getMapPanePos());
          },
          containerPointToLatLng: function (a) {
            var n = this.containerPointToLayerPoint(ee(a));
            return this.layerPointToLatLng(n);
          },
          latLngToContainerPoint: function (a) {
            return this.layerPointToContainerPoint(
              this.latLngToLayerPoint(fe(a)),
            );
          },
          mouseEventToContainerPoint: function (a) {
            return pt(a, this._container);
          },
          mouseEventToLayerPoint: function (a) {
            return this.containerPointToLayerPoint(
              this.mouseEventToContainerPoint(a),
            );
          },
          mouseEventToLatLng: function (a) {
            return this.layerPointToLatLng(this.mouseEventToLayerPoint(a));
          },
          _initContainer: function (a) {
            var n = (this._container = en(a));
            if (n) {
              if (n._leaflet_id)
                throw new Error("Map container is already initialized.");
            } else throw new Error("Map container not found.");
            (ae(n, "scroll", this._onScroll, this), (this._containerId = f(n)));
          },
          _initLayout: function () {
            var a = this._container;
            ((this._fadeAnimated = this.options.fadeAnimation && X.any3d),
              oe(
                a,
                "leaflet-container" +
                  (X.touch ? " leaflet-touch" : "") +
                  (X.retina ? " leaflet-retina" : "") +
                  (X.ielt9 ? " leaflet-oldie" : "") +
                  (X.safari ? " leaflet-safari" : "") +
                  (this._fadeAnimated ? " leaflet-fade-anim" : ""),
              ));
            var n = Qt(a, "position");
            (n !== "absolute" &&
              n !== "relative" &&
              n !== "fixed" &&
              n !== "sticky" &&
              (a.style.position = "relative"),
              this._initPanes(),
              this._initControlPos && this._initControlPos());
          },
          _initPanes: function () {
            var a = (this._panes = {});
            ((this._paneRenderers = {}),
              (this._mapPane = this.createPane("mapPane", this._container)),
              qe(this._mapPane, new $(0, 0)),
              this.createPane("tilePane"),
              this.createPane("overlayPane"),
              this.createPane("shadowPane"),
              this.createPane("markerPane"),
              this.createPane("tooltipPane"),
              this.createPane("popupPane"),
              this.options.markerZoomAnimation ||
                (oe(a.markerPane, "leaflet-zoom-hide"),
                oe(a.shadowPane, "leaflet-zoom-hide")));
          },
          _resetView: function (a, n, u) {
            qe(this._mapPane, new $(0, 0));
            var r = !this._loaded;
            ((this._loaded = !0),
              (n = this._limitZoom(n)),
              this.fire("viewprereset"));
            var d = this._zoom !== n;
            (this._moveStart(d, u)._move(a, n)._moveEnd(d),
              this.fire("viewreset"),
              r && this.fire("load"));
          },
          _moveStart: function (a, n) {
            return (
              a && this.fire("zoomstart"),
              n || this.fire("movestart"),
              this
            );
          },
          _move: function (a, n, u, r) {
            n === void 0 && (n = this._zoom);
            var d = this._zoom !== n;
            return (
              (this._zoom = n),
              (this._lastCenter = a),
              (this._pixelOrigin = this._getNewPixelOrigin(a)),
              r
                ? u && u.pinch && this.fire("zoom", u)
                : ((d || (u && u.pinch)) && this.fire("zoom", u),
                  this.fire("move", u)),
              this
            );
          },
          _moveEnd: function (a) {
            return (a && this.fire("zoomend"), this.fire("moveend"));
          },
          _stop: function () {
            return (
              W(this._flyToFrame),
              this._panAnim && this._panAnim.stop(),
              this
            );
          },
          _rawPanBy: function (a) {
            qe(this._mapPane, this._getMapPanePos().subtract(a));
          },
          _getZoomSpan: function () {
            return this.getMaxZoom() - this.getMinZoom();
          },
          _panInsideMaxBounds: function () {
            this._enforcingBounds ||
              this.panInsideBounds(this.options.maxBounds);
          },
          _checkIfLoaded: function () {
            if (!this._loaded)
              throw new Error("Set map center and zoom first.");
          },
          _initEvents: function (a) {
            ((this._targets = {}), (this._targets[f(this._container)] = this));
            var n = a ? A : ae;
            (n(
              this._container,
              "click dblclick mousedown mouseup mouseover mouseout mousemove contextmenu keypress keydown keyup",
              this._handleDOMEvent,
              this,
            ),
              this.options.trackResize &&
                n(window, "resize", this._onResize, this),
              X.any3d &&
                this.options.transform3DLimit &&
                (a ? this.off : this.on).call(
                  this,
                  "moveend",
                  this._onMoveEnd,
                ));
          },
          _onResize: function () {
            (W(this._resizeRequest),
              (this._resizeRequest = V(function () {
                this.invalidateSize({ debounceMoveend: !0 });
              }, this)));
          },
          _onScroll: function () {
            ((this._container.scrollTop = 0), (this._container.scrollLeft = 0));
          },
          _onMoveEnd: function () {
            var a = this._getMapPanePos();
            Math.max(Math.abs(a.x), Math.abs(a.y)) >=
              this.options.transform3DLimit &&
              this._resetView(this.getCenter(), this.getZoom());
          },
          _findEventTargets: function (a, n) {
            for (
              var u = [],
                r,
                d = n === "mouseout" || n === "mouseover",
                h = a.target || a.srcElement,
                I = !1;
              h;
            ) {
              if (
                ((r = this._targets[f(h)]),
                r &&
                  (n === "click" || n === "preclick") &&
                  this._draggableMoved(r))
              ) {
                I = !0;
                break;
              }
              if (
                (r &&
                  r.listens(n, !0) &&
                  ((d && !ga(h, a)) || (u.push(r), d))) ||
                h === this._container
              )
                break;
              h = h.parentNode;
            }
            return (
              !u.length && !I && !d && this.listens(n, !0) && (u = [this]),
              u
            );
          },
          _isClickDisabled: function (a) {
            for (; a && a !== this._container;) {
              if (a._leaflet_disable_click) return !0;
              a = a.parentNode;
            }
          },
          _handleDOMEvent: function (a) {
            var n = a.target || a.srcElement;
            if (!(
              !this._loaded ||
              n._leaflet_disable_events ||
              (a.type === "click" && this._isClickDisabled(n))
            )) {
              var u = a.type;
              (u === "mousedown" && an(n), this._fireDOMEvent(a, u));
            }
          },
          _mouseEvents: [
            "click",
            "dblclick",
            "mouseover",
            "mouseout",
            "contextmenu",
          ],
          _fireDOMEvent: function (a, n, u) {
            if (a.type === "click") {
              var r = i({}, a);
              ((r.type = "preclick"), this._fireDOMEvent(r, r.type, u));
            }
            var d = this._findEventTargets(a, n);
            if (u) {
              for (var h = [], I = 0; I < u.length; I++)
                u[I].listens(n, !0) && h.push(u[I]);
              d = h.concat(d);
            }
            if (d.length) {
              n === "contextmenu" && se(a);
              var M = d[0],
                D = { originalEvent: a };
              if (
                a.type !== "keypress" &&
                a.type !== "keydown" &&
                a.type !== "keyup"
              ) {
                var U = M.getLatLng && (!M._radius || M._radius <= 10);
                ((D.containerPoint = U
                  ? this.latLngToContainerPoint(M.getLatLng())
                  : this.mouseEventToContainerPoint(a)),
                  (D.layerPoint = this.containerPointToLayerPoint(
                    D.containerPoint,
                  )),
                  (D.latlng = U
                    ? M.getLatLng()
                    : this.layerPointToLatLng(D.layerPoint)));
              }
              for (I = 0; I < d.length; I++)
                if (
                  (d[I].fire(n, D, !0),
                  D.originalEvent._stopped ||
                    (d[I].options.bubblingMouseEvents === !1 &&
                      C(this._mouseEvents, n) !== -1))
                )
                  return;
            }
          },
          _draggableMoved: function (a) {
            return (
              (a = a.dragging && a.dragging.enabled() ? a : this),
              (a.dragging && a.dragging.moved()) ||
                (this.boxZoom && this.boxZoom.moved())
            );
          },
          _clearHandlers: function () {
            for (var a = 0, n = this._handlers.length; a < n; a++)
              this._handlers[a].disable();
          },
          whenReady: function (a, n) {
            return (
              this._loaded
                ? a.call(n || this, { target: this })
                : this.on("load", a, n),
              this
            );
          },
          _getMapPanePos: function () {
            return Wt(this._mapPane) || new $(0, 0);
          },
          _moved: function () {
            var a = this._getMapPanePos();
            return a && !a.equals([0, 0]);
          },
          _getTopLeftPoint: function (a, n) {
            var u =
              a && n !== void 0
                ? this._getNewPixelOrigin(a, n)
                : this.getPixelOrigin();
            return u.subtract(this._getMapPanePos());
          },
          _getNewPixelOrigin: function (a, n) {
            var u = this.getSize()._divideBy(2);
            return this.project(a, n)
              ._subtract(u)
              ._add(this._getMapPanePos())
              ._round();
          },
          _latLngToNewLayerPoint: function (a, n, u) {
            var r = this._getNewPixelOrigin(u, n);
            return this.project(a, n)._subtract(r);
          },
          _latLngBoundsToNewLayerBounds: function (a, n, u) {
            var r = this._getNewPixelOrigin(u, n);
            return Xe([
              this.project(a.getSouthWest(), n)._subtract(r),
              this.project(a.getNorthWest(), n)._subtract(r),
              this.project(a.getSouthEast(), n)._subtract(r),
              this.project(a.getNorthEast(), n)._subtract(r),
            ]);
          },
          _getCenterLayerPoint: function () {
            return this.containerPointToLayerPoint(this.getSize()._divideBy(2));
          },
          _getCenterOffset: function (a) {
            return this.latLngToLayerPoint(a).subtract(
              this._getCenterLayerPoint(),
            );
          },
          _limitCenter: function (a, n, u) {
            if (!u) return a;
            var r = this.project(a, n),
              d = this.getSize().divideBy(2),
              h = new De(r.subtract(d), r.add(d)),
              I = this._getBoundsOffset(h, u, n);
            return Math.abs(I.x) <= 1 && Math.abs(I.y) <= 1
              ? a
              : this.unproject(r.add(I), n);
          },
          _limitOffset: function (a, n) {
            if (!n) return a;
            var u = this.getPixelBounds(),
              r = new De(u.min.add(a), u.max.add(a));
            return a.add(this._getBoundsOffset(r, n));
          },
          _getBoundsOffset: function (a, n, u) {
            var r = Xe(
                this.project(n.getNorthEast(), u),
                this.project(n.getSouthWest(), u),
              ),
              d = r.min.subtract(a.min),
              h = r.max.subtract(a.max),
              I = this._rebound(d.x, -h.x),
              M = this._rebound(d.y, -h.y);
            return new $(I, M);
          },
          _rebound: function (a, n) {
            return a + n > 0
              ? Math.round(a - n) / 2
              : Math.max(0, Math.ceil(a)) - Math.max(0, Math.floor(n));
          },
          _limitZoom: function (a) {
            var n = this.getMinZoom(),
              u = this.getMaxZoom(),
              r = X.any3d ? this.options.zoomSnap : 1;
            return (
              r && (a = Math.round(a / r) * r),
              Math.max(n, Math.min(u, a))
            );
          },
          _onPanTransitionStep: function () {
            this.fire("move");
          },
          _onPanTransitionEnd: function () {
            (Re(this._mapPane, "leaflet-pan-anim"), this.fire("moveend"));
          },
          _tryAnimatedPan: function (a, n) {
            var u = this._getCenterOffset(a)._trunc();
            return (n && n.animate) !== !0 && !this.getSize().contains(u)
              ? !1
              : (this.panBy(u, n), !0);
          },
          _createAnimProxy: function () {
            var a = (this._proxy = he(
              "div",
              "leaflet-proxy leaflet-zoom-animated",
            ));
            (this._panes.mapPane.appendChild(a),
              this.on(
                "zoomanim",
                function (n) {
                  var u = Ai,
                    r = this._proxy.style[u];
                  (pa(
                    this._proxy,
                    this.project(n.center, n.zoom),
                    this.getZoomScale(n.zoom, 1),
                  ),
                    r === this._proxy.style[u] &&
                      this._animatingZoom &&
                      this._onZoomTransitionEnd());
                },
                this,
              ),
              this.on("load moveend", this._animMoveEnd, this),
              this._on("unload", this._destroyAnimProxy, this));
          },
          _destroyAnimProxy: function () {
            (Me(this._proxy),
              this.off("load moveend", this._animMoveEnd, this),
              delete this._proxy);
          },
          _animMoveEnd: function () {
            var a = this.getCenter(),
              n = this.getZoom();
            pa(this._proxy, this.project(a, n), this.getZoomScale(n, 1));
          },
          _catchTransitionEnd: function (a) {
            this._animatingZoom &&
              a.propertyName.indexOf("transform") >= 0 &&
              this._onZoomTransitionEnd();
          },
          _nothingToAnimate: function () {
            return !this._container.getElementsByClassName(
              "leaflet-zoom-animated",
            ).length;
          },
          _tryAnimatedZoom: function (a, n, u) {
            if (this._animatingZoom) return !0;
            if (
              ((u = u || {}),
              !this._zoomAnimated ||
                u.animate === !1 ||
                this._nothingToAnimate() ||
                Math.abs(n - this._zoom) > this.options.zoomAnimationThreshold)
            )
              return !1;
            var r = this.getZoomScale(n),
              d = this._getCenterOffset(a)._divideBy(1 - 1 / r);
            return u.animate !== !0 && !this.getSize().contains(d)
              ? !1
              : (V(function () {
                  this._moveStart(!0, u.noMoveStart || !1)._animateZoom(
                    a,
                    n,
                    !0,
                  );
                }, this),
                !0);
          },
          _animateZoom: function (a, n, u, r) {
            this._mapPane &&
              (u &&
                ((this._animatingZoom = !0),
                (this._animateToCenter = a),
                (this._animateToZoom = n),
                oe(this._mapPane, "leaflet-zoom-anim")),
              this.fire("zoomanim", { center: a, zoom: n, noUpdate: r }),
              this._tempFireZoomEvent ||
                (this._tempFireZoomEvent = this._zoom !== this._animateToZoom),
              this._move(
                this._animateToCenter,
                this._animateToZoom,
                void 0,
                !0,
              ),
              setTimeout(l(this._onZoomTransitionEnd, this), 250));
          },
          _onZoomTransitionEnd: function () {
            this._animatingZoom &&
              (this._mapPane && Re(this._mapPane, "leaflet-zoom-anim"),
              (this._animatingZoom = !1),
              this._move(
                this._animateToCenter,
                this._animateToZoom,
                void 0,
                !0,
              ),
              this._tempFireZoomEvent && this.fire("zoom"),
              delete this._tempFireZoomEvent,
              this.fire("move"),
              this._moveEnd(!0));
          },
        });
      function nn(a, n) {
        return new me(a, n);
      }
      var gt = Ze.extend({
          options: { position: "topright" },
          initialize: function (a) {
            x(this, a);
          },
          getPosition: function () {
            return this.options.position;
          },
          setPosition: function (a) {
            var n = this._map;
            return (
              n && n.removeControl(this),
              (this.options.position = a),
              n && n.addControl(this),
              this
            );
          },
          getContainer: function () {
            return this._container;
          },
          addTo: function (a) {
            (this.remove(), (this._map = a));
            var n = (this._container = this.onAdd(a)),
              u = this.getPosition(),
              r = a._controlCorners[u];
            return (
              oe(n, "leaflet-control"),
              u.indexOf("bottom") !== -1
                ? r.insertBefore(n, r.firstChild)
                : r.appendChild(n),
              this._map.on("unload", this.remove, this),
              this
            );
          },
          remove: function () {
            return this._map
              ? (Me(this._container),
                this.onRemove && this.onRemove(this._map),
                this._map.off("unload", this.remove, this),
                (this._map = null),
                this)
              : this;
          },
          _refocusOnMap: function (a) {
            this._map &&
              a &&
              a.screenX > 0 &&
              a.screenY > 0 &&
              this._map.getContainer().focus();
          },
        }),
        Ja = function (a) {
          return new gt(a);
        };
      me.include({
        addControl: function (a) {
          return (a.addTo(this), this);
        },
        removeControl: function (a) {
          return (a.remove(), this);
        },
        _initControlPos: function () {
          var a = (this._controlCorners = {}),
            n = "leaflet-",
            u = (this._controlContainer = he(
              "div",
              n + "control-container",
              this._container,
            ));
          function r(d, h) {
            var I = n + d + " " + n + h;
            a[d + h] = he("div", I, u);
          }
          (r("top", "left"),
            r("top", "right"),
            r("bottom", "left"),
            r("bottom", "right"));
        },
        _clearControlPos: function () {
          for (var a in this._controlCorners) Me(this._controlCorners[a]);
          (Me(this._controlContainer),
            delete this._controlCorners,
            delete this._controlContainer);
        },
      });
      var Cl = gt.extend({
          options: {
            collapsed: !0,
            position: "topright",
            autoZIndex: !0,
            hideSingleBase: !1,
            sortLayers: !1,
            sortFunction: function (a, n, u, r) {
              return u < r ? -1 : r < u ? 1 : 0;
            },
          },
          initialize: function (a, n, u) {
            (x(this, u),
              (this._layerControlInputs = []),
              (this._layers = []),
              (this._lastZIndex = 0),
              (this._handlingClick = !1),
              (this._preventClick = !1));
            for (var r in a) this._addLayer(a[r], r);
            for (r in n) this._addLayer(n[r], r, !0);
          },
          onAdd: function (a) {
            (this._initLayout(),
              this._update(),
              (this._map = a),
              a.on("zoomend", this._checkDisabledLayers, this));
            for (var n = 0; n < this._layers.length; n++)
              this._layers[n].layer.on("add remove", this._onLayerChange, this);
            return this._container;
          },
          addTo: function (a) {
            return (
              gt.prototype.addTo.call(this, a),
              this._expandIfNotCollapsed()
            );
          },
          onRemove: function () {
            this._map.off("zoomend", this._checkDisabledLayers, this);
            for (var a = 0; a < this._layers.length; a++)
              this._layers[a].layer.off(
                "add remove",
                this._onLayerChange,
                this,
              );
          },
          addBaseLayer: function (a, n) {
            return (this._addLayer(a, n), this._map ? this._update() : this);
          },
          addOverlay: function (a, n) {
            return (
              this._addLayer(a, n, !0),
              this._map ? this._update() : this
            );
          },
          removeLayer: function (a) {
            a.off("add remove", this._onLayerChange, this);
            var n = this._getLayer(f(a));
            return (
              n && this._layers.splice(this._layers.indexOf(n), 1),
              this._map ? this._update() : this
            );
          },
          expand: function () {
            (oe(this._container, "leaflet-control-layers-expanded"),
              (this._section.style.height = null));
            var a = this._map.getSize().y - (this._container.offsetTop + 50);
            return (
              a < this._section.clientHeight
                ? (oe(this._section, "leaflet-control-layers-scrollbar"),
                  (this._section.style.height = a + "px"))
                : Re(this._section, "leaflet-control-layers-scrollbar"),
              this._checkDisabledLayers(),
              this
            );
          },
          collapse: function () {
            return (
              Re(this._container, "leaflet-control-layers-expanded"),
              this
            );
          },
          _initLayout: function () {
            var a = "leaflet-control-layers",
              n = (this._container = he("div", a)),
              u = this.options.collapsed;
            (n.setAttribute("aria-haspopup", !0), Le(n), _e(n));
            var r = (this._section = he("section", a + "-list"));
            u &&
              (this._map.on("click", this.collapse, this),
              ae(
                n,
                { mouseenter: this._expandSafely, mouseleave: this.collapse },
                this,
              ));
            var d = (this._layersLink = he("a", a + "-toggle", n));
            ((d.href = "#"),
              (d.title = "Layers"),
              d.setAttribute("role", "button"),
              ae(
                d,
                {
                  keydown: function (h) {
                    h.keyCode === 13 && this._expandSafely();
                  },
                  click: function (h) {
                    (se(h), this._expandSafely());
                  },
                },
                this,
              ),
              u || this.expand(),
              (this._baseLayersList = he("div", a + "-base", r)),
              (this._separator = he("div", a + "-separator", r)),
              (this._overlaysList = he("div", a + "-overlays", r)),
              n.appendChild(r));
          },
          _getLayer: function (a) {
            for (var n = 0; n < this._layers.length; n++)
              if (this._layers[n] && f(this._layers[n].layer) === a)
                return this._layers[n];
          },
          _addLayer: function (a, n, u) {
            (this._map && a.on("add remove", this._onLayerChange, this),
              this._layers.push({ layer: a, name: n, overlay: u }),
              this.options.sortLayers &&
                this._layers.sort(
                  l(function (r, d) {
                    return this.options.sortFunction(
                      r.layer,
                      d.layer,
                      r.name,
                      d.name,
                    );
                  }, this),
                ),
              this.options.autoZIndex &&
                a.setZIndex &&
                (this._lastZIndex++, a.setZIndex(this._lastZIndex)),
              this._expandIfNotCollapsed());
          },
          _update: function () {
            if (!this._container) return this;
            (Ct(this._baseLayersList),
              Ct(this._overlaysList),
              (this._layerControlInputs = []));
            var a,
              n,
              u,
              r,
              d = 0;
            for (u = 0; u < this._layers.length; u++)
              ((r = this._layers[u]),
                this._addItem(r),
                (n = n || r.overlay),
                (a = a || !r.overlay),
                (d += r.overlay ? 0 : 1));
            return (
              this.options.hideSingleBase &&
                ((a = a && d > 1),
                (this._baseLayersList.style.display = a ? "" : "none")),
              (this._separator.style.display = n && a ? "" : "none"),
              this
            );
          },
          _onLayerChange: function (a) {
            this._handlingClick || this._update();
            var n = this._getLayer(f(a.target)),
              u = n.overlay
                ? a.type === "add"
                  ? "overlayadd"
                  : "overlayremove"
                : a.type === "add"
                  ? "baselayerchange"
                  : null;
            u && this._map.fire(u, n);
          },
          _createRadioElement: function (a, n) {
            var u =
                '<input type="radio" class="leaflet-control-layers-selector" name="' +
                a +
                '"' +
                (n ? ' checked="checked"' : "") +
                "/>",
              r = document.createElement("div");
            return ((r.innerHTML = u), r.firstChild);
          },
          _addItem: function (a) {
            var n = document.createElement("label"),
              u = this._map.hasLayer(a.layer),
              r;
            (a.overlay
              ? ((r = document.createElement("input")),
                (r.type = "checkbox"),
                (r.className = "leaflet-control-layers-selector"),
                (r.defaultChecked = u))
              : (r = this._createRadioElement(
                  "leaflet-base-layers_" + f(this),
                  u,
                )),
              this._layerControlInputs.push(r),
              (r.layerId = f(a.layer)),
              ae(r, "click", this._onInputClick, this));
            var d = document.createElement("span");
            d.innerHTML = " " + a.name;
            var h = document.createElement("span");
            (n.appendChild(h), h.appendChild(r), h.appendChild(d));
            var I = a.overlay ? this._overlaysList : this._baseLayersList;
            return (I.appendChild(n), this._checkDisabledLayers(), n);
          },
          _onInputClick: function () {
            if (!this._preventClick) {
              var a = this._layerControlInputs,
                n,
                u,
                r = [],
                d = [];
              this._handlingClick = !0;
              for (var h = a.length - 1; h >= 0; h--)
                ((n = a[h]),
                  (u = this._getLayer(n.layerId).layer),
                  n.checked ? r.push(u) : n.checked || d.push(u));
              for (h = 0; h < d.length; h++)
                this._map.hasLayer(d[h]) && this._map.removeLayer(d[h]);
              for (h = 0; h < r.length; h++)
                this._map.hasLayer(r[h]) || this._map.addLayer(r[h]);
              ((this._handlingClick = !1), this._refocusOnMap());
            }
          },
          _checkDisabledLayers: function () {
            for (
              var a = this._layerControlInputs,
                n,
                u,
                r = this._map.getZoom(),
                d = a.length - 1;
              d >= 0;
              d--
            )
              ((n = a[d]),
                (u = this._getLayer(n.layerId).layer),
                (n.disabled =
                  (u.options.minZoom !== void 0 && r < u.options.minZoom) ||
                  (u.options.maxZoom !== void 0 && r > u.options.maxZoom)));
          },
          _expandIfNotCollapsed: function () {
            return (
              this._map && !this.options.collapsed && this.expand(),
              this
            );
          },
          _expandSafely: function () {
            var a = this._section;
            ((this._preventClick = !0), ae(a, "click", se), this.expand());
            var n = this;
            setTimeout(function () {
              (A(a, "click", se), (n._preventClick = !1));
            });
          },
        }),
        hL = function (a, n, u) {
          return new Cl(a, n, u);
        },
        ff = gt.extend({
          options: {
            position: "topleft",
            zoomInText: '<span aria-hidden="true">+</span>',
            zoomInTitle: "Zoom in",
            zoomOutText: '<span aria-hidden="true">&#x2212;</span>',
            zoomOutTitle: "Zoom out",
          },
          onAdd: function (a) {
            var n = "leaflet-control-zoom",
              u = he("div", n + " leaflet-bar"),
              r = this.options;
            return (
              (this._zoomInButton = this._createButton(
                r.zoomInText,
                r.zoomInTitle,
                n + "-in",
                u,
                this._zoomIn,
              )),
              (this._zoomOutButton = this._createButton(
                r.zoomOutText,
                r.zoomOutTitle,
                n + "-out",
                u,
                this._zoomOut,
              )),
              this._updateDisabled(),
              a.on("zoomend zoomlevelschange", this._updateDisabled, this),
              u
            );
          },
          onRemove: function (a) {
            a.off("zoomend zoomlevelschange", this._updateDisabled, this);
          },
          disable: function () {
            return ((this._disabled = !0), this._updateDisabled(), this);
          },
          enable: function () {
            return ((this._disabled = !1), this._updateDisabled(), this);
          },
          _zoomIn: function (a) {
            !this._disabled &&
              this._map._zoom < this._map.getMaxZoom() &&
              this._map.zoomIn(
                this._map.options.zoomDelta * (a.shiftKey ? 3 : 1),
              );
          },
          _zoomOut: function (a) {
            !this._disabled &&
              this._map._zoom > this._map.getMinZoom() &&
              this._map.zoomOut(
                this._map.options.zoomDelta * (a.shiftKey ? 3 : 1),
              );
          },
          _createButton: function (a, n, u, r, d) {
            var h = he("a", u, r);
            return (
              (h.innerHTML = a),
              (h.href = "#"),
              (h.title = n),
              h.setAttribute("role", "button"),
              h.setAttribute("aria-label", n),
              Le(h),
              ae(h, "click", Be),
              ae(h, "click", d, this),
              ae(h, "click", this._refocusOnMap, this),
              h
            );
          },
          _updateDisabled: function () {
            var a = this._map,
              n = "leaflet-disabled";
            (Re(this._zoomInButton, n),
              Re(this._zoomOutButton, n),
              this._zoomInButton.setAttribute("aria-disabled", "false"),
              this._zoomOutButton.setAttribute("aria-disabled", "false"),
              (this._disabled || a._zoom === a.getMinZoom()) &&
                (oe(this._zoomOutButton, n),
                this._zoomOutButton.setAttribute("aria-disabled", "true")),
              (this._disabled || a._zoom === a.getMaxZoom()) &&
                (oe(this._zoomInButton, n),
                this._zoomInButton.setAttribute("aria-disabled", "true")));
          },
        });
      (me.mergeOptions({ zoomControl: !0 }),
        me.addInitHook(function () {
          this.options.zoomControl &&
            ((this.zoomControl = new ff()), this.addControl(this.zoomControl));
        }));
      var mL = function (a) {
          return new ff(a);
        },
        mh = gt.extend({
          options: {
            position: "bottomleft",
            maxWidth: 100,
            metric: !0,
            imperial: !0,
          },
          onAdd: function (a) {
            var n = "leaflet-control-scale",
              u = he("div", n),
              r = this.options;
            return (
              this._addScales(r, n + "-line", u),
              a.on(r.updateWhenIdle ? "moveend" : "move", this._update, this),
              a.whenReady(this._update, this),
              u
            );
          },
          onRemove: function (a) {
            a.off(
              this.options.updateWhenIdle ? "moveend" : "move",
              this._update,
              this,
            );
          },
          _addScales: function (a, n, u) {
            (a.metric && (this._mScale = he("div", n, u)),
              a.imperial && (this._iScale = he("div", n, u)));
          },
          _update: function () {
            var a = this._map,
              n = a.getSize().y / 2,
              u = a.distance(
                a.containerPointToLatLng([0, n]),
                a.containerPointToLatLng([this.options.maxWidth, n]),
              );
            this._updateScales(u);
          },
          _updateScales: function (a) {
            (this.options.metric && a && this._updateMetric(a),
              this.options.imperial && a && this._updateImperial(a));
          },
          _updateMetric: function (a) {
            var n = this._getRoundNum(a),
              u = n < 1e3 ? n + " m" : n / 1e3 + " km";
            this._updateScale(this._mScale, u, n / a);
          },
          _updateImperial: function (a) {
            var n = a * 3.2808399,
              u,
              r,
              d;
            n > 5280
              ? ((u = n / 5280),
                (r = this._getRoundNum(u)),
                this._updateScale(this._iScale, r + " mi", r / u))
              : ((d = this._getRoundNum(n)),
                this._updateScale(this._iScale, d + " ft", d / n));
          },
          _updateScale: function (a, n, u) {
            ((a.style.width = Math.round(this.options.maxWidth * u) + "px"),
              (a.innerHTML = n));
          },
          _getRoundNum: function (a) {
            var n = Math.pow(10, (Math.floor(a) + "").length - 1),
              u = a / n;
            return (
              (u = u >= 10 ? 10 : u >= 5 ? 5 : u >= 3 ? 3 : u >= 2 ? 2 : 1),
              n * u
            );
          },
        }),
        pL = function (a) {
          return new mh(a);
        },
        gL =
          '<svg aria-hidden="true" xmlns="http://www.w3.org/2000/svg" width="12" height="8" viewBox="0 0 12 8" class="leaflet-attribution-flag"><path fill="#4C7BE1" d="M0 0h12v4H0z"/><path fill="#FFD500" d="M0 4h12v3H0z"/><path fill="#E0BC00" d="M0 7h12v1H0z"/></svg>',
        df = gt.extend({
          options: {
            position: "bottomright",
            prefix:
              '<a href="https://leafletjs.com" title="A JavaScript library for interactive maps">' +
              (X.inlineSvg ? gL + " " : "") +
              "Leaflet</a>",
          },
          initialize: function (a) {
            (x(this, a), (this._attributions = {}));
          },
          onAdd: function (a) {
            ((a.attributionControl = this),
              (this._container = he("div", "leaflet-control-attribution")),
              Le(this._container));
            for (var n in a._layers)
              a._layers[n].getAttribution &&
                this.addAttribution(a._layers[n].getAttribution());
            return (
              this._update(),
              a.on("layeradd", this._addAttribution, this),
              this._container
            );
          },
          onRemove: function (a) {
            a.off("layeradd", this._addAttribution, this);
          },
          _addAttribution: function (a) {
            a.layer.getAttribution &&
              (this.addAttribution(a.layer.getAttribution()),
              a.layer.once(
                "remove",
                function () {
                  this.removeAttribution(a.layer.getAttribution());
                },
                this,
              ));
          },
          setPrefix: function (a) {
            return ((this.options.prefix = a), this._update(), this);
          },
          addAttribution: function (a) {
            return a
              ? (this._attributions[a] || (this._attributions[a] = 0),
                this._attributions[a]++,
                this._update(),
                this)
              : this;
          },
          removeAttribution: function (a) {
            return a
              ? (this._attributions[a] &&
                  (this._attributions[a]--, this._update()),
                this)
              : this;
          },
          _update: function () {
            if (this._map) {
              var a = [];
              for (var n in this._attributions)
                this._attributions[n] && a.push(n);
              var u = [];
              (this.options.prefix && u.push(this.options.prefix),
                a.length && u.push(a.join(", ")),
                (this._container.innerHTML = u.join(
                  ' <span aria-hidden="true">|</span> ',
                )));
            }
          },
        });
      (me.mergeOptions({ attributionControl: !0 }),
        me.addInitHook(function () {
          this.options.attributionControl && new df().addTo(this);
        }));
      var LL = function (a) {
        return new df(a);
      };
      ((gt.Layers = Cl),
        (gt.Zoom = ff),
        (gt.Scale = mh),
        (gt.Attribution = df),
        (Ja.layers = hL),
        (Ja.zoom = mL),
        (Ja.scale = pL),
        (Ja.attribution = LL));
      var Ba = Ze.extend({
        initialize: function (a) {
          this._map = a;
        },
        enable: function () {
          return this._enabled
            ? this
            : ((this._enabled = !0), this.addHooks(), this);
        },
        disable: function () {
          return this._enabled
            ? ((this._enabled = !1), this.removeHooks(), this)
            : this;
        },
        enabled: function () {
          return !!this._enabled;
        },
      });
      Ba.addTo = function (a, n) {
        return (a.addHandler(n, this), this);
      };
      var _L = { Events: et },
        ph = X.touch ? "touchstart mousedown" : "mousedown",
        Pi = Ii.extend({
          options: { clickTolerance: 3 },
          initialize: function (a, n, u, r) {
            (x(this, r),
              (this._element = a),
              (this._dragStartTarget = n || a),
              (this._preventOutline = u));
          },
          enable: function () {
            this._enabled ||
              (ae(this._dragStartTarget, ph, this._onDown, this),
              (this._enabled = !0));
          },
          disable: function () {
            this._enabled &&
              (Pi._dragging === this && this.finishDrag(!0),
              A(this._dragStartTarget, ph, this._onDown, this),
              (this._enabled = !1),
              (this._moved = !1));
          },
          _onDown: function (a) {
            if (
              this._enabled &&
              ((this._moved = !1), !ma(this._element, "leaflet-zoom-anim"))
            ) {
              if (a.touches && a.touches.length !== 1) {
                Pi._dragging === this && this.finishDrag();
                return;
              }
              if (
                !(
                  Pi._dragging ||
                  a.shiftKey ||
                  (a.which !== 1 && a.button !== 1 && !a.touches)
                ) &&
                ((Pi._dragging = this),
                this._preventOutline && an(this._element),
                Da(),
                Ka(),
                !this._moving)
              ) {
                this.fire("down");
                var n = a.touches ? a.touches[0] : a,
                  u = ns(this._element);
                ((this._startPoint = new $(n.clientX, n.clientY)),
                  (this._startPos = Wt(this._element)),
                  (this._parentScale = Sl(u)));
                var r = a.type === "mousedown";
                (ae(
                  document,
                  r ? "mousemove" : "touchmove",
                  this._onMove,
                  this,
                ),
                  ae(
                    document,
                    r ? "mouseup" : "touchend touchcancel",
                    this._onUp,
                    this,
                  ));
              }
            }
          },
          _onMove: function (a) {
            if (this._enabled) {
              if (a.touches && a.touches.length > 1) {
                this._moved = !0;
                return;
              }
              var n = a.touches && a.touches.length === 1 ? a.touches[0] : a,
                u = new $(n.clientX, n.clientY)._subtract(this._startPoint);
              (!u.x && !u.y) ||
                Math.abs(u.x) + Math.abs(u.y) < this.options.clickTolerance ||
                ((u.x /= this._parentScale.x),
                (u.y /= this._parentScale.y),
                se(a),
                this._moved ||
                  (this.fire("dragstart"),
                  (this._moved = !0),
                  oe(document.body, "leaflet-dragging"),
                  (this._lastTarget = a.target || a.srcElement),
                  window.SVGElementInstance &&
                    this._lastTarget instanceof window.SVGElementInstance &&
                    (this._lastTarget =
                      this._lastTarget.correspondingUseElement),
                  oe(this._lastTarget, "leaflet-drag-target")),
                (this._newPos = this._startPos.add(u)),
                (this._moving = !0),
                (this._lastEvent = a),
                this._updatePosition());
            }
          },
          _updatePosition: function () {
            var a = { originalEvent: this._lastEvent };
            (this.fire("predrag", a),
              qe(this._element, this._newPos),
              this.fire("drag", a));
          },
          _onUp: function () {
            this._enabled && this.finishDrag();
          },
          finishDrag: function (a) {
            (Re(document.body, "leaflet-dragging"),
              this._lastTarget &&
                (Re(this._lastTarget, "leaflet-drag-target"),
                (this._lastTarget = null)),
              A(document, "mousemove touchmove", this._onMove, this),
              A(document, "mouseup touchend touchcancel", this._onUp, this),
              xl(),
              Bi());
            var n = this._moved && this._moving;
            ((this._moving = !1),
              (Pi._dragging = !1),
              n &&
                this.fire("dragend", {
                  noInertia: a,
                  distance: this._newPos.distanceTo(this._startPos),
                }));
          },
        });
      function gh(a, n, u) {
        var r,
          d = [1, 4, 2, 8],
          h,
          I,
          M,
          D,
          U,
          N,
          Q,
          re;
        for (h = 0, N = a.length; h < N; h++) a[h]._code = vo(a[h], n);
        for (M = 0; M < 4; M++) {
          for (Q = d[M], r = [], h = 0, N = a.length, I = N - 1; h < N; I = h++)
            ((D = a[h]),
              (U = a[I]),
              D._code & Q
                ? U._code & Q ||
                  ((re = us(U, D, Q, n, u)), (re._code = vo(re, n)), r.push(re))
                : (U._code & Q &&
                    ((re = us(U, D, Q, n, u)),
                    (re._code = vo(re, n)),
                    r.push(re)),
                  r.push(D)));
          a = r;
        }
        return a;
      }
      function Lh(a, n) {
        var u, r, d, h, I, M, D, U, N;
        if (!a || a.length === 0) throw new Error("latlngs not passed");
        Jt(a) ||
          (console.warn(
            "latlngs are not flat! Only the first ring will be used",
          ),
          (a = a[0]));
        var Q = fe([0, 0]),
          re = He(a),
          _t =
            re.getNorthWest().distanceTo(re.getSouthWest()) *
            re.getNorthEast().distanceTo(re.getNorthWest());
        _t < 1700 && (Q = cf(a));
        var it = a.length,
          $t = [];
        for (u = 0; u < it; u++) {
          var wt = fe(a[u]);
          $t.push(n.project(fe([wt.lat - Q.lat, wt.lng - Q.lng])));
        }
        for (M = D = U = 0, u = 0, r = it - 1; u < it; r = u++)
          ((d = $t[u]),
            (h = $t[r]),
            (I = d.y * h.x - h.y * d.x),
            (D += (d.x + h.x) * I),
            (U += (d.y + h.y) * I),
            (M += I * 3));
        M === 0 ? (N = $t[0]) : (N = [D / M, U / M]);
        var dn = n.unproject(ee(N));
        return fe([dn.lat + Q.lat, dn.lng + Q.lng]);
      }
      function cf(a) {
        for (var n = 0, u = 0, r = 0, d = 0; d < a.length; d++) {
          var h = fe(a[d]);
          ((n += h.lat), (u += h.lng), r++);
        }
        return fe([n / r, u / r]);
      }
      var vL = {
        __proto__: null,
        clipPolygon: gh,
        polygonCenter: Lh,
        centroid: cf,
      };
      function _h(a, n) {
        if (!n || !a.length) return a.slice();
        var u = n * n;
        return ((a = SL(a, u)), (a = xL(a, u)), a);
      }
      function vh(a, n, u) {
        return Math.sqrt(Il(a, n, u, !0));
      }
      function yL(a, n, u) {
        return Il(a, n, u);
      }
      function xL(a, n) {
        var u = a.length,
          r = typeof Uint8Array < "u" ? Uint8Array : Array,
          d = new r(u);
        ((d[0] = d[u - 1] = 1), hf(a, d, n, 0, u - 1));
        var h,
          I = [];
        for (h = 0; h < u; h++) d[h] && I.push(a[h]);
        return I;
      }
      function hf(a, n, u, r, d) {
        var h = 0,
          I,
          M,
          D;
        for (M = r + 1; M <= d - 1; M++)
          ((D = Il(a[M], a[r], a[d], !0)), D > h && ((I = M), (h = D)));
        h > u && ((n[I] = 1), hf(a, n, u, r, I), hf(a, n, u, I, d));
      }
      function SL(a, n) {
        for (var u = [a[0]], r = 1, d = 0, h = a.length; r < h; r++)
          CL(a[r], a[d]) > n && (u.push(a[r]), (d = r));
        return (d < h - 1 && u.push(a[h - 1]), u);
      }
      var yh;
      function xh(a, n, u, r, d) {
        var h = r ? yh : vo(a, u),
          I = vo(n, u),
          M,
          D,
          U;
        for (yh = I; ;) {
          if (!(h | I)) return [a, n];
          if (h & I) return !1;
          ((M = h || I),
            (D = us(a, n, M, u, d)),
            (U = vo(D, u)),
            M === h ? ((a = D), (h = U)) : ((n = D), (I = U)));
        }
      }
      function us(a, n, u, r, d) {
        var h = n.x - a.x,
          I = n.y - a.y,
          M = r.min,
          D = r.max,
          U,
          N;
        return (
          u & 8
            ? ((U = a.x + (h * (D.y - a.y)) / I), (N = D.y))
            : u & 4
              ? ((U = a.x + (h * (M.y - a.y)) / I), (N = M.y))
              : u & 2
                ? ((U = D.x), (N = a.y + (I * (D.x - a.x)) / h))
                : u & 1 && ((U = M.x), (N = a.y + (I * (M.x - a.x)) / h)),
          new $(U, N, d)
        );
      }
      function vo(a, n) {
        var u = 0;
        return (
          a.x < n.min.x ? (u |= 1) : a.x > n.max.x && (u |= 2),
          a.y < n.min.y ? (u |= 4) : a.y > n.max.y && (u |= 8),
          u
        );
      }
      function CL(a, n) {
        var u = n.x - a.x,
          r = n.y - a.y;
        return u * u + r * r;
      }
      function Il(a, n, u, r) {
        var d = n.x,
          h = n.y,
          I = u.x - d,
          M = u.y - h,
          D = I * I + M * M,
          U;
        return (
          D > 0 &&
            ((U = ((a.x - d) * I + (a.y - h) * M) / D),
            U > 1
              ? ((d = u.x), (h = u.y))
              : U > 0 && ((d += I * U), (h += M * U))),
          (I = a.x - d),
          (M = a.y - h),
          r ? I * I + M * M : new $(d, h)
        );
      }
      function Jt(a) {
        return !b(a[0]) || (typeof a[0][0] != "object" && typeof a[0][0] < "u");
      }
      function Sh(a) {
        return (
          console.warn(
            "Deprecated use of _flat, please use L.LineUtil.isFlat instead.",
          ),
          Jt(a)
        );
      }
      function Ch(a, n) {
        var u, r, d, h, I, M, D, U;
        if (!a || a.length === 0) throw new Error("latlngs not passed");
        Jt(a) ||
          (console.warn(
            "latlngs are not flat! Only the first ring will be used",
          ),
          (a = a[0]));
        var N = fe([0, 0]),
          Q = He(a),
          re =
            Q.getNorthWest().distanceTo(Q.getSouthWest()) *
            Q.getNorthEast().distanceTo(Q.getNorthWest());
        re < 1700 && (N = cf(a));
        var _t = a.length,
          it = [];
        for (u = 0; u < _t; u++) {
          var $t = fe(a[u]);
          it.push(n.project(fe([$t.lat - N.lat, $t.lng - N.lng])));
        }
        for (u = 0, r = 0; u < _t - 1; u++)
          r += it[u].distanceTo(it[u + 1]) / 2;
        if (r === 0) U = it[0];
        else
          for (u = 0, h = 0; u < _t - 1; u++)
            if (
              ((I = it[u]),
              (M = it[u + 1]),
              (d = I.distanceTo(M)),
              (h += d),
              h > r)
            ) {
              ((D = (h - r) / d),
                (U = [M.x - D * (M.x - I.x), M.y - D * (M.y - I.y)]));
              break;
            }
        var wt = n.unproject(ee(U));
        return fe([wt.lat + N.lat, wt.lng + N.lng]);
      }
      var IL = {
          __proto__: null,
          simplify: _h,
          pointToSegmentDistance: vh,
          closestPointOnSegment: yL,
          clipSegment: xh,
          _getEdgeIntersection: us,
          _getBitCode: vo,
          _sqClosestPointOnSegment: Il,
          isFlat: Jt,
          _flat: Sh,
          polylineCenter: Ch,
        },
        mf = {
          project: function (a) {
            return new $(a.lng, a.lat);
          },
          unproject: function (a) {
            return new q(a.y, a.x);
          },
          bounds: new De([-180, -90], [180, 90]),
        },
        pf = {
          R: 6378137,
          R_MINOR: 6356752314245179e-9,
          bounds: new De(
            [-2003750834279e-5, -1549657073972e-5],
            [2003750834279e-5, 1876465623138e-5],
          ),
          project: function (a) {
            var n = Math.PI / 180,
              u = this.R,
              r = a.lat * n,
              d = this.R_MINOR / u,
              h = Math.sqrt(1 - d * d),
              I = h * Math.sin(r),
              M =
                Math.tan(Math.PI / 4 - r / 2) /
                Math.pow((1 - I) / (1 + I), h / 2);
            return (
              (r = -u * Math.log(Math.max(M, 1e-10))),
              new $(a.lng * n * u, r)
            );
          },
          unproject: function (a) {
            for (
              var n = 180 / Math.PI,
                u = this.R,
                r = this.R_MINOR / u,
                d = Math.sqrt(1 - r * r),
                h = Math.exp(-a.y / u),
                I = Math.PI / 2 - 2 * Math.atan(h),
                M = 0,
                D = 0.1,
                U;
              M < 15 && Math.abs(D) > 1e-7;
              M++
            )
              ((U = d * Math.sin(I)),
                (U = Math.pow((1 - U) / (1 + U), d / 2)),
                (D = Math.PI / 2 - 2 * Math.atan(h * U) - I),
                (I += D));
            return new q(I * n, (a.x * n) / u);
          },
        },
        bL = {
          __proto__: null,
          LonLat: mf,
          Mercator: pf,
          SphericalMercator: Kt,
        },
        wL = i({}, Yt, {
          code: "EPSG:3395",
          projection: pf,
          transformation: (function () {
            var a = 0.5 / (Math.PI * pf.R);
            return bi(a, 0.5, -a, 0.5);
          })(),
        }),
        Ih = i({}, Yt, {
          code: "EPSG:4326",
          projection: mf,
          transformation: bi(1 / 180, 1, -1 / 180, 0.5),
        }),
        ML = i({}, ca, {
          projection: mf,
          transformation: bi(1, 0, -1, 0),
          scale: function (a) {
            return Math.pow(2, a);
          },
          zoom: function (a) {
            return Math.log(a) / Math.LN2;
          },
          distance: function (a, n) {
            var u = n.lng - a.lng,
              r = n.lat - a.lat;
            return Math.sqrt(u * u + r * r);
          },
          infinite: !0,
        });
      ((ca.Earth = Yt),
        (ca.EPSG3395 = wL),
        (ca.EPSG3857 = Ye),
        (ca.EPSG900913 = ju),
        (ca.EPSG4326 = Ih),
        (ca.Simple = ML));
      var _a = Ii.extend({
        options: {
          pane: "overlayPane",
          attribution: null,
          bubblingMouseEvents: !0,
        },
        addTo: function (a) {
          return (a.addLayer(this), this);
        },
        remove: function () {
          return this.removeFrom(this._map || this._mapToAdd);
        },
        removeFrom: function (a) {
          return (a && a.removeLayer(this), this);
        },
        getPane: function (a) {
          return this._map.getPane(
            a ? this.options[a] || a : this.options.pane,
          );
        },
        addInteractiveTarget: function (a) {
          return ((this._map._targets[f(a)] = this), this);
        },
        removeInteractiveTarget: function (a) {
          return (delete this._map._targets[f(a)], this);
        },
        getAttribution: function () {
          return this.options.attribution;
        },
        _layerAdd: function (a) {
          var n = a.target;
          if (n.hasLayer(this)) {
            if (
              ((this._map = n),
              (this._zoomAnimated = n._zoomAnimated),
              this.getEvents)
            ) {
              var u = this.getEvents();
              (n.on(u, this),
                this.once(
                  "remove",
                  function () {
                    n.off(u, this);
                  },
                  this,
                ));
            }
            (this.onAdd(n),
              this.fire("add"),
              n.fire("layeradd", { layer: this }));
          }
        },
      });
      me.include({
        addLayer: function (a) {
          if (!a._layerAdd)
            throw new Error("The provided object is not a Layer.");
          var n = f(a);
          return this._layers[n]
            ? this
            : ((this._layers[n] = a),
              (a._mapToAdd = this),
              a.beforeAdd && a.beforeAdd(this),
              this.whenReady(a._layerAdd, a),
              this);
        },
        removeLayer: function (a) {
          var n = f(a);
          return this._layers[n]
            ? (this._loaded && a.onRemove(this),
              delete this._layers[n],
              this._loaded &&
                (this.fire("layerremove", { layer: a }), a.fire("remove")),
              (a._map = a._mapToAdd = null),
              this)
            : this;
        },
        hasLayer: function (a) {
          return f(a) in this._layers;
        },
        eachLayer: function (a, n) {
          for (var u in this._layers) a.call(n, this._layers[u]);
          return this;
        },
        _addLayers: function (a) {
          a = a ? (b(a) ? a : [a]) : [];
          for (var n = 0, u = a.length; n < u; n++) this.addLayer(a[n]);
        },
        _addZoomLimit: function (a) {
          (!isNaN(a.options.maxZoom) || !isNaN(a.options.minZoom)) &&
            ((this._zoomBoundLayers[f(a)] = a), this._updateZoomLevels());
        },
        _removeZoomLimit: function (a) {
          var n = f(a);
          this._zoomBoundLayers[n] &&
            (delete this._zoomBoundLayers[n], this._updateZoomLevels());
        },
        _updateZoomLevels: function () {
          var a = 1 / 0,
            n = -1 / 0,
            u = this._getZoomSpan();
          for (var r in this._zoomBoundLayers) {
            var d = this._zoomBoundLayers[r].options;
            ((a = d.minZoom === void 0 ? a : Math.min(a, d.minZoom)),
              (n = d.maxZoom === void 0 ? n : Math.max(n, d.maxZoom)));
          }
          ((this._layersMaxZoom = n === -1 / 0 ? void 0 : n),
            (this._layersMinZoom = a === 1 / 0 ? void 0 : a),
            u !== this._getZoomSpan() && this.fire("zoomlevelschange"),
            this.options.maxZoom === void 0 &&
              this._layersMaxZoom &&
              this.getZoom() > this._layersMaxZoom &&
              this.setZoom(this._layersMaxZoom),
            this.options.minZoom === void 0 &&
              this._layersMinZoom &&
              this.getZoom() < this._layersMinZoom &&
              this.setZoom(this._layersMinZoom));
        },
      });
      var ln = _a.extend({
          initialize: function (a, n) {
            (x(this, n), (this._layers = {}));
            var u, r;
            if (a) for (u = 0, r = a.length; u < r; u++) this.addLayer(a[u]);
          },
          addLayer: function (a) {
            var n = this.getLayerId(a);
            return (
              (this._layers[n] = a),
              this._map && this._map.addLayer(a),
              this
            );
          },
          removeLayer: function (a) {
            var n = a in this._layers ? a : this.getLayerId(a);
            return (
              this._map &&
                this._layers[n] &&
                this._map.removeLayer(this._layers[n]),
              delete this._layers[n],
              this
            );
          },
          hasLayer: function (a) {
            var n = typeof a == "number" ? a : this.getLayerId(a);
            return n in this._layers;
          },
          clearLayers: function () {
            return this.eachLayer(this.removeLayer, this);
          },
          invoke: function (a) {
            var n = Array.prototype.slice.call(arguments, 1),
              u,
              r;
            for (u in this._layers)
              ((r = this._layers[u]), r[a] && r[a].apply(r, n));
            return this;
          },
          onAdd: function (a) {
            this.eachLayer(a.addLayer, a);
          },
          onRemove: function (a) {
            this.eachLayer(a.removeLayer, a);
          },
          eachLayer: function (a, n) {
            for (var u in this._layers) a.call(n, this._layers[u]);
            return this;
          },
          getLayer: function (a) {
            return this._layers[a];
          },
          getLayers: function () {
            var a = [];
            return (this.eachLayer(a.push, a), a);
          },
          setZIndex: function (a) {
            return this.invoke("setZIndex", a);
          },
          getLayerId: function (a) {
            return f(a);
          },
        }),
        TL = function (a, n) {
          return new ln(a, n);
        },
        $a = ln.extend({
          addLayer: function (a) {
            return this.hasLayer(a)
              ? this
              : (a.addEventParent(this),
                ln.prototype.addLayer.call(this, a),
                this.fire("layeradd", { layer: a }));
          },
          removeLayer: function (a) {
            return this.hasLayer(a)
              ? (a in this._layers && (a = this._layers[a]),
                a.removeEventParent(this),
                ln.prototype.removeLayer.call(this, a),
                this.fire("layerremove", { layer: a }))
              : this;
          },
          setStyle: function (a) {
            return this.invoke("setStyle", a);
          },
          bringToFront: function () {
            return this.invoke("bringToFront");
          },
          bringToBack: function () {
            return this.invoke("bringToBack");
          },
          getBounds: function () {
            var a = new je();
            for (var n in this._layers) {
              var u = this._layers[n];
              a.extend(u.getBounds ? u.getBounds() : u.getLatLng());
            }
            return a;
          },
        }),
        AL = function (a, n) {
          return new $a(a, n);
        },
        un = Ze.extend({
          options: {
            popupAnchor: [0, 0],
            tooltipAnchor: [0, 0],
            crossOrigin: !1,
          },
          initialize: function (a) {
            x(this, a);
          },
          createIcon: function (a) {
            return this._createIcon("icon", a);
          },
          createShadow: function (a) {
            return this._createIcon("shadow", a);
          },
          _createIcon: function (a, n) {
            var u = this._getIconUrl(a);
            if (!u) {
              if (a === "icon")
                throw new Error(
                  "iconUrl not set in Icon options (see the docs).",
                );
              return null;
            }
            var r = this._createImg(u, n && n.tagName === "IMG" ? n : null);
            return (
              this._setIconStyles(r, a),
              (this.options.crossOrigin || this.options.crossOrigin === "") &&
                (r.crossOrigin =
                  this.options.crossOrigin === !0
                    ? ""
                    : this.options.crossOrigin),
              r
            );
          },
          _setIconStyles: function (a, n) {
            var u = this.options,
              r = u[n + "Size"];
            typeof r == "number" && (r = [r, r]);
            var d = ee(r),
              h = ee(
                (n === "shadow" && u.shadowAnchor) ||
                  u.iconAnchor ||
                  (d && d.divideBy(2, !0)),
              );
            ((a.className = "leaflet-marker-" + n + " " + (u.className || "")),
              h &&
                ((a.style.marginLeft = -h.x + "px"),
                (a.style.marginTop = -h.y + "px")),
              d &&
                ((a.style.width = d.x + "px"), (a.style.height = d.y + "px")));
          },
          _createImg: function (a, n) {
            return ((n = n || document.createElement("img")), (n.src = a), n);
          },
          _getIconUrl: function (a) {
            return (
              (X.retina && this.options[a + "RetinaUrl"]) ||
              this.options[a + "Url"]
            );
          },
        });
      function DL(a) {
        return new un(a);
      }
      var bl = un.extend({
          options: {
            iconUrl: "marker-icon.png",
            iconRetinaUrl: "marker-icon-2x.png",
            shadowUrl: "marker-shadow.png",
            iconSize: [25, 41],
            iconAnchor: [12, 41],
            popupAnchor: [1, -34],
            tooltipAnchor: [16, -28],
            shadowSize: [41, 41],
          },
          _getIconUrl: function (a) {
            return (
              typeof bl.imagePath != "string" &&
                (bl.imagePath = this._detectIconPath()),
              (this.options.imagePath || bl.imagePath) +
                un.prototype._getIconUrl.call(this, a)
            );
          },
          _stripUrl: function (a) {
            var n = function (u, r, d) {
              var h = r.exec(u);
              return h && h[d];
            };
            return (
              (a = n(a, /^url\((['"])?(.+)\1\)$/, 2)),
              a && n(a, /^(.*)marker-icon\.png$/, 1)
            );
          },
          _detectIconPath: function () {
            var a = he("div", "leaflet-default-icon-path", document.body),
              n = Qt(a, "background-image") || Qt(a, "backgroundImage");
            if ((document.body.removeChild(a), (n = this._stripUrl(n)), n))
              return n;
            var u = document.querySelector('link[href$="leaflet.css"]');
            return u ? u.href.substring(0, u.href.length - 11 - 1) : "";
          },
        }),
        bh = Ba.extend({
          initialize: function (a) {
            this._marker = a;
          },
          addHooks: function () {
            var a = this._marker._icon;
            (this._draggable || (this._draggable = new Pi(a, a, !0)),
              this._draggable
                .on(
                  {
                    dragstart: this._onDragStart,
                    predrag: this._onPreDrag,
                    drag: this._onDrag,
                    dragend: this._onDragEnd,
                  },
                  this,
                )
                .enable(),
              oe(a, "leaflet-marker-draggable"));
          },
          removeHooks: function () {
            (this._draggable
              .off(
                {
                  dragstart: this._onDragStart,
                  predrag: this._onPreDrag,
                  drag: this._onDrag,
                  dragend: this._onDragEnd,
                },
                this,
              )
              .disable(),
              this._marker._icon &&
                Re(this._marker._icon, "leaflet-marker-draggable"));
          },
          moved: function () {
            return this._draggable && this._draggable._moved;
          },
          _adjustPan: function (a) {
            var n = this._marker,
              u = n._map,
              r = this._marker.options.autoPanSpeed,
              d = this._marker.options.autoPanPadding,
              h = Wt(n._icon),
              I = u.getPixelBounds(),
              M = u.getPixelOrigin(),
              D = Xe(I.min._subtract(M).add(d), I.max._subtract(M).subtract(d));
            if (!D.contains(h)) {
              var U = ee(
                (Math.max(D.max.x, h.x) - D.max.x) / (I.max.x - D.max.x) -
                  (Math.min(D.min.x, h.x) - D.min.x) / (I.min.x - D.min.x),
                (Math.max(D.max.y, h.y) - D.max.y) / (I.max.y - D.max.y) -
                  (Math.min(D.min.y, h.y) - D.min.y) / (I.min.y - D.min.y),
              ).multiplyBy(r);
              (u.panBy(U, { animate: !1 }),
                this._draggable._newPos._add(U),
                this._draggable._startPos._add(U),
                qe(n._icon, this._draggable._newPos),
                this._onDrag(a),
                (this._panRequest = V(this._adjustPan.bind(this, a))));
            }
          },
          _onDragStart: function () {
            ((this._oldLatLng = this._marker.getLatLng()),
              this._marker.closePopup && this._marker.closePopup(),
              this._marker.fire("movestart").fire("dragstart"));
          },
          _onPreDrag: function (a) {
            this._marker.options.autoPan &&
              (W(this._panRequest),
              (this._panRequest = V(this._adjustPan.bind(this, a))));
          },
          _onDrag: function (a) {
            var n = this._marker,
              u = n._shadow,
              r = Wt(n._icon),
              d = n._map.layerPointToLatLng(r);
            (u && qe(u, r),
              (n._latlng = d),
              (a.latlng = d),
              (a.oldLatLng = this._oldLatLng),
              n.fire("move", a).fire("drag", a));
          },
          _onDragEnd: function (a) {
            (W(this._panRequest),
              delete this._oldLatLng,
              this._marker.fire("moveend").fire("dragend", a));
          },
        }),
        ss = _a.extend({
          options: {
            icon: new bl(),
            interactive: !0,
            keyboard: !0,
            title: "",
            alt: "Marker",
            zIndexOffset: 0,
            opacity: 1,
            riseOnHover: !1,
            riseOffset: 250,
            pane: "markerPane",
            shadowPane: "shadowPane",
            bubblingMouseEvents: !1,
            autoPanOnFocus: !0,
            draggable: !1,
            autoPan: !1,
            autoPanPadding: [50, 50],
            autoPanSpeed: 10,
          },
          initialize: function (a, n) {
            (x(this, n), (this._latlng = fe(a)));
          },
          onAdd: function (a) {
            ((this._zoomAnimated =
              this._zoomAnimated && a.options.markerZoomAnimation),
              this._zoomAnimated && a.on("zoomanim", this._animateZoom, this),
              this._initIcon(),
              this.update());
          },
          onRemove: function (a) {
            (this.dragging &&
              this.dragging.enabled() &&
              ((this.options.draggable = !0), this.dragging.removeHooks()),
              delete this.dragging,
              this._zoomAnimated && a.off("zoomanim", this._animateZoom, this),
              this._removeIcon(),
              this._removeShadow());
          },
          getEvents: function () {
            return { zoom: this.update, viewreset: this.update };
          },
          getLatLng: function () {
            return this._latlng;
          },
          setLatLng: function (a) {
            var n = this._latlng;
            return (
              (this._latlng = fe(a)),
              this.update(),
              this.fire("move", { oldLatLng: n, latlng: this._latlng })
            );
          },
          setZIndexOffset: function (a) {
            return ((this.options.zIndexOffset = a), this.update());
          },
          getIcon: function () {
            return this.options.icon;
          },
          setIcon: function (a) {
            return (
              (this.options.icon = a),
              this._map && (this._initIcon(), this.update()),
              this._popup && this.bindPopup(this._popup, this._popup.options),
              this
            );
          },
          getElement: function () {
            return this._icon;
          },
          update: function () {
            if (this._icon && this._map) {
              var a = this._map.latLngToLayerPoint(this._latlng).round();
              this._setPos(a);
            }
            return this;
          },
          _initIcon: function () {
            var a = this.options,
              n = "leaflet-zoom-" + (this._zoomAnimated ? "animated" : "hide"),
              u = a.icon.createIcon(this._icon),
              r = !1;
            (u !== this._icon &&
              (this._icon && this._removeIcon(),
              (r = !0),
              a.title && (u.title = a.title),
              u.tagName === "IMG" && (u.alt = a.alt || "")),
              oe(u, n),
              a.keyboard &&
                ((u.tabIndex = "0"), u.setAttribute("role", "button")),
              (this._icon = u),
              a.riseOnHover &&
                this.on({
                  mouseover: this._bringToFront,
                  mouseout: this._resetZIndex,
                }),
              this.options.autoPanOnFocus &&
                ae(u, "focus", this._panOnFocus, this));
            var d = a.icon.createShadow(this._shadow),
              h = !1;
            (d !== this._shadow && (this._removeShadow(), (h = !0)),
              d && (oe(d, n), (d.alt = "")),
              (this._shadow = d),
              a.opacity < 1 && this._updateOpacity(),
              r && this.getPane().appendChild(this._icon),
              this._initInteraction(),
              d && h && this.getPane(a.shadowPane).appendChild(this._shadow));
          },
          _removeIcon: function () {
            (this.options.riseOnHover &&
              this.off({
                mouseover: this._bringToFront,
                mouseout: this._resetZIndex,
              }),
              this.options.autoPanOnFocus &&
                A(this._icon, "focus", this._panOnFocus, this),
              Me(this._icon),
              this.removeInteractiveTarget(this._icon),
              (this._icon = null));
          },
          _removeShadow: function () {
            (this._shadow && Me(this._shadow), (this._shadow = null));
          },
          _setPos: function (a) {
            (this._icon && qe(this._icon, a),
              this._shadow && qe(this._shadow, a),
              (this._zIndex = a.y + this.options.zIndexOffset),
              this._resetZIndex());
          },
          _updateZIndex: function (a) {
            this._icon && (this._icon.style.zIndex = this._zIndex + a);
          },
          _animateZoom: function (a) {
            var n = this._map
              ._latLngToNewLayerPoint(this._latlng, a.zoom, a.center)
              .round();
            this._setPos(n);
          },
          _initInteraction: function () {
            if (
              this.options.interactive &&
              (oe(this._icon, "leaflet-interactive"),
              this.addInteractiveTarget(this._icon),
              bh)
            ) {
              var a = this.options.draggable;
              (this.dragging &&
                ((a = this.dragging.enabled()), this.dragging.disable()),
                (this.dragging = new bh(this)),
                a && this.dragging.enable());
            }
          },
          setOpacity: function (a) {
            return (
              (this.options.opacity = a),
              this._map && this._updateOpacity(),
              this
            );
          },
          _updateOpacity: function () {
            var a = this.options.opacity;
            (this._icon && It(this._icon, a),
              this._shadow && It(this._shadow, a));
          },
          _bringToFront: function () {
            this._updateZIndex(this.options.riseOffset);
          },
          _resetZIndex: function () {
            this._updateZIndex(0);
          },
          _panOnFocus: function () {
            var a = this._map;
            if (a) {
              var n = this.options.icon.options,
                u = n.iconSize ? ee(n.iconSize) : ee(0, 0),
                r = n.iconAnchor ? ee(n.iconAnchor) : ee(0, 0);
              a.panInside(this._latlng, {
                paddingTopLeft: r,
                paddingBottomRight: u.subtract(r),
              });
            }
          },
          _getPopupAnchor: function () {
            return this.options.icon.options.popupAnchor;
          },
          _getTooltipAnchor: function () {
            return this.options.icon.options.tooltipAnchor;
          },
        });
      function BL(a, n) {
        return new ss(a, n);
      }
      var ki = _a.extend({
          options: {
            stroke: !0,
            color: "#3388ff",
            weight: 3,
            opacity: 1,
            lineCap: "round",
            lineJoin: "round",
            dashArray: null,
            dashOffset: null,
            fill: !1,
            fillColor: null,
            fillOpacity: 0.2,
            fillRule: "evenodd",
            interactive: !0,
            bubblingMouseEvents: !0,
          },
          beforeAdd: function (a) {
            this._renderer = a.getRenderer(this);
          },
          onAdd: function () {
            (this._renderer._initPath(this),
              this._reset(),
              this._renderer._addPath(this));
          },
          onRemove: function () {
            this._renderer._removePath(this);
          },
          redraw: function () {
            return (this._map && this._renderer._updatePath(this), this);
          },
          setStyle: function (a) {
            return (
              x(this, a),
              this._renderer &&
                (this._renderer._updateStyle(this),
                this.options.stroke &&
                  a &&
                  Object.prototype.hasOwnProperty.call(a, "weight") &&
                  this._updateBounds()),
              this
            );
          },
          bringToFront: function () {
            return (this._renderer && this._renderer._bringToFront(this), this);
          },
          bringToBack: function () {
            return (this._renderer && this._renderer._bringToBack(this), this);
          },
          getElement: function () {
            return this._path;
          },
          _reset: function () {
            (this._project(), this._update());
          },
          _clickTolerance: function () {
            return (
              (this.options.stroke ? this.options.weight / 2 : 0) +
              (this._renderer.options.tolerance || 0)
            );
          },
        }),
        rs = ki.extend({
          options: { fill: !0, radius: 10 },
          initialize: function (a, n) {
            (x(this, n),
              (this._latlng = fe(a)),
              (this._radius = this.options.radius));
          },
          setLatLng: function (a) {
            var n = this._latlng;
            return (
              (this._latlng = fe(a)),
              this.redraw(),
              this.fire("move", { oldLatLng: n, latlng: this._latlng })
            );
          },
          getLatLng: function () {
            return this._latlng;
          },
          setRadius: function (a) {
            return ((this.options.radius = this._radius = a), this.redraw());
          },
          getRadius: function () {
            return this._radius;
          },
          setStyle: function (a) {
            var n = (a && a.radius) || this._radius;
            return (
              ki.prototype.setStyle.call(this, a),
              this.setRadius(n),
              this
            );
          },
          _project: function () {
            ((this._point = this._map.latLngToLayerPoint(this._latlng)),
              this._updateBounds());
          },
          _updateBounds: function () {
            var a = this._radius,
              n = this._radiusY || a,
              u = this._clickTolerance(),
              r = [a + u, n + u];
            this._pxBounds = new De(
              this._point.subtract(r),
              this._point.add(r),
            );
          },
          _update: function () {
            this._map && this._updatePath();
          },
          _updatePath: function () {
            this._renderer._updateCircle(this);
          },
          _empty: function () {
            return (
              this._radius && !this._renderer._bounds.intersects(this._pxBounds)
            );
          },
          _containsPoint: function (a) {
            return (
              a.distanceTo(this._point) <= this._radius + this._clickTolerance()
            );
          },
        });
      function PL(a, n) {
        return new rs(a, n);
      }
      var gf = rs.extend({
        initialize: function (a, n, u) {
          if (
            (typeof n == "number" && (n = i({}, u, { radius: n })),
            x(this, n),
            (this._latlng = fe(a)),
            isNaN(this.options.radius))
          )
            throw new Error("Circle radius cannot be NaN");
          this._mRadius = this.options.radius;
        },
        setRadius: function (a) {
          return ((this._mRadius = a), this.redraw());
        },
        getRadius: function () {
          return this._mRadius;
        },
        getBounds: function () {
          var a = [this._radius, this._radiusY || this._radius];
          return new je(
            this._map.layerPointToLatLng(this._point.subtract(a)),
            this._map.layerPointToLatLng(this._point.add(a)),
          );
        },
        setStyle: ki.prototype.setStyle,
        _project: function () {
          var a = this._latlng.lng,
            n = this._latlng.lat,
            u = this._map,
            r = u.options.crs;
          if (r.distance === Yt.distance) {
            var d = Math.PI / 180,
              h = this._mRadius / Yt.R / d,
              I = u.project([n + h, a]),
              M = u.project([n - h, a]),
              D = I.add(M).divideBy(2),
              U = u.unproject(D).lat,
              N =
                Math.acos(
                  (Math.cos(h * d) - Math.sin(n * d) * Math.sin(U * d)) /
                    (Math.cos(n * d) * Math.cos(U * d)),
                ) / d;
            ((isNaN(N) || N === 0) && (N = h / Math.cos((Math.PI / 180) * n)),
              (this._point = D.subtract(u.getPixelOrigin())),
              (this._radius = isNaN(N) ? 0 : D.x - u.project([U, a - N]).x),
              (this._radiusY = D.y - I.y));
          } else {
            var Q = r.unproject(
              r.project(this._latlng).subtract([this._mRadius, 0]),
            );
            ((this._point = u.latLngToLayerPoint(this._latlng)),
              (this._radius = this._point.x - u.latLngToLayerPoint(Q).x));
          }
          this._updateBounds();
        },
      });
      function kL(a, n, u) {
        return new gf(a, n, u);
      }
      var ei = ki.extend({
        options: { smoothFactor: 1, noClip: !1 },
        initialize: function (a, n) {
          (x(this, n), this._setLatLngs(a));
        },
        getLatLngs: function () {
          return this._latlngs;
        },
        setLatLngs: function (a) {
          return (this._setLatLngs(a), this.redraw());
        },
        isEmpty: function () {
          return !this._latlngs.length;
        },
        closestLayerPoint: function (a) {
          for (
            var n = 1 / 0,
              u = null,
              r = Il,
              d,
              h,
              I = 0,
              M = this._parts.length;
            I < M;
            I++
          )
            for (var D = this._parts[I], U = 1, N = D.length; U < N; U++) {
              ((d = D[U - 1]), (h = D[U]));
              var Q = r(a, d, h, !0);
              Q < n && ((n = Q), (u = r(a, d, h)));
            }
          return (u && (u.distance = Math.sqrt(n)), u);
        },
        getCenter: function () {
          if (!this._map)
            throw new Error("Must add layer to map before using getCenter()");
          return Ch(this._defaultShape(), this._map.options.crs);
        },
        getBounds: function () {
          return this._bounds;
        },
        addLatLng: function (a, n) {
          return (
            (n = n || this._defaultShape()),
            (a = fe(a)),
            n.push(a),
            this._bounds.extend(a),
            this.redraw()
          );
        },
        _setLatLngs: function (a) {
          ((this._bounds = new je()),
            (this._latlngs = this._convertLatLngs(a)));
        },
        _defaultShape: function () {
          return Jt(this._latlngs) ? this._latlngs : this._latlngs[0];
        },
        _convertLatLngs: function (a) {
          for (var n = [], u = Jt(a), r = 0, d = a.length; r < d; r++)
            u
              ? ((n[r] = fe(a[r])), this._bounds.extend(n[r]))
              : (n[r] = this._convertLatLngs(a[r]));
          return n;
        },
        _project: function () {
          var a = new De();
          ((this._rings = []),
            this._projectLatlngs(this._latlngs, this._rings, a),
            this._bounds.isValid() &&
              a.isValid() &&
              ((this._rawPxBounds = a), this._updateBounds()));
        },
        _updateBounds: function () {
          var a = this._clickTolerance(),
            n = new $(a, a);
          this._rawPxBounds &&
            (this._pxBounds = new De([
              this._rawPxBounds.min.subtract(n),
              this._rawPxBounds.max.add(n),
            ]));
        },
        _projectLatlngs: function (a, n, u) {
          var r = a[0] instanceof q,
            d = a.length,
            h,
            I;
          if (r) {
            for (I = [], h = 0; h < d; h++)
              ((I[h] = this._map.latLngToLayerPoint(a[h])), u.extend(I[h]));
            n.push(I);
          } else for (h = 0; h < d; h++) this._projectLatlngs(a[h], n, u);
        },
        _clipPoints: function () {
          var a = this._renderer._bounds;
          if (
            ((this._parts = []),
            !(!this._pxBounds || !this._pxBounds.intersects(a)))
          ) {
            if (this.options.noClip) {
              this._parts = this._rings;
              return;
            }
            var n = this._parts,
              u,
              r,
              d,
              h,
              I,
              M,
              D;
            for (u = 0, d = 0, h = this._rings.length; u < h; u++)
              for (D = this._rings[u], r = 0, I = D.length; r < I - 1; r++)
                ((M = xh(D[r], D[r + 1], a, r, !0)),
                  M &&
                    ((n[d] = n[d] || []),
                    n[d].push(M[0]),
                    (M[1] !== D[r + 1] || r === I - 2) &&
                      (n[d].push(M[1]), d++)));
          }
        },
        _simplifyPoints: function () {
          for (
            var a = this._parts,
              n = this.options.smoothFactor,
              u = 0,
              r = a.length;
            u < r;
            u++
          )
            a[u] = _h(a[u], n);
        },
        _update: function () {
          this._map &&
            (this._clipPoints(), this._simplifyPoints(), this._updatePath());
        },
        _updatePath: function () {
          this._renderer._updatePoly(this);
        },
        _containsPoint: function (a, n) {
          var u,
            r,
            d,
            h,
            I,
            M,
            D = this._clickTolerance();
          if (!this._pxBounds || !this._pxBounds.contains(a)) return !1;
          for (u = 0, h = this._parts.length; u < h; u++)
            for (
              M = this._parts[u], r = 0, I = M.length, d = I - 1;
              r < I;
              d = r++
            )
              if (!(!n && r === 0) && vh(a, M[d], M[r]) <= D) return !0;
          return !1;
        },
      });
      function zL(a, n) {
        return new ei(a, n);
      }
      ei._flat = Sh;
      var sn = ei.extend({
        options: { fill: !0 },
        isEmpty: function () {
          return !this._latlngs.length || !this._latlngs[0].length;
        },
        getCenter: function () {
          if (!this._map)
            throw new Error("Must add layer to map before using getCenter()");
          return Lh(this._defaultShape(), this._map.options.crs);
        },
        _convertLatLngs: function (a) {
          var n = ei.prototype._convertLatLngs.call(this, a),
            u = n.length;
          return (
            u >= 2 && n[0] instanceof q && n[0].equals(n[u - 1]) && n.pop(),
            n
          );
        },
        _setLatLngs: function (a) {
          (ei.prototype._setLatLngs.call(this, a),
            Jt(this._latlngs) && (this._latlngs = [this._latlngs]));
        },
        _defaultShape: function () {
          return Jt(this._latlngs[0]) ? this._latlngs[0] : this._latlngs[0][0];
        },
        _clipPoints: function () {
          var a = this._renderer._bounds,
            n = this.options.weight,
            u = new $(n, n);
          if (
            ((a = new De(a.min.subtract(u), a.max.add(u))),
            (this._parts = []),
            !(!this._pxBounds || !this._pxBounds.intersects(a)))
          ) {
            if (this.options.noClip) {
              this._parts = this._rings;
              return;
            }
            for (var r = 0, d = this._rings.length, h; r < d; r++)
              ((h = gh(this._rings[r], a, !0)),
                h.length && this._parts.push(h));
          }
        },
        _updatePath: function () {
          this._renderer._updatePoly(this, !0);
        },
        _containsPoint: function (a) {
          var n = !1,
            u,
            r,
            d,
            h,
            I,
            M,
            D,
            U;
          if (!this._pxBounds || !this._pxBounds.contains(a)) return !1;
          for (h = 0, D = this._parts.length; h < D; h++)
            for (
              u = this._parts[h], I = 0, U = u.length, M = U - 1;
              I < U;
              M = I++
            )
              ((r = u[I]),
                (d = u[M]),
                r.y > a.y != d.y > a.y &&
                  a.x < ((d.x - r.x) * (a.y - r.y)) / (d.y - r.y) + r.x &&
                  (n = !n));
          return n || ei.prototype._containsPoint.call(this, a, !0);
        },
      });
      function OL(a, n) {
        return new sn(a, n);
      }
      var ti = $a.extend({
        initialize: function (a, n) {
          (x(this, n), (this._layers = {}), a && this.addData(a));
        },
        addData: function (a) {
          var n = b(a) ? a : a.features,
            u,
            r,
            d;
          if (n) {
            for (u = 0, r = n.length; u < r; u++)
              ((d = n[u]),
                (d.geometries || d.geometry || d.features || d.coordinates) &&
                  this.addData(d));
            return this;
          }
          var h = this.options;
          if (h.filter && !h.filter(a)) return this;
          var I = fs(a, h);
          return I
            ? ((I.feature = hs(a)),
              (I.defaultOptions = I.options),
              this.resetStyle(I),
              h.onEachFeature && h.onEachFeature(a, I),
              this.addLayer(I))
            : this;
        },
        resetStyle: function (a) {
          return a === void 0
            ? this.eachLayer(this.resetStyle, this)
            : ((a.options = i({}, a.defaultOptions)),
              this._setLayerStyle(a, this.options.style),
              this);
        },
        setStyle: function (a) {
          return this.eachLayer(function (n) {
            this._setLayerStyle(n, a);
          }, this);
        },
        _setLayerStyle: function (a, n) {
          a.setStyle &&
            (typeof n == "function" && (n = n(a.feature)), a.setStyle(n));
        },
      });
      function fs(a, n) {
        var u = a.type === "Feature" ? a.geometry : a,
          r = u ? u.coordinates : null,
          d = [],
          h = n && n.pointToLayer,
          I = (n && n.coordsToLatLng) || Lf,
          M,
          D,
          U,
          N;
        if (!r && !u) return null;
        switch (u.type) {
          case "Point":
            return ((M = I(r)), wh(h, a, M, n));
          case "MultiPoint":
            for (U = 0, N = r.length; U < N; U++)
              ((M = I(r[U])), d.push(wh(h, a, M, n)));
            return new $a(d);
          case "LineString":
          case "MultiLineString":
            return (
              (D = ds(r, u.type === "LineString" ? 0 : 1, I)),
              new ei(D, n)
            );
          case "Polygon":
          case "MultiPolygon":
            return ((D = ds(r, u.type === "Polygon" ? 1 : 2, I)), new sn(D, n));
          case "GeometryCollection":
            for (U = 0, N = u.geometries.length; U < N; U++) {
              var Q = fs(
                {
                  geometry: u.geometries[U],
                  type: "Feature",
                  properties: a.properties,
                },
                n,
              );
              Q && d.push(Q);
            }
            return new $a(d);
          case "FeatureCollection":
            for (U = 0, N = u.features.length; U < N; U++) {
              var re = fs(u.features[U], n);
              re && d.push(re);
            }
            return new $a(d);
          default:
            throw new Error("Invalid GeoJSON object.");
        }
      }
      function wh(a, n, u, r) {
        return a ? a(n, u) : new ss(u, r && r.markersInheritOptions && r);
      }
      function Lf(a) {
        return new q(a[1], a[0], a[2]);
      }
      function ds(a, n, u) {
        for (var r = [], d = 0, h = a.length, I; d < h; d++)
          ((I = n ? ds(a[d], n - 1, u) : (u || Lf)(a[d])), r.push(I));
        return r;
      }
      function _f(a, n) {
        return (
          (a = fe(a)),
          a.alt !== void 0
            ? [p(a.lng, n), p(a.lat, n), p(a.alt, n)]
            : [p(a.lng, n), p(a.lat, n)]
        );
      }
      function cs(a, n, u, r) {
        for (var d = [], h = 0, I = a.length; h < I; h++)
          d.push(n ? cs(a[h], Jt(a[h]) ? 0 : n - 1, u, r) : _f(a[h], r));
        return (!n && u && d.length > 0 && d.push(d[0].slice()), d);
      }
      function rn(a, n) {
        return a.feature ? i({}, a.feature, { geometry: n }) : hs(n);
      }
      function hs(a) {
        return a.type === "Feature" || a.type === "FeatureCollection"
          ? a
          : { type: "Feature", properties: {}, geometry: a };
      }
      var vf = {
        toGeoJSON: function (a) {
          return rn(this, {
            type: "Point",
            coordinates: _f(this.getLatLng(), a),
          });
        },
      };
      (ss.include(vf),
        gf.include(vf),
        rs.include(vf),
        ei.include({
          toGeoJSON: function (a) {
            var n = !Jt(this._latlngs),
              u = cs(this._latlngs, n ? 1 : 0, !1, a);
            return rn(this, {
              type: (n ? "Multi" : "") + "LineString",
              coordinates: u,
            });
          },
        }),
        sn.include({
          toGeoJSON: function (a) {
            var n = !Jt(this._latlngs),
              u = n && !Jt(this._latlngs[0]),
              r = cs(this._latlngs, u ? 2 : n ? 1 : 0, !0, a);
            return (
              n || (r = [r]),
              rn(this, { type: (u ? "Multi" : "") + "Polygon", coordinates: r })
            );
          },
        }),
        ln.include({
          toMultiPoint: function (a) {
            var n = [];
            return (
              this.eachLayer(function (u) {
                n.push(u.toGeoJSON(a).geometry.coordinates);
              }),
              rn(this, { type: "MultiPoint", coordinates: n })
            );
          },
          toGeoJSON: function (a) {
            var n =
              this.feature &&
              this.feature.geometry &&
              this.feature.geometry.type;
            if (n === "MultiPoint") return this.toMultiPoint(a);
            var u = n === "GeometryCollection",
              r = [];
            return (
              this.eachLayer(function (d) {
                if (d.toGeoJSON) {
                  var h = d.toGeoJSON(a);
                  if (u) r.push(h.geometry);
                  else {
                    var I = hs(h);
                    I.type === "FeatureCollection"
                      ? r.push.apply(r, I.features)
                      : r.push(I);
                  }
                }
              }),
              u
                ? rn(this, { geometries: r, type: "GeometryCollection" })
                : { type: "FeatureCollection", features: r }
            );
          },
        }));
      function Mh(a, n) {
        return new ti(a, n);
      }
      var RL = Mh,
        ms = _a.extend({
          options: {
            opacity: 1,
            alt: "",
            interactive: !1,
            crossOrigin: !1,
            errorOverlayUrl: "",
            zIndex: 1,
            className: "",
          },
          initialize: function (a, n, u) {
            ((this._url = a), (this._bounds = He(n)), x(this, u));
          },
          onAdd: function () {
            (this._image ||
              (this._initImage(),
              this.options.opacity < 1 && this._updateOpacity()),
              this.options.interactive &&
                (oe(this._image, "leaflet-interactive"),
                this.addInteractiveTarget(this._image)),
              this.getPane().appendChild(this._image),
              this._reset());
          },
          onRemove: function () {
            (Me(this._image),
              this.options.interactive &&
                this.removeInteractiveTarget(this._image));
          },
          setOpacity: function (a) {
            return (
              (this.options.opacity = a),
              this._image && this._updateOpacity(),
              this
            );
          },
          setStyle: function (a) {
            return (a.opacity && this.setOpacity(a.opacity), this);
          },
          bringToFront: function () {
            return (this._map && st(this._image), this);
          },
          bringToBack: function () {
            return (this._map && Di(this._image), this);
          },
          setUrl: function (a) {
            return (
              (this._url = a),
              this._image && (this._image.src = a),
              this
            );
          },
          setBounds: function (a) {
            return ((this._bounds = He(a)), this._map && this._reset(), this);
          },
          getEvents: function () {
            var a = { zoom: this._reset, viewreset: this._reset };
            return (this._zoomAnimated && (a.zoomanim = this._animateZoom), a);
          },
          setZIndex: function (a) {
            return ((this.options.zIndex = a), this._updateZIndex(), this);
          },
          getBounds: function () {
            return this._bounds;
          },
          getElement: function () {
            return this._image;
          },
          _initImage: function () {
            var a = this._url.tagName === "IMG",
              n = (this._image = a ? this._url : he("img"));
            if (
              (oe(n, "leaflet-image-layer"),
              this._zoomAnimated && oe(n, "leaflet-zoom-animated"),
              this.options.className && oe(n, this.options.className),
              (n.onselectstart = y),
              (n.onmousemove = y),
              (n.onload = l(this.fire, this, "load")),
              (n.onerror = l(this._overlayOnError, this, "error")),
              (this.options.crossOrigin || this.options.crossOrigin === "") &&
                (n.crossOrigin =
                  this.options.crossOrigin === !0
                    ? ""
                    : this.options.crossOrigin),
              this.options.zIndex && this._updateZIndex(),
              a)
            ) {
              this._url = n.src;
              return;
            }
            ((n.src = this._url), (n.alt = this.options.alt));
          },
          _animateZoom: function (a) {
            var n = this._map.getZoomScale(a.zoom),
              u = this._map._latLngBoundsToNewLayerBounds(
                this._bounds,
                a.zoom,
                a.center,
              ).min;
            pa(this._image, u, n);
          },
          _reset: function () {
            var a = this._image,
              n = new De(
                this._map.latLngToLayerPoint(this._bounds.getNorthWest()),
                this._map.latLngToLayerPoint(this._bounds.getSouthEast()),
              ),
              u = n.getSize();
            (qe(a, n.min),
              (a.style.width = u.x + "px"),
              (a.style.height = u.y + "px"));
          },
          _updateOpacity: function () {
            It(this._image, this.options.opacity);
          },
          _updateZIndex: function () {
            this._image &&
              this.options.zIndex !== void 0 &&
              this.options.zIndex !== null &&
              (this._image.style.zIndex = this.options.zIndex);
          },
          _overlayOnError: function () {
            this.fire("error");
            var a = this.options.errorOverlayUrl;
            a && this._url !== a && ((this._url = a), (this._image.src = a));
          },
          getCenter: function () {
            return this._bounds.getCenter();
          },
        }),
        EL = function (a, n, u) {
          return new ms(a, n, u);
        },
        Th = ms.extend({
          options: {
            autoplay: !0,
            loop: !0,
            keepAspectRatio: !0,
            muted: !1,
            playsInline: !0,
          },
          _initImage: function () {
            var a = this._url.tagName === "VIDEO",
              n = (this._image = a ? this._url : he("video"));
            if (
              (oe(n, "leaflet-image-layer"),
              this._zoomAnimated && oe(n, "leaflet-zoom-animated"),
              this.options.className && oe(n, this.options.className),
              (n.onselectstart = y),
              (n.onmousemove = y),
              (n.onloadeddata = l(this.fire, this, "load")),
              a)
            ) {
              for (
                var u = n.getElementsByTagName("source"), r = [], d = 0;
                d < u.length;
                d++
              )
                r.push(u[d].src);
              this._url = u.length > 0 ? r : [n.src];
              return;
            }
            (b(this._url) || (this._url = [this._url]),
              !this.options.keepAspectRatio &&
                Object.prototype.hasOwnProperty.call(n.style, "objectFit") &&
                (n.style.objectFit = "fill"),
              (n.autoplay = !!this.options.autoplay),
              (n.loop = !!this.options.loop),
              (n.muted = !!this.options.muted),
              (n.playsInline = !!this.options.playsInline));
            for (var h = 0; h < this._url.length; h++) {
              var I = he("source");
              ((I.src = this._url[h]), n.appendChild(I));
            }
          },
        });
      function UL(a, n, u) {
        return new Th(a, n, u);
      }
      var Ah = ms.extend({
        _initImage: function () {
          var a = (this._image = this._url);
          (oe(a, "leaflet-image-layer"),
            this._zoomAnimated && oe(a, "leaflet-zoom-animated"),
            this.options.className && oe(a, this.options.className),
            (a.onselectstart = y),
            (a.onmousemove = y));
        },
      });
      function qL(a, n, u) {
        return new Ah(a, n, u);
      }
      var Pa = _a.extend({
        options: {
          interactive: !1,
          offset: [0, 0],
          className: "",
          pane: void 0,
          content: "",
        },
        initialize: function (a, n) {
          (a && (a instanceof q || b(a))
            ? ((this._latlng = fe(a)), x(this, n))
            : (x(this, a), (this._source = n)),
            this.options.content && (this._content = this.options.content));
        },
        openOn: function (a) {
          return (
            (a = arguments.length ? a : this._source._map),
            a.hasLayer(this) || a.addLayer(this),
            this
          );
        },
        close: function () {
          return (this._map && this._map.removeLayer(this), this);
        },
        toggle: function (a) {
          return (
            this._map
              ? this.close()
              : (arguments.length ? (this._source = a) : (a = this._source),
                this._prepareOpen(),
                this.openOn(a._map)),
            this
          );
        },
        onAdd: function (a) {
          ((this._zoomAnimated = a._zoomAnimated),
            this._container || this._initLayout(),
            a._fadeAnimated && It(this._container, 0),
            clearTimeout(this._removeTimeout),
            this.getPane().appendChild(this._container),
            this.update(),
            a._fadeAnimated && It(this._container, 1),
            this.bringToFront(),
            this.options.interactive &&
              (oe(this._container, "leaflet-interactive"),
              this.addInteractiveTarget(this._container)));
        },
        onRemove: function (a) {
          (a._fadeAnimated
            ? (It(this._container, 0),
              (this._removeTimeout = setTimeout(
                l(Me, void 0, this._container),
                200,
              )))
            : Me(this._container),
            this.options.interactive &&
              (Re(this._container, "leaflet-interactive"),
              this.removeInteractiveTarget(this._container)));
        },
        getLatLng: function () {
          return this._latlng;
        },
        setLatLng: function (a) {
          return (
            (this._latlng = fe(a)),
            this._map && (this._updatePosition(), this._adjustPan()),
            this
          );
        },
        getContent: function () {
          return this._content;
        },
        setContent: function (a) {
          return ((this._content = a), this.update(), this);
        },
        getElement: function () {
          return this._container;
        },
        update: function () {
          this._map &&
            ((this._container.style.visibility = "hidden"),
            this._updateContent(),
            this._updateLayout(),
            this._updatePosition(),
            (this._container.style.visibility = ""),
            this._adjustPan());
        },
        getEvents: function () {
          var a = {
            zoom: this._updatePosition,
            viewreset: this._updatePosition,
          };
          return (this._zoomAnimated && (a.zoomanim = this._animateZoom), a);
        },
        isOpen: function () {
          return !!this._map && this._map.hasLayer(this);
        },
        bringToFront: function () {
          return (this._map && st(this._container), this);
        },
        bringToBack: function () {
          return (this._map && Di(this._container), this);
        },
        _prepareOpen: function (a) {
          var n = this._source;
          if (!n._map) return !1;
          if (n instanceof $a) {
            n = null;
            var u = this._source._layers;
            for (var r in u)
              if (u[r]._map) {
                n = u[r];
                break;
              }
            if (!n) return !1;
            this._source = n;
          }
          if (!a)
            if (n.getCenter) a = n.getCenter();
            else if (n.getLatLng) a = n.getLatLng();
            else if (n.getBounds) a = n.getBounds().getCenter();
            else throw new Error("Unable to get source layer LatLng.");
          return (this.setLatLng(a), this._map && this.update(), !0);
        },
        _updateContent: function () {
          if (this._content) {
            var a = this._contentNode,
              n =
                typeof this._content == "function"
                  ? this._content(this._source || this)
                  : this._content;
            if (typeof n == "string") a.innerHTML = n;
            else {
              for (; a.hasChildNodes();) a.removeChild(a.firstChild);
              a.appendChild(n);
            }
            this.fire("contentupdate");
          }
        },
        _updatePosition: function () {
          if (this._map) {
            var a = this._map.latLngToLayerPoint(this._latlng),
              n = ee(this.options.offset),
              u = this._getAnchor();
            this._zoomAnimated
              ? qe(this._container, a.add(u))
              : (n = n.add(a).add(u));
            var r = (this._containerBottom = -n.y),
              d = (this._containerLeft =
                -Math.round(this._containerWidth / 2) + n.x);
            ((this._container.style.bottom = r + "px"),
              (this._container.style.left = d + "px"));
          }
        },
        _getAnchor: function () {
          return [0, 0];
        },
      });
      (me.include({
        _initOverlay: function (a, n, u, r) {
          var d = n;
          return (
            d instanceof a || (d = new a(r).setContent(n)),
            u && d.setLatLng(u),
            d
          );
        },
      }),
        _a.include({
          _initOverlay: function (a, n, u, r) {
            var d = u;
            return (
              d instanceof a
                ? (x(d, r), (d._source = this))
                : ((d = n && !r ? n : new a(r, this)), d.setContent(u)),
              d
            );
          },
        }));
      var ps = Pa.extend({
          options: {
            pane: "popupPane",
            offset: [0, 7],
            maxWidth: 300,
            minWidth: 50,
            maxHeight: null,
            autoPan: !0,
            autoPanPaddingTopLeft: null,
            autoPanPaddingBottomRight: null,
            autoPanPadding: [5, 5],
            keepInView: !1,
            closeButton: !0,
            autoClose: !0,
            closeOnEscapeKey: !0,
            className: "",
          },
          openOn: function (a) {
            return (
              (a = arguments.length ? a : this._source._map),
              !a.hasLayer(this) &&
                a._popup &&
                a._popup.options.autoClose &&
                a.removeLayer(a._popup),
              (a._popup = this),
              Pa.prototype.openOn.call(this, a)
            );
          },
          onAdd: function (a) {
            (Pa.prototype.onAdd.call(this, a),
              a.fire("popupopen", { popup: this }),
              this._source &&
                (this._source.fire("popupopen", { popup: this }, !0),
                this._source instanceof ki || this._source.on("preclick", ne)));
          },
          onRemove: function (a) {
            (Pa.prototype.onRemove.call(this, a),
              a.fire("popupclose", { popup: this }),
              this._source &&
                (this._source.fire("popupclose", { popup: this }, !0),
                this._source instanceof ki ||
                  this._source.off("preclick", ne)));
          },
          getEvents: function () {
            var a = Pa.prototype.getEvents.call(this);
            return (
              (this.options.closeOnClick !== void 0
                ? this.options.closeOnClick
                : this._map.options.closePopupOnClick) &&
                (a.preclick = this.close),
              this.options.keepInView && (a.moveend = this._adjustPan),
              a
            );
          },
          _initLayout: function () {
            var a = "leaflet-popup",
              n = (this._container = he(
                "div",
                a +
                  " " +
                  (this.options.className || "") +
                  " leaflet-zoom-animated",
              )),
              u = (this._wrapper = he("div", a + "-content-wrapper", n));
            if (
              ((this._contentNode = he("div", a + "-content", u)),
              Le(n),
              _e(this._contentNode),
              ae(n, "contextmenu", ne),
              (this._tipContainer = he("div", a + "-tip-container", n)),
              (this._tip = he("div", a + "-tip", this._tipContainer)),
              this.options.closeButton)
            ) {
              var r = (this._closeButton = he("a", a + "-close-button", n));
              (r.setAttribute("role", "button"),
                r.setAttribute("aria-label", "Close popup"),
                (r.href = "#close"),
                (r.innerHTML = '<span aria-hidden="true">&#215;</span>'),
                ae(
                  r,
                  "click",
                  function (d) {
                    (se(d), this.close());
                  },
                  this,
                ));
            }
          },
          _updateLayout: function () {
            var a = this._contentNode,
              n = a.style;
            ((n.width = ""), (n.whiteSpace = "nowrap"));
            var u = a.offsetWidth;
            ((u = Math.min(u, this.options.maxWidth)),
              (u = Math.max(u, this.options.minWidth)),
              (n.width = u + 1 + "px"),
              (n.whiteSpace = ""),
              (n.height = ""));
            var r = a.offsetHeight,
              d = this.options.maxHeight,
              h = "leaflet-popup-scrolled";
            (d && r > d ? ((n.height = d + "px"), oe(a, h)) : Re(a, h),
              (this._containerWidth = this._container.offsetWidth));
          },
          _animateZoom: function (a) {
            var n = this._map._latLngToNewLayerPoint(
                this._latlng,
                a.zoom,
                a.center,
              ),
              u = this._getAnchor();
            qe(this._container, n.add(u));
          },
          _adjustPan: function () {
            if (this.options.autoPan) {
              if (
                (this._map._panAnim && this._map._panAnim.stop(),
                this._autopanning)
              ) {
                this._autopanning = !1;
                return;
              }
              var a = this._map,
                n = parseInt(Qt(this._container, "marginBottom"), 10) || 0,
                u = this._container.offsetHeight + n,
                r = this._containerWidth,
                d = new $(this._containerLeft, -u - this._containerBottom);
              d._add(Wt(this._container));
              var h = a.layerPointToContainerPoint(d),
                I = ee(this.options.autoPanPadding),
                M = ee(this.options.autoPanPaddingTopLeft || I),
                D = ee(this.options.autoPanPaddingBottomRight || I),
                U = a.getSize(),
                N = 0,
                Q = 0;
              (h.x + r + D.x > U.x && (N = h.x + r - U.x + D.x),
                h.x - N - M.x < 0 && (N = h.x - M.x),
                h.y + u + D.y > U.y && (Q = h.y + u - U.y + D.y),
                h.y - Q - M.y < 0 && (Q = h.y - M.y),
                (N || Q) &&
                  (this.options.keepInView && (this._autopanning = !0),
                  a.fire("autopanstart").panBy([N, Q])));
            }
          },
          _getAnchor: function () {
            return ee(
              this._source && this._source._getPopupAnchor
                ? this._source._getPopupAnchor()
                : [0, 0],
            );
          },
        }),
        HL = function (a, n) {
          return new ps(a, n);
        };
      (me.mergeOptions({ closePopupOnClick: !0 }),
        me.include({
          openPopup: function (a, n, u) {
            return (this._initOverlay(ps, a, n, u).openOn(this), this);
          },
          closePopup: function (a) {
            return (
              (a = arguments.length ? a : this._popup),
              a && a.close(),
              this
            );
          },
        }),
        _a.include({
          bindPopup: function (a, n) {
            return (
              (this._popup = this._initOverlay(ps, this._popup, a, n)),
              this._popupHandlersAdded ||
                (this.on({
                  click: this._openPopup,
                  keypress: this._onKeyPress,
                  remove: this.closePopup,
                  move: this._movePopup,
                }),
                (this._popupHandlersAdded = !0)),
              this
            );
          },
          unbindPopup: function () {
            return (
              this._popup &&
                (this.off({
                  click: this._openPopup,
                  keypress: this._onKeyPress,
                  remove: this.closePopup,
                  move: this._movePopup,
                }),
                (this._popupHandlersAdded = !1),
                (this._popup = null)),
              this
            );
          },
          openPopup: function (a) {
            return (
              this._popup &&
                (this instanceof $a || (this._popup._source = this),
                this._popup._prepareOpen(a || this._latlng) &&
                  this._popup.openOn(this._map)),
              this
            );
          },
          closePopup: function () {
            return (this._popup && this._popup.close(), this);
          },
          togglePopup: function () {
            return (this._popup && this._popup.toggle(this), this);
          },
          isPopupOpen: function () {
            return this._popup ? this._popup.isOpen() : !1;
          },
          setPopupContent: function (a) {
            return (this._popup && this._popup.setContent(a), this);
          },
          getPopup: function () {
            return this._popup;
          },
          _openPopup: function (a) {
            if (!(!this._popup || !this._map)) {
              Be(a);
              var n = a.layer || a.target;
              if (this._popup._source === n && !(n instanceof ki)) {
                this._map.hasLayer(this._popup)
                  ? this.closePopup()
                  : this.openPopup(a.latlng);
                return;
              }
              ((this._popup._source = n), this.openPopup(a.latlng));
            }
          },
          _movePopup: function (a) {
            this._popup.setLatLng(a.latlng);
          },
          _onKeyPress: function (a) {
            a.originalEvent.keyCode === 13 && this._openPopup(a);
          },
        }));
      var gs = Pa.extend({
          options: {
            pane: "tooltipPane",
            offset: [0, 0],
            direction: "auto",
            permanent: !1,
            sticky: !1,
            opacity: 0.9,
          },
          onAdd: function (a) {
            (Pa.prototype.onAdd.call(this, a),
              this.setOpacity(this.options.opacity),
              a.fire("tooltipopen", { tooltip: this }),
              this._source &&
                (this.addEventParent(this._source),
                this._source.fire("tooltipopen", { tooltip: this }, !0)));
          },
          onRemove: function (a) {
            (Pa.prototype.onRemove.call(this, a),
              a.fire("tooltipclose", { tooltip: this }),
              this._source &&
                (this.removeEventParent(this._source),
                this._source.fire("tooltipclose", { tooltip: this }, !0)));
          },
          getEvents: function () {
            var a = Pa.prototype.getEvents.call(this);
            return (this.options.permanent || (a.preclick = this.close), a);
          },
          _initLayout: function () {
            var a = "leaflet-tooltip",
              n =
                a +
                " " +
                (this.options.className || "") +
                " leaflet-zoom-" +
                (this._zoomAnimated ? "animated" : "hide");
            ((this._contentNode = this._container = he("div", n)),
              this._container.setAttribute("role", "tooltip"),
              this._container.setAttribute("id", "leaflet-tooltip-" + f(this)));
          },
          _updateLayout: function () {},
          _adjustPan: function () {},
          _setPosition: function (a) {
            var n,
              u,
              r = this._map,
              d = this._container,
              h = r.latLngToContainerPoint(r.getCenter()),
              I = r.layerPointToContainerPoint(a),
              M = this.options.direction,
              D = d.offsetWidth,
              U = d.offsetHeight,
              N = ee(this.options.offset),
              Q = this._getAnchor();
            (M === "top"
              ? ((n = D / 2), (u = U))
              : M === "bottom"
                ? ((n = D / 2), (u = 0))
                : M === "center"
                  ? ((n = D / 2), (u = U / 2))
                  : M === "right"
                    ? ((n = 0), (u = U / 2))
                    : M === "left"
                      ? ((n = D), (u = U / 2))
                      : I.x < h.x
                        ? ((M = "right"), (n = 0), (u = U / 2))
                        : ((M = "left"),
                          (n = D + (N.x + Q.x) * 2),
                          (u = U / 2)),
              (a = a
                .subtract(ee(n, u, !0))
                .add(N)
                .add(Q)),
              Re(d, "leaflet-tooltip-right"),
              Re(d, "leaflet-tooltip-left"),
              Re(d, "leaflet-tooltip-top"),
              Re(d, "leaflet-tooltip-bottom"),
              oe(d, "leaflet-tooltip-" + M),
              qe(d, a));
          },
          _updatePosition: function () {
            var a = this._map.latLngToLayerPoint(this._latlng);
            this._setPosition(a);
          },
          setOpacity: function (a) {
            ((this.options.opacity = a),
              this._container && It(this._container, a));
          },
          _animateZoom: function (a) {
            var n = this._map._latLngToNewLayerPoint(
              this._latlng,
              a.zoom,
              a.center,
            );
            this._setPosition(n);
          },
          _getAnchor: function () {
            return ee(
              this._source &&
                this._source._getTooltipAnchor &&
                !this.options.sticky
                ? this._source._getTooltipAnchor()
                : [0, 0],
            );
          },
        }),
        NL = function (a, n) {
          return new gs(a, n);
        };
      (me.include({
        openTooltip: function (a, n, u) {
          return (this._initOverlay(gs, a, n, u).openOn(this), this);
        },
        closeTooltip: function (a) {
          return (a.close(), this);
        },
      }),
        _a.include({
          bindTooltip: function (a, n) {
            return (
              this._tooltip && this.isTooltipOpen() && this.unbindTooltip(),
              (this._tooltip = this._initOverlay(gs, this._tooltip, a, n)),
              this._initTooltipInteractions(),
              this._tooltip.options.permanent &&
                this._map &&
                this._map.hasLayer(this) &&
                this.openTooltip(),
              this
            );
          },
          unbindTooltip: function () {
            return (
              this._tooltip &&
                (this._initTooltipInteractions(!0),
                this.closeTooltip(),
                (this._tooltip = null)),
              this
            );
          },
          _initTooltipInteractions: function (a) {
            if (!(!a && this._tooltipHandlersAdded)) {
              var n = a ? "off" : "on",
                u = { remove: this.closeTooltip, move: this._moveTooltip };
              (this._tooltip.options.permanent
                ? (u.add = this._openTooltip)
                : ((u.mouseover = this._openTooltip),
                  (u.mouseout = this.closeTooltip),
                  (u.click = this._openTooltip),
                  this._map
                    ? this._addFocusListeners()
                    : (u.add = this._addFocusListeners)),
                this._tooltip.options.sticky &&
                  (u.mousemove = this._moveTooltip),
                this[n](u),
                (this._tooltipHandlersAdded = !a));
            }
          },
          openTooltip: function (a) {
            return (
              this._tooltip &&
                (this instanceof $a || (this._tooltip._source = this),
                this._tooltip._prepareOpen(a) &&
                  (this._tooltip.openOn(this._map),
                  this.getElement
                    ? this._setAriaDescribedByOnLayer(this)
                    : this.eachLayer &&
                      this.eachLayer(this._setAriaDescribedByOnLayer, this))),
              this
            );
          },
          closeTooltip: function () {
            if (this._tooltip) return this._tooltip.close();
          },
          toggleTooltip: function () {
            return (this._tooltip && this._tooltip.toggle(this), this);
          },
          isTooltipOpen: function () {
            return this._tooltip.isOpen();
          },
          setTooltipContent: function (a) {
            return (this._tooltip && this._tooltip.setContent(a), this);
          },
          getTooltip: function () {
            return this._tooltip;
          },
          _addFocusListeners: function () {
            this.getElement
              ? this._addFocusListenersOnLayer(this)
              : this.eachLayer &&
                this.eachLayer(this._addFocusListenersOnLayer, this);
          },
          _addFocusListenersOnLayer: function (a) {
            var n = typeof a.getElement == "function" && a.getElement();
            n &&
              (ae(
                n,
                "focus",
                function () {
                  ((this._tooltip._source = a), this.openTooltip());
                },
                this,
              ),
              ae(n, "blur", this.closeTooltip, this));
          },
          _setAriaDescribedByOnLayer: function (a) {
            var n = typeof a.getElement == "function" && a.getElement();
            n &&
              n.setAttribute("aria-describedby", this._tooltip._container.id);
          },
          _openTooltip: function (a) {
            if (!(!this._tooltip || !this._map)) {
              if (
                this._map.dragging &&
                this._map.dragging.moving() &&
                !this._openOnceFlag
              ) {
                this._openOnceFlag = !0;
                var n = this;
                this._map.once("moveend", function () {
                  ((n._openOnceFlag = !1), n._openTooltip(a));
                });
                return;
              }
              ((this._tooltip._source = a.layer || a.target),
                this.openTooltip(
                  this._tooltip.options.sticky ? a.latlng : void 0,
                ));
            }
          },
          _moveTooltip: function (a) {
            var n = a.latlng,
              u,
              r;
            (this._tooltip.options.sticky &&
              a.originalEvent &&
              ((u = this._map.mouseEventToContainerPoint(a.originalEvent)),
              (r = this._map.containerPointToLayerPoint(u)),
              (n = this._map.layerPointToLatLng(r))),
              this._tooltip.setLatLng(n));
          },
        }));
      var Dh = un.extend({
        options: {
          iconSize: [12, 12],
          html: !1,
          bgPos: null,
          className: "leaflet-div-icon",
        },
        createIcon: function (a) {
          var n = a && a.tagName === "DIV" ? a : document.createElement("div"),
            u = this.options;
          if (
            (u.html instanceof Element
              ? (Ct(n), n.appendChild(u.html))
              : (n.innerHTML = u.html !== !1 ? u.html : ""),
            u.bgPos)
          ) {
            var r = ee(u.bgPos);
            n.style.backgroundPosition = -r.x + "px " + -r.y + "px";
          }
          return (this._setIconStyles(n, "icon"), n);
        },
        createShadow: function () {
          return null;
        },
      });
      function FL(a) {
        return new Dh(a);
      }
      un.Default = bl;
      var wl = _a.extend({
        options: {
          tileSize: 256,
          opacity: 1,
          updateWhenIdle: X.mobile,
          updateWhenZooming: !0,
          updateInterval: 200,
          zIndex: 1,
          bounds: null,
          minZoom: 0,
          maxZoom: void 0,
          maxNativeZoom: void 0,
          minNativeZoom: void 0,
          noWrap: !1,
          pane: "tilePane",
          className: "",
          keepBuffer: 2,
        },
        initialize: function (a) {
          x(this, a);
        },
        onAdd: function () {
          (this._initContainer(),
            (this._levels = {}),
            (this._tiles = {}),
            this._resetView());
        },
        beforeAdd: function (a) {
          a._addZoomLimit(this);
        },
        onRemove: function (a) {
          (this._removeAllTiles(),
            Me(this._container),
            a._removeZoomLimit(this),
            (this._container = null),
            (this._tileZoom = void 0));
        },
        bringToFront: function () {
          return (
            this._map && (st(this._container), this._setAutoZIndex(Math.max)),
            this
          );
        },
        bringToBack: function () {
          return (
            this._map && (Di(this._container), this._setAutoZIndex(Math.min)),
            this
          );
        },
        getContainer: function () {
          return this._container;
        },
        setOpacity: function (a) {
          return ((this.options.opacity = a), this._updateOpacity(), this);
        },
        setZIndex: function (a) {
          return ((this.options.zIndex = a), this._updateZIndex(), this);
        },
        isLoading: function () {
          return this._loading;
        },
        redraw: function () {
          if (this._map) {
            this._removeAllTiles();
            var a = this._clampZoom(this._map.getZoom());
            (a !== this._tileZoom &&
              ((this._tileZoom = a), this._updateLevels()),
              this._update());
          }
          return this;
        },
        getEvents: function () {
          var a = {
            viewprereset: this._invalidateAll,
            viewreset: this._resetView,
            zoom: this._resetView,
            moveend: this._onMoveEnd,
          };
          return (
            this.options.updateWhenIdle ||
              (this._onMove ||
                (this._onMove = c(
                  this._onMoveEnd,
                  this.options.updateInterval,
                  this,
                )),
              (a.move = this._onMove)),
            this._zoomAnimated && (a.zoomanim = this._animateZoom),
            a
          );
        },
        createTile: function () {
          return document.createElement("div");
        },
        getTileSize: function () {
          var a = this.options.tileSize;
          return a instanceof $ ? a : new $(a, a);
        },
        _updateZIndex: function () {
          this._container &&
            this.options.zIndex !== void 0 &&
            this.options.zIndex !== null &&
            (this._container.style.zIndex = this.options.zIndex);
        },
        _setAutoZIndex: function (a) {
          for (
            var n = this.getPane().children,
              u = -a(-1 / 0, 1 / 0),
              r = 0,
              d = n.length,
              h;
            r < d;
            r++
          )
            ((h = n[r].style.zIndex),
              n[r] !== this._container && h && (u = a(u, +h)));
          isFinite(u) &&
            ((this.options.zIndex = u + a(-1, 1)), this._updateZIndex());
        },
        _updateOpacity: function () {
          if (this._map && !X.ielt9) {
            It(this._container, this.options.opacity);
            var a = +new Date(),
              n = !1,
              u = !1;
            for (var r in this._tiles) {
              var d = this._tiles[r];
              if (!(!d.current || !d.loaded)) {
                var h = Math.min(1, (a - d.loaded) / 200);
                (It(d.el, h),
                  h < 1
                    ? (n = !0)
                    : (d.active ? (u = !0) : this._onOpaqueTile(d),
                      (d.active = !0)));
              }
            }
            (u && !this._noPrune && this._pruneTiles(),
              n &&
                (W(this._fadeFrame),
                (this._fadeFrame = V(this._updateOpacity, this))));
          }
        },
        _onOpaqueTile: y,
        _initContainer: function () {
          this._container ||
            ((this._container = he(
              "div",
              "leaflet-layer " + (this.options.className || ""),
            )),
            this._updateZIndex(),
            this.options.opacity < 1 && this._updateOpacity(),
            this.getPane().appendChild(this._container));
        },
        _updateLevels: function () {
          var a = this._tileZoom,
            n = this.options.maxZoom;
          if (a !== void 0) {
            for (var u in this._levels)
              ((u = Number(u)),
                this._levels[u].el.children.length || u === a
                  ? ((this._levels[u].el.style.zIndex = n - Math.abs(a - u)),
                    this._onUpdateLevel(u))
                  : (Me(this._levels[u].el),
                    this._removeTilesAtZoom(u),
                    this._onRemoveLevel(u),
                    delete this._levels[u]));
            var r = this._levels[a],
              d = this._map;
            return (
              r ||
                ((r = this._levels[a] = {}),
                (r.el = he(
                  "div",
                  "leaflet-tile-container leaflet-zoom-animated",
                  this._container,
                )),
                (r.el.style.zIndex = n),
                (r.origin = d
                  .project(d.unproject(d.getPixelOrigin()), a)
                  .round()),
                (r.zoom = a),
                this._setZoomTransform(r, d.getCenter(), d.getZoom()),
                y(r.el.offsetWidth),
                this._onCreateLevel(r)),
              (this._level = r),
              r
            );
          }
        },
        _onUpdateLevel: y,
        _onRemoveLevel: y,
        _onCreateLevel: y,
        _pruneTiles: function () {
          if (this._map) {
            var a,
              n,
              u = this._map.getZoom();
            if (u > this.options.maxZoom || u < this.options.minZoom) {
              this._removeAllTiles();
              return;
            }
            for (a in this._tiles)
              ((n = this._tiles[a]), (n.retain = n.current));
            for (a in this._tiles)
              if (((n = this._tiles[a]), n.current && !n.active)) {
                var r = n.coords;
                this._retainParent(r.x, r.y, r.z, r.z - 5) ||
                  this._retainChildren(r.x, r.y, r.z, r.z + 2);
              }
            for (a in this._tiles) this._tiles[a].retain || this._removeTile(a);
          }
        },
        _removeTilesAtZoom: function (a) {
          for (var n in this._tiles)
            this._tiles[n].coords.z === a && this._removeTile(n);
        },
        _removeAllTiles: function () {
          for (var a in this._tiles) this._removeTile(a);
        },
        _invalidateAll: function () {
          for (var a in this._levels)
            (Me(this._levels[a].el),
              this._onRemoveLevel(Number(a)),
              delete this._levels[a]);
          (this._removeAllTiles(), (this._tileZoom = void 0));
        },
        _retainParent: function (a, n, u, r) {
          var d = Math.floor(a / 2),
            h = Math.floor(n / 2),
            I = u - 1,
            M = new $(+d, +h);
          M.z = +I;
          var D = this._tileCoordsToKey(M),
            U = this._tiles[D];
          return U && U.active
            ? ((U.retain = !0), !0)
            : (U && U.loaded && (U.retain = !0),
              I > r ? this._retainParent(d, h, I, r) : !1);
        },
        _retainChildren: function (a, n, u, r) {
          for (var d = 2 * a; d < 2 * a + 2; d++)
            for (var h = 2 * n; h < 2 * n + 2; h++) {
              var I = new $(d, h);
              I.z = u + 1;
              var M = this._tileCoordsToKey(I),
                D = this._tiles[M];
              if (D && D.active) {
                D.retain = !0;
                continue;
              } else D && D.loaded && (D.retain = !0);
              u + 1 < r && this._retainChildren(d, h, u + 1, r);
            }
        },
        _resetView: function (a) {
          var n = a && (a.pinch || a.flyTo);
          this._setView(this._map.getCenter(), this._map.getZoom(), n, n);
        },
        _animateZoom: function (a) {
          this._setView(a.center, a.zoom, !0, a.noUpdate);
        },
        _clampZoom: function (a) {
          var n = this.options;
          return n.minNativeZoom !== void 0 && a < n.minNativeZoom
            ? n.minNativeZoom
            : n.maxNativeZoom !== void 0 && n.maxNativeZoom < a
              ? n.maxNativeZoom
              : a;
        },
        _setView: function (a, n, u, r) {
          var d = Math.round(n);
          (this.options.maxZoom !== void 0 && d > this.options.maxZoom) ||
          (this.options.minZoom !== void 0 && d < this.options.minZoom)
            ? (d = void 0)
            : (d = this._clampZoom(d));
          var h = this.options.updateWhenZooming && d !== this._tileZoom;
          ((!r || h) &&
            ((this._tileZoom = d),
            this._abortLoading && this._abortLoading(),
            this._updateLevels(),
            this._resetGrid(),
            d !== void 0 && this._update(a),
            u || this._pruneTiles(),
            (this._noPrune = !!u)),
            this._setZoomTransforms(a, n));
        },
        _setZoomTransforms: function (a, n) {
          for (var u in this._levels)
            this._setZoomTransform(this._levels[u], a, n);
        },
        _setZoomTransform: function (a, n, u) {
          var r = this._map.getZoomScale(u, a.zoom),
            d = a.origin
              .multiplyBy(r)
              .subtract(this._map._getNewPixelOrigin(n, u))
              .round();
          X.any3d ? pa(a.el, d, r) : qe(a.el, d);
        },
        _resetGrid: function () {
          var a = this._map,
            n = a.options.crs,
            u = (this._tileSize = this.getTileSize()),
            r = this._tileZoom,
            d = this._map.getPixelWorldBounds(this._tileZoom);
          (d && (this._globalTileRange = this._pxBoundsToTileRange(d)),
            (this._wrapX = n.wrapLng &&
              !this.options.noWrap && [
                Math.floor(a.project([0, n.wrapLng[0]], r).x / u.x),
                Math.ceil(a.project([0, n.wrapLng[1]], r).x / u.y),
              ]),
            (this._wrapY = n.wrapLat &&
              !this.options.noWrap && [
                Math.floor(a.project([n.wrapLat[0], 0], r).y / u.x),
                Math.ceil(a.project([n.wrapLat[1], 0], r).y / u.y),
              ]));
        },
        _onMoveEnd: function () {
          !this._map || this._map._animatingZoom || this._update();
        },
        _getTiledPixelBounds: function (a) {
          var n = this._map,
            u = n._animatingZoom
              ? Math.max(n._animateToZoom, n.getZoom())
              : n.getZoom(),
            r = n.getZoomScale(u, this._tileZoom),
            d = n.project(a, this._tileZoom).floor(),
            h = n.getSize().divideBy(r * 2);
          return new De(d.subtract(h), d.add(h));
        },
        _update: function (a) {
          var n = this._map;
          if (n) {
            var u = this._clampZoom(n.getZoom());
            if (
              (a === void 0 && (a = n.getCenter()), this._tileZoom !== void 0)
            ) {
              var r = this._getTiledPixelBounds(a),
                d = this._pxBoundsToTileRange(r),
                h = d.getCenter(),
                I = [],
                M = this.options.keepBuffer,
                D = new De(
                  d.getBottomLeft().subtract([M, -M]),
                  d.getTopRight().add([M, -M]),
                );
              if (!(
                isFinite(d.min.x) &&
                isFinite(d.min.y) &&
                isFinite(d.max.x) &&
                isFinite(d.max.y)
              ))
                throw new Error(
                  "Attempted to load an infinite number of tiles",
                );
              for (var U in this._tiles) {
                var N = this._tiles[U].coords;
                (N.z !== this._tileZoom || !D.contains(new $(N.x, N.y))) &&
                  (this._tiles[U].current = !1);
              }
              if (Math.abs(u - this._tileZoom) > 1) {
                this._setView(a, u);
                return;
              }
              for (var Q = d.min.y; Q <= d.max.y; Q++)
                for (var re = d.min.x; re <= d.max.x; re++) {
                  var _t = new $(re, Q);
                  if (((_t.z = this._tileZoom), !!this._isValidTile(_t))) {
                    var it = this._tiles[this._tileCoordsToKey(_t)];
                    it ? (it.current = !0) : I.push(_t);
                  }
                }
              if (
                (I.sort(function (wt, dn) {
                  return wt.distanceTo(h) - dn.distanceTo(h);
                }),
                I.length !== 0)
              ) {
                this._loading || ((this._loading = !0), this.fire("loading"));
                var $t = document.createDocumentFragment();
                for (re = 0; re < I.length; re++) this._addTile(I[re], $t);
                this._level.el.appendChild($t);
              }
            }
          }
        },
        _isValidTile: function (a) {
          var n = this._map.options.crs;
          if (!n.infinite) {
            var u = this._globalTileRange;
            if (
              (!n.wrapLng && (a.x < u.min.x || a.x > u.max.x)) ||
              (!n.wrapLat && (a.y < u.min.y || a.y > u.max.y))
            )
              return !1;
          }
          if (!this.options.bounds) return !0;
          var r = this._tileCoordsToBounds(a);
          return He(this.options.bounds).overlaps(r);
        },
        _keyToBounds: function (a) {
          return this._tileCoordsToBounds(this._keyToTileCoords(a));
        },
        _tileCoordsToNwSe: function (a) {
          var n = this._map,
            u = this.getTileSize(),
            r = a.scaleBy(u),
            d = r.add(u),
            h = n.unproject(r, a.z),
            I = n.unproject(d, a.z);
          return [h, I];
        },
        _tileCoordsToBounds: function (a) {
          var n = this._tileCoordsToNwSe(a),
            u = new je(n[0], n[1]);
          return (
            this.options.noWrap || (u = this._map.wrapLatLngBounds(u)),
            u
          );
        },
        _tileCoordsToKey: function (a) {
          return a.x + ":" + a.y + ":" + a.z;
        },
        _keyToTileCoords: function (a) {
          var n = a.split(":"),
            u = new $(+n[0], +n[1]);
          return ((u.z = +n[2]), u);
        },
        _removeTile: function (a) {
          var n = this._tiles[a];
          n &&
            (Me(n.el),
            delete this._tiles[a],
            this.fire("tileunload", {
              tile: n.el,
              coords: this._keyToTileCoords(a),
            }));
        },
        _initTile: function (a) {
          oe(a, "leaflet-tile");
          var n = this.getTileSize();
          ((a.style.width = n.x + "px"),
            (a.style.height = n.y + "px"),
            (a.onselectstart = y),
            (a.onmousemove = y),
            X.ielt9 && this.options.opacity < 1 && It(a, this.options.opacity));
        },
        _addTile: function (a, n) {
          var u = this._getTilePos(a),
            r = this._tileCoordsToKey(a),
            d = this.createTile(
              this._wrapCoords(a),
              l(this._tileReady, this, a),
            );
          (this._initTile(d),
            this.createTile.length < 2 &&
              V(l(this._tileReady, this, a, null, d)),
            qe(d, u),
            (this._tiles[r] = { el: d, coords: a, current: !0 }),
            n.appendChild(d),
            this.fire("tileloadstart", { tile: d, coords: a }));
        },
        _tileReady: function (a, n, u) {
          n && this.fire("tileerror", { error: n, tile: u, coords: a });
          var r = this._tileCoordsToKey(a);
          ((u = this._tiles[r]),
            u &&
              ((u.loaded = +new Date()),
              this._map._fadeAnimated
                ? (It(u.el, 0),
                  W(this._fadeFrame),
                  (this._fadeFrame = V(this._updateOpacity, this)))
                : ((u.active = !0), this._pruneTiles()),
              n ||
                (oe(u.el, "leaflet-tile-loaded"),
                this.fire("tileload", { tile: u.el, coords: a })),
              this._noTilesToLoad() &&
                ((this._loading = !1),
                this.fire("load"),
                X.ielt9 || !this._map._fadeAnimated
                  ? V(this._pruneTiles, this)
                  : setTimeout(l(this._pruneTiles, this), 250))));
        },
        _getTilePos: function (a) {
          return a.scaleBy(this.getTileSize()).subtract(this._level.origin);
        },
        _wrapCoords: function (a) {
          var n = new $(
            this._wrapX ? g(a.x, this._wrapX) : a.x,
            this._wrapY ? g(a.y, this._wrapY) : a.y,
          );
          return ((n.z = a.z), n);
        },
        _pxBoundsToTileRange: function (a) {
          var n = this.getTileSize();
          return new De(
            a.min.unscaleBy(n).floor(),
            a.max.unscaleBy(n).ceil().subtract([1, 1]),
          );
        },
        _noTilesToLoad: function () {
          for (var a in this._tiles) if (!this._tiles[a].loaded) return !1;
          return !0;
        },
      });
      function ZL(a) {
        return new wl(a);
      }
      var fn = wl.extend({
        options: {
          minZoom: 0,
          maxZoom: 18,
          subdomains: "abc",
          errorTileUrl: "",
          zoomOffset: 0,
          tms: !1,
          zoomReverse: !1,
          detectRetina: !1,
          crossOrigin: !1,
          referrerPolicy: !1,
        },
        initialize: function (a, n) {
          ((this._url = a),
            (n = x(this, n)),
            n.detectRetina && X.retina && n.maxZoom > 0
              ? ((n.tileSize = Math.floor(n.tileSize / 2)),
                n.zoomReverse
                  ? (n.zoomOffset--,
                    (n.minZoom = Math.min(n.maxZoom, n.minZoom + 1)))
                  : (n.zoomOffset++,
                    (n.maxZoom = Math.max(n.minZoom, n.maxZoom - 1))),
                (n.minZoom = Math.max(0, n.minZoom)))
              : n.zoomReverse
                ? (n.minZoom = Math.min(n.maxZoom, n.minZoom))
                : (n.maxZoom = Math.max(n.minZoom, n.maxZoom)),
            typeof n.subdomains == "string" &&
              (n.subdomains = n.subdomains.split("")),
            this.on("tileunload", this._onTileRemove));
        },
        setUrl: function (a, n) {
          return (
            this._url === a && n === void 0 && (n = !0),
            (this._url = a),
            n || this.redraw(),
            this
          );
        },
        createTile: function (a, n) {
          var u = document.createElement("img");
          return (
            ae(u, "load", l(this._tileOnLoad, this, n, u)),
            ae(u, "error", l(this._tileOnError, this, n, u)),
            (this.options.crossOrigin || this.options.crossOrigin === "") &&
              (u.crossOrigin =
                this.options.crossOrigin === !0
                  ? ""
                  : this.options.crossOrigin),
            typeof this.options.referrerPolicy == "string" &&
              (u.referrerPolicy = this.options.referrerPolicy),
            (u.alt = ""),
            (u.src = this.getTileUrl(a)),
            u
          );
        },
        getTileUrl: function (a) {
          var n = {
            r: X.retina ? "@2x" : "",
            s: this._getSubdomain(a),
            x: a.x,
            y: a.y,
            z: this._getZoomForUrl(),
          };
          if (this._map && !this._map.options.crs.infinite) {
            var u = this._globalTileRange.max.y - a.y;
            (this.options.tms && (n.y = u), (n["-y"] = u));
          }
          return Z(this._url, i(n, this.options));
        },
        _tileOnLoad: function (a, n) {
          X.ielt9 ? setTimeout(l(a, this, null, n), 0) : a(null, n);
        },
        _tileOnError: function (a, n, u) {
          var r = this.options.errorTileUrl;
          (r && n.getAttribute("src") !== r && (n.src = r), a(u, n));
        },
        _onTileRemove: function (a) {
          a.tile.onload = null;
        },
        _getZoomForUrl: function () {
          var a = this._tileZoom,
            n = this.options.maxZoom,
            u = this.options.zoomReverse,
            r = this.options.zoomOffset;
          return (u && (a = n - a), a + r);
        },
        _getSubdomain: function (a) {
          var n = Math.abs(a.x + a.y) % this.options.subdomains.length;
          return this.options.subdomains[n];
        },
        _abortLoading: function () {
          var a, n;
          for (a in this._tiles)
            if (
              this._tiles[a].coords.z !== this._tileZoom &&
              ((n = this._tiles[a].el),
              (n.onload = y),
              (n.onerror = y),
              !n.complete)
            ) {
              n.src = w;
              var u = this._tiles[a].coords;
              (Me(n),
                delete this._tiles[a],
                this.fire("tileabort", { tile: n, coords: u }));
            }
        },
        _removeTile: function (a) {
          var n = this._tiles[a];
          if (n)
            return (
              n.el.setAttribute("src", w),
              wl.prototype._removeTile.call(this, a)
            );
        },
        _tileReady: function (a, n, u) {
          if (!(!this._map || (u && u.getAttribute("src") === w)))
            return wl.prototype._tileReady.call(this, a, n, u);
        },
      });
      function Bh(a, n) {
        return new fn(a, n);
      }
      var Ph = fn.extend({
        defaultWmsParams: {
          service: "WMS",
          request: "GetMap",
          layers: "",
          styles: "",
          format: "image/jpeg",
          transparent: !1,
          version: "1.1.1",
        },
        options: { crs: null, uppercase: !1 },
        initialize: function (a, n) {
          this._url = a;
          var u = i({}, this.defaultWmsParams);
          for (var r in n) r in this.options || (u[r] = n[r]);
          n = x(this, n);
          var d = n.detectRetina && X.retina ? 2 : 1,
            h = this.getTileSize();
          ((u.width = h.x * d), (u.height = h.y * d), (this.wmsParams = u));
        },
        onAdd: function (a) {
          ((this._crs = this.options.crs || a.options.crs),
            (this._wmsVersion = parseFloat(this.wmsParams.version)));
          var n = this._wmsVersion >= 1.3 ? "crs" : "srs";
          ((this.wmsParams[n] = this._crs.code),
            fn.prototype.onAdd.call(this, a));
        },
        getTileUrl: function (a) {
          var n = this._tileCoordsToNwSe(a),
            u = this._crs,
            r = Xe(u.project(n[0]), u.project(n[1])),
            d = r.min,
            h = r.max,
            I = (
              this._wmsVersion >= 1.3 && this._crs === Ih
                ? [d.y, d.x, h.y, h.x]
                : [d.x, d.y, h.x, h.y]
            ).join(","),
            M = fn.prototype.getTileUrl.call(this, a);
          return (
            M +
            B(this.wmsParams, M, this.options.uppercase) +
            (this.options.uppercase ? "&BBOX=" : "&bbox=") +
            I
          );
        },
        setParams: function (a, n) {
          return (i(this.wmsParams, a), n || this.redraw(), this);
        },
      });
      function GL(a, n) {
        return new Ph(a, n);
      }
      ((fn.WMS = Ph), (Bh.wms = GL));
      var ai = _a.extend({
          options: { padding: 0.1 },
          initialize: function (a) {
            (x(this, a), f(this), (this._layers = this._layers || {}));
          },
          onAdd: function () {
            (this._container ||
              (this._initContainer(),
              oe(this._container, "leaflet-zoom-animated")),
              this.getPane().appendChild(this._container),
              this._update(),
              this.on("update", this._updatePaths, this));
          },
          onRemove: function () {
            (this.off("update", this._updatePaths, this),
              this._destroyContainer());
          },
          getEvents: function () {
            var a = {
              viewreset: this._reset,
              zoom: this._onZoom,
              moveend: this._update,
              zoomend: this._onZoomEnd,
            };
            return (this._zoomAnimated && (a.zoomanim = this._onAnimZoom), a);
          },
          _onAnimZoom: function (a) {
            this._updateTransform(a.center, a.zoom);
          },
          _onZoom: function () {
            this._updateTransform(this._map.getCenter(), this._map.getZoom());
          },
          _updateTransform: function (a, n) {
            var u = this._map.getZoomScale(n, this._zoom),
              r = this._map.getSize().multiplyBy(0.5 + this.options.padding),
              d = this._map.project(this._center, n),
              h = r
                .multiplyBy(-u)
                .add(d)
                .subtract(this._map._getNewPixelOrigin(a, n));
            X.any3d ? pa(this._container, h, u) : qe(this._container, h);
          },
          _reset: function () {
            (this._update(), this._updateTransform(this._center, this._zoom));
            for (var a in this._layers) this._layers[a]._reset();
          },
          _onZoomEnd: function () {
            for (var a in this._layers) this._layers[a]._project();
          },
          _updatePaths: function () {
            for (var a in this._layers) this._layers[a]._update();
          },
          _update: function () {
            var a = this.options.padding,
              n = this._map.getSize(),
              u = this._map
                .containerPointToLayerPoint(n.multiplyBy(-a))
                .round();
            ((this._bounds = new De(u, u.add(n.multiplyBy(1 + a * 2)).round())),
              (this._center = this._map.getCenter()),
              (this._zoom = this._map.getZoom()));
          },
        }),
        kh = ai.extend({
          options: { tolerance: 0 },
          getEvents: function () {
            var a = ai.prototype.getEvents.call(this);
            return ((a.viewprereset = this._onViewPreReset), a);
          },
          _onViewPreReset: function () {
            this._postponeUpdatePaths = !0;
          },
          onAdd: function () {
            (ai.prototype.onAdd.call(this), this._draw());
          },
          _initContainer: function () {
            var a = (this._container = document.createElement("canvas"));
            (ae(a, "mousemove", this._onMouseMove, this),
              ae(
                a,
                "click dblclick mousedown mouseup contextmenu",
                this._onClick,
                this,
              ),
              ae(a, "mouseout", this._handleMouseOut, this),
              (a._leaflet_disable_events = !0),
              (this._ctx = a.getContext("2d")));
          },
          _destroyContainer: function () {
            (W(this._redrawRequest),
              delete this._ctx,
              Me(this._container),
              A(this._container),
              delete this._container);
          },
          _updatePaths: function () {
            if (!this._postponeUpdatePaths) {
              var a;
              this._redrawBounds = null;
              for (var n in this._layers) ((a = this._layers[n]), a._update());
              this._redraw();
            }
          },
          _update: function () {
            if (!(this._map._animatingZoom && this._bounds)) {
              ai.prototype._update.call(this);
              var a = this._bounds,
                n = this._container,
                u = a.getSize(),
                r = X.retina ? 2 : 1;
              (qe(n, a.min),
                (n.width = r * u.x),
                (n.height = r * u.y),
                (n.style.width = u.x + "px"),
                (n.style.height = u.y + "px"),
                X.retina && this._ctx.scale(2, 2),
                this._ctx.translate(-a.min.x, -a.min.y),
                this.fire("update"));
            }
          },
          _reset: function () {
            (ai.prototype._reset.call(this),
              this._postponeUpdatePaths &&
                ((this._postponeUpdatePaths = !1), this._updatePaths()));
          },
          _initPath: function (a) {
            (this._updateDashArray(a), (this._layers[f(a)] = a));
            var n = (a._order = { layer: a, prev: this._drawLast, next: null });
            (this._drawLast && (this._drawLast.next = n),
              (this._drawLast = n),
              (this._drawFirst = this._drawFirst || this._drawLast));
          },
          _addPath: function (a) {
            this._requestRedraw(a);
          },
          _removePath: function (a) {
            var n = a._order,
              u = n.next,
              r = n.prev;
            (u ? (u.prev = r) : (this._drawLast = r),
              r ? (r.next = u) : (this._drawFirst = u),
              delete a._order,
              delete this._layers[f(a)],
              this._requestRedraw(a));
          },
          _updatePath: function (a) {
            (this._extendRedrawBounds(a),
              a._project(),
              a._update(),
              this._requestRedraw(a));
          },
          _updateStyle: function (a) {
            (this._updateDashArray(a), this._requestRedraw(a));
          },
          _updateDashArray: function (a) {
            if (typeof a.options.dashArray == "string") {
              var n = a.options.dashArray.split(/[, ]+/),
                u = [],
                r,
                d;
              for (d = 0; d < n.length; d++) {
                if (((r = Number(n[d])), isNaN(r))) return;
                u.push(r);
              }
              a.options._dashArray = u;
            } else a.options._dashArray = a.options.dashArray;
          },
          _requestRedraw: function (a) {
            this._map &&
              (this._extendRedrawBounds(a),
              (this._redrawRequest =
                this._redrawRequest || V(this._redraw, this)));
          },
          _extendRedrawBounds: function (a) {
            if (a._pxBounds) {
              var n = (a.options.weight || 0) + 1;
              ((this._redrawBounds = this._redrawBounds || new De()),
                this._redrawBounds.extend(a._pxBounds.min.subtract([n, n])),
                this._redrawBounds.extend(a._pxBounds.max.add([n, n])));
            }
          },
          _redraw: function () {
            ((this._redrawRequest = null),
              this._redrawBounds &&
                (this._redrawBounds.min._floor(),
                this._redrawBounds.max._ceil()),
              this._clear(),
              this._draw(),
              (this._redrawBounds = null));
          },
          _clear: function () {
            var a = this._redrawBounds;
            if (a) {
              var n = a.getSize();
              this._ctx.clearRect(a.min.x, a.min.y, n.x, n.y);
            } else
              (this._ctx.save(),
                this._ctx.setTransform(1, 0, 0, 1, 0, 0),
                this._ctx.clearRect(
                  0,
                  0,
                  this._container.width,
                  this._container.height,
                ),
                this._ctx.restore());
          },
          _draw: function () {
            var a,
              n = this._redrawBounds;
            if ((this._ctx.save(), n)) {
              var u = n.getSize();
              (this._ctx.beginPath(),
                this._ctx.rect(n.min.x, n.min.y, u.x, u.y),
                this._ctx.clip());
            }
            this._drawing = !0;
            for (var r = this._drawFirst; r; r = r.next)
              ((a = r.layer),
                (!n || (a._pxBounds && a._pxBounds.intersects(n))) &&
                  a._updatePath());
            ((this._drawing = !1), this._ctx.restore());
          },
          _updatePoly: function (a, n) {
            if (this._drawing) {
              var u,
                r,
                d,
                h,
                I = a._parts,
                M = I.length,
                D = this._ctx;
              if (M) {
                for (D.beginPath(), u = 0; u < M; u++) {
                  for (r = 0, d = I[u].length; r < d; r++)
                    ((h = I[u][r]), D[r ? "lineTo" : "moveTo"](h.x, h.y));
                  n && D.closePath();
                }
                this._fillStroke(D, a);
              }
            }
          },
          _updateCircle: function (a) {
            if (!(!this._drawing || a._empty())) {
              var n = a._point,
                u = this._ctx,
                r = Math.max(Math.round(a._radius), 1),
                d = (Math.max(Math.round(a._radiusY), 1) || r) / r;
              (d !== 1 && (u.save(), u.scale(1, d)),
                u.beginPath(),
                u.arc(n.x, n.y / d, r, 0, Math.PI * 2, !1),
                d !== 1 && u.restore(),
                this._fillStroke(u, a));
            }
          },
          _fillStroke: function (a, n) {
            var u = n.options;
            (u.fill &&
              ((a.globalAlpha = u.fillOpacity),
              (a.fillStyle = u.fillColor || u.color),
              a.fill(u.fillRule || "evenodd")),
              u.stroke &&
                u.weight !== 0 &&
                (a.setLineDash &&
                  a.setLineDash((n.options && n.options._dashArray) || []),
                (a.globalAlpha = u.opacity),
                (a.lineWidth = u.weight),
                (a.strokeStyle = u.color),
                (a.lineCap = u.lineCap),
                (a.lineJoin = u.lineJoin),
                a.stroke()));
          },
          _onClick: function (a) {
            for (
              var n = this._map.mouseEventToLayerPoint(a),
                u,
                r,
                d = this._drawFirst;
              d;
              d = d.next
            )
              ((u = d.layer),
                u.options.interactive &&
                  u._containsPoint(n) &&
                  (!(a.type === "click" || a.type === "preclick") ||
                    !this._map._draggableMoved(u)) &&
                  (r = u));
            this._fireEvent(r ? [r] : !1, a);
          },
          _onMouseMove: function (a) {
            if (!(
              !this._map ||
              this._map.dragging.moving() ||
              this._map._animatingZoom
            )) {
              var n = this._map.mouseEventToLayerPoint(a);
              this._handleMouseHover(a, n);
            }
          },
          _handleMouseOut: function (a) {
            var n = this._hoveredLayer;
            n &&
              (Re(this._container, "leaflet-interactive"),
              this._fireEvent([n], a, "mouseout"),
              (this._hoveredLayer = null),
              (this._mouseHoverThrottled = !1));
          },
          _handleMouseHover: function (a, n) {
            if (!this._mouseHoverThrottled) {
              for (var u, r, d = this._drawFirst; d; d = d.next)
                ((u = d.layer),
                  u.options.interactive && u._containsPoint(n) && (r = u));
              (r !== this._hoveredLayer &&
                (this._handleMouseOut(a),
                r &&
                  (oe(this._container, "leaflet-interactive"),
                  this._fireEvent([r], a, "mouseover"),
                  (this._hoveredLayer = r))),
                this._fireEvent(
                  this._hoveredLayer ? [this._hoveredLayer] : !1,
                  a,
                ),
                (this._mouseHoverThrottled = !0),
                setTimeout(
                  l(function () {
                    this._mouseHoverThrottled = !1;
                  }, this),
                  32,
                ));
            }
          },
          _fireEvent: function (a, n, u) {
            this._map._fireDOMEvent(n, u || n.type, a);
          },
          _bringToFront: function (a) {
            var n = a._order;
            if (n) {
              var u = n.next,
                r = n.prev;
              if (u) u.prev = r;
              else return;
              (r ? (r.next = u) : u && (this._drawFirst = u),
                (n.prev = this._drawLast),
                (this._drawLast.next = n),
                (n.next = null),
                (this._drawLast = n),
                this._requestRedraw(a));
            }
          },
          _bringToBack: function (a) {
            var n = a._order;
            if (n) {
              var u = n.next,
                r = n.prev;
              if (r) r.next = u;
              else return;
              (u ? (u.prev = r) : r && (this._drawLast = r),
                (n.prev = null),
                (n.next = this._drawFirst),
                (this._drawFirst.prev = n),
                (this._drawFirst = n),
                this._requestRedraw(a));
            }
          },
        });
      function zh(a) {
        return X.canvas ? new kh(a) : null;
      }
      var Ml = (function () {
          try {
            return (
              document.namespaces.add("lvml", "urn:schemas-microsoft-com:vml"),
              function (a) {
                return document.createElement("<lvml:" + a + ' class="lvml">');
              }
            );
          } catch {}
          return function (a) {
            return document.createElement(
              "<" + a + ' xmlns="urn:schemas-microsoft.com:vml" class="lvml">',
            );
          };
        })(),
        VL = {
          _initContainer: function () {
            this._container = he("div", "leaflet-vml-container");
          },
          _update: function () {
            this._map._animatingZoom ||
              (ai.prototype._update.call(this), this.fire("update"));
          },
          _initPath: function (a) {
            var n = (a._container = Ml("shape"));
            (oe(n, "leaflet-vml-shape " + (this.options.className || "")),
              (n.coordsize = "1 1"),
              (a._path = Ml("path")),
              n.appendChild(a._path),
              this._updateStyle(a),
              (this._layers[f(a)] = a));
          },
          _addPath: function (a) {
            var n = a._container;
            (this._container.appendChild(n),
              a.options.interactive && a.addInteractiveTarget(n));
          },
          _removePath: function (a) {
            var n = a._container;
            (Me(n), a.removeInteractiveTarget(n), delete this._layers[f(a)]);
          },
          _updateStyle: function (a) {
            var n = a._stroke,
              u = a._fill,
              r = a.options,
              d = a._container;
            ((d.stroked = !!r.stroke),
              (d.filled = !!r.fill),
              r.stroke
                ? (n || (n = a._stroke = Ml("stroke")),
                  d.appendChild(n),
                  (n.weight = r.weight + "px"),
                  (n.color = r.color),
                  (n.opacity = r.opacity),
                  r.dashArray
                    ? (n.dashStyle = b(r.dashArray)
                        ? r.dashArray.join(" ")
                        : r.dashArray.replace(/( *, *)/g, " "))
                    : (n.dashStyle = ""),
                  (n.endcap = r.lineCap.replace("butt", "flat")),
                  (n.joinstyle = r.lineJoin))
                : n && (d.removeChild(n), (a._stroke = null)),
              r.fill
                ? (u || (u = a._fill = Ml("fill")),
                  d.appendChild(u),
                  (u.color = r.fillColor || r.color),
                  (u.opacity = r.fillOpacity))
                : u && (d.removeChild(u), (a._fill = null)));
          },
          _updateCircle: function (a) {
            var n = a._point.round(),
              u = Math.round(a._radius),
              r = Math.round(a._radiusY || u);
            this._setPath(
              a,
              a._empty()
                ? "M0 0"
                : "AL " +
                    n.x +
                    "," +
                    n.y +
                    " " +
                    u +
                    "," +
                    r +
                    " 0," +
                    65535 * 360,
            );
          },
          _setPath: function (a, n) {
            a._path.v = n;
          },
          _bringToFront: function (a) {
            st(a._container);
          },
          _bringToBack: function (a) {
            Di(a._container);
          },
        },
        Ls = X.vml ? Ml : K,
        Tl = ai.extend({
          _initContainer: function () {
            ((this._container = Ls("svg")),
              this._container.setAttribute("pointer-events", "none"),
              (this._rootGroup = Ls("g")),
              this._container.appendChild(this._rootGroup));
          },
          _destroyContainer: function () {
            (Me(this._container),
              A(this._container),
              delete this._container,
              delete this._rootGroup,
              delete this._svgSize);
          },
          _update: function () {
            if (!(this._map._animatingZoom && this._bounds)) {
              ai.prototype._update.call(this);
              var a = this._bounds,
                n = a.getSize(),
                u = this._container;
              ((!this._svgSize || !this._svgSize.equals(n)) &&
                ((this._svgSize = n),
                u.setAttribute("width", n.x),
                u.setAttribute("height", n.y)),
                qe(u, a.min),
                u.setAttribute(
                  "viewBox",
                  [a.min.x, a.min.y, n.x, n.y].join(" "),
                ),
                this.fire("update"));
            }
          },
          _initPath: function (a) {
            var n = (a._path = Ls("path"));
            (a.options.className && oe(n, a.options.className),
              a.options.interactive && oe(n, "leaflet-interactive"),
              this._updateStyle(a),
              (this._layers[f(a)] = a));
          },
          _addPath: function (a) {
            (this._rootGroup || this._initContainer(),
              this._rootGroup.appendChild(a._path),
              a.addInteractiveTarget(a._path));
          },
          _removePath: function (a) {
            (Me(a._path),
              a.removeInteractiveTarget(a._path),
              delete this._layers[f(a)]);
          },
          _updatePath: function (a) {
            (a._project(), a._update());
          },
          _updateStyle: function (a) {
            var n = a._path,
              u = a.options;
            n &&
              (u.stroke
                ? (n.setAttribute("stroke", u.color),
                  n.setAttribute("stroke-opacity", u.opacity),
                  n.setAttribute("stroke-width", u.weight),
                  n.setAttribute("stroke-linecap", u.lineCap),
                  n.setAttribute("stroke-linejoin", u.lineJoin),
                  u.dashArray
                    ? n.setAttribute("stroke-dasharray", u.dashArray)
                    : n.removeAttribute("stroke-dasharray"),
                  u.dashOffset
                    ? n.setAttribute("stroke-dashoffset", u.dashOffset)
                    : n.removeAttribute("stroke-dashoffset"))
                : n.setAttribute("stroke", "none"),
              u.fill
                ? (n.setAttribute("fill", u.fillColor || u.color),
                  n.setAttribute("fill-opacity", u.fillOpacity),
                  n.setAttribute("fill-rule", u.fillRule || "evenodd"))
                : n.setAttribute("fill", "none"));
          },
          _updatePoly: function (a, n) {
            this._setPath(a, zt(a._parts, n));
          },
          _updateCircle: function (a) {
            var n = a._point,
              u = Math.max(Math.round(a._radius), 1),
              r = Math.max(Math.round(a._radiusY), 1) || u,
              d = "a" + u + "," + r + " 0 1,0 ",
              h = a._empty()
                ? "M0 0"
                : "M" +
                  (n.x - u) +
                  "," +
                  n.y +
                  d +
                  u * 2 +
                  ",0 " +
                  d +
                  -u * 2 +
                  ",0 ";
            this._setPath(a, h);
          },
          _setPath: function (a, n) {
            a._path.setAttribute("d", n);
          },
          _bringToFront: function (a) {
            st(a._path);
          },
          _bringToBack: function (a) {
            Di(a._path);
          },
        });
      X.vml && Tl.include(VL);
      function Oh(a) {
        return X.svg || X.vml ? new Tl(a) : null;
      }
      me.include({
        getRenderer: function (a) {
          var n =
            a.options.renderer ||
            this._getPaneRenderer(a.options.pane) ||
            this.options.renderer ||
            this._renderer;
          return (
            n || (n = this._renderer = this._createRenderer()),
            this.hasLayer(n) || this.addLayer(n),
            n
          );
        },
        _getPaneRenderer: function (a) {
          if (a === "overlayPane" || a === void 0) return !1;
          var n = this._paneRenderers[a];
          return (
            n === void 0 &&
              ((n = this._createRenderer({ pane: a })),
              (this._paneRenderers[a] = n)),
            n
          );
        },
        _createRenderer: function (a) {
          return (this.options.preferCanvas && zh(a)) || Oh(a);
        },
      });
      var Rh = sn.extend({
        initialize: function (a, n) {
          sn.prototype.initialize.call(this, this._boundsToLatLngs(a), n);
        },
        setBounds: function (a) {
          return this.setLatLngs(this._boundsToLatLngs(a));
        },
        _boundsToLatLngs: function (a) {
          return (
            (a = He(a)),
            [
              a.getSouthWest(),
              a.getNorthWest(),
              a.getNorthEast(),
              a.getSouthEast(),
            ]
          );
        },
      });
      function XL(a, n) {
        return new Rh(a, n);
      }
      ((Tl.create = Ls),
        (Tl.pointsToPath = zt),
        (ti.geometryToLayer = fs),
        (ti.coordsToLatLng = Lf),
        (ti.coordsToLatLngs = ds),
        (ti.latLngToCoords = _f),
        (ti.latLngsToCoords = cs),
        (ti.getFeature = rn),
        (ti.asFeature = hs),
        me.mergeOptions({ boxZoom: !0 }));
      var Eh = Ba.extend({
        initialize: function (a) {
          ((this._map = a),
            (this._container = a._container),
            (this._pane = a._panes.overlayPane),
            (this._resetStateTimeout = 0),
            a.on("unload", this._destroy, this));
        },
        addHooks: function () {
          ae(this._container, "mousedown", this._onMouseDown, this);
        },
        removeHooks: function () {
          A(this._container, "mousedown", this._onMouseDown, this);
        },
        moved: function () {
          return this._moved;
        },
        _destroy: function () {
          (Me(this._pane), delete this._pane);
        },
        _resetState: function () {
          ((this._resetStateTimeout = 0), (this._moved = !1));
        },
        _clearDeferredResetState: function () {
          this._resetStateTimeout !== 0 &&
            (clearTimeout(this._resetStateTimeout),
            (this._resetStateTimeout = 0));
        },
        _onMouseDown: function (a) {
          if (!a.shiftKey || (a.which !== 1 && a.button !== 1)) return !1;
          (this._clearDeferredResetState(),
            this._resetState(),
            Ka(),
            Da(),
            (this._startPoint = this._map.mouseEventToContainerPoint(a)),
            ae(
              document,
              {
                contextmenu: Be,
                mousemove: this._onMouseMove,
                mouseup: this._onMouseUp,
                keydown: this._onKeyDown,
              },
              this,
            ));
        },
        _onMouseMove: function (a) {
          (this._moved ||
            ((this._moved = !0),
            (this._box = he("div", "leaflet-zoom-box", this._container)),
            oe(this._container, "leaflet-crosshair"),
            this._map.fire("boxzoomstart")),
            (this._point = this._map.mouseEventToContainerPoint(a)));
          var n = new De(this._point, this._startPoint),
            u = n.getSize();
          (qe(this._box, n.min),
            (this._box.style.width = u.x + "px"),
            (this._box.style.height = u.y + "px"));
        },
        _finish: function () {
          (this._moved &&
            (Me(this._box), Re(this._container, "leaflet-crosshair")),
            Bi(),
            xl(),
            A(
              document,
              {
                contextmenu: Be,
                mousemove: this._onMouseMove,
                mouseup: this._onMouseUp,
                keydown: this._onKeyDown,
              },
              this,
            ));
        },
        _onMouseUp: function (a) {
          if (
            !(a.which !== 1 && a.button !== 1) &&
            (this._finish(), !!this._moved)
          ) {
            (this._clearDeferredResetState(),
              (this._resetStateTimeout = setTimeout(
                l(this._resetState, this),
                0,
              )));
            var n = new je(
              this._map.containerPointToLatLng(this._startPoint),
              this._map.containerPointToLatLng(this._point),
            );
            this._map.fitBounds(n).fire("boxzoomend", { boxZoomBounds: n });
          }
        },
        _onKeyDown: function (a) {
          a.keyCode === 27 &&
            (this._finish(),
            this._clearDeferredResetState(),
            this._resetState());
        },
      });
      (me.addInitHook("addHandler", "boxZoom", Eh),
        me.mergeOptions({ doubleClickZoom: !0 }));
      var Uh = Ba.extend({
        addHooks: function () {
          this._map.on("dblclick", this._onDoubleClick, this);
        },
        removeHooks: function () {
          this._map.off("dblclick", this._onDoubleClick, this);
        },
        _onDoubleClick: function (a) {
          var n = this._map,
            u = n.getZoom(),
            r = n.options.zoomDelta,
            d = a.originalEvent.shiftKey ? u - r : u + r;
          n.options.doubleClickZoom === "center"
            ? n.setZoom(d)
            : n.setZoomAround(a.containerPoint, d);
        },
      });
      (me.addInitHook("addHandler", "doubleClickZoom", Uh),
        me.mergeOptions({
          dragging: !0,
          inertia: !0,
          inertiaDeceleration: 3400,
          inertiaMaxSpeed: 1 / 0,
          easeLinearity: 0.2,
          worldCopyJump: !1,
          maxBoundsViscosity: 0,
        }));
      var qh = Ba.extend({
        addHooks: function () {
          if (!this._draggable) {
            var a = this._map;
            ((this._draggable = new Pi(a._mapPane, a._container)),
              this._draggable.on(
                {
                  dragstart: this._onDragStart,
                  drag: this._onDrag,
                  dragend: this._onDragEnd,
                },
                this,
              ),
              this._draggable.on("predrag", this._onPreDragLimit, this),
              a.options.worldCopyJump &&
                (this._draggable.on("predrag", this._onPreDragWrap, this),
                a.on("zoomend", this._onZoomEnd, this),
                a.whenReady(this._onZoomEnd, this)));
          }
          (oe(this._map._container, "leaflet-grab leaflet-touch-drag"),
            this._draggable.enable(),
            (this._positions = []),
            (this._times = []));
        },
        removeHooks: function () {
          (Re(this._map._container, "leaflet-grab"),
            Re(this._map._container, "leaflet-touch-drag"),
            this._draggable.disable());
        },
        moved: function () {
          return this._draggable && this._draggable._moved;
        },
        moving: function () {
          return this._draggable && this._draggable._moving;
        },
        _onDragStart: function () {
          var a = this._map;
          if (
            (a._stop(),
            this._map.options.maxBounds && this._map.options.maxBoundsViscosity)
          ) {
            var n = He(this._map.options.maxBounds);
            ((this._offsetLimit = Xe(
              this._map.latLngToContainerPoint(n.getNorthWest()).multiplyBy(-1),
              this._map
                .latLngToContainerPoint(n.getSouthEast())
                .multiplyBy(-1)
                .add(this._map.getSize()),
            )),
              (this._viscosity = Math.min(
                1,
                Math.max(0, this._map.options.maxBoundsViscosity),
              )));
          } else this._offsetLimit = null;
          (a.fire("movestart").fire("dragstart"),
            a.options.inertia && ((this._positions = []), (this._times = [])));
        },
        _onDrag: function (a) {
          if (this._map.options.inertia) {
            var n = (this._lastTime = +new Date()),
              u = (this._lastPos =
                this._draggable._absPos || this._draggable._newPos);
            (this._positions.push(u),
              this._times.push(n),
              this._prunePositions(n));
          }
          this._map.fire("move", a).fire("drag", a);
        },
        _prunePositions: function (a) {
          for (; this._positions.length > 1 && a - this._times[0] > 50;)
            (this._positions.shift(), this._times.shift());
        },
        _onZoomEnd: function () {
          var a = this._map.getSize().divideBy(2),
            n = this._map.latLngToLayerPoint([0, 0]);
          ((this._initialWorldOffset = n.subtract(a).x),
            (this._worldWidth = this._map.getPixelWorldBounds().getSize().x));
        },
        _viscousLimit: function (a, n) {
          return a - (a - n) * this._viscosity;
        },
        _onPreDragLimit: function () {
          if (!(!this._viscosity || !this._offsetLimit)) {
            var a = this._draggable._newPos.subtract(this._draggable._startPos),
              n = this._offsetLimit;
            (a.x < n.min.x && (a.x = this._viscousLimit(a.x, n.min.x)),
              a.y < n.min.y && (a.y = this._viscousLimit(a.y, n.min.y)),
              a.x > n.max.x && (a.x = this._viscousLimit(a.x, n.max.x)),
              a.y > n.max.y && (a.y = this._viscousLimit(a.y, n.max.y)),
              (this._draggable._newPos = this._draggable._startPos.add(a)));
          }
        },
        _onPreDragWrap: function () {
          var a = this._worldWidth,
            n = Math.round(a / 2),
            u = this._initialWorldOffset,
            r = this._draggable._newPos.x,
            d = ((r - n + u) % a) + n - u,
            h = ((r + n + u) % a) - n - u,
            I = Math.abs(d + u) < Math.abs(h + u) ? d : h;
          ((this._draggable._absPos = this._draggable._newPos.clone()),
            (this._draggable._newPos.x = I));
        },
        _onDragEnd: function (a) {
          var n = this._map,
            u = n.options,
            r = !u.inertia || a.noInertia || this._times.length < 2;
          if ((n.fire("dragend", a), r)) n.fire("moveend");
          else {
            this._prunePositions(+new Date());
            var d = this._lastPos.subtract(this._positions[0]),
              h = (this._lastTime - this._times[0]) / 1e3,
              I = u.easeLinearity,
              M = d.multiplyBy(I / h),
              D = M.distanceTo([0, 0]),
              U = Math.min(u.inertiaMaxSpeed, D),
              N = M.multiplyBy(U / D),
              Q = U / (u.inertiaDeceleration * I),
              re = N.multiplyBy(-Q / 2).round();
            !re.x && !re.y
              ? n.fire("moveend")
              : ((re = n._limitOffset(re, n.options.maxBounds)),
                V(function () {
                  n.panBy(re, {
                    duration: Q,
                    easeLinearity: I,
                    noMoveStart: !0,
                    animate: !0,
                  });
                }));
          }
        },
      });
      (me.addInitHook("addHandler", "dragging", qh),
        me.mergeOptions({ keyboard: !0, keyboardPanDelta: 80 }));
      var Hh = Ba.extend({
        keyCodes: {
          left: [37],
          right: [39],
          down: [40],
          up: [38],
          zoomIn: [187, 107, 61, 171],
          zoomOut: [189, 109, 54, 173],
        },
        initialize: function (a) {
          ((this._map = a),
            this._setPanDelta(a.options.keyboardPanDelta),
            this._setZoomDelta(a.options.zoomDelta));
        },
        addHooks: function () {
          var a = this._map._container;
          (a.tabIndex <= 0 && (a.tabIndex = "0"),
            ae(
              a,
              {
                focus: this._onFocus,
                blur: this._onBlur,
                mousedown: this._onMouseDown,
              },
              this,
            ),
            this._map.on(
              { focus: this._addHooks, blur: this._removeHooks },
              this,
            ));
        },
        removeHooks: function () {
          (this._removeHooks(),
            A(
              this._map._container,
              {
                focus: this._onFocus,
                blur: this._onBlur,
                mousedown: this._onMouseDown,
              },
              this,
            ),
            this._map.off(
              { focus: this._addHooks, blur: this._removeHooks },
              this,
            ));
        },
        _onMouseDown: function () {
          if (!this._focused) {
            var a = document.body,
              n = document.documentElement,
              u = a.scrollTop || n.scrollTop,
              r = a.scrollLeft || n.scrollLeft;
            (this._map._container.focus(), window.scrollTo(r, u));
          }
        },
        _onFocus: function () {
          ((this._focused = !0), this._map.fire("focus"));
        },
        _onBlur: function () {
          ((this._focused = !1), this._map.fire("blur"));
        },
        _setPanDelta: function (a) {
          var n = (this._panKeys = {}),
            u = this.keyCodes,
            r,
            d;
          for (r = 0, d = u.left.length; r < d; r++) n[u.left[r]] = [-1 * a, 0];
          for (r = 0, d = u.right.length; r < d; r++) n[u.right[r]] = [a, 0];
          for (r = 0, d = u.down.length; r < d; r++) n[u.down[r]] = [0, a];
          for (r = 0, d = u.up.length; r < d; r++) n[u.up[r]] = [0, -1 * a];
        },
        _setZoomDelta: function (a) {
          var n = (this._zoomKeys = {}),
            u = this.keyCodes,
            r,
            d;
          for (r = 0, d = u.zoomIn.length; r < d; r++) n[u.zoomIn[r]] = a;
          for (r = 0, d = u.zoomOut.length; r < d; r++) n[u.zoomOut[r]] = -a;
        },
        _addHooks: function () {
          ae(document, "keydown", this._onKeyDown, this);
        },
        _removeHooks: function () {
          A(document, "keydown", this._onKeyDown, this);
        },
        _onKeyDown: function (a) {
          if (!(a.altKey || a.ctrlKey || a.metaKey)) {
            var n = a.keyCode,
              u = this._map,
              r;
            if (n in this._panKeys) {
              if (!u._panAnim || !u._panAnim._inProgress)
                if (
                  ((r = this._panKeys[n]),
                  a.shiftKey && (r = ee(r).multiplyBy(3)),
                  u.options.maxBounds &&
                    (r = u._limitOffset(ee(r), u.options.maxBounds)),
                  u.options.worldCopyJump)
                ) {
                  var d = u.wrapLatLng(
                    u.unproject(u.project(u.getCenter()).add(r)),
                  );
                  u.panTo(d);
                } else u.panBy(r);
            } else if (n in this._zoomKeys)
              u.setZoom(u.getZoom() + (a.shiftKey ? 3 : 1) * this._zoomKeys[n]);
            else if (n === 27 && u._popup && u._popup.options.closeOnEscapeKey)
              u.closePopup();
            else return;
            Be(a);
          }
        },
      });
      (me.addInitHook("addHandler", "keyboard", Hh),
        me.mergeOptions({
          scrollWheelZoom: !0,
          wheelDebounceTime: 40,
          wheelPxPerZoomLevel: 60,
        }));
      var Nh = Ba.extend({
        addHooks: function () {
          (ae(this._map._container, "wheel", this._onWheelScroll, this),
            (this._delta = 0));
        },
        removeHooks: function () {
          A(this._map._container, "wheel", this._onWheelScroll, this);
        },
        _onWheelScroll: function (a) {
          var n = Rt(a),
            u = this._map.options.wheelDebounceTime;
          ((this._delta += n),
            (this._lastMousePos = this._map.mouseEventToContainerPoint(a)),
            this._startTime || (this._startTime = +new Date()));
          var r = Math.max(u - (+new Date() - this._startTime), 0);
          (clearTimeout(this._timer),
            (this._timer = setTimeout(l(this._performZoom, this), r)),
            Be(a));
        },
        _performZoom: function () {
          var a = this._map,
            n = a.getZoom(),
            u = this._map.options.zoomSnap || 0;
          a._stop();
          var r = this._delta / (this._map.options.wheelPxPerZoomLevel * 4),
            d = (4 * Math.log(2 / (1 + Math.exp(-Math.abs(r))))) / Math.LN2,
            h = u ? Math.ceil(d / u) * u : d,
            I = a._limitZoom(n + (this._delta > 0 ? h : -h)) - n;
          ((this._delta = 0),
            (this._startTime = null),
            I &&
              (a.options.scrollWheelZoom === "center"
                ? a.setZoom(n + I)
                : a.setZoomAround(this._lastMousePos, n + I)));
        },
      });
      me.addInitHook("addHandler", "scrollWheelZoom", Nh);
      var jL = 600;
      me.mergeOptions({
        tapHold: X.touchNative && X.safari && X.mobile,
        tapTolerance: 15,
      });
      var Fh = Ba.extend({
        addHooks: function () {
          ae(this._map._container, "touchstart", this._onDown, this);
        },
        removeHooks: function () {
          A(this._map._container, "touchstart", this._onDown, this);
        },
        _onDown: function (a) {
          if ((clearTimeout(this._holdTimeout), a.touches.length === 1)) {
            var n = a.touches[0];
            ((this._startPos = this._newPos = new $(n.clientX, n.clientY)),
              (this._holdTimeout = setTimeout(
                l(function () {
                  (this._cancel(),
                    this._isTapValid() &&
                      (ae(document, "touchend", se),
                      ae(
                        document,
                        "touchend touchcancel",
                        this._cancelClickPrevent,
                      ),
                      this._simulateEvent("contextmenu", n)));
                }, this),
                jL,
              )),
              ae(
                document,
                "touchend touchcancel contextmenu",
                this._cancel,
                this,
              ),
              ae(document, "touchmove", this._onMove, this));
          }
        },
        _cancelClickPrevent: function a() {
          (A(document, "touchend", se), A(document, "touchend touchcancel", a));
        },
        _cancel: function () {
          (clearTimeout(this._holdTimeout),
            A(document, "touchend touchcancel contextmenu", this._cancel, this),
            A(document, "touchmove", this._onMove, this));
        },
        _onMove: function (a) {
          var n = a.touches[0];
          this._newPos = new $(n.clientX, n.clientY);
        },
        _isTapValid: function () {
          return (
            this._newPos.distanceTo(this._startPos) <=
            this._map.options.tapTolerance
          );
        },
        _simulateEvent: function (a, n) {
          var u = new MouseEvent(a, {
            bubbles: !0,
            cancelable: !0,
            view: window,
            screenX: n.screenX,
            screenY: n.screenY,
            clientX: n.clientX,
            clientY: n.clientY,
          });
          ((u._simulated = !0), n.target.dispatchEvent(u));
        },
      });
      (me.addInitHook("addHandler", "tapHold", Fh),
        me.mergeOptions({ touchZoom: X.touch, bounceAtZoomLimits: !0 }));
      var Zh = Ba.extend({
        addHooks: function () {
          (oe(this._map._container, "leaflet-touch-zoom"),
            ae(this._map._container, "touchstart", this._onTouchStart, this));
        },
        removeHooks: function () {
          (Re(this._map._container, "leaflet-touch-zoom"),
            A(this._map._container, "touchstart", this._onTouchStart, this));
        },
        _onTouchStart: function (a) {
          var n = this._map;
          if (!(
            !a.touches ||
            a.touches.length !== 2 ||
            n._animatingZoom ||
            this._zooming
          )) {
            var u = n.mouseEventToContainerPoint(a.touches[0]),
              r = n.mouseEventToContainerPoint(a.touches[1]);
            ((this._centerPoint = n.getSize()._divideBy(2)),
              (this._startLatLng = n.containerPointToLatLng(this._centerPoint)),
              n.options.touchZoom !== "center" &&
                (this._pinchStartLatLng = n.containerPointToLatLng(
                  u.add(r)._divideBy(2),
                )),
              (this._startDist = u.distanceTo(r)),
              (this._startZoom = n.getZoom()),
              (this._moved = !1),
              (this._zooming = !0),
              n._stop(),
              ae(document, "touchmove", this._onTouchMove, this),
              ae(document, "touchend touchcancel", this._onTouchEnd, this),
              se(a));
          }
        },
        _onTouchMove: function (a) {
          if (!(!a.touches || a.touches.length !== 2 || !this._zooming)) {
            var n = this._map,
              u = n.mouseEventToContainerPoint(a.touches[0]),
              r = n.mouseEventToContainerPoint(a.touches[1]),
              d = u.distanceTo(r) / this._startDist;
            if (
              ((this._zoom = n.getScaleZoom(d, this._startZoom)),
              !n.options.bounceAtZoomLimits &&
                ((this._zoom < n.getMinZoom() && d < 1) ||
                  (this._zoom > n.getMaxZoom() && d > 1)) &&
                (this._zoom = n._limitZoom(this._zoom)),
              n.options.touchZoom === "center")
            ) {
              if (((this._center = this._startLatLng), d === 1)) return;
            } else {
              var h = u._add(r)._divideBy(2)._subtract(this._centerPoint);
              if (d === 1 && h.x === 0 && h.y === 0) return;
              this._center = n.unproject(
                n.project(this._pinchStartLatLng, this._zoom).subtract(h),
                this._zoom,
              );
            }
            (this._moved || (n._moveStart(!0, !1), (this._moved = !0)),
              W(this._animRequest));
            var I = l(
              n._move,
              n,
              this._center,
              this._zoom,
              { pinch: !0, round: !1 },
              void 0,
            );
            ((this._animRequest = V(I, this, !0)), se(a));
          }
        },
        _onTouchEnd: function () {
          if (!this._moved || !this._zooming) {
            this._zooming = !1;
            return;
          }
          ((this._zooming = !1),
            W(this._animRequest),
            A(document, "touchmove", this._onTouchMove, this),
            A(document, "touchend touchcancel", this._onTouchEnd, this),
            this._map.options.zoomAnimation
              ? this._map._animateZoom(
                  this._center,
                  this._map._limitZoom(this._zoom),
                  !0,
                  this._map.options.zoomSnap,
                )
              : this._map._resetView(
                  this._center,
                  this._map._limitZoom(this._zoom),
                ));
        },
      });
      (me.addInitHook("addHandler", "touchZoom", Zh),
        (me.BoxZoom = Eh),
        (me.DoubleClickZoom = Uh),
        (me.Drag = qh),
        (me.Keyboard = Hh),
        (me.ScrollWheelZoom = Nh),
        (me.TapHold = Fh),
        (me.TouchZoom = Zh),
        (e.Bounds = De),
        (e.Browser = X),
        (e.CRS = ca),
        (e.Canvas = kh),
        (e.Circle = gf),
        (e.CircleMarker = rs),
        (e.Class = Ze),
        (e.Control = gt),
        (e.DivIcon = Dh),
        (e.DivOverlay = Pa),
        (e.DomEvent = La),
        (e.DomUtil = ls),
        (e.Draggable = Pi),
        (e.Evented = Ii),
        (e.FeatureGroup = $a),
        (e.GeoJSON = ti),
        (e.GridLayer = wl),
        (e.Handler = Ba),
        (e.Icon = un),
        (e.ImageOverlay = ms),
        (e.LatLng = q),
        (e.LatLngBounds = je),
        (e.Layer = _a),
        (e.LayerGroup = ln),
        (e.LineUtil = IL),
        (e.Map = me),
        (e.Marker = ss),
        (e.Mixin = _L),
        (e.Path = ki),
        (e.Point = $),
        (e.PolyUtil = vL),
        (e.Polygon = sn),
        (e.Polyline = ei),
        (e.Popup = ps),
        (e.PosAnimation = _o),
        (e.Projection = bL),
        (e.Rectangle = Rh),
        (e.Renderer = ai),
        (e.SVG = Tl),
        (e.SVGOverlay = Ah),
        (e.TileLayer = fn),
        (e.Tooltip = gs),
        (e.Transformation = Zo),
        (e.Util = Y),
        (e.VideoOverlay = Th),
        (e.bind = l),
        (e.bounds = Xe),
        (e.canvas = zh),
        (e.circle = kL),
        (e.circleMarker = PL),
        (e.control = Ja),
        (e.divIcon = FL),
        (e.extend = i),
        (e.featureGroup = AL),
        (e.geoJSON = Mh),
        (e.geoJson = RL),
        (e.gridLayer = ZL),
        (e.icon = DL),
        (e.imageOverlay = EL),
        (e.latLng = fe),
        (e.latLngBounds = He),
        (e.layerGroup = TL),
        (e.map = nn),
        (e.marker = BL),
        (e.point = ee),
        (e.polygon = OL),
        (e.polyline = zL),
        (e.popup = HL),
        (e.rectangle = XL),
        (e.setOptions = x),
        (e.stamp = f),
        (e.svg = Oh),
        (e.svgOverlay = qL),
        (e.tileLayer = Bh),
        (e.tooltip = NL),
        (e.transformation = bi),
        (e.version = t),
        (e.videoOverlay = UL));
      var YL = window.L;
      ((e.noConflict = function () {
        return ((window.L = YL), this);
      }),
        (window.L = e));
    });
  });
  var Cy = {};
  var fL = s_(() => {
    "use strict";
    (function (e) {
      typeof define == "function" && define.amd ? define(e) : e();
    })(function () {
      "use strict";
      let e = L.extend({}, L.DomUtil);
      (L.extend(L.DomUtil, {
        setTransform: function (p, _, v, x, B) {
          var P = _ || new L.Point(0, 0);
          if (!x)
            return ((_ = P._round()), e.setTransform.apply(this, arguments));
          ((P = P.rotateFrom(x, B)),
            (p.style[L.DomUtil.TRANSFORM] =
              "translate3d(" +
              P.x +
              "px," +
              P.y +
              "px,0)" +
              (v ? " scale(" + v + ")" : "") +
              " rotate(" +
              x +
              "rad)"));
        },
        setPosition: function (p, _, v, x, B) {
          if (!v) return e.setPosition.apply(this, arguments);
          ((p._leaflet_pos = _),
            L.Browser.any3d
              ? L.DomUtil.setTransform(p, _, B, v, x)
              : ((p.style.left = _.x + "px"), (p.style.top = _.y + "px")));
        },
        DEG_TO_RAD: Math.PI / 180,
        RAD_TO_DEG: 180 / Math.PI,
      }),
        L.Draggable.include({}),
        L.extend(L.Point.prototype, {
          rotate: function (p) {
            return this.rotateFrom(p, new L.Point(0, 0));
          },
          rotateFrom: function (p, _) {
            if (!p) return this;
            var v = Math.sin(p),
              x = Math.cos(p),
              B = _.x,
              P = _.y,
              Z = this.x - B,
              b = this.y - P;
            return new L.Point(Z * x - b * v + B, Z * v + b * x + P);
          },
        }));
      let t = L.extend({}, L.DivOverlay.prototype);
      L.DivOverlay.include({
        getEvents: function () {
          return L.extend(t.getEvents.apply(this, arguments), {
            rotate: this._updatePosition,
          });
        },
        _updatePosition: function () {
          if (
            this._map &&
            (t._updatePosition.apply(this, arguments),
            this._map && this._map._rotate && this._zoomAnimated)
          ) {
            var p = this._getAnchor(),
              _ = L.DomUtil.getPosition(this._container).subtract(p);
            L.DomUtil.setPosition(
              this._container,
              this._map.rotatedPointToMapPanePoint(_).add(p),
            );
          }
        },
      });
      let i = L.extend({}, L.Popup.prototype);
      L.Popup.include({
        _animateZoom: function (p) {
          if (
            (i._animateZoom.apply(this, arguments),
            this._map && this._map._rotate)
          ) {
            var _ = this._getAnchor(),
              v = L.DomUtil.getPosition(this._container).subtract(_);
            L.DomUtil.setPosition(
              this._container,
              this._map.rotatedPointToMapPanePoint(v).add(_),
            );
          }
        },
        _adjustPan: function () {
          if (!(
            !this.options.autoPan ||
            (this._map._panAnim && this._map._panAnim._inProgress)
          ))
            if (this._autopanning) this._autopanning = !1;
            else {
              var p = this._map,
                _ =
                  parseInt(
                    L.DomUtil.getStyle(this._container, "marginBottom"),
                    10,
                  ) || 0,
                v = this._container.offsetHeight + _,
                x = this._containerWidth,
                B = new L.Point(
                  this._containerLeft,
                  -v - this._containerBottom,
                );
              B._add(L.DomUtil.getPosition(this._container));
              var P = B._add(this._map._getMapPanePos()),
                Z = L.point(this.options.autoPanPadding),
                b = L.point(this.options.autoPanPaddingTopLeft || Z),
                C = L.point(this.options.autoPanPaddingBottomRight || Z),
                w = p.getSize(),
                T = 0,
                z = 0;
              (P.x + x + C.x > w.x && (T = P.x + x - w.x + C.x),
                P.x - T - b.x < 0 && (T = P.x - b.x),
                P.y + v + C.y > w.y && (z = P.y + v - w.y + C.y),
                P.y - z - b.y < 0 && (z = P.y - b.y),
                (T || z) &&
                  (this.options.keepInView && (this._autopanning = !0),
                  p.fire("autopanstart").panBy([T, z])));
            }
        },
      });
      let o = L.extend({}, L.Tooltip.prototype);
      (L.Tooltip.include({
        _animateZoom: function (p) {
          if (!this._map._rotate) return o._animateZoom.apply(this, arguments);
          var _ = this._map._latLngToNewLayerPoint(
            this._latlng,
            p.zoom,
            p.center,
          );
          ((_ = this._map.rotatedPointToMapPanePoint(_)), this._setPosition(_));
        },
        _updatePosition: function () {
          if (!this._map._rotate)
            return o._updatePosition.apply(this, arguments);
          var p = this._map.latLngToLayerPoint(this._latlng);
          ((p = this._map.rotatedPointToMapPanePoint(p)), this._setPosition(p));
        },
      }),
        L.extend({}, L.Icon.prototype),
        L.Icon.include({
          _setIconStyles: function (p, _) {
            var v = this.options,
              x = v[_ + "Size"];
            typeof x == "number" && (x = [x, x]);
            var B = L.point(x),
              P = L.point(
                (_ === "shadow" && v.shadowAnchor) ||
                  v.iconAnchor ||
                  (B && B.divideBy(2, !0)),
              );
            ((p.className = "leaflet-marker-" + _ + " " + (v.className || "")),
              P &&
                ((p.style.marginLeft = -P.x + "px"),
                (p.style.marginTop = -P.y + "px"),
                (p.style[L.DomUtil.TRANSFORM + "Origin"] =
                  P.x + "px " + P.y + "px 0px")),
              B &&
                ((p.style.width = B.x + "px"), (p.style.height = B.y + "px")));
          },
        }));
      let l = L.extend({}, L.Marker.prototype);
      var s;
      L.Marker.mergeOptions({ rotation: 0, rotateWithView: !1, scale: void 0 });
      var f = {
        _onDrag: function (p) {
          var _ = this._marker,
            v = _.options.rotation || _.options.rotateWithView,
            x = _._shadow,
            B = L.DomUtil.getPosition(_._icon);
          (!v && x && L.DomUtil.setPosition(x, B),
            _._map._rotate && (B = _._map.mapPanePointToRotatedPoint(B)));
          var P = _._map.layerPointToLatLng(B);
          ((_._latlng = P),
            (p.latlng = P),
            (p.oldLatLng = this._oldLatLng),
            v ? _.setLatLng(P) : _.fire("move", p),
            _.fire("drag", p));
        },
        _onDragEnd: function (p) {
          (this._marker._map._rotate && this._marker.update(),
            s._onDragEnd.apply(this, arguments));
        },
      };
      L.Marker.include({
        getEvents: function () {
          return L.extend(l.getEvents.apply(this, arguments), {
            rotate: this.update,
          });
        },
        _initInteraction: function () {
          var p = l._initInteraction.apply(this, arguments);
          return (
            this.dragging &&
              this.dragging.enabled() &&
              this._map &&
              this._map._rotate &&
              ((s = s || Object.getPrototypeOf(this.dragging)),
              this.dragging.disable(),
              Object.assign(this.dragging, {
                _onDrag: f._onDrag.bind(this.dragging),
                _onDragEnd: f._onDragEnd.bind(this.dragging),
              }),
              this.dragging.enable()),
            p
          );
        },
        _setPos: function (p) {
          this._map._rotate && (p = this._map.rotatedPointToMapPanePoint(p));
          var _ = this.options.rotation || 0;
          (this.options.rotateWithView && (_ += this._map._bearing),
            this._icon &&
              L.DomUtil.setPosition(this._icon, p, _, p, this.options.scale),
            this._shadow &&
              L.DomUtil.setPosition(this._shadow, p, _, p, this.options.scale),
            (this._zIndex = p.y + this.options.zIndexOffset),
            this._resetZIndex());
        },
        setRotation: function (p) {
          ((this.options.rotation = p), this.update());
        },
      });
      let c = L.extend({}, L.GridLayer.prototype);
      L.GridLayer.include({
        getEvents: function () {
          var p = c.getEvents.apply(this, arguments);
          return (
            this._map._rotate &&
              !this.options.updateWhenIdle &&
              (this._onRotate ||
                (this._onRotate = L.Util.throttle(
                  this._onMoveEnd,
                  this.options.updateInterval,
                  this,
                )),
              (p.rotate = this._onRotate)),
            p
          );
        },
        _getTiledPixelBounds: function (p) {
          return this._map._rotate
            ? this._map._getNewPixelBounds(p, this._tileZoom)
            : c._getTiledPixelBounds.apply(this, arguments);
        },
      });
      let g = L.extend({}, L.Renderer.prototype);
      L.Renderer.include({
        getEvents: function () {
          return L.extend(g.getEvents.apply(this, arguments), {
            rotate: this._update,
          });
        },
        onAdd: function () {
          (g.onAdd.apply(this, arguments),
            L.version <= "1.9.3" &&
              this._container.classList.add("leaflet-zoom-animated"));
        },
        _updateTransform: function (p, _) {
          if (!this._map._rotate)
            return g._updateTransform.apply(this, arguments);
          var v = this._map.getZoomScale(_, this._zoom),
            x = this._map._latLngToNewLayerPoint(this._topLeft, _, p);
          L.DomUtil.setTransform(this._container, x, v);
        },
        _update: function () {
          if (!this._map._rotate) return g._update.apply(this, arguments);
          ((this._bounds = this._map._getPaddedPixelBounds(
            this.options.padding,
          )),
            (this._topLeft = this._map.layerPointToLatLng(this._bounds.min)),
            (this._center = this._map.getCenter()),
            (this._zoom = this._map.getZoom()));
        },
      });
      let y = L.extend({}, L.Map.prototype);
      (L.Map.mergeOptions({ rotate: !1, bearing: 0 }),
        L.Map.include({
          initialize: function (p, _) {
            (_.rotate && ((this._rotate = !0), (this._bearing = 0)),
              y.initialize.apply(this, arguments),
              this.options.rotate && this.setBearing(this.options.bearing));
          },
          containerPointToLayerPoint: function (p) {
            return this._rotate
              ? L.point(p)
                  .subtract(this._getMapPanePos())
                  .rotateFrom(-this._bearing, this._getRotatePanePos())
                  .subtract(this._getRotatePanePos())
              : y.containerPointToLayerPoint.apply(this, arguments);
          },
          layerPointToContainerPoint: function (p) {
            return this._rotate
              ? L.point(p)
                  .add(this._getRotatePanePos())
                  .rotateFrom(this._bearing, this._getRotatePanePos())
                  .add(this._getMapPanePos())
              : y.layerPointToContainerPoint.apply(this, arguments);
          },
          rotatedPointToMapPanePoint: function (p) {
            return L.point(p)
              .rotate(this._bearing)
              ._add(this._getRotatePanePos());
          },
          mapPanePointToRotatedPoint: function (p) {
            return L.point(p)
              ._subtract(this._getRotatePanePos())
              .rotate(-this._bearing);
          },
          mapBoundsToContainerBounds: function (p) {
            if (!this._rotate && y.mapBoundsToContainerBounds)
              return y.mapBoundsToContainerBounds.apply(this, arguments);
            let _ = this.getPixelOrigin(),
              v = this.layerPointToContainerPoint(
                this.project(p.getNorthWest())._subtract(_),
              ),
              x = this.layerPointToContainerPoint(
                this.project(p.getNorthEast())._subtract(_),
              ),
              B = this.layerPointToContainerPoint(
                this.project(p.getSouthWest())._subtract(_),
              ),
              P = this.layerPointToContainerPoint(
                this.project(p.getSouthEast())._subtract(_),
              );
            return L.bounds([
              L.point(
                Math.min(v.x, x.x, P.x, B.x),
                Math.min(v.y, x.y, P.y, B.y),
              ),
              L.point(
                Math.max(v.x, x.x, P.x, B.x),
                Math.max(v.y, x.y, P.y, B.y),
              ),
            ]);
          },
          getBounds: function () {
            if (!this._rotate) return y.getBounds.apply(this, arguments);
            var p = this.getSize();
            return new L.LatLngBounds([
              this.containerPointToLatLng([0, 0]),
              this.containerPointToLatLng([p.x, 0]),
              this.containerPointToLatLng([p.x, p.y]),
              this.containerPointToLatLng([0, p.y]),
            ]);
          },
          setBearing: function (p) {
            if (L.Browser.any3d && this._rotate) {
              var _ = L.Util.wrapNum(p, [0, 360]) * L.DomUtil.DEG_TO_RAD,
                v = this._getPixelCenter(),
                x = this._getRotatePanePos().rotateFrom(-this._bearing, v),
                B = x.rotateFrom(_, v);
              (L.DomUtil.setPosition(this._rotatePane, x, _, v),
                (this._pivot = v),
                (this._bearing = _),
                (this._rotatePanePos = B),
                this.fire("rotate"));
            }
          },
          getBearing: function () {
            return this._bearing * L.DomUtil.RAD_TO_DEG;
          },
          _initPanes: function () {
            var p = (this._panes = {});
            ((this._paneRenderers = {}),
              (this._mapPane = this.createPane("mapPane", this._container)),
              L.DomUtil.setPosition(this._mapPane, new L.Point(0, 0)),
              this._rotate
                ? ((this._rotatePane = this.createPane(
                    "rotatePane",
                    this._mapPane,
                  )),
                  (this._norotatePane = this.createPane(
                    "norotatePane",
                    this._mapPane,
                  )),
                  this.createPane("tilePane", this._rotatePane),
                  this.createPane("overlayPane", this._rotatePane),
                  this.createPane("shadowPane", this._norotatePane),
                  this.createPane("markerPane", this._norotatePane),
                  this.createPane("tooltipPane", this._norotatePane),
                  this.createPane("popupPane", this._norotatePane))
                : (this.createPane("tilePane"),
                  this.createPane("overlayPane"),
                  this.createPane("shadowPane"),
                  this.createPane("markerPane"),
                  this.createPane("tooltipPane"),
                  this.createPane("popupPane")),
              this.options.markerZoomAnimation ||
                (L.DomUtil.addClass(p.markerPane, "leaflet-zoom-hide"),
                L.DomUtil.addClass(p.shadowPane, "leaflet-zoom-hide")));
          },
          panInside(p, _) {
            if (!this._rotate || Math.abs(this._bearing).toFixed(1) < 0.1)
              return y.panInside.apply(this, arguments);
            _ = _ || {};
            let v = L.point(_.paddingTopLeft || _.padding || [0, 0]),
              x = L.point(_.paddingBottomRight || _.padding || [0, 0]),
              B = this._container.getBoundingClientRect(),
              P = this.latLngToContainerPoint(p),
              Z = L.bounds([L.point(B), L.point(B).add(this.getSize())]),
              b = Z.getCenter(),
              C = L.bounds([Z.min.add(v), Z.max.subtract(x)]),
              w = C.getSize();
            if (!C.contains(P)) {
              this._enforcingBounds = !0;
              let T = P.subtract(C.getCenter()),
                z = C.extend(P).getSize().subtract(w);
              ((b.x += T.x < 0 ? -z.x : z.x),
                (b.y += T.y < 0 ? -z.y : z.y),
                this.panTo(this.containerPointToLatLng(b), _),
                (this._enforcingBounds = !1));
            }
            return this;
          },
          getBoundsZoom(p, _, v) {
            if (!this._rotate || Math.abs(this._bearing).toFixed(1) < 0.1)
              return y.getBoundsZoom.apply(this, arguments);
            ((p = L.latLngBounds(p)), (v = L.point(v || [0, 0])));
            let x = this.getZoom() || 0,
              B = this.getMinZoom(),
              P = this.getMaxZoom(),
              Z = this.getSize().subtract(v),
              b = this.mapBoundsToContainerBounds(p).getSize(),
              C = this.options.zoomSnap,
              w = Z.x / b.x,
              T = Z.y / b.y,
              z = _ ? Math.max(w, T) : Math.min(w, T);
            return (
              (x = this.getScaleZoom(z, x)),
              C &&
                ((x = Math.round(x / (C / 100)) * (C / 100)),
                (x = _ ? Math.ceil(x / C) * C : Math.floor(x / C) * C)),
              Math.max(B, Math.min(P, x))
            );
          },
          _getCenterOffset: function (p) {
            var _ = y._getCenterOffset.apply(this, arguments);
            return (this._rotate && (_ = _.rotate(this._bearing)), _);
          },
          _getRotatePanePos: function () {
            return this._rotatePanePos || new L.Point(0, 0);
          },
          _getNewPixelOrigin: function (p, _) {
            if (!this._rotate)
              return y._getNewPixelOrigin.apply(this, arguments);
            var v = this.getSize()._divideBy(2);
            return this.project(p, _)
              .rotate(this._bearing)
              ._subtract(v)
              ._add(this._getMapPanePos())
              ._add(this._getRotatePanePos())
              .rotate(-this._bearing)
              ._round();
          },
          _getNewPixelBounds: function (p, _) {
            if (
              ((p = p || this.getCenter()),
              (_ = _ || this.getZoom()),
              !this._rotate && y._getNewPixelBounds)
            )
              return y._getNewPixelBounds.apply(this, arguments);
            var v = this._animatingZoom
                ? Math.max(this._animateToZoom, this.getZoom())
                : this.getZoom(),
              x = this.getZoomScale(v, _),
              B = this.project(p, _).floor(),
              P = this.getSize(),
              Z = new L.Bounds([
                this.containerPointToLayerPoint([0, 0]).floor(),
                this.containerPointToLayerPoint([P.x, 0]).floor(),
                this.containerPointToLayerPoint([0, P.y]).floor(),
                this.containerPointToLayerPoint([P.x, P.y]).floor(),
              ])
                .getSize()
                .divideBy(2 * x);
            return new L.Bounds(B.subtract(Z), B.add(Z));
          },
          _getPixelCenter: function () {
            return !this._rotate && y._getPixelCenter
              ? y._getPixelCenter.apply(this, arguments)
              : this.getSize()._divideBy(2)._subtract(this._getMapPanePos());
          },
          _getPaddedPixelBounds: function (p) {
            if (!this._rotate && y._getPaddedPixelBounds)
              return y._getPaddedPixelBounds.apply(this, arguments);
            var _ = p,
              v = this.getSize(),
              x = v.multiplyBy(-_),
              B = v.multiplyBy(1 + _);
            return new L.Bounds([
              this.containerPointToLayerPoint([x.x, x.y]).floor(),
              this.containerPointToLayerPoint([x.x, B.y]).floor(),
              this.containerPointToLayerPoint([B.x, x.y]).floor(),
              this.containerPointToLayerPoint([B.x, B.y]).floor(),
            ]);
          },
          _handleGeolocationResponse: function (p) {
            if (this._container._leaflet_id) {
              var _ = p.coords.latitude,
                v = p.coords.longitude,
                x = p.coords.heading,
                B = new L.LatLng(_, v),
                P = B.toBounds(p.coords.accuracy),
                Z = this._locateOptions;
              if (Z.setView) {
                var b = this.getBoundsZoom(P);
                this.setView(B, Z.maxZoom ? Math.min(b, Z.maxZoom) : b);
              }
              var C = {
                latlng: B,
                bounds: P,
                timestamp: p.timestamp,
                heading: x,
              };
              for (var w in p.coords)
                typeof p.coords[w] == "number" && (C[w] = p.coords[w]);
              this.fire("locationfound", C);
            }
          },
        }),
        (L.Map.CompassBearing = L.Handler.extend({
          initialize: function (p) {
            ((this._map = p),
              "ondeviceorientationabsolute" in window
                ? (this.__deviceOrientationEvent = "deviceorientationabsolute")
                : "ondeviceorientation" in window &&
                  (this.__deviceOrientationEvent = "deviceorientation"),
              (this._throttled = L.Util.throttle(
                this._onDeviceOrientation,
                100,
                this,
              )));
          },
          addHooks: function () {
            this._map._rotate && this.__deviceOrientationEvent
              ? L.DomEvent.on(
                  window,
                  this.__deviceOrientationEvent,
                  this._throttled,
                  this,
                )
              : this.disable();
          },
          removeHooks: function () {
            this._map._rotate &&
              this.__deviceOrientationEvent &&
              L.DomEvent.off(
                window,
                this.__deviceOrientationEvent,
                this._throttled,
                this,
              );
          },
          _onDeviceOrientation: function (p) {
            var _ = p.webkitCompassHeading || p.alpha,
              v = 0;
            (!p.absolute && p.webkitCompassHeading && (_ = 360 - _),
              p.absolute ||
                window.orientation === void 0 ||
                (v = window.orientation),
              this._map.setBearing(_ - v));
          },
        })),
        L.Map.addInitHook("addHandler", "compassBearing", L.Map.CompassBearing),
        L.Map.mergeOptions({ trackContainerMutation: !1 }),
        (L.Map.ContainerMutation = L.Handler.extend({
          addHooks: function () {
            (this._observer ||
              (this._observer = new MutationObserver(
                L.Util.bind(this._map.invalidateSize, this._map),
              )),
              this._observer.observe(this._map.getContainer(), {
                childList: !1,
                attributes: !0,
                characterData: !1,
                subtree: !1,
                attributeFilter: ["style"],
              }));
          },
          removeHooks: function () {
            this._observer.disconnect();
          },
        })),
        L.Map.addInitHook(
          "addHandler",
          "trackContainerMutation",
          L.Map.ContainerMutation,
        ),
        L.Map.mergeOptions({ bounceAtZoomLimits: !0 }),
        (L.Map.TouchGestures = L.Handler.extend({
          initialize: function (p) {
            ((this._map = p),
              (this.rotate = !!this._map.options.touchRotate),
              (this.zoom = !!this._map.options.touchZoom));
          },
          addHooks: function () {
            L.DomEvent.on(
              this._map._container,
              "touchstart",
              this._onTouchStart,
              this,
            );
          },
          removeHooks: function () {
            L.DomEvent.off(
              this._map._container,
              "touchstart",
              this._onTouchStart,
              this,
            );
          },
          _onTouchStart: function (p) {
            var _ = this._map;
            if (
              p.touches &&
              p.touches.length === 2 &&
              !_._animatingZoom &&
              !this._zooming &&
              !this._rotating
            ) {
              var v = _.mouseEventToContainerPoint(p.touches[0]),
                x = _.mouseEventToContainerPoint(p.touches[1]),
                B = v.subtract(x);
              ((this._centerPoint = _.getSize()._divideBy(2)),
                (this._startLatLng = _.containerPointToLatLng(
                  this._centerPoint,
                )),
                this.zoom
                  ? (_.options.touchZoom !== "center" &&
                      (this._pinchStartLatLng = _.containerPointToLatLng(
                        v.add(x)._divideBy(2),
                      )),
                    (this._startDist = v.distanceTo(x)),
                    (this._startZoom = _.getZoom()),
                    (this._zooming = !0))
                  : (this._zooming = !1),
                this.rotate
                  ? ((this._startTheta = Math.atan(B.x / B.y)),
                    (this._startBearing = _.getBearing()),
                    B.y < 0 && (this._startBearing += 180),
                    (this._rotating = !0))
                  : (this._rotating = !1),
                (this._moved = !1),
                _._stop(),
                L.DomEvent.on(
                  document,
                  "touchmove",
                  this._onTouchMove,
                  this,
                ).on(document, "touchend touchcancel", this._onTouchEnd, this),
                L.DomEvent.preventDefault(p));
            }
          },
          _onTouchMove: function (p) {
            if (
              p.touches &&
              p.touches.length === 2 &&
              (this._zooming || this._rotating)
            ) {
              var _,
                v = this._map,
                x = v.mouseEventToContainerPoint(p.touches[0]),
                B = v.mouseEventToContainerPoint(p.touches[1]),
                P = x.subtract(B),
                Z = x.distanceTo(B) / this._startDist;
              if (this._rotating) {
                var b =
                  (Math.atan(P.x / P.y) - this._startTheta) *
                  L.DomUtil.RAD_TO_DEG;
                (P.y < 0 && (b += 180),
                  b && v.setBearing(this._startBearing - b));
              }
              if (this._zooming)
                if (
                  ((this._zoom = v.getScaleZoom(Z, this._startZoom)),
                  !v.options.bounceAtZoomLimits &&
                    ((this._zoom < v.getMinZoom() && Z < 1) ||
                      (this._zoom > v.getMaxZoom() && Z > 1)) &&
                    (this._zoom = v._limitZoom(this._zoom)),
                  v.options.touchZoom === "center")
                ) {
                  if (((this._center = this._startLatLng), Z === 1)) return;
                } else {
                  if (
                    ((_ = x._add(B)._divideBy(2)._subtract(this._centerPoint)),
                    Z === 1 && _.x === 0 && _.y === 0)
                  )
                    return;
                  var C = -v.getBearing() * L.DomUtil.DEG_TO_RAD;
                  this._center = v.unproject(
                    v.project(this._pinchStartLatLng).subtract(_.rotate(C)),
                  );
                }
              (this._moved || (v._moveStart(!0, !1), (this._moved = !0)),
                L.Util.cancelAnimFrame(this._animRequest));
              var w = v._move.bind(
                v,
                this._center,
                this._zoom,
                { pinch: !0, round: !1 },
                void 0,
              );
              ((this._animRequest = L.Util.requestAnimFrame(w, this, !0)),
                L.DomEvent.preventDefault(p));
            }
          },
          _onTouchEnd: function () {
            this._moved && (this._zooming || this._rotating)
              ? ((this._zooming = !1),
                (this._rotating = !1),
                L.Util.cancelAnimFrame(this._animRequest),
                L.DomEvent.off(
                  document,
                  "touchmove",
                  this._onTouchMove,
                  this,
                ).off(document, "touchend touchcancel", this._onTouchEnd, this),
                this.zoom &&
                  (this._map.options.zoomAnimation
                    ? this._map._animateZoom(
                        this._center,
                        this._map._limitZoom(this._zoom),
                        !0,
                        this._map.options.zoomSnap,
                      )
                    : this._map._resetView(
                        this._center,
                        this._map._limitZoom(this._zoom),
                      )))
              : (this._zooming = !1);
          },
        })),
        L.Map.addInitHook("addHandler", "touchGestures", L.Map.TouchGestures),
        L.Map.mergeOptions({ touchRotate: !1 }),
        (L.Map.TouchRotate = L.Handler.extend({
          addHooks: function () {
            (this._map.touchGestures.enable(),
              (this._map.touchGestures.rotate = !0));
          },
          removeHooks: function () {
            this._map.touchGestures.rotate = !1;
          },
        })),
        L.Map.addInitHook("addHandler", "touchRotate", L.Map.TouchRotate),
        L.Map.mergeOptions({ shiftKeyRotate: !0 }),
        (L.Map.ShiftKeyRotate = L.Handler.extend({
          addHooks: function () {
            (L.DomEvent.on(
              this._map._container,
              "wheel",
              this._handleShiftScroll,
              this,
            ),
              (this._map.shiftKeyRotate.rotate = !0));
          },
          removeHooks: function () {
            (L.DomEvent.off(
              this._map._container,
              "wheel",
              this._handleShiftScroll,
              this,
            ),
              (this._map.shiftKeyRotate.rotate = !1));
          },
          _handleShiftScroll: function (p) {
            p.shiftKey
              ? (p.preventDefault(),
                this._map.scrollWheelZoom.disable(),
                this._map.setBearing(
                  this._map._bearing * L.DomUtil.RAD_TO_DEG +
                    5 * Math.sign(p.deltaY),
                ))
              : this._map.scrollWheelZoom.enable();
          },
        })),
        L.Map.addInitHook("addHandler", "shiftKeyRotate", L.Map.ShiftKeyRotate),
        L.Map.addInitHook(function () {
          this.scrollWheelZoom.enabled() &&
            this.shiftKeyRotate.enabled() &&
            (this.scrollWheelZoom.disable(), this.scrollWheelZoom.enable());
        }),
        L.Map.mergeOptions({
          touchZoom: L.Browser.touch,
          bounceAtZoomLimits: !1,
        }),
        (L.Map.TouchZoom = L.Handler.extend({
          addHooks: function () {
            (L.DomUtil.addClass(this._map._container, "leaflet-touch-zoom"),
              this._map.touchGestures.enable(),
              (this._map.touchGestures.zoom = !0));
          },
          removeHooks: function () {
            (L.DomUtil.removeClass(this._map._container, "leaflet-touch-zoom"),
              (this._map.touchGestures.zoom = !1));
          },
        })),
        L.Map.addInitHook("addHandler", "touchZoom", L.Map.TouchZoom),
        (L.Control.Rotate = L.Control.extend({
          options: { position: "topleft", closeOnZeroBearing: !0 },
          onAdd: function (p) {
            var _ = (this._container = L.DomUtil.create(
                "div",
                "leaflet-control-rotate leaflet-bar",
              )),
              v = (this._arrow = L.DomUtil.create(
                "span",
                "leaflet-control-rotate-arrow",
              ));
            ((v.style.backgroundImage = `url("data:image/svg+xml;charset=utf-8,%3Csvg width='29' height='29' viewBox='0 0 29 29' xmlns='http://www.w3.org/2000/svg' fill='%23333'%3E%3Cpath d='M10.5 14l4-8 4 8h-8z'/%3E%3Cpath d='M10.5 16l4 8 4-8h-8z' fill='%23ccc'/%3E%3C/svg%3E")`),
              (v.style.cursor = "grab"),
              (v.style.display = "block"),
              (v.style.width = "100%"),
              (v.style.height = "100%"),
              (v.style.backgroundRepeat = "no-repeat"),
              (v.style.backgroundPosition = "50%"));
            var x = (this._link = L.DomUtil.create(
              "a",
              "leaflet-control-rotate-toggle",
              _,
            ));
            return (
              x.appendChild(v),
              (x.href = "#"),
              (x.title = "Rotate map"),
              L.DomEvent.on(x, "dblclick", L.DomEvent.stopPropagation)
                .on(x, "mousedown", this._handleMouseDown, this)
                .on(x, "click", L.DomEvent.stop)
                .on(x, "click", this._cycleState, this)
                .on(x, "click", this._refocusOnMap, this),
              L.Browser.any3d || L.DomUtil.addClass(x, "leaflet-disabled"),
              this._restyle(),
              p.on("rotate", this._restyle, this),
              (this._follow = !1),
              (this._canFollow = !1),
              this.options.closeOnZeroBearing &&
                p.getBearing() === 0 &&
                (_.style.display = "none"),
              _
            );
          },
          onRemove: function (p) {
            p.off("rotate", this._restyle, this);
          },
          _handleMouseDown: function (p) {
            (L.DomEvent.stop(p),
              (this.dragging = !0),
              (this.dragstartX = p.pageX),
              (this.dragstartY = p.pageY),
              L.DomEvent.on(
                document,
                "mousemove",
                this._handleMouseDrag,
                this,
              ).on(document, "mouseup", this._handleMouseUp, this));
          },
          _handleMouseUp: function (p) {
            (L.DomEvent.stop(p),
              (this.dragging = !1),
              L.DomEvent.off(
                document,
                "mousemove",
                this._handleMouseDrag,
                this,
              ).off(document, "mouseup", this._handleMouseUp, this));
          },
          _handleMouseDrag: function (p) {
            if (this.dragging) {
              var _ = p.clientX - this.dragstartX;
              this._map.setBearing(_);
            }
          },
          _cycleState: function (p) {
            if (this._map) {
              var _ = this._map;
              (_.touchRotate.enabled() || _.compassBearing.enabled()
                ? _.compassBearing.enabled()
                  ? (_.compassBearing.disable(),
                    _.setBearing(0),
                    this.options.closeOnZeroBearing && _.touchRotate.enable())
                  : (_.touchRotate.disable(), _.compassBearing.enable())
                : _.touchRotate.enable(),
                this._restyle());
            }
          },
          _restyle: function () {
            if (this._map.options.rotate) {
              var p = this._map,
                _ = p.getBearing();
              ((this._arrow.style.transform = "rotate(" + _ + "deg)"),
                _ &&
                  this.options.closeOnZeroBearing &&
                  (this._container.style.display = "block"),
                p.compassBearing.enabled()
                  ? (this._link.style.backgroundColor = "orange")
                  : p.touchRotate.enabled()
                    ? (this._link.style.backgroundColor = null)
                    : ((this._link.style.backgroundColor = "grey"),
                      _ === 0 &&
                        this.options.closeOnZeroBearing &&
                        (this._container.style.display = "none")));
            } else L.DomUtil.addClass(this._link, "leaflet-disabled");
          },
        })),
        (L.control.rotate = function (p) {
          return new L.Control.Rotate(p);
        }),
        L.Map.mergeOptions({ rotateControl: !0 }),
        L.Map.addInitHook(function () {
          if (this.options.rotateControl) {
            var p =
              typeof this.options.rotateControl == "object"
                ? this.options.rotateControl
                : {};
            ((this.rotateControl = L.control.rotate(p)),
              this.addControl(this.rotateControl));
          }
        }));
    });
  });
  var dL = ka(E1(), 1);
  var R = ka(yo(), 1);
  var Wr = ka(yo(), 1);
  var Kr = (...e) =>
    e
      .filter((t, i, o) => !!t && t.trim() !== "" && o.indexOf(t) === i)
      .join(" ")
      .trim();
  var U1 = (e) => e.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase();
  var q1 = (e) =>
    e.replace(/^([A-Z])|[\s-_]+(\w)/g, (t, i, o) =>
      o ? o.toUpperCase() : i.toLowerCase(),
    );
  var lh = (e) => {
    let t = q1(e);
    return t.charAt(0).toUpperCase() + t.slice(1);
  };
  var Du = ka(yo(), 1);
  var Qr = {
    xmlns: "http://www.w3.org/2000/svg",
    width: 24,
    height: 24,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 2,
    strokeLinecap: "round",
    strokeLinejoin: "round",
  };
  var H1 = (e) => {
    for (let t in e)
      if (t.startsWith("aria-") || t === "role" || t === "title") return !0;
    return !1;
  };
  var ol = ka(yo(), 1);
  var ty = (0, ol.createContext)({});
  var N1 = () => (0, ol.useContext)(ty);
  var F1 = (0, Du.forwardRef)(
    (
      {
        color: e,
        size: t,
        strokeWidth: i,
        absoluteStrokeWidth: o,
        className: l = "",
        children: s,
        iconNode: f,
        ...c
      },
      g,
    ) => {
      let {
          size: y = 24,
          strokeWidth: p = 2,
          absoluteStrokeWidth: _ = !1,
          color: v = "currentColor",
          className: x = "",
        } = N1() ?? {},
        B = (o ?? _) ? (Number(i ?? p) * 24) / Number(t ?? y) : (i ?? p);
      return (0, Du.createElement)(
        "svg",
        {
          ref: g,
          ...Qr,
          width: t ?? y ?? Qr.width,
          height: t ?? y ?? Qr.height,
          stroke: e ?? v,
          strokeWidth: B,
          className: Kr("lucide", x, l),
          ...(!s && !H1(c) && { "aria-hidden": "true" }),
          ...c,
        },
        [
          ...f.map(([P, Z]) => (0, Du.createElement)(P, Z)),
          ...(Array.isArray(s) ? s : [s]),
        ],
      );
    },
  );
  var ve = (e, t) => {
    let i = (0, Wr.forwardRef)(({ className: o, ...l }, s) =>
      (0, Wr.createElement)(F1, {
        ref: s,
        iconNode: t,
        className: Kr(`lucide-${U1(lh(e))}`, `lucide-${e}`, o),
        ...l,
      }),
    );
    return ((i.displayName = lh(e)), i);
  };
  var ay = [["path", { d: "M20 6 9 17l-5-5", key: "1gmf2c" }]],
    da = ve("check", ay);
  var iy = [["path", { d: "m15 18-6-6 6-6", key: "1wnfg3" }]],
    Bu = ve("chevron-left", iy);
  var oy = [
      ["circle", { cx: "12", cy: "12", r: "10", key: "1mglay" }],
      ["path", { d: "M12 6v6l4 2", key: "mmk7yg" }],
    ],
    Pu = ve("clock", oy);
  var ny = [
      ["circle", { cx: "12", cy: "12", r: "10", key: "1mglay" }],
      [
        "path",
        {
          d: "m16.24 7.76-1.804 5.411a2 2 0 0 1-1.265 1.265L7.76 16.24l1.804-5.411a2 2 0 0 1 1.265-1.265z",
          key: "9ktpf1",
        },
      ],
    ],
    ku = ve("compass", ny);
  var ly = [
      ["line", { x1: "2", x2: "5", y1: "12", y2: "12", key: "bvdh0s" }],
      ["line", { x1: "19", x2: "22", y1: "12", y2: "12", key: "1tbv5k" }],
      ["line", { x1: "12", x2: "12", y1: "2", y2: "5", key: "11lu5j" }],
      ["line", { x1: "12", x2: "12", y1: "19", y2: "22", key: "x3vr5v" }],
      ["circle", { cx: "12", cy: "12", r: "7", key: "fim9np" }],
      ["circle", { cx: "12", cy: "12", r: "3", key: "1v7zrd" }],
    ],
    nl = ve("locate-fixed", ly);
  var uy = [
      [
        "path",
        {
          d: "M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0",
          key: "1r0f0z",
        },
      ],
      ["circle", { cx: "12", cy: "10", r: "3", key: "ilqhr7" }],
    ],
    No = ve("map-pin", uy);
  var sy = [
      ["path", { d: "M12 19v3", key: "npa21l" }],
      ["path", { d: "M19 10v2a7 7 0 0 1-14 0v-2", key: "1vc78b" }],
      [
        "rect",
        { x: "9", y: "2", width: "6", height: "13", rx: "3", key: "s6n7sd" },
      ],
    ],
    Fo = ve("mic", sy);
  var ry = [["path", { d: "M5 12h14", key: "1ays0h" }]],
    zu = ve("minus", ry);
  var fy = [
      ["polygon", { points: "3 11 22 2 13 21 11 13 3 11", key: "1ltx0t" }],
    ],
    so = ve("navigation", fy);
  var dy = [
      [
        "path",
        {
          d: "M13.832 16.568a1 1 0 0 0 1.213-.303l.355-.465A2 2 0 0 1 17 15h3a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2A18 18 0 0 1 2 4a2 2 0 0 1 2-2h3a2 2 0 0 1 2 2v3a2 2 0 0 1-.8 1.6l-.468.351a1 1 0 0 0-.292 1.233 14 14 0 0 0 6.392 6.384",
          key: "9njp5v",
        },
      ],
    ],
    Ou = ve("phone", dy);
  var cy = [
      ["path", { d: "m21 21-4.34-4.34", key: "14j7rj" }],
      ["circle", { cx: "11", cy: "11", r: "8", key: "4ej97u" }],
    ],
    Ru = ve("search", cy);
  var hy = [
      ["path", { d: "M14 17H5", key: "gfn3mx" }],
      ["path", { d: "M19 7h-9", key: "6i9tg" }],
      ["circle", { cx: "17", cy: "17", r: "3", key: "18b49y" }],
      ["circle", { cx: "7", cy: "7", r: "3", key: "dfmy0x" }],
    ],
    Eu = ve("settings-2", hy);
  var my = [
      [
        "path",
        { d: "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2", key: "1yyitq" },
      ],
      ["path", { d: "M16 3.128a4 4 0 0 1 0 7.744", key: "16gr8j" }],
      ["path", { d: "M22 21v-2a4 4 0 0 0-3-3.87", key: "kshegd" }],
      ["circle", { cx: "9", cy: "7", r: "4", key: "nufk8" }],
    ],
    Uu = ve("users", my);
  var py = [
      [
        "path",
        {
          d: "M11 4.702a.705.705 0 0 0-1.203-.498L6.413 7.587A1.4 1.4 0 0 1 5.416 8H3a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2.416a1.4 1.4 0 0 1 .997.413l3.383 3.384A.705.705 0 0 0 11 19.298z",
          key: "uqj9uw",
        },
      ],
      ["path", { d: "M16 9a5 5 0 0 1 0 6", key: "1q6k2b" }],
      ["path", { d: "M19.364 18.364a9 9 0 0 0 0-12.728", key: "ijwkga" }],
    ],
    ll = ve("volume-2", py);
  var gy = [
      [
        "path",
        {
          d: "M11 4.702a.705.705 0 0 0-1.203-.498L6.413 7.587A1.4 1.4 0 0 1 5.416 8H3a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2.416a1.4 1.4 0 0 1 .997.413l3.383 3.384A.705.705 0 0 0 11 19.298z",
          key: "uqj9uw",
        },
      ],
      ["line", { x1: "22", x2: "16", y1: "9", y2: "15", key: "1ewh16" }],
      ["line", { x1: "16", x2: "22", y1: "9", y2: "15", key: "5ykzw1" }],
    ],
    ul = ve("volume-x", gy);
  var Ly = [
      ["path", { d: "M18 6 6 18", key: "1bl5f8" }],
      ["path", { d: "m6 6 12 12", key: "d8bk6v" }],
    ],
    Na = ve("x", Ly);
  var Ci = [
      { id: "marche", label: "March\xE9s", symbol: "\u25A5", color: "#15774e" },
      {
        id: "voyageur",
        label: "Voyageurs",
        symbol: "\u2667",
        color: "#876033",
      },
      { id: "foire", label: "Foires", symbol: "\u2691", color: "#c96b20" },
      {
        id: "brocante",
        label: "Brocantes",
        symbol: "\u25C7",
        color: "#8b4a7d",
      },
      { id: "noel", label: "No\xEBl", symbol: "\u2726", color: "#b94049" },
      { id: "agp", label: "Grand passage", symbol: "P", color: "#2468b2" },
      {
        id: "terrain",
        label: "Terrains d\xE9sign\xE9s",
        symbol: "T",
        color: "#7254a5",
      },
    ],
    Hu = [
      {
        id: "truck",
        name: "Camion L2H2",
        image: "/gps/vehicles/peugeot-boxer-l2h2.webp",
        navigationImage: "/gps/vehicles/van-roof-v29.webp",
        turnImage: "/gps/vehicles/van-turns.webp",
        length: 5.8,
      },
      {
        id: "car",
        name: "Peugeot 308",
        image: "/gps/vehicles/peugeot-308.webp",
        navigationImage: "/gps/vehicles/car-roof-v29.webp",
        turnImage: "/gps/vehicles/car-turns.webp",
        length: 4.4,
      },
    ],
    Nu = [
      {
        id: "none",
        name: "Sans attelage",
        image: "",
        navigationImage: "",
        turnImage: "",
        length: 0,
      },
      {
        id: "small",
        name: "Petite caravane",
        detail: "Tabbert \xB7 4,70 m",
        image: "/gps/vehicles/small-tabbert-cazadora-460-2026.webp",
        navigationImage: "/gps/vehicles/caravan-roof-v28.webp",
        turnImage: "/gps/vehicles/small-caravan-turns.webp",
        length: 4.7,
      },
      {
        id: "large",
        name: "Grande caravane",
        detail: "Tabbert \xB7 6,20 m \xB7 2026",
        image: "/gps/vehicles/large-tabbert-puccini-620.webp",
        navigationImage: "/gps/vehicles/caravan-roof-v28.webp",
        turnImage: "/gps/vehicles/large-caravan-turns.webp",
        length: 6.2,
      },
      {
        id: "trailer",
        name: "Remorque",
        detail: "Barbot",
        image: "/gps/vehicles/barbot-cargo-trailer.webp",
        navigationImage: "/gps/vehicles/trailer-roof-v29.webp",
        turnImage: "/gps/vehicles/trailer-turns.webp",
        length: 4.6,
      },
    ];
  function _y(e, t) {
    return (
      Math.round(
        ((Hu.find((i) => i.id === e)?.length || 5.8) +
          (Nu.find((i) => i.id === t)?.length || 0)) *
          10,
      ) / 10
    );
  }
  function Jr(e, t) {
    if (t === "large")
      return {
        length: 12,
        height: "2.50",
        width: "2.50",
        weight: "3500",
        confirmed: true,
      };
    let i = Math.max(
        e === "truck" ? 2.53 : 1.5,
        t === "small" || t === "large" ? 2.65 : t === "trailer" ? 2 : 0,
      ),
      o = Math.max(e === "truck" ? 2.5 : 2.1, t === "none" ? 0 : 2.5);
    return { length: _y(e, t), height: String(i), width: String(o) };
  }
  var uh = {
    vehicle: "truck",
    trailer: "large",
    ...Jr("truck", "large"),
    weight: "3500",
    confirmed: !0,
    tolls: !0,
    roadMode: "main",
  };
  function qu(e) {
    return String(e || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "");
  }
  function Fu(e, t = new Date()) {
    if (e.kind === "agp" || e.kind === "terrain")
      return e.hours || "Ouverture \xE0 v\xE9rifier";
    let i = new Intl.DateTimeFormat("fr-FR", {
        timeZone: "Europe/Paris",
        weekday: "long",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        hourCycle: "h23",
      }).formatToParts(t),
      o = (p) => i.find((_) => _.type === p)?.value || "",
      l = `${o("year")}-${o("month")}-${o("day")}`,
      s = Number(o("hour")) * 60 + Number(o("minute")),
      f = !!e.start,
      c = f
        ? l >= e.start && l <= (e.end || e.start)
        : qu(e.day).includes(qu(o("weekday"))),
      g = [
        ...e.hours.matchAll(
          /(\d{1,2})\s*(?:h|:)(\d{2})?\s*(?:-|–|—|à|a)\s*(\d{1,2})\s*(?:h|:)(\d{2})?/gi,
        ),
      ];
    return c &&
      g.some((p) => {
        let _ = Number(p[1]) * 60 + Number(p[2] || 0),
          v = Number(p[3]) * 60 + Number(p[4] || 0);
        return v > _ && s >= _ && s < v;
      })
      ? `${e.kind === "noel" ? "March\xE9 de No\xEBl" : e.kind === "voyageur" ? "March\xE9 voyageur" : e.kind === "foire" ? "Foire" : e.kind === "brocante" ? "Brocante" : "March\xE9"} en cours`
      : [
          e.start
            ? new Date(e.start + "T12:00:00").toLocaleDateString("fr-FR") +
              (e.end && e.end !== e.start
                ? " \u2192 " +
                  new Date(e.end + "T12:00:00").toLocaleDateString("fr-FR")
                : "")
            : e.day,
          e.hours,
        ]
          .filter(Boolean)
          .join(" \xB7 ") || "Dates \xE0 confirmer";
  }
  function Fa(e, t, i, o) {
    let l = Math.PI / 180,
      s =
        Math.sin(((i - e) * l) / 2) ** 2 +
        Math.cos(e * l) * Math.cos(i * l) * Math.sin(((o - t) * l) / 2) ** 2;
    return 6371 * 2 * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s));
  }
  var Z1 = [
      "\xC7a a l\u2019air d\u2019une bonne maison !",
      "Ah, celui-l\xE0, c\u2019est un bon pouro !",
      "Ah, celle-l\xE0, elle a du charme !",
      "Tu pourrais chiner par ici, je le sens bien !",
      "Cette adresse, je la sens bien !",
      "On dirait un bon coin pour trouver des tr\xE9sors !",
    ],
    G1 = [
      "Tu devrais chiner par ici, je le sens bien !",
      "Cette petite rue, je la vois bonne !",
      "Il y a peut-\xEAtre des tr\xE9sors dans ce coin !",
      "Ah, par ici, je sens la bonne trouvaille !",
      "Cette rue-l\xE0, elle me pla\xEEt bien !",
      "On garde ce coin en t\xEAte pour chiner !",
    ];
  function V1(e, t, i = Math.random) {
    let o = e.map((s, f) => f).filter((s) => s !== t),
      l = o[Math.min(o.length - 1, Math.max(0, Math.floor(i() * o.length)))];
    return { index: l, text: e[l] };
  }
  var ro = null;
  function X1() {
    try {
      let e = window.AudioContext || window.webkitAudioContext;
      if (!e) return;
      ((ro ??= new e()), ro?.resume().catch(() => {}));
    } catch {}
  }
  function j1() {
    if (!(!ro || ro.state !== "running"))
      try {
        let e = ro.currentTime;
        for (let t = 0; t < 2; t++) {
          let i = ro.createOscillator(),
            o = ro.createGain(),
            l = e + t * 0.3;
          ((i.type = "sine"),
            i.frequency.setValueAtTime(1600, l),
            i.frequency.linearRampToValueAtTime(2200, l + 0.12),
            o.gain.setValueAtTime(0, l),
            o.gain.linearRampToValueAtTime(0.08, l + 0.025),
            o.gain.linearRampToValueAtTime(0, l + 0.21),
            i.connect(o),
            o.connect(ro.destination),
            i.start(l),
            i.stop(l + 0.22));
        }
      } catch {}
  }
  var Y1 = [
    [2071, 306],
    [2076, 305],
    [2079, 309],
    [2083, 297],
    [2083, 310],
    [2095, 291],
    [2097, 291],
    [2097, 292],
    [2098, 294],
    [2098, 313],
    [2113, 318],
    [2116, 318],
    [2122, 65],
    [2123, 65],
    [2124, 316],
    [2125, 312],
    [2126, 93],
    [2126, 102],
    [2126, 313],
    [2127, 98],
    [2127, 101],
    [2128, 293],
    [2129, 101],
    [2129, 317],
    [2130, 95],
    [2130, 99],
    [2131, 316],
    [2132, 61],
    [2132, 101],
    [2133, 85],
    [2133, 96],
    [2133, 98],
    [2134, 94],
    [2134, 96],
    [2134, 97],
    [2134, 315],
    [2135, 96],
    [2135, 97],
    [2135, 100],
    [2137, 6],
    [2137, 96],
    [2138, 59],
    [2138, 97],
    [2138, 101],
    [2139, 100],
    [2140, 101],
    [2141, 84],
    [2141, 86],
    [2143, 53],
    [2145, 100],
    [2146, 55],
    [2147, 62],
    [2150, 21],
    [2150, 40],
    [2150, 54],
    [2151, 21],
    [2151, 37],
    [2151, 53],
    [2152, -20],
    [2152, 63],
    [2152, 75],
    [2154, -20],
    [2154, 21],
    [2154, 98],
    [2154, 197],
    [2155, 63],
    [2155, 194],
    [2156, 14],
    [2156, 102],
    [2156, 194],
    [2156, 197],
    [2156, 198],
    [2156, 199],
    [2156, 200],
    [2156, 204],
    [2156, 206],
    [2157, 10],
    [2157, 77],
    [2157, 102],
    [2157, 195],
    [2157, 196],
    [2157, 200],
    [2157, 201],
    [2158, -16],
    [2158, -15],
    [2158, 191],
    [2159, -39],
    [2159, 33],
    [2159, 41],
    [2159, 93],
    [2160, -42],
    [2160, 54],
    [2160, 79],
    [2160, 81],
    [2160, 92],
    [2160, 102],
    [2160, 188],
    [2160, 216],
    [2161, 2],
    [2161, 78],
    [2161, 79],
    [2161, 194],
    [2162, -9],
    [2162, -2],
    [2162, 0],
    [2162, 220],
    [2163, 2],
    [2163, 91],
    [2163, 180],
    [2163, 218],
    [2164, 4],
    [2164, 104],
    [2164, 110],
    [2164, 179],
    [2164, 180],
    [2164, 181],
    [2164, 183],
    [2164, 187],
    [2164, 202],
    [2165, -45],
    [2165, -13],
    [2165, -12],
    [2165, 97],
    [2165, 115],
    [2165, 179],
    [2165, 181],
    [2165, 183],
    [2166, -14],
    [2166, -13],
    [2166, -12],
    [2166, 50],
    [2166, 116],
    [2166, 179],
    [2166, 180],
    [2166, 181],
    [2167, 4],
    [2167, 63],
    [2167, 107],
    [2167, 108],
    [2167, 178],
    [2167, 179],
    [2167, 180],
    [2167, 187],
    [2167, 203],
    [2168, -58],
    [2168, -57],
    [2168, -55],
    [2168, -53],
    [2168, -18],
    [2168, -16],
    [2168, 65],
    [2168, 108],
    [2168, 176],
    [2169, 54],
    [2169, 110],
    [2169, 115],
    [2169, 160],
    [2169, 178],
    [2169, 202],
    [2169, 220],
    [2170, -7],
    [2170, 48],
    [2170, 174],
    [2170, 176],
    [2170, 178],
    [2170, 212],
    [2171, -54],
    [2171, -16],
    [2171, 2],
    [2171, 10],
    [2171, 118],
    [2171, 123],
    [2171, 125],
    [2171, 166],
    [2171, 168],
    [2171, 169],
    [2171, 174],
    [2171, 176],
    [2171, 177],
    [2171, 179],
    [2171, 196],
    [2171, 215],
    [2171, 223],
    [2171, 224],
    [2171, 228],
    [2172, -53],
    [2172, -52],
    [2172, -50],
    [2172, 216],
    [2172, 224],
    [2172, 225],
    [2173, -23],
    [2173, 29],
    [2173, 43],
    [2173, 63],
    [2173, 85],
    [2173, 177],
    [2173, 221],
    [2173, 224],
    [2174, -51],
    [2174, -50],
    [2174, -41],
    [2174, 95],
    [2174, 122],
    [2174, 165],
    [2174, 188],
    [2174, 196],
    [2175, -51],
    [2175, -50],
    [2175, -49],
    [2175, -46],
    [2175, -29],
    [2175, -26],
    [2175, -20],
    [2175, -11],
    [2175, 1],
    [2175, 12],
    [2175, 67],
    [2175, 126],
    [2175, 162],
    [2175, 166],
    [2175, 184],
    [2175, 216],
    [2176, -49],
    [2176, 69],
    [2176, 181],
    [2176, 182],
    [2176, 216],
    [2177, -32],
    [2177, -27],
    [2177, 33],
    [2177, 147],
    [2177, 165],
    [2177, 168],
    [2177, 173],
    [2177, 226],
    [2177, 228],
    [2177, 233],
    [2177, 235],
    [2178, -47],
    [2178, -43],
    [2178, -39],
    [2178, 20],
    [2178, 44],
    [2178, 47],
    [2178, 49],
    [2178, 63],
    [2178, 128],
    [2178, 132],
    [2178, 181],
    [2178, 233],
    [2179, -22],
    [2179, 18],
    [2179, 38],
    [2179, 47],
    [2179, 48],
    [2179, 50],
    [2179, 60],
    [2179, 129],
    [2179, 131],
    [2179, 148],
    [2179, 171],
    [2179, 237],
    [2180, 33],
    [2180, 44],
    [2180, 47],
    [2180, 48],
    [2180, 49],
    [2180, 128],
    [2180, 129],
    [2180, 130],
    [2180, 131],
    [2180, 159],
    [2180, 234],
    [2181, -47],
    [2181, 47],
    [2181, 48],
    [2181, 49],
    [2181, 77],
    [2181, 123],
    [2181, 128],
    [2181, 129],
    [2181, 130],
    [2182, -47],
    [2182, -21],
    [2182, -16],
    [2182, 19],
    [2182, 47],
    [2182, 48],
    [2182, 49],
    [2182, 73],
    [2182, 74],
    [2182, 127],
    [2182, 130],
    [2182, 185],
    [2182, 186],
    [2182, 238],
    [2183, -47],
    [2183, -31],
    [2183, 21],
    [2183, 47],
    [2183, 49],
    [2183, 132],
    [2183, 134],
    [2183, 154],
    [2183, 155],
    [2183, 183],
    [2183, 236],
    [2183, 237],
    [2183, 238],
    [2183, 239],
    [2183, 240],
    [2184, -47],
    [2184, -42],
    [2184, -6],
    [2184, -3],
    [2184, 32],
    [2184, 42],
    [2184, 62],
    [2184, 137],
    [2184, 154],
    [2184, 170],
    [2184, 240],
    [2185, -36],
    [2185, -23],
    [2185, 16],
    [2185, 47],
    [2185, 52],
    [2185, 148],
    [2185, 152],
    [2185, 241],
    [2185, 242],
    [2185, 243],
    [2186, -41],
    [2186, -37],
    [2186, 36],
    [2186, 141],
    [2186, 155],
    [2186, 240],
    [2186, 242],
    [2186, 243],
    [2186, 247],
    [2187, -47],
    [2187, -35],
    [2187, 11],
    [2187, 12],
    [2187, 44],
    [2187, 58],
    [2187, 143],
    [2187, 149],
    [2187, 242],
    [2187, 243],
    [2187, 246],
    [2187, 247],
    [2187, 248],
    [2188, -35],
    [2188, -20],
    [2188, 16],
    [2188, 21],
    [2188, 45],
    [2188, 47],
    [2188, 61],
    [2188, 68],
    [2188, 142],
    [2188, 149],
    [2188, 171],
    [2188, 172],
    [2188, 248],
    [2188, 249],
    [2189, -19],
    [2189, -1],
    [2189, 66],
    [2189, 129],
    [2189, 143],
    [2189, 145],
    [2189, 154],
    [2189, 164],
    [2189, 243],
    [2189, 251],
    [2190, -10],
    [2190, 43],
    [2190, 44],
    [2190, 143],
    [2190, 146],
    [2190, 167],
    [2190, 249],
    [2191, -10],
    [2191, 40],
    [2191, 42],
    [2191, 111],
    [2191, 145],
    [2191, 151],
    [2191, 193],
    [2192, 41],
    [2192, 144],
    [2192, 145],
    [2192, 146],
    [2192, 147],
    [2192, 152],
    [2192, 164],
    [2192, 168],
    [2193, -37],
    [2193, -25],
    [2193, -24],
    [2193, -14],
    [2193, 64],
    [2193, 142],
    [2193, 161],
    [2193, 167],
    [2193, 171],
    [2193, 174],
    [2193, 187],
    [2193, 194],
    [2194, -36],
    [2194, -16],
    [2194, -12],
    [2194, 2],
    [2194, 61],
    [2194, 72],
    [2194, 134],
    [2194, 142],
    [2194, 148],
    [2194, 150],
    [2194, 162],
    [2194, 165],
    [2194, 195],
    [2195, -17],
    [2195, 34],
    [2195, 44],
    [2195, 59],
    [2195, 60],
    [2195, 80],
    [2195, 156],
    [2195, 194],
    [2196, -41],
    [2196, -31],
    [2196, -19],
    [2196, 46],
    [2196, 53],
    [2196, 74],
    [2196, 76],
    [2196, 160],
    [2196, 161],
    [2197, -36],
    [2197, 22],
    [2197, 41],
    [2197, 72],
    [2197, 97],
    [2197, 152],
    [2197, 153],
    [2197, 156],
    [2197, 159],
    [2197, 161],
    [2197, 162],
    [2197, 165],
    [2197, 168],
    [2198, -18],
    [2198, -11],
    [2198, 40],
    [2198, 45],
    [2198, 48],
    [2198, 72],
    [2198, 127],
    [2198, 141],
    [2198, 155],
    [2198, 158],
    [2198, 160],
    [2198, 161],
    [2198, 162],
    [2198, 216],
    [2198, 225],
    [2198, 229],
    [2199, -10],
    [2199, 49],
    [2199, 70],
    [2199, 123],
    [2199, 142],
    [2199, 162],
    [2199, 167],
    [2200, -3],
    [2200, 44],
    [2200, 45],
    [2200, 72],
    [2200, 158],
    [2200, 162],
    [2201, -42],
    [2201, -11],
    [2201, 44],
    [2201, 45],
    [2201, 46],
    [2201, 163],
    [2202, 16],
    [2202, 37],
    [2202, 39],
    [2202, 41],
    [2202, 46],
    [2202, 67],
    [2202, 138],
    [2202, 205],
    [2203, 29],
    [2203, 47],
    [2203, 159],
    [2203, 166],
    [2203, 168],
    [2203, 207],
    [2204, 12],
    [2204, 36],
    [2204, 43],
    [2204, 100],
    [2204, 201],
    [2205, 34],
    [2205, 49],
    [2205, 136],
    [2206, 18],
    [2206, 38],
    [2206, 136],
    [2206, 143],
    [2206, 154],
    [2206, 160],
    [2206, 200],
    [2207, -32],
    [2207, 40],
    [2207, 50],
    [2207, 136],
    [2207, 160],
    [2208, -10],
    [2208, 10],
    [2208, 21],
    [2208, 53],
    [2208, 137],
    [2208, 152],
    [2209, 23],
    [2209, 135],
    [2209, 137],
    [2209, 138],
    [2210, -41],
    [2210, -25],
    [2210, -9],
    [2210, 11],
    [2210, 18],
    [2210, 20],
    [2210, 21],
    [2210, 138],
    [2210, 154],
    [2210, 158],
    [2211, -42],
    [2211, -41],
    [2211, -40],
    [2211, 22],
    [2211, 51],
    [2211, 58],
    [2212, -38],
    [2212, -37],
    [2212, 15],
    [2212, 17],
    [2213, 9],
    [2213, 12],
    [2213, 24],
    [2213, 155],
    [2213, 195],
    [2214, 81],
    [2214, 126],
    [2215, -16],
    [2215, 62],
    [2215, 154],
    [2216, -31],
    [2216, 24],
    [2216, 193],
    [2217, -31],
    [2217, 4],
    [2217, 101],
    [2217, 160],
    [2217, 165],
    [2218, -25],
    [2218, 15],
    [2218, 24],
    [2218, 49],
    [2219, 11],
    [2219, 28],
    [2220, -39],
    [2220, -27],
    [2220, 24],
    [2220, 79],
    [2220, 90],
    [2220, 216],
    [2221, 24],
    [2221, 48],
    [2221, 70],
    [2221, 106],
    [2221, 158],
    [2222, 9],
    [2222, 33],
    [2222, 140],
    [2222, 156],
    [2223, -37],
    [2223, -36],
    [2223, 23],
    [2224, 30],
    [2224, 47],
    [2224, 113],
    [2224, 145],
    [2224, 201],
    [2225, -35],
    [2225, 5],
    [2225, 6],
    [2225, 33],
    [2225, 158],
    [2225, 191],
    [2225, 205],
    [2226, 36],
    [2226, 46],
    [2226, 78],
    [2226, 145],
    [2226, 202],
    [2226, 212],
    [2227, 10],
    [2227, 118],
    [2227, 158],
    [2228, 1],
    [2228, 88],
    [2228, 158],
    [2228, 197],
    [2228, 216],
    [2229, -30],
    [2229, -11],
    [2229, -5],
    [2229, 50],
    [2229, 154],
    [2229, 205],
    [2230, -31],
    [2230, -28],
    [2230, 65],
    [2230, 160],
    [2230, 203],
    [2231, -32],
    [2231, -11],
    [2231, -2],
    [2231, 12],
    [2231, 147],
    [2232, -29],
    [2232, -8],
    [2232, 67],
    [2232, 69],
    [2232, 158],
    [2232, 159],
    [2232, 203],
    [2232, 219],
    [2233, -13],
    [2233, 115],
    [2233, 220],
    [2234, -33],
    [2235, -34],
    [2235, -32],
    [2235, -16],
    [2235, 109],
    [2235, 155],
    [2235, 156],
    [2235, 160],
    [2235, 201],
    [2236, -35],
    [2236, -34],
    [2236, 73],
    [2236, 128],
    [2236, 138],
    [2236, 165],
    [2237, -23],
    [2237, 155],
    [2237, 167],
    [2239, -31],
    [2239, -21],
    [2239, -19],
    [2240, -29],
    [2241, -20],
    [2241, -19],
    [2241, -18],
    [2241, 155],
    [2242, -24],
    [2242, -20],
    [2242, -17],
    [2242, -5],
    [2242, 4],
    [2242, 13],
    [2242, 83],
    [2242, 163],
    [2243, -20],
    [2243, -19],
    [2243, 1],
    [2243, 41],
    [2243, 187],
    [2244, -19],
    [2244, -18],
    [2244, -11],
    [2244, -6],
    [2244, 17],
    [2244, 40],
    [2244, 77],
    [2245, 62],
    [2246, 163],
    [2246, 220],
    [2247, -7],
    [2247, 82],
    [2247, 160],
    [2247, 163],
    [2247, 165],
    [2247, 192],
    [2248, -24],
    [2248, -20],
    [2248, -7],
    [2248, -6],
    [2248, 86],
    [2249, -34],
    [2249, -14],
    [2249, 163],
    [2250, 88],
    [2250, 166],
    [2250, 167],
    [2251, -5],
    [2251, -1],
    [2251, 126],
    [2251, 128],
    [2252, -14],
    [2252, -4],
    [2252, 11],
    [2252, 130],
    [2252, 162],
    [2252, 166],
    [2252, 169],
    [2253, 128],
    [2253, 129],
    [2253, 161],
    [2253, 193],
    [2255, 16],
    [2255, 28],
    [2255, 51],
    [2255, 190],
    [2256, 30],
    [2256, 41],
    [2256, 44],
    [2256, 52],
    [2256, 105],
    [2256, 124],
    [2256, 190],
    [2256, 193],
    [2257, -35],
    [2257, 26],
    [2257, 50],
    [2257, 63],
    [2257, 99],
    [2257, 117],
    [2257, 131],
    [2257, 168],
    [2257, 190],
    [2258, -27],
    [2258, 24],
    [2258, 51],
    [2258, 136],
    [2258, 192],
    [2259, 13],
    [2259, 22],
    [2259, 24],
    [2259, 106],
    [2259, 117],
    [2259, 180],
    [2259, 190],
    [2259, 223],
    [2260, 23],
    [2260, 27],
    [2260, 56],
    [2260, 61],
    [2260, 127],
    [2260, 221],
    [2261, 23],
    [2261, 47],
    [2261, 48],
    [2261, 50],
    [2261, 161],
    [2262, 195],
    [2263, 107],
    [2263, 138],
    [2263, 141],
    [2263, 184],
    [2264, 1],
    [2264, 109],
    [2264, 131],
    [2264, 158],
    [2265, -8],
    [2265, 80],
    [2265, 138],
    [2265, 154],
    [2266, 184],
    [2267, 63],
    [2267, 142],
    [2267, 184],
    [2268, 66],
    [2268, 110],
    [2268, 142],
    [2268, 144],
    [2268, 163],
    [2268, 175],
    [2268, 181],
    [2268, 200],
    [2269, -20],
    [2269, 52],
    [2269, 56],
    [2269, 183],
    [2270, 51],
    [2270, 145],
    [2270, 146],
    [2270, 209],
    [2271, 29],
    [2271, 146],
    [2271, 147],
    [2271, 178],
    [2272, 68],
    [2272, 84],
    [2272, 146],
    [2272, 148],
    [2273, 50],
    [2273, 150],
    [2273, 159],
    [2273, 180],
    [2273, 186],
    [2273, 194],
    [2273, 200],
    [2274, 46],
    [2274, 79],
    [2274, 161],
    [2274, 205],
    [2275, 32],
    [2275, 109],
    [2275, 166],
    [2275, 187],
    [2275, 191],
    [2275, 202],
    [2275, 210],
    [2275, 217],
    [2276, 78],
    [2276, 163],
    [2276, 206],
    [2277, 33],
    [2277, 162],
    [2277, 184],
    [2277, 189],
    [2277, 204],
    [2278, -19],
    [2278, 138],
    [2278, 143],
    [2278, 179],
    [2278, 191],
    [2278, 198],
    [2279, -25],
    [2279, 157],
    [2279, 159],
    [2279, 160],
    [2279, 194],
    [2279, 197],
    [2279, 198],
    [2279, 225],
    [2280, -11],
    [2280, 9],
    [2280, 90],
    [2280, 142],
    [2281, -34],
    [2281, 3],
    [2281, 6],
    [2281, 145],
    [2281, 171],
    [2281, 172],
    [2281, 197],
    [2282, -33],
    [2282, 4],
    [2282, 5],
    [2282, 6],
    [2282, 7],
    [2282, 33],
    [2282, 144],
    [2283, -8],
    [2283, 4],
    [2283, 6],
    [2283, 153],
    [2283, 170],
    [2283, 212],
    [2283, 213],
    [2284, -11],
    [2284, -10],
    [2284, -1],
    [2284, 1],
    [2284, 5],
    [2284, 6],
    [2284, 7],
    [2284, 93],
    [2284, 159],
    [2284, 162],
    [2284, 165],
    [2284, 197],
    [2284, 213],
    [2285, -34],
    [2285, 45],
    [2285, 100],
    [2285, 110],
    [2285, 161],
    [2285, 162],
    [2285, 163],
    [2285, 193],
    [2286, -20],
    [2286, -16],
    [2286, 102],
    [2286, 162],
    [2286, 163],
    [2287, -25],
    [2287, -21],
    [2287, 13],
    [2287, 107],
    [2287, 136],
    [2287, 161],
    [2287, 162],
    [2287, 164],
    [2287, 166],
    [2287, 174],
    [2287, 198],
    [2288, 43],
    [2288, 101],
    [2288, 104],
    [2288, 105],
    [2288, 159],
    [2288, 160],
    [2288, 161],
    [2288, 162],
    [2288, 163],
    [2288, 164],
    [2288, 208],
    [2288, 209],
    [2288, 213],
    [2289, -23],
    [2289, 103],
    [2289, 104],
    [2289, 105],
    [2289, 159],
    [2289, 161],
    [2289, 162],
    [2289, 166],
    [2289, 182],
    [2289, 198],
    [2290, -4],
    [2290, 41],
    [2290, 102],
    [2290, 104],
    [2290, 160],
    [2290, 164],
    [2290, 192],
    [2291, -36],
    [2291, 2],
    [2291, 40],
    [2291, 41],
    [2291, 42],
    [2291, 43],
    [2291, 115],
    [2291, 154],
    [2291, 164],
    [2292, -39],
    [2292, 42],
    [2292, 43],
    [2293, 6],
    [2293, 17],
    [2293, 43],
    [2293, 72],
    [2293, 98],
    [2293, 104],
    [2293, 151],
    [2293, 157],
    [2293, 172],
    [2293, 177],
    [2293, 192],
    [2293, 230],
    [2294, 19],
    [2294, 119],
    [2294, 121],
    [2294, 150],
    [2294, 164],
    [2294, 172],
    [2294, 179],
    [2294, 229],
    [2295, 42],
    [2295, 103],
    [2295, 146],
    [2295, 204],
    [2295, 229],
    [2296, -32],
    [2296, -18],
    [2296, 170],
    [2296, 203],
    [2296, 204],
    [2296, 225],
    [2297, 18],
    [2297, 105],
    [2297, 111],
    [2298, -31],
    [2298, 39],
    [2298, 60],
    [2298, 167],
    [2298, 178],
    [2298, 204],
    [2299, 7],
    [2299, 39],
    [2299, 66],
    [2299, 73],
    [2299, 106],
    [2299, 221],
    [2300, 45],
    [2300, 158],
    [2300, 173],
    [2300, 200],
    [2301, 71],
    [2302, 103],
    [2302, 162],
    [2302, 196],
    [2302, 203],
    [2302, 208],
    [2303, -31],
    [2303, 23],
    [2303, 37],
    [2303, 136],
    [2303, 169],
    [2303, 203],
    [2303, 215],
    [2304, 115],
    [2304, 181],
    [2304, 197],
    [2304, 203],
    [2304, 216],
    [2305, 28],
    [2305, 136],
    [2305, 158],
    [2305, 177],
    [2306, -37],
    [2306, -35],
    [2306, -8],
    [2306, 35],
    [2306, 65],
    [2306, 131],
    [2307, -24],
    [2307, 114],
    [2307, 137],
    [2307, 165],
    [2307, 188],
    [2307, 203],
    [2307, 205],
    [2308, -44],
    [2308, -42],
    [2308, -38],
    [2308, 9],
    [2308, 32],
    [2308, 38],
    [2308, 114],
    [2308, 166],
    [2308, 187],
    [2308, 208],
    [2308, 212],
    [2309, -45],
    [2309, -38],
    [2309, 32],
    [2309, 65],
    [2309, 113],
    [2309, 115],
    [2309, 116],
    [2309, 170],
    [2309, 197],
    [2309, 208],
    [2310, -50],
    [2310, -48],
    [2310, -35],
    [2310, -22],
    [2310, -2],
    [2310, 42],
    [2310, 43],
    [2310, 45],
    [2310, 59],
    [2310, 65],
    [2310, 208],
    [2311, 47],
    [2311, 57],
    [2311, 64],
    [2311, 82],
    [2311, 177],
    [2312, -18],
    [2312, 123],
    [2312, 135],
    [2313, -16],
    [2313, 116],
    [2313, 167],
    [2313, 211],
    [2314, 80],
    [2315, -2],
    [2315, 202],
    [2315, 209],
    [2316, -33],
    [2316, -17],
    [2316, -14],
    [2316, 87],
    [2316, 96],
    [2316, 111],
    [2316, 177],
    [2316, 211],
    [2316, 212],
    [2317, -15],
    [2317, -13],
    [2317, 26],
    [2317, 88],
    [2317, 110],
    [2317, 161],
    [2317, 214],
    [2317, 215],
    [2318, -47],
    [2318, -8],
    [2318, 93],
    [2318, 171],
    [2318, 215],
    [2318, 216],
    [2319, -12],
    [2319, 110],
    [2319, 162],
    [2319, 194],
    [2319, 216],
    [2320, 13],
    [2320, 24],
    [2321, -28],
    [2321, -7],
    [2321, -6],
    [2321, 28],
    [2321, 49],
    [2321, 112],
    [2321, 148],
    [2321, 164],
    [2323, 9],
    [2323, 163],
    [2324, -56],
    [2324, -36],
    [2324, -30],
    [2324, 156],
    [2324, 202],
    [2326, -48],
    [2327, 14],
    [2327, 135],
    [2328, 9],
    [2328, 11],
    [2328, 13],
    [2328, 16],
    [2328, 165],
    [2328, 168],
    [2328, 200],
    [2329, -10],
    [2329, 67],
    [2329, 87],
    [2329, 181],
    [2329, 186],
    [2330, -59],
    [2330, -7],
    [2330, 11],
    [2330, 50],
    [2330, 116],
    [2330, 182],
    [2331, -45],
    [2331, -35],
    [2331, 12],
    [2331, 125],
    [2332, 8],
    [2332, 12],
    [2332, 42],
    [2332, 183],
    [2333, -61],
    [2333, -20],
    [2333, -3],
    [2333, 2],
    [2333, 9],
    [2334, -49],
    [2334, 162],
    [2335, -65],
    [2335, -47],
    [2335, -45],
    [2335, 62],
    [2335, 173],
    [2336, -56],
    [2336, -8],
    [2336, 14],
    [2336, 186],
    [2337, 79],
    [2337, 84],
    [2337, 154],
    [2337, 161],
    [2337, 164],
    [2337, 197],
    [2338, -48],
    [2338, -37],
    [2338, 7],
    [2338, 54],
    [2338, 55],
    [2339, 56],
    [2339, 163],
    [2340, -48],
    [2340, 53],
    [2340, 56],
    [2340, 186],
    [2341, -66],
    [2341, -63],
    [2341, -59],
    [2341, -14],
    [2341, 11],
    [2341, 15],
    [2341, 17],
    [2341, 22],
    [2341, 54],
    [2341, 58],
    [2341, 61],
    [2341, 101],
    [2341, 146],
    [2341, 202],
    [2341, 212],
    [2342, -23],
    [2342, 17],
    [2342, 114],
    [2343, -60],
    [2343, 60],
    [2343, 142],
    [2343, 189],
    [2343, 191],
    [2344, -65],
    [2344, -12],
    [2344, 49],
    [2344, 147],
    [2344, 191],
    [2345, -33],
    [2345, 5],
    [2345, 55],
    [2345, 63],
    [2345, 105],
    [2345, 162],
    [2346, -63],
    [2346, -42],
    [2346, -7],
    [2346, 43],
    [2346, 210],
    [2347, -67],
    [2347, 104],
    [2347, 105],
    [2347, 156],
    [2347, 207],
    [2348, -7],
    [2348, 105],
    [2349, -27],
    [2349, 39],
    [2349, 69],
    [2349, 109],
    [2349, 157],
    [2349, 177],
    [2349, 211],
    [2349, 215],
    [2350, -61],
    [2350, -38],
    [2350, -7],
    [2350, 72],
    [2350, 84],
    [2350, 103],
    [2350, 104],
    [2350, 106],
    [2350, 144],
    [2350, 160],
    [2351, -7],
    [2351, 91],
    [2352, 37],
    [2352, 105],
    [2353, -46],
    [2353, -31],
    [2353, -30],
    [2353, 80],
    [2353, 124],
    [2353, 222],
    [2354, -30],
    [2354, -29],
    [2354, 76],
    [2354, 77],
    [2354, 80],
    [2354, 159],
    [2354, 181],
    [2354, 182],
    [2355, -60],
    [2355, -49],
    [2355, 62],
    [2355, 79],
    [2355, 80],
    [2355, 81],
    [2355, 201],
    [2356, -66],
    [2356, -43],
    [2356, -28],
    [2356, 20],
    [2356, 87],
    [2356, 108],
    [2356, 219],
    [2356, 220],
    [2357, 53],
    [2357, 150],
    [2357, 209],
    [2357, 213],
    [2357, 219],
    [2358, -51],
    [2358, -46],
    [2358, -44],
    [2358, -25],
    [2358, -22],
    [2358, -6],
    [2358, 22],
    [2358, 192],
    [2359, -54],
    [2359, -50],
    [2359, 72],
    [2359, 183],
    [2360, -54],
    [2360, -52],
    [2360, -4],
    [2360, 10],
    [2360, 77],
    [2360, 103],
    [2360, 206],
    [2361, -70],
    [2361, -55],
    [2361, -52],
    [2361, 70],
    [2361, 175],
    [2361, 199],
    [2361, 200],
    [2362, -51],
    [2362, -30],
    [2362, 3],
    [2362, 15],
    [2362, 68],
    [2362, 170],
    [2363, -76],
    [2363, -72],
    [2363, -56],
    [2363, -54],
    [2363, -51],
    [2363, -50],
    [2363, -49],
    [2363, 200],
    [2364, -77],
    [2364, -51],
    [2364, -22],
    [2364, 73],
    [2364, 167],
    [2364, 227],
    [2365, -73],
    [2365, -58],
    [2365, 12],
    [2365, 27],
    [2365, 74],
    [2365, 93],
    [2365, 150],
    [2365, 167],
    [2365, 168],
    [2365, 206],
    [2366, -73],
    [2366, -49],
    [2366, -13],
    [2366, 23],
    [2366, 36],
    [2366, 57],
    [2366, 167],
    [2366, 168],
    [2366, 169],
    [2366, 191],
    [2366, 226],
    [2367, -55],
    [2367, -2],
    [2367, 112],
    [2367, 165],
    [2367, 166],
    [2367, 168],
    [2367, 169],
    [2367, 212],
    [2368, -42],
    [2368, 22],
    [2368, 24],
    [2368, 25],
    [2368, 81],
    [2369, -25],
    [2369, 22],
    [2369, 26],
    [2369, 69],
    [2369, 168],
    [2370, -55],
    [2370, -36],
    [2370, 24],
    [2370, 25],
    [2370, 29],
    [2370, 30],
    [2370, 216],
    [2371, -43],
    [2371, -6],
    [2371, 24],
    [2371, 43],
    [2371, 68],
    [2372, -69],
    [2372, -61],
    [2372, -24],
    [2372, -18],
    [2372, -17],
    [2372, 20],
    [2372, 170],
    [2372, 196],
    [2372, 228],
    [2373, -69],
    [2373, -17],
    [2373, 37],
    [2373, 203],
    [2373, 223],
    [2373, 228],
    [2374, -18],
    [2374, -17],
    [2374, 26],
    [2374, 228],
    [2375, -25],
    [2375, -20],
    [2375, -19],
    [2375, 26],
    [2375, 227],
    [2375, 228],
    [2376, 128],
    [2376, 228],
    [2377, -81],
    [2377, -16],
    [2377, -14],
    [2377, 18],
    [2377, 28],
    [2377, 43],
    [2377, 47],
    [2377, 217],
    [2377, 226],
    [2377, 228],
    [2378, -80],
    [2378, -3],
    [2378, 18],
    [2378, 20],
    [2378, 32],
    [2378, 43],
    [2378, 44],
    [2378, 174],
    [2378, 209],
    [2378, 231],
    [2379, 9],
    [2379, 126],
    [2380, -20],
    [2380, 25],
    [2380, 45],
    [2380, 227],
    [2380, 229],
    [2380, 246],
    [2380, 251],
    [2381, -26],
    [2381, 22],
    [2381, 45],
    [2381, 206],
    [2381, 207],
    [2381, 228],
    [2381, 229],
    [2381, 240],
    [2382, -89],
    [2382, -66],
    [2382, 48],
    [2382, 86],
    [2382, 116],
    [2382, 173],
    [2382, 205],
    [2382, 227],
    [2382, 228],
    [2382, 229],
    [2383, -100],
    [2383, -95],
    [2383, -93],
    [2383, -91],
    [2383, 176],
    [2383, 212],
    [2383, 213],
    [2383, 228],
    [2384, -98],
    [2384, -49],
    [2384, 32],
    [2384, 44],
    [2384, 65],
    [2384, 204],
    [2384, 231],
    [2385, -70],
    [2385, 198],
    [2385, 221],
    [2386, -107],
    [2386, -4],
    [2386, 0],
    [2386, 34],
    [2386, 210],
    [2386, 217],
    [2386, 228],
    [2386, 229],
    [2386, 234],
    [2387, -81],
    [2387, 35],
    [2387, 51],
    [2387, 67],
    [2387, 120],
    [2387, 124],
    [2387, 173],
    [2387, 237],
    [2387, 243],
    [2387, 245],
    [2388, -108],
    [2388, -65],
    [2388, 52],
    [2388, 244],
    [2388, 245],
    [2389, -115],
    [2389, -113],
    [2389, -109],
    [2389, -108],
    [2389, -24],
    [2389, 34],
    [2389, 44],
    [2389, 188],
    [2389, 241],
    [2389, 245],
    [2390, -111],
    [2390, -9],
    [2390, 11],
    [2390, 36],
    [2390, 81],
    [2390, 121],
    [2390, 213],
    [2390, 237],
    [2390, 244],
    [2391, 2],
    [2391, 120],
    [2391, 183],
    [2391, 213],
    [2392, -111],
    [2392, -57],
    [2392, -22],
    [2392, 121],
    [2392, 132],
    [2392, 245],
    [2393, -119],
    [2393, -94],
    [2393, -1],
    [2393, 58],
    [2393, 65],
    [2393, 66],
    [2393, 178],
    [2393, 179],
    [2394, -120],
    [2394, -111],
    [2394, -83],
    [2394, 61],
    [2394, 64],
    [2394, 91],
    [2394, 120],
    [2394, 213],
    [2394, 225],
    [2394, 228],
    [2394, 230],
    [2395, -133],
    [2395, -84],
    [2395, -56],
    [2395, 50],
    [2395, 62],
    [2395, 63],
    [2395, 64],
    [2395, 76],
    [2395, 224],
    [2396, 2],
    [2396, 28],
    [2396, 61],
    [2396, 63],
    [2396, 64],
    [2396, 65],
    [2396, 124],
    [2396, 134],
    [2397, -87],
    [2397, -84],
    [2397, -77],
    [2397, -65],
    [2397, 63],
    [2397, 64],
    [2397, 79],
    [2397, 108],
    [2398, -133],
    [2398, -132],
    [2398, -86],
    [2398, -70],
    [2398, -23],
    [2398, -19],
    [2398, 6],
    [2398, 7],
    [2398, 92],
    [2398, 110],
    [2398, 115],
    [2398, 124],
    [2398, 127],
    [2398, 176],
    [2398, 188],
    [2398, 244],
    [2399, -138],
    [2399, 7],
    [2399, 8],
    [2399, 91],
    [2399, 92],
    [2399, 124],
    [2399, 246],
    [2400, -28],
    [2400, 6],
    [2400, 12],
    [2400, 63],
    [2400, 91],
    [2401, -99],
    [2401, -93],
    [2401, -60],
    [2401, -56],
    [2401, -53],
    [2401, -40],
    [2401, -24],
    [2401, -3],
    [2401, 1],
    [2401, 6],
    [2401, 63],
    [2401, 66],
    [2401, 70],
    [2401, 110],
    [2402, -136],
    [2402, -96],
    [2402, -65],
    [2402, -54],
    [2402, -23],
    [2402, 6],
    [2402, 62],
    [2402, 180],
    [2403, -60],
    [2403, -57],
    [2403, -43],
    [2403, -29],
    [2403, -26],
    [2403, -25],
    [2403, -15],
    [2403, 8],
    [2403, 41],
    [2403, 48],
    [2403, 127],
    [2403, 169],
    [2403, 220],
    [2403, 244],
    [2404, -118],
    [2404, -64],
    [2404, -57],
    [2404, -32],
    [2404, 18],
    [2404, 92],
    [2404, 110],
    [2404, 226],
    [2404, 244],
    [2404, 245],
    [2405, -75],
    [2405, -67],
    [2405, -59],
    [2405, -58],
    [2405, -54],
    [2405, -50],
    [2405, -48],
    [2405, 63],
    [2405, 92],
    [2405, 146],
    [2405, 169],
    [2405, 171],
    [2405, 172],
    [2406, 12],
    [2406, 171],
    [2407, -57],
    [2407, -10],
    [2407, 45],
    [2407, 54],
    [2407, 57],
    [2407, 62],
    [2407, 154],
    [2407, 168],
    [2407, 246],
    [2408, -3],
    [2408, 71],
    [2408, 92],
    [2408, 110],
    [2408, 141],
    [2408, 144],
    [2408, 190],
    [2408, 216],
    [2408, 219],
    [2408, 226],
    [2409, -39],
    [2409, 19],
    [2409, 46],
    [2409, 91],
    [2409, 106],
    [2409, 109],
    [2409, 112],
    [2409, 113],
    [2409, 115],
    [2409, 191],
    [2409, 217],
    [2409, 237],
    [2410, -58],
    [2410, 28],
    [2410, 47],
    [2410, 65],
    [2410, 75],
    [2410, 116],
    [2410, 133],
    [2410, 159],
    [2410, 202],
    [2411, -133],
    [2411, 109],
    [2411, 217],
    [2411, 247],
    [2412, -111],
    [2412, -1],
    [2412, 40],
    [2412, 78],
    [2412, 123],
    [2412, 134],
    [2412, 148],
    [2412, 157],
    [2412, 249],
    [2413, 31],
    [2413, 62],
    [2413, 90],
    [2413, 136],
    [2413, 154],
    [2413, 239],
    [2413, 244],
    [2413, 248],
    [2413, 249],
    [2414, -38],
    [2414, 80],
    [2414, 107],
    [2414, 130],
    [2414, 132],
    [2414, 136],
    [2414, 170],
    [2414, 183],
    [2414, 231],
    [2414, 238],
    [2415, -31],
    [2415, -21],
    [2415, 84],
    [2416, -105],
    [2416, -37],
    [2416, 137],
    [2417, -83],
    [2417, -41],
    [2417, 25],
    [2417, 136],
    [2417, 140],
    [2417, 210],
    [2417, 230],
    [2417, 251],
    [2418, 14],
    [2418, 19],
    [2418, 22],
    [2418, 72],
    [2418, 100],
    [2418, 137],
    [2418, 139],
    [2419, -143],
    [2419, -83],
    [2419, -79],
    [2419, 3],
    [2419, 30],
    [2419, 231],
    [2419, 251],
    [2420, -147],
    [2420, -142],
    [2420, -88],
    [2420, 6],
    [2420, 46],
    [2420, 90],
    [2420, 146],
    [2420, 254],
    [2421, -95],
    [2421, -77],
    [2421, -48],
    [2421, -10],
    [2421, 0],
    [2421, 49],
    [2421, 51],
    [2421, 71],
    [2421, 89],
    [2421, 255],
    [2422, -94],
    [2422, -84],
    [2422, -83],
    [2422, 65],
    [2423, -146],
    [2423, -88],
    [2423, -69],
    [2423, 18],
    [2423, 43],
    [2423, 48],
    [2423, 63],
    [2423, 73],
    [2423, 87],
    [2423, 130],
    [2423, 165],
    [2423, 208],
    [2423, 257],
    [2424, -58],
    [2424, -6],
    [2424, 39],
    [2424, 49],
    [2424, 73],
    [2424, 84],
    [2424, 115],
    [2424, 116],
    [2424, 170],
    [2425, -143],
    [2425, -98],
    [2425, -92],
    [2425, -87],
    [2425, 12],
    [2425, 49],
    [2425, 56],
    [2425, 57],
    [2425, 61],
    [2425, 129],
    [2425, 130],
    [2425, 138],
    [2425, 252],
    [2426, -135],
    [2426, -93],
    [2426, -92],
    [2426, -91],
    [2426, -84],
    [2426, -81],
    [2426, -68],
    [2426, 18],
    [2426, 44],
    [2426, 124],
    [2426, 160],
    [2426, 255],
    [2427, -114],
    [2427, -64],
    [2427, -22],
    [2427, -16],
    [2427, 52],
    [2427, 74],
    [2427, 79],
    [2427, 92],
    [2428, -129],
    [2428, -106],
    [2428, -104],
    [2428, -64],
    [2428, -24],
    [2428, 6],
    [2428, 19],
    [2428, 72],
    [2428, 257],
    [2429, -125],
    [2429, -102],
    [2429, -64],
    [2429, -38],
    [2429, -14],
    [2429, -12],
    [2429, -10],
    [2429, 6],
    [2429, 88],
    [2429, 99],
    [2429, 258],
    [2429, 259],
    [2429, 260],
    [2430, -70],
    [2430, -47],
    [2430, 78],
    [2430, 83],
    [2430, 168],
    [2430, 211],
    [2430, 258],
    [2431, -126],
    [2431, -109],
    [2431, -67],
    [2431, -13],
    [2431, 4],
    [2431, 20],
    [2431, 75],
    [2431, 79],
    [2431, 82],
    [2431, 85],
    [2431, 166],
    [2432, -100],
    [2432, -63],
    [2432, 16],
    [2432, 43],
    [2432, 62],
    [2432, 72],
    [2432, 74],
    [2432, 76],
    [2432, 78],
    [2432, 80],
    [2432, 81],
    [2432, 83],
    [2432, 84],
    [2432, 162],
    [2432, 165],
    [2432, 166],
    [2432, 169],
    [2432, 206],
    [2432, 208],
    [2432, 230],
    [2432, 258],
    [2432, 260],
    [2433, -46],
    [2433, -17],
    [2433, 25],
    [2433, 78],
    [2433, 139],
    [2433, 197],
    [2434, -19],
    [2434, -17],
    [2434, 22],
    [2434, 27],
    [2434, 66],
    [2434, 72],
    [2434, 73],
    [2434, 76],
    [2434, 78],
    [2434, 83],
    [2434, 158],
    [2434, 205],
    [2434, 206],
    [2434, 207],
    [2434, 259],
    [2435, -45],
    [2435, 11],
    [2435, 21],
    [2435, 64],
    [2435, 73],
    [2435, 77],
    [2435, 81],
    [2435, 106],
    [2435, 155],
    [2435, 178],
    [2435, 181],
    [2435, 204],
    [2435, 205],
    [2435, 206],
    [2435, 207],
    [2435, 232],
    [2436, -47],
    [2436, 22],
    [2436, 29],
    [2436, 63],
    [2436, 76],
    [2436, 77],
    [2436, 79],
    [2436, 83],
    [2436, 85],
    [2436, 87],
    [2436, 90],
    [2436, 118],
    [2436, 119],
    [2436, 128],
    [2436, 205],
    [2436, 206],
    [2437, -43],
    [2437, -8],
    [2437, -1],
    [2437, 9],
    [2437, 28],
    [2437, 31],
    [2437, 32],
    [2437, 33],
    [2437, 43],
    [2437, 64],
    [2437, 67],
    [2437, 68],
    [2437, 74],
    [2437, 75],
    [2437, 82],
    [2437, 84],
    [2437, 91],
    [2437, 120],
    [2437, 130],
    [2437, 146],
    [2437, 153],
    [2437, 171],
    [2437, 252],
    [2438, -103],
    [2438, -23],
    [2438, 2],
    [2438, 23],
    [2438, 41],
    [2438, 48],
    [2438, 49],
    [2438, 64],
    [2438, 65],
    [2438, 72],
    [2438, 73],
    [2438, 74],
    [2438, 81],
    [2438, 83],
    [2438, 87],
    [2438, 153],
    [2438, 172],
    [2438, 239],
    [2439, 11],
    [2439, 19],
    [2439, 22],
    [2439, 39],
    [2439, 54],
    [2439, 66],
    [2439, 67],
    [2439, 68],
    [2439, 72],
    [2439, 73],
    [2439, 74],
    [2439, 78],
    [2439, 80],
    [2439, 81],
    [2439, 82],
    [2439, 86],
    [2439, 87],
    [2439, 102],
    [2439, 173],
    [2439, 252],
    [2440, -51],
    [2440, -19],
    [2440, -8],
    [2440, 0],
    [2440, 14],
    [2440, 59],
    [2440, 69],
    [2440, 71],
    [2440, 72],
    [2440, 73],
    [2440, 75],
    [2440, 77],
    [2440, 78],
    [2440, 81],
    [2440, 82],
    [2440, 95],
    [2441, -27],
    [2441, -20],
    [2441, 11],
    [2441, 34],
    [2441, 65],
    [2441, 69],
    [2441, 71],
    [2441, 72],
    [2441, 74],
    [2441, 75],
    [2441, 77],
    [2441, 78],
    [2441, 79],
    [2441, 81],
    [2441, 82],
    [2441, 83],
    [2441, 84],
    [2441, 259],
    [2442, -50],
    [2442, -49],
    [2442, -33],
    [2442, -26],
    [2442, 51],
    [2442, 70],
    [2442, 72],
    [2442, 74],
    [2442, 75],
    [2442, 76],
    [2442, 77],
    [2442, 79],
    [2442, 80],
    [2442, 81],
    [2442, 88],
    [2442, 94],
    [2442, 202],
    [2442, 240],
    [2442, 264],
    [2443, 39],
    [2443, 70],
    [2443, 71],
    [2443, 72],
    [2443, 74],
    [2443, 76],
    [2443, 78],
    [2443, 79],
    [2443, 80],
    [2443, 85],
    [2443, 203],
    [2443, 249],
    [2443, 257],
    [2444, -8],
    [2444, 31],
    [2444, 70],
    [2444, 74],
    [2444, 75],
    [2444, 76],
    [2444, 78],
    [2444, 79],
    [2444, 81],
    [2444, 82],
    [2444, 83],
    [2444, 84],
    [2444, 89],
    [2445, -50],
    [2445, 67],
    [2445, 69],
    [2445, 71],
    [2445, 75],
    [2445, 76],
    [2445, 77],
    [2445, 79],
    [2445, 80],
    [2445, 88],
    [2445, 248],
    [2446, -36],
    [2446, -16],
    [2446, 68],
    [2446, 69],
    [2446, 74],
    [2446, 76],
    [2446, 78],
    [2446, 80],
    [2446, 81],
    [2446, 82],
    [2446, 147],
    [2446, 175],
    [2446, 201],
    [2446, 204],
    [2446, 237],
    [2447, 37],
    [2447, 68],
    [2447, 69],
    [2447, 71],
    [2447, 75],
    [2447, 79],
    [2447, 80],
    [2447, 81],
    [2447, 83],
    [2447, 86],
    [2447, 92],
    [2447, 145],
    [2447, 146],
    [2448, -34],
    [2448, -8],
    [2448, 31],
    [2448, 75],
    [2448, 76],
    [2448, 77],
    [2448, 78],
    [2448, 79],
    [2448, 80],
    [2448, 82],
    [2448, 84],
    [2448, 85],
    [2448, 90],
    [2448, 95],
    [2448, 99],
    [2448, 144],
    [2448, 146],
    [2448, 210],
    [2448, 218],
    [2448, 254],
    [2449, 57],
    [2449, 62],
    [2449, 64],
    [2449, 70],
    [2449, 74],
    [2449, 78],
    [2449, 79],
    [2449, 82],
    [2449, 84],
    [2449, 211],
    [2449, 225],
    [2449, 226],
    [2450, -2],
    [2450, 40],
    [2450, 57],
    [2450, 64],
    [2450, 66],
    [2450, 69],
    [2450, 73],
    [2450, 79],
    [2450, 80],
    [2450, 83],
    [2450, 130],
    [2450, 216],
    [2451, -25],
    [2451, 37],
    [2451, 39],
    [2451, 44],
    [2451, 54],
    [2451, 68],
    [2451, 69],
    [2451, 70],
    [2451, 72],
    [2451, 80],
    [2451, 207],
    [2452, -22],
    [2452, 37],
    [2452, 67],
    [2452, 68],
    [2452, 69],
    [2452, 70],
    [2452, 71],
    [2452, 78],
    [2452, 83],
    [2452, 84],
    [2452, 108],
    [2452, 181],
    [2453, -48],
    [2453, 19],
    [2453, 34],
    [2453, 39],
    [2453, 65],
    [2453, 67],
    [2453, 69],
    [2453, 71],
    [2453, 76],
    [2453, 79],
    [2453, 206],
    [2453, 219],
    [2453, 244],
    [2454, 19],
    [2454, 40],
    [2454, 75],
    [2454, 81],
    [2454, 84],
    [2454, 91],
    [2454, 92],
    [2454, 132],
    [2454, 218],
    [2454, 246],
    [2455, -50],
    [2455, 10],
    [2455, 21],
    [2455, 31],
    [2455, 91],
    [2455, 174],
    [2455, 204],
    [2455, 205],
    [2455, 206],
    [2455, 217],
    [2455, 244],
    [2456, -36],
    [2456, 50],
    [2456, 84],
    [2456, 87],
    [2456, 95],
    [2456, 102],
    [2456, 205],
    [2456, 207],
    [2456, 209],
    [2456, 210],
    [2456, 223],
    [2456, 224],
    [2456, 225],
    [2457, 12],
    [2457, 14],
    [2457, 22],
    [2457, 39],
    [2457, 75],
    [2457, 85],
    [2457, 89],
    [2457, 137],
    [2457, 179],
    [2457, 181],
    [2457, 235],
    [2458, 24],
    [2458, 59],
    [2458, 63],
    [2458, 75],
    [2458, 104],
    [2458, 134],
    [2458, 140],
    [2458, 206],
    [2458, 228],
    [2458, 229],
    [2459, -17],
    [2459, -11],
    [2459, -10],
    [2459, 8],
    [2459, 42],
    [2459, 43],
    [2459, 74],
    [2459, 97],
    [2460, -14],
    [2460, -11],
    [2460, 26],
    [2460, 39],
    [2460, 62],
    [2460, 76],
    [2460, 82],
    [2460, 86],
    [2460, 88],
    [2460, 95],
    [2460, 205],
    [2461, 25],
    [2461, 32],
    [2461, 53],
    [2461, 55],
    [2461, 68],
    [2461, 74],
    [2461, 78],
    [2461, 80],
    [2461, 81],
    [2461, 85],
    [2461, 87],
    [2461, 88],
    [2461, 92],
    [2461, 112],
    [2461, 134],
    [2461, 188],
    [2461, 205],
    [2462, -6],
    [2462, 52],
    [2462, 71],
    [2462, 83],
    [2462, 88],
    [2462, 95],
    [2462, 100],
    [2462, 101],
    [2462, 133],
    [2462, 135],
    [2462, 202],
    [2463, -13],
    [2463, -4],
    [2463, 57],
    [2463, 78],
    [2463, 82],
    [2463, 83],
    [2463, 86],
    [2463, 133],
    [2463, 136],
    [2464, 62],
    [2464, 73],
    [2464, 96],
    [2464, 128],
    [2464, 133],
    [2464, 135],
    [2464, 141],
    [2464, 206],
    [2465, 37],
    [2465, 82],
    [2465, 86],
    [2465, 87],
    [2466, -37],
    [2466, 4],
    [2466, 59],
    [2466, 88],
    [2466, 91],
    [2466, 121],
    [2466, 122],
    [2466, 133],
    [2466, 203],
    [2466, 205],
    [2467, 31],
    [2467, 46],
    [2467, 70],
    [2467, 73],
    [2467, 87],
    [2467, 205],
    [2467, 206],
    [2468, 15],
    [2468, 36],
    [2468, 59],
    [2468, 73],
    [2468, 75],
    [2468, 93],
    [2468, 111],
    [2468, 112],
    [2468, 116],
    [2468, 140],
    [2468, 195],
    [2468, 204],
    [2469, 42],
    [2469, 87],
    [2469, 93],
    [2469, 153],
    [2469, 188],
    [2469, 203],
    [2470, 17],
    [2470, 71],
    [2470, 74],
    [2470, 89],
    [2470, 93],
    [2470, 95],
    [2470, 99],
    [2470, 100],
    [2470, 101],
    [2470, 102],
    [2470, 106],
    [2470, 130],
    [2470, 146],
    [2470, 157],
    [2470, 209],
    [2471, 35],
    [2471, 36],
    [2471, 57],
    [2471, 65],
    [2471, 69],
    [2471, 81],
    [2471, 95],
    [2472, -57],
    [2472, 38],
    [2472, 40],
    [2472, 68],
    [2472, 69],
    [2472, 88],
    [2472, 94],
    [2472, 95],
    [2472, 198],
    [2473, -45],
    [2473, 32],
    [2473, 35],
    [2473, 38],
    [2473, 67],
    [2473, 70],
    [2473, 74],
    [2473, 112],
    [2473, 199],
    [2474, 5],
    [2474, 34],
    [2474, 68],
    [2474, 69],
    [2474, 72],
    [2474, 92],
    [2475, 25],
    [2475, 56],
    [2475, 66],
    [2475, 67],
    [2475, 77],
    [2476, 3],
    [2476, 24],
    [2476, 33],
    [2476, 62],
    [2476, 66],
    [2476, 97],
    [2476, 125],
    [2476, 145],
    [2477, 12],
    [2477, 62],
    [2477, 89],
    [2477, 91],
    [2477, 98],
    [2477, 104],
    [2477, 121],
    [2477, 146],
    [2477, 147],
    [2478, -59],
    [2478, -52],
    [2478, 15],
    [2478, 64],
    [2478, 86],
    [2478, 121],
    [2479, -57],
    [2479, 24],
    [2479, 67],
    [2479, 71],
    [2479, 73],
    [2480, 65],
    [2480, 77],
    [2480, 91],
    [2480, 99],
    [2480, 100],
    [2480, 104],
    [2480, 117],
    [2480, 141],
    [2481, -54],
    [2481, 71],
    [2481, 115],
    [2482, -55],
    [2482, -49],
    [2482, 27],
    [2482, 79],
    [2482, 92],
    [2483, -55],
    [2483, 60],
    [2483, 90],
    [2483, 95],
    [2483, 97],
    [2483, 163],
    [2484, 64],
    [2484, 102],
    [2484, 124],
    [2484, 170],
    [2485, 109],
    [2485, 164],
    [2486, 148],
    [2487, 26],
    [2487, 89],
    [2487, 157],
    [2488, 29],
    [2488, 48],
    [2488, 73],
    [2488, 94],
    [2488, 168],
    [2489, 50],
    [2489, 58],
    [2489, 75],
    [2491, 129],
    [2491, 153],
    [2492, 109],
    [2492, 110],
    [2492, 116],
    [2493, 76],
    [2493, 81],
    [2493, 154],
    [2494, 76],
    [2494, 77],
    [2494, 78],
    [2494, 91],
    [2494, 146],
    [2495, 36],
    [2495, 37],
    [2495, 76],
    [2495, 77],
    [2495, 78],
    [2495, 83],
    [2495, 97],
    [2495, 130],
    [2495, 154],
    [2496, 36],
    [2496, 37],
    [2496, 76],
    [2496, 78],
    [2497, 95],
    [2497, 108],
    [2498, 65],
    [2498, 95],
    [2498, 96],
    [2499, 53],
    [2499, 56],
    [2499, 70],
    [2499, 80],
    [2499, 85],
    [2499, 131],
    [2500, 51],
    [2500, 100],
    [2501, 158],
    [2503, 77],
    [2503, 131],
    [2505, 117],
    [2506, 60],
    [2506, 105],
    [2507, 112],
    [2508, 58],
    [2508, 61],
    [2509, 82],
    [2509, 83],
    [2509, 132],
    [2511, 85],
    [2511, 87],
    [2511, 113],
    [2513, 55],
    [2513, 105],
    [2514, 93],
    [2514, 112],
    [2514, 131],
    [2515, 76],
    [2515, 93],
    [2515, 94],
    [2515, 128],
    [2515, 133],
    [2516, 58],
    [2516, 96],
    [2516, 104],
    [2516, 112],
    [2516, 120],
    [2517, 110],
    [2517, 118],
    [2518, 77],
    [2518, 102],
    [2518, 116],
    [2519, 62],
    [2519, 113],
    [2519, 116],
    [2520, 116],
    [2521, 80],
    [2521, 98],
    [2521, 101],
    [2521, 114],
    [2522, 86],
    [2522, 94],
    [2522, 95],
    [2523, 94],
    [2523, 96],
    [2523, 107],
    [2523, 108],
    [2525, 59],
    [2525, 91],
    [2526, 101],
    [2527, 87],
    [2528, 54],
    [2528, 102],
    [2529, 95],
    [2529, 103],
    [2530, 98],
    [2530, 100],
    [2530, 101],
    [2530, 102],
    [2530, 104],
    [2530, 106],
    [2530, 108],
    [2531, 101],
    [2531, 102],
    [2532, 98],
    [2532, 100],
    [2532, 101],
    [2532, 102],
    [2532, 103],
    [2533, 102],
    [2533, 103],
    [2533, 105],
    [2534, 59],
    [2534, 104],
    [2534, 107],
    [2535, 54],
    [2535, 106],
    [2536, 88],
    [2536, 92],
    [2536, 104],
    [2536, 106],
    [2537, 57],
    [2537, 62],
    [2537, 106],
    [2538, 81],
    [2538, 83],
    [2539, 103],
    [2543, 57],
    [2543, 58],
    [2547, 61],
    [2547, 63],
    [2548, 80],
    [2550, 76],
    [2551, 77],
    [2551, 78],
    [2551, 79],
    [2551, 80],
    [2552, 78],
    [2552, 81],
  ];
  function K1(e, t) {
    return Y1.filter(
      ([i, o]) => Math.abs(i * 0.02 - e) < 0.12 && Math.abs(o * 0.03 - t) < 0.2,
    )
      .map(([i, o]) => ({
        id: `official:${i}:${o}`,
        kind: "danger",
        lat: i * 0.02,
        lon: o * 0.03,
        heading: 0,
        radius: 2e3,
        expires: Number.MAX_SAFE_INTEGER,
        source: "official",
      }))
      .sort((i, o) => Fa(e, t, i.lat, i.lon) - Fa(e, t, o.lat, o.lon))
      .slice(0, 100);
  }
  var $r =
    '<svg viewBox="0 0 64 64" width="42" height="42" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path d="M8 43l5-12h37l7 12v13H7V43z" fill="#f2f5f9" stroke="#162e4b" stroke-width="2"/><path d="M15 33h33l5 11H10z" fill="#8bbadc"/><path d="M25 29h14v5H25z" fill="#dc4450"/><path d="M10 48h45v5H10z" fill="#2466ad"/><circle cx="14" cy="55" r="5" fill="#152739"/><circle cx="49" cy="55" r="5" fill="#152739"/><path d="M17 48v-9c0-8 30-8 30 0v9" fill="#2466ad" stroke="#162e4b" stroke-width="2"/><circle cx="32" cy="24" r="12" fill="#f4c396" stroke="#162e4b" stroke-width="2"/><path d="M18 18l3-9q11-7 22 0l3 9z" fill="#2466ad" stroke="#162e4b" stroke-width="2"/><path d="M18 18h28v4H18z" fill="#102e4e"/><path d="M30 11h4v6h-4z" fill="#ffe176"/><path d="M24 25h16l-2 5h-5l-1-2-1 2h-5z" fill="#182b3e"/><path d="M35 34h8v4h-8z" fill="#dadfe4" stroke="#243847"/><path d="M44 33l6-3m-6 8l7 1" stroke="#e4a531" stroke-width="2"/><path d="M3 52q-5-13 7-15 2-13 14-5 10-10 18 1 13-9 17 4 10 3 3 15z" fill="#38864a" stroke="#235c35" stroke-width="2"/><path d="M12 43q3-8 8-4m16 5q5-10 11-5" fill="none" stroke="#6fab64" stroke-width="3"/></svg>';
  var Zu = [
    { id: "works", label: "Travaux", symbol: "\u{1F6A7}" },
    { id: "traffic", label: "Bouchon", symbol: "\u{1F697}" },
    { id: "danger", label: "Radar", symbol: "\u26A0\uFE0F" },
  ];
  function ef(e, t, i) {
    let o = 0,
      l = { offset: 1 / 0, along: 0 },
      s = Math.PI / 180,
      f = 6371e3 * s,
      c = Math.cos(e * s);
    for (let g = 1; g < i.length; g++) {
      let y = i[g - 1],
        p = i[g],
        _ = (p[1] - y[1]) * c * f,
        v = (p[0] - y[0]) * f,
        x = (y[1] - t) * c * f,
        B = (y[0] - e) * f,
        P = Math.hypot(_, v);
      if (!P) continue;
      let Z = Math.max(0, Math.min(1, -(x * _ + B * v) / (P * P))),
        b = Math.hypot(x + Z * _, B + Z * v);
      (b < l.offset && (l = { offset: b, along: o + Z * P }), (o += P));
    }
    return l;
  }
  function sh(e, t, i) {
    let o = ef(t.lat, t.lon, i),
      l = ef(e.lat, e.lon, i);
    if (o.offset > 50 || l.offset > Math.max(35, e.radius)) return null;
    let s = Math.abs(((e.heading - t.heading + 540) % 360) - 180);
    if (e.kind !== "danger" && s > 70) return null;
    let f =
        e.kind === "danger"
          ? Math.sqrt(Math.max(0, e.radius ** 2 - l.offset ** 2))
          : e.radius,
      c = l.along - o.along - f;
    return e.kind === "danger" &&
      Math.hypot(o.along - l.along, l.offset) <= e.radius
      ? 0
      : c >= -25 && c <= (e.kind === "danger" ? 2e3 : 100)
        ? Math.max(
            0,
            Math.round(c / (e.kind === "danger" ? 100 : 10)) *
              (e.kind === "danger" ? 100 : 10),
          )
        : null;
  }
  function rh(e) {
    return e <= 0
      ? "Vous entrez dans la zone de danger"
      : "Zone de danger dans " +
          (e / 1e3).toLocaleString("fr-FR", { maximumFractionDigits: 1 }) +
          " km";
  }
  function Q1(e, t) {
    let i = new Set(),
      o = new Set(),
      l = new Map();
    e.createTile = function (c, g) {
      let y = document.createElement("img");
      (o.add(y), (y.alt = ""), y.setAttribute("role", "presentation"));
      let p = this.getTileUrl(c),
        _ = 0,
        v = !1;
      return (
        (y.onload = () => {
          v || ((v = !0), i.delete(y), t(i.size > 0), g(null, y));
        }),
        (y.onerror = () => {
          v ||
            (_ < 2
              ? (_++,
                l.set(
                  y,
                  setTimeout(() => {
                    (l.delete(y), (y.src = p + "&gps_retry=" + _));
                  }, _ * 750),
                ))
              : ((v = !0),
                i.add(y),
                t(!0),
                g(new Error("Satellite tile unavailable"), y)));
        }),
        (y.src = p),
        y
      );
    };
    let s = ({ tile: c }) => {
      (clearTimeout(l.get(c)),
        l.delete(c),
        (c.onload = null),
        (c.onerror = null),
        o.delete(c),
        i.delete(c),
        t(i.size > 0));
    };
    e.on("tileunload", s);
    let f = () => e.redraw();
    return (
      window.addEventListener("online", f),
      () => {
        (window.removeEventListener("online", f),
          e.off("tileunload", s),
          l.forEach(clearTimeout),
          l.clear(),
          o.forEach((c) => {
            ((c.onload = null), (c.onerror = null));
          }),
          o.clear());
      }
    );
  }
  function W1(e) {
    return gpsArrivalDifference(e);
  }
  const gpsRoadState = new WeakMap();
  function sl(e, t) {
    if (!e || !Array.isArray(t) || t.length < 2) return e;
    let state = gpsRoadState.get(t);
    if (!state) {
      state = { joined: false, last: null };
      gpsRoadState.set(t, state);
    }
    let i = Math.PI / 180,
      o = Math.cos(e.lat * i),
      l = 6371e3 * i,
      s = Infinity,
      f = e;
    for (let c = 1; c < t.length; c++) {
      let g = t[c - 1],
        y = t[c],
        p = (g[1] - e.lon) * o,
        _ = g[0] - e.lat,
        v = (y[1] - g[1]) * o,
        x = y[0] - g[0];
      if (!v && !x) continue;
      let B = Math.max(0, Math.min(1, -(p * v + _ * x) / (v * v + x * x))),
        P = Math.hypot(p + B * v, _ + B * x) * l;
      if (P < s) {
        s = P;
        f = {
          ...e,
          lat: g[0] + B * (y[0] - g[0]),
          lon: g[1] + B * (y[1] - g[1]),
          heading: (Math.atan2(v, x) / i + 360) % 360,
        };
      }
    }
    const first = t[0],
      next = t.find((p) => p[0] !== first[0] || p[1] !== first[1]) || t[1],
      firstHeading =
        (Math.atan2((next[1] - first[1]) * o, next[0] - first[0]) / i + 360) %
        360;
    if (!state.joined) {
      if (e.accuracy <= 50 && s <= 30) {
        state.joined = true;
      } else {
        return {
          ...e,
          lat: first[0],
          lon: first[1],
          heading: firstHeading,
          waiting: true,
        };
      }
    }
    const limit = Math.max(55, Math.min(85, (e.accuracy || 0) * 1.5));
    if (e.accuracy <= 80 && s <= limit) {
      state.last = f;
      return f;
    }
    return state.last
      ? {
          ...e,
          lat: state.last.lat,
          lon: state.last.lon,
          heading: state.last.heading,
        }
      : f;
  }
  var Gu = (50 * Math.PI) / 180,
    fh = 1e3;
  function J1(e, t, i, o, l, s) {
    let f = i * 0.5,
      c = o * 0.7,
      g = t - s - c,
      y = g / (Math.cos(Gu) + (g * Math.sin(Gu)) / fh),
      p = 1 - (y * Math.sin(Gu)) / fh;
    return { x: f + (e - l - f) * p, y: c + y };
  }
  function $1(e, t, i, o, l, s) {
    let f = i * 0.5,
      c = o * 0.7,
      g = t - c,
      y = 1 - (g * Math.sin(Gu)) / fh;
    return {
      x: l + f + (e - f) / y,
      y: s + c + (g * Math.cos(Gu)) / y,
      magnification: Math.max(0.05, 1 / y),
    };
  }
  function eL(e, t, i, o = 60, l = 1) {
    let s = (156543.03392 * Math.cos((e * Math.PI) / 180)) / 2 ** t;
    return Math.max(0.015, Math.min(2, (i * l) / (o * s)));
  }
  function jt(e, t) {
    return ((((t - e + 540) % 360) + 360) % 360) - 180;
  }
  function tf(e, t, i, o) {
    return e + jt(e, t) * (1 - Math.exp(-Math.max(0, i) / o));
  }
  function tL(e, t, i, o) {
    if (!e || o <= 0) return i.heading;
    let l = Math.PI / 180,
      s =
        6371e3 *
        Math.hypot(
          (i.lat - e.lat) * l,
          (i.lon - e.lon) * l * Math.cos(((i.lat + e.lat) * l) / 2),
        );
    if (s > 100 || i.accuracy > 50) return i.heading;
    if (s < 0.5) return t;
    let f = Math.max(1, Math.ceil(s / 0.5)),
      c = s / f,
      g = Math.max(3, o * 0.72);
    for (let y = 1; y <= f; y++) {
      let p = e.heading + (jt(e.heading, i.heading) * y) / f;
      t += ((c / g) * Math.sin(jt(t, p) * l)) / l;
    }
    return i.heading + Math.max(-55, Math.min(55, jt(i.heading, t)));
  }
  function aL(e, t) {
    let i = (jt(t, e) * Math.PI) / 180;
    return { x: 40 - 31 * Math.sin(i), y: 45 + 31 * Math.cos(i) };
  }
  function yy(e, t, i, o) {
    let l = Math.max(-55, Math.min(55, jt(e, t))),
      s = (Math.abs(l) * Math.PI) / 180;
    return {
      yaw: l,
      side: l < 0 ? "left" : "right",
      mix: Math.max(0, Math.min(1, (Math.abs(l) - 3) / 35)),
      widthScale: Math.max(1, Math.cos(s) + (o / i) * Math.sin(s)),
    };
  }
  function dh(e, t, i, o, l, s = true, f = "van") {
    const yaw = Math.max(-70, Math.min(70, ((i - t + 540) % 360) - 180));
    const rear = e.querySelector("[data-view-rear]");
    const side = e.querySelector("[data-view-side]");
    if (rear) rear.style.opacity = "1";
    if (side) side.style.opacity = "0";
    e.style.transform = "rotate(" + yaw + "deg)";
    e.style.transformOrigin = e.hasAttribute("data-rig-trailer")
      ? "50% 5.5px"
      : "50% 66px";
  }
  function iL(e, t) {
    let i = t?.heading || 0;
    if (e.heading !== null && Number.isFinite(e.heading)) i = e.heading;
    else if (t) {
      let o = Math.PI / 180,
        l = t.lat * o,
        s = e.latitude * o,
        f = (e.longitude - t.lon) * o;
      6371e3 * Math.hypot(s - l, f * Math.cos((l + s) / 2)) >=
        Math.max(5, Math.min(e.accuracy, 15)) &&
        (i =
          (Math.atan2(
            Math.sin(f) * Math.cos(s),
            Math.cos(l) * Math.sin(s) - Math.sin(l) * Math.cos(s) * Math.cos(f),
          ) /
            o +
            360) %
          360);
    }
    return {
      lat: e.latitude,
      lon: e.longitude,
      accuracy: e.accuracy,
      heading: i,
      speed:
        typeof e.speed == "number" &&
        Number.isFinite(e.speed) &&
        e.speed >= 0 &&
        e.speed <= 100
          ? e.speed * 3.6
          : null,
    };
  }
  function oL(e, t, i) {
    return e === "none" ||
      typeof t != "number" ||
      !Number.isFinite(t) ||
      t < 110 ||
      !Number.isFinite(i) ||
      i > 30
      ? ""
      : e === "trailer"
        ? "Attention ! Votre remorque risque de chasser sur la route. Réduisez la vitesse."
        : "Attention ! Votre caravane risque de chasser sur la route. Réduisez la vitesse.";
  }
  var S = ka(Vu(), 1),
    ch = (e) =>
      String(e).replace(
        /[&<>"']/g,
        (t) =>
          ({
            "&": "&amp;",
            "<": "&lt;",
            ">": "&gt;",
            '"': "&quot;",
            "'": "&#39;",
          })[t],
      );
  function hh() {
    const [gpsHeavy48, gpsSetHeavy48] = (0, R.useState)(false);
    const [gpsConfirmed46, gpsSetConfirmed46] = (0, R.useState)(null);
    let [gpsAlertsMuted, gpsSetAlertsMuted] = (0, R.useState)(() => {
      try {
        return localStorage.getItem("gps-attelage-alerts") === "off";
      } catch {
        return false;
      }
    });
    let [gpsSignChoice, gpsSetSignChoice] = (0, R.useState)(null),
      [gpsSignBusy, gpsSetSignBusy] = (0, R.useState)(false),
      [gpsSignError, gpsSetSignError] = (0, R.useState)("");
    function gpsToggleAlerts() {
      const muted = !gpsAlertsMuted;
      gpsSetAlertsMuted(muted);
      gpsSetSpeedVisible(false);
      try {
        localStorage.setItem("gps-attelage-alerts", muted ? "off" : "on");
      } catch {}
      if (muted && "speechSynthesis" in window) speechSynthesis.cancel();
    }
    async function gpsGoToSign() {
      const place = gpsSignChoice;
      if (!place || gpsSignBusy) return;
      if (!q) {
        Wa();
        gpsSetSignError(
          "Activez votre position, puis appuyez sur Oui, y aller.",
        );
        return;
      }
      if (!Number.isFinite(place.lat) || !Number.isFinite(place.lon)) {
        gpsSetSignError("Position de ce lieu indisponible.");
        return;
      }
      gpsSetSignBusy(true);
      gpsSetSignError("");
      const controller = new AbortController(),
        timer = setTimeout(() => controller.abort(), 25000);
      try {
        const response = await fetch("/gps/api/route", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: controller.signal,
          body: JSON.stringify({
            from: [q.lat, q.lon],
            to: [place.lat, place.lon],
            profile: z,
          }),
        });
        const route = await response.json();
        if (
          !response.ok ||
          !Array.isArray(route.points) ||
          route.points.length < 2 ||
          !route.summary
        )
          throw Error(route.error || "Trajet indisponible.");
        Ze(place);
        Kt(route);
        fo(0);
        Mi.current = -1;
        f.current?.remove();
        f.current = i.current
          .featureGroup([
            i.current.polyline(route.points, {
              color: "#ffffff",
              weight: 12,
              opacity: 0.95,
            }),
            i.current.polyline(route.points, {
              color: "#2466ed",
              weight: 7,
              opacity: 1,
            }),
          ])
          .addTo(t.current);
        Bi(route);
        gpsSetSignChoice(null);
        T("");
      } catch (error) {
        gpsSetSignError(
          error.name === "AbortError"
            ? "Le calcul prend trop de temps. Réessayez."
            : error.message || "Trajet indisponible.",
        );
      } finally {
        clearTimeout(timer);
        gpsSetSignBusy(false);
      }
    }
    let e = (0, R.useRef)(null),
      t = (0, R.useRef)(null),
      i = (0, R.useRef)(null),
      o = (0, R.useRef)(null),
      l = (0, R.useRef)(null),
      s = (0, R.useRef)(null),
      f = (0, R.useRef)(null),
      [c, g] = (0, R.useState)(0),
      [y, p] = (0, R.useState)(0),
      [_, v] = (0, R.useState)(!1),
      [x, B] = (0, R.useState)([]),
      [P, Z] = (0, R.useState)(!0),
      [b, C] = (0, R.useState)(""),
      [w, T] = (0, R.useState)(""),
      [z, ue] = (0, R.useState)(uh),
      [F, j] = (0, R.useState)(!1),
      [V, W] = (0, R.useState)(Ci.map((m) => m.id)),
      [Y, Ze] = (0, R.useState)(null),
      [Ca, et] = (0, R.useState)(""),
      [Ii, $] = (0, R.useState)([]),
      [Xu, ee] = (0, R.useState)(!1),
      [De, Xe] = (0, R.useState)(!1),
      [je, He] = (0, R.useState)(new Date()),
      [q, fe] = (0, R.useState)(null),
      [ca, Yt] = (0, R.useState)(!1),
      [te, Kt] = (0, R.useState)(null),
      [Zo, bi] = (0, R.useState)(!1),
      [Ye, ju] = (0, R.useState)(!0),
      [K, zt] = (0, R.useState)(!1),
      [Za, fo] = (0, R.useState)(0),
      [Ia, rl] = (0, R.useState)(null),
      [co, ho] = (0, R.useState)(""),
      [Yu, fl] = (0, R.useState)([]),
      [nf, Go] = (0, R.useState)(!1),
      [Ku, Vo] = (0, R.useState)(!1),
      [dl, Xo] = (0, R.useState)(null),
      [Ga, cl] = (0, R.useState)(null),
      [wi, mo] = (0, R.useState)(null),
      [ba, Qu] = (0, R.useState)(!0),
      Va = (0, R.useRef)({ address: -1, passing: -1, last: 0, next: 0 });
    (0, R.useEffect)(() => {
      try {
        Qu(localStorage.getItem("gps-voyage-fun-voice") !== "off");
      } catch {}
    }, []);
    function lf() {
      let m = !ba;
      Qu(m);
      try {
        localStorage.setItem("gps-voyage-fun-voice", m ? "on" : "off");
      } catch {}
    }
    function Wu(m = !1) {
      if (
        !ba ||
        !Ye ||
        !("speechSynthesis" in window) ||
        speechSynthesis.speaking ||
        speechSynthesis.pending
      )
        return;
      let A = Va.current,
        E = m ? "passing" : "address",
        O = V1(m ? G1 : Z1, A[E]);
      ((A[E] = O.index),
        (A.last = Date.now()),
        (A.next = A.last + (180 + Math.random() * 180) * 1e3));
      let H = new SpeechSynthesisUtterance(O.text);
      ((H.lang = "fr-FR"), speechSynthesis.speak(H));
    }
    let [po, jo] = (0, R.useState)(null),
      [Ju, hl] = (0, R.useState)(!1),
      [uf, Yo] = (0, R.useState)(!1),
      ml =
        Y && !Y.photo && Y.lat != null && Y.lon != null
          ? Y.id + ":" + Y.lat + ":" + Y.lon
          : "";
    ((0, R.useEffect)(() => {
      if ((jo(null), Yo(!1), !ml || K)) {
        hl(!1);
        return;
      }
      let m = !1,
        A = new AbortController();
      return (
        hl(!0),
        fetch(`/gps/api/panorama?lat=${Y.lat}&lon=${Y.lon}`, {
          signal: A.signal,
        })
          .then(async (E) => {
            let O = await E.json();
            m || (jo(O.panorama || null), Yo(!!O.unavailable));
          })
          .catch(() => {
            m || Yo(!0);
          })
          .finally(() => {
            m || hl(!1);
          }),
        () => {
          ((m = !0), A.abort());
        }
      );
    }, [ml, K]),
      (0, R.useEffect)(() => {
        let m = (A) => {
          A.origin === window.location.origin &&
            A.source ===
              document.querySelector(".street-view iframe")?.contentWindow &&
            A.data?.type === "gps-panorama-error" &&
            (jo(null), Yo(!0));
        };
        return (
          window.addEventListener("message", m),
          () => window.removeEventListener("message", m)
        );
      }, []));
    let $u = (0, R.useRef)(null),
      pl = (0, R.useRef)(!0),
      wa = (0, R.useRef)(null),
      gl = (0, R.useRef)(new Set()),
      [sf, rf] = (0, R.useState)(0),
      es = (0, R.useRef)(""),
      ut = (0, R.useRef)(!0),
      X = (0, R.useRef)(!1),
      Ko = (0, R.useRef)(null),
      Ll = (0, R.useRef)(0),
      Ot = (0, R.useRef)(null),
      ha = (0, R.useRef)(0),
      Ma = (0, R.useRef)(null),
      Qo = (0, R.useRef)(null),
      Ta = (0, R.useRef)(null),
      Mi = (0, R.useRef)(-1),
      ts = (0, R.useRef)(() => {}),
      [_l, as] = (0, R.useState)(Date.now()),
      go = (0, R.useRef)(0),
      Wo = (0, R.useRef)(0),
      St =
        K && q && _l - go.current < 1e4
          ? oL(z.trailer, q.speed, q.accuracy)
          : "";
    let [gpsSpeedVisible, gpsSetSpeedVisible] = (0, R.useState)(false),
      gpsSpeedCycle = (0, R.useRef)(false);
    (0, R.useEffect)(() => {
      if (
        !K ||
        z.trailer === "none" ||
        (q && q.accuracy <= 30 && Number.isFinite(q.speed) && q.speed < 105)
      ) {
        gpsSpeedCycle.current = false;
        gpsSetSpeedVisible(false);
      } else if (St && !gpsAlertsMuted && !gpsSpeedCycle.current) {
        gpsSpeedCycle.current = true;
        gpsSetSpeedVisible(true);
      } else if (!St) {
        gpsSetSpeedVisible(false);
      }
    }, [St, K, z.trailer, q?.speed, q?.accuracy, gpsAlertsMuted]);
    (0, R.useEffect)(() => {
      if (!gpsSpeedVisible) return;
      let timer = setTimeout(() => gpsSetSpeedVisible(false), 7000);
      return () => clearTimeout(timer);
    }, [gpsSpeedVisible]);
    ((0, R.useEffect)(() => {
      if (!K) return;
      let m = setInterval(() => as(Date.now()), 1e3);
      return () => clearInterval(m);
    }, [K]),
      (0, R.useEffect)(() => {
        if (!K || !ba || !Ye || !q || !te || Ie || St) return;
        let m = q.speed == null ? null : q.speed * 3.6,
          A = te.instructions[Za]?.message || "";
        if (
          m === null ||
          m < 5 ||
          m > 40 ||
          q.accuracy > 30 ||
          Date.now() - go.current > 1e4 ||
          Date.now() < Va.current.next ||
          !/(?:\brue\b|\bR\b|\bchemin\b|\ballée\b|\bimpasse\b)/i.test(A)
        )
          return;
        let E =
          Number(te.instructions[Za]?.routeOffsetInMeters) -
          ha.current * te.summary.lengthInMeters;
        !Number.isFinite(E) || E < 150 || Wu(!0);
      }, [_l, K, ba, Ye, Za]),
      (0, R.useEffect)(() => {
        if (!gpsSpeedVisible || !St || !Ye || !("speechSynthesis" in window))
          return;
        ((Wo.current = Date.now()), speechSynthesis.cancel());
        let m = new SpeechSynthesisUtterance(St);
        ((m.lang = "fr-FR"), speechSynthesis.speak(m));
      }, [gpsSpeedVisible, Ye]),
      (0, R.useEffect)(() => {
        let m = () => X1();
        return (
          document.addEventListener("pointerdown", m, { once: !0 }),
          document.addEventListener("touchend", m, { once: !0 }),
          () => {
            (document.removeEventListener("pointerdown", m),
              document.removeEventListener("touchend", m));
          }
        );
      }, []));
    let [Xa, is] = (0, R.useState)([]),
      [Ie, Ti] = (0, R.useState)(null),
      [Jo, os] = (0, R.useState)(!1),
      [Ai, Aa] = (0, R.useState)(""),
      $o = (0, R.useRef)(null),
      en = (0, R.useRef)(new Set()),
      Qt = (0, R.useRef)(null);
    $o.current = q;
    async function he() {
      let m = $o.current;
      if (!m || document.visibilityState === "hidden") return;
      let A = K1(m.lat, m.lon);
      is((E) => [...E.filter((O) => O.source !== "official"), ...A]);
      try {
        let E = await fetch(`/gps/api/road-reports?lat=${m.lat}&lon=${m.lon}`);
        if (E.ok) {
          let O = await E.json();
          is([...(O.reports || []), ...A]);
        }
      } catch {}
    }
    ((0, R.useEffect)(() => {
      he();
      let m = setInterval(he, 2e4);
      return () => clearInterval(m);
    }, [!!q]),
      (0, R.useEffect)(() => {
        if (!Ai) return;
        let m = setTimeout(() => Aa(""), 3500);
        return () => clearTimeout(m);
      }, [Ai]),
      (0, R.useEffect)(() => {
        if (_) {
          (Qt.current || (Qt.current = i.current.layerGroup().addTo(t.current)),
            Qt.current.clearLayers());
          for (let m of Xa) {
            if (m.expires < Date.now()) continue;
            let A = Zu.find((E) => E.id === m.kind);
            m.kind === "danger"
              ? (i.current
                  .circle([m.lat, m.lon], {
                    radius: m.radius,
                    color: "#e3a32c",
                    weight: 2,
                    fillOpacity: 0.08,
                  })
                  .bindTooltip("Zone de danger")
                  .addTo(Qt.current),
                i.current
                  .marker([m.lat, m.lon], {
                    icon: i.current.divIcon({
                      className: "road-report-pin radar-zone-pin",
                      html: $r,
                      iconSize: [42, 42],
                      iconAnchor: [21, 21],
                    }),
                  })
                  .bindTooltip("Zone de danger")
                  .addTo(Qt.current))
              : i.current
                  .marker([m.lat, m.lon], {
                    icon: i.current.divIcon({
                      className: "road-report-pin",
                      html: "<span>" + A.symbol + "</span>",
                      iconSize: [38, 38],
                      iconAnchor: [19, 19],
                    }),
                  })
                  .bindTooltip(A.label)
                  .addTo(Qt.current);
          }
        }
      }, [_, Xa]),
      (0, R.useEffect)(() => {
        if (!K) {
          (en.current.clear(), Ti(null));
          return;
        }
        if (!(!q || !te || q.accuracy > 50)) {
          if (Ie) {
            let m = sh(Ie.report, sl(q, te.points), te.points);
            m !== null && m !== Ie.distance && Ti({ ...Ie, distance: m });
            return;
          }
          for (let m of Xa) {
            if (m.expires < Date.now() || en.current.has(m.id)) continue;
            let A = sh(m, sl(q, te.points), te.points);
            if (A !== null && !Ie) {
              (en.current.add(m.id), Ti({ report: m, distance: A }));
              break;
            }
          }
        }
      }, [q, Xa, K, te, Ie]),
      (0, R.useEffect)(() => {
        if (!Ie) return;
        let m = setTimeout(() => Ti(null), 7e3);
        return () => clearTimeout(m);
      }, [Ie?.report.id]),
      (0, R.useEffect)(() => {
        if (!Ie || !Ye || (j1(), !("speechSynthesis" in window))) return;
        let m = Zu.find((E) => E.id === Ie.report.kind),
          A = new SpeechSynthesisUtterance(
            Ie.report.kind === "danger"
              ? rh(Ie.distance)
              : m.label + " dans " + Ie.distance + " m\xE8tres",
          );
        ((A.lang = "fr-FR"), speechSynthesis.speak(A));
      }, [Ie?.report.id]));
    async function Me(m, A, E = !0) {
      if (Jo) return;
      let O = $o.current;
      if (!O || O.accuracy > 50 || Date.now() - go.current > 15e3) {
        Aa("Attendez une position GPS pr\xE9cise.");
        return;
      }
      os(!0);
      try {
        let H = await fetch("/gps/api/road-reports", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              kind: m,
              id: A,
              active: E,
              lat: O.lat,
              lon: O.lon,
              heading: O.heading,
              accuracy: O.accuracy,
            }),
          }),
          G = await H.json();
        if (!H.ok) throw Error(G.error);
        (Ti(null),
          Aa(
            E
              ? G.confirmed
                ? "Signalement confirm\xE9."
                : "Signalement enregistr\xE9 \xB7 " +
                  G.remaining +
                  " confirmation" +
                  (G.remaining > 1 ? "s" : "") +
                  " restante" +
                  (G.remaining > 1 ? "s" : "")
              : "Fin du signalement enregistr\xE9e.",
          ),
          he());
      } catch (H) {
        Aa(H.message || "Signalement non envoy\xE9. R\xE9essayez.");
      } finally {
        os(!1);
      }
    }
    let Ct = Hu.find((m) => m.id === z.vehicle),
      st = Nu.find((m) => m.id === z.trailer);
    (0, R.useEffect)(() => {
      for (let m of [Ct.turnImage, st.turnImage])
        if (m) {
          let A = new Image();
          ((A.onload = () => {
            (gl.current.add(m), rf((E) => E + 1));
          }),
            (A.src = m));
        }
    }, [z.vehicle, z.trailer]);
    let Di =
        z.travelMode === "pedestrian"
          ? "Piéton"
          : Ct.name +
            (z.trailer !== "none" ? " + " + st.name.toLowerCase() : ""),
      ma = (0, R.useMemo)(
        () =>
          x
            .filter(
              (m) =>
                V.includes(m.kind) &&
                (!Ca ||
                  qu([m.name, m.city, m.address].join(" ")).includes(qu(Ca))),
            )
            .sort((m, A) =>
              q && m.lat != null && A.lat != null
                ? Fa(q.lat, q.lon, m.lat, m.lon) -
                  Fa(q.lat, q.lon, A.lat, A.lon)
                : m.name.localeCompare(A.name),
            ),
        [x, V, Ca, q],
      ),
      oe = ma.slice(0, 45),
      Re = (0, R.useRef)(null),
      Lo = (0, R.useMemo)(() => {
        let m = _ ? t.current?.getBounds() : null;
        return [
          ...new Set(
            [
              ...ma.filter(
                (A) =>
                  m &&
                  A.lat != null &&
                  A.lon != null &&
                  m.contains([A.lat, A.lon]),
              ),
              ...ma.slice(0, 45),
            ]
              .map((A) => A.key)
              .filter(Boolean),
          ),
        ]
          .slice(0, 300)
          .sort().join(`
`);
      }, [ma, _, y]);
    async function ja(m = 48.11, A = -1.68, E = !1) {
      let O = Re.current;
      if (!E && O && Date.now() - O.at < 12e4 && Fa(m, A, O.lat, O.lon) < 10)
        return;
      ((Re.current = { lat: m, lon: A, at: Date.now() }), Ta.current?.abort());
      let H = new AbortController();
      ((Ta.current = H), Z(!0));
      try {
        let G = await fetch(
          `/gps/api/places?lat=${m.toFixed(2)}&lon=${A.toFixed(2)}`,
          { signal: H.signal },
        );
        if (!G.ok) throw Error();
        let ne = await G.json();
        (B((_e) =>
          (ne.places || []).map((Le) => ({
            ...Le,
            photo: _e.find((se) => se.id === Le.id)?.photo,
          })),
        ),
          g((_e) => _e + 1),
          C(
            ne.live
              ? "Couteau Suisse \xB7 synchronis\xE9"
              : "Derni\xE8res donn\xE9es enregistr\xE9es",
          ));
      } catch (G) {
        G.name !== "AbortError" &&
          T("Les lieux ne peuvent pas \xEAtre charg\xE9s. R\xE9essayez.");
      } finally {
        H.signal.aborted || Z(!1);
      }
    }
    ((0, R.useEffect)(() => {
      try {
        let O = JSON.parse(
          localStorage.getItem("gps-voyage-profile") || "null",
        );
        O &&
          Hu.some((_e) => _e.id === O.vehicle) &&
          Nu.some((_e) => _e.id === O.trailer) &&
          ue({
            ...uh,
            ...O,
            ...Jr(O.vehicle, O.trailer),
            weight: O.trailer === "large" ? "3500" : "6000",
            confirmed: true,
          });
        let H = JSON.parse(localStorage.getItem("gps-voyage-home") || "null");
        H && (rl(H), ho(H.name));
        let G = localStorage.getItem("gps-voyage-layers-v2"),
          ne = JSON.parse(
            G || localStorage.getItem("gps-voyage-layers") || "null",
          );
        Array.isArray(ne) &&
          W([
            ...ne.filter((_e) => Ci.some((Le) => Le.id === _e)),
            ...(G ? [] : ["brocante"]),
          ]);
      } catch {}
      let m = !1,
        A = () => {};
      Promise.resolve()
        .then(() => ka(rL(), 1))
        .then(async (O) => {
          if (m || !e.current) return;
          let H = O.default;
          if (
            ((window.L = H), await Promise.resolve().then(() => (fL(), Cy)), m)
          )
            return;
          i.current = H;
          let G = H.map(e.current, {
            zoomControl: !1,
            attributionControl: !0,
            preferCanvas: !0,
            rotate: !0,
            rotateControl: !1,
            touchRotate: !1,
            shiftKeyRotate: !1,
            compassBearing: !1,
          }).setView([48.11, -1.68], 10);
          t.current = G;
          let ne = G.createPane("gpsPosition");
          ((ne.style.zIndex = "650"), (ne.style.pointerEvents = "none"));
          let _e = H.tileLayer(
            "https://data.geopf.fr/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=ORTHOIMAGERY.ORTHOPHOTOS&STYLE=normal&FORMAT=image/jpeg&TILEMATRIXSET=PM_0_19&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}",
            {
              maxZoom: 20,
              maxNativeZoom: 19,
              keepBuffer: 4,
              updateWhenIdle: !0,
              attribution:
                '\xA9 <a href="https://www.ign.fr">IGN</a> \xB7 G\xE9oplateforme',
            },
          );
          ((A = Q1(_e, (Le) => {
            m ||
              T((se) =>
                Le
                  ? !se ||
                    se === "Certaines images satellites sont indisponibles."
                    ? "Certaines images satellites sont indisponibles."
                    : se
                  : se === "Certaines images satellites sont indisponibles."
                    ? ""
                    : se,
              );
          })),
            _e.addTo(G),
            (o.current = H.layerGroup().addTo(G)),
            G.on("zoomend", () => p((Le) => Le + 1)),
            G.on("moveend", () => {
              (Date.now() - Ll.current > 250 &&
                ((Ll.current = Date.now()), p((Le) => Le + 1)),
                clearTimeout(Qo.current),
                (Qo.current = setTimeout(() => {
                  let Le = G.getCenter();
                  ja(Le.lat, Le.lng);
                }, 900)));
            }),
            v(!0),
            xl());
        });
      let E = setInterval(() => He(new Date()), 6e4);
      return () => {
        ((m = !0),
          A(),
          clearInterval(E),
          clearTimeout(Qo.current),
          Ta.current?.abort(),
          t.current?.remove(),
          Ma.current !== null && navigator.geolocation.clearWatch(Ma.current));
      };
    }, []),
      (0, R.useEffect)(() => {
        let m = setInterval(() => {
            document.visibilityState === "visible" && g((E) => E + 1);
          }, 6e4),
          A = () => {
            if (document.visibilityState === "visible") {
              g((O) => O + 1);
              let E = t.current?.getCenter();
              E && ja(E.lat, E.lng, !0);
            }
          };
        return (
          document.addEventListener("visibilitychange", A),
          () => {
            (clearInterval(m),
              document.removeEventListener("visibilitychange", A));
          }
        );
      }, []),
      (0, R.useEffect)(() => {
        if (!Lo) return;
        let m = new AbortController();
        return (
          fetch("/gps/api/photos", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              keys: Lo.split(`
`),
            }),
            signal: m.signal,
          })
            .then(async (A) => {
              if (!A.ok) return;
              let E = await A.json();
              if (m.signal.aborted) return;
              let O = E.photos || {};
              (B((H) =>
                H.map((G) =>
                  G.key && Object.prototype.hasOwnProperty.call(O, G.key)
                    ? { ...G, photo: O[G.key] || void 0 }
                    : G,
                ),
              ),
                Ze((H) =>
                  H?.key && Object.prototype.hasOwnProperty.call(O, H.key)
                    ? { ...H, photo: O[H.key] || void 0 }
                    : H,
                ));
            })
            .catch(() => {}),
          () => m.abort()
        );
      }, [Lo, c]),
      (0, R.useEffect)(() => {
        try {
          localStorage.setItem("gps-voyage-layers-v2", JSON.stringify(V));
        } catch {}
      }, [V]),
      (0, R.useEffect)(() => {
        try {
          localStorage.setItem("gps-voyage-profile", JSON.stringify(z));
        } catch {}
      }, [z]),
      (0, R.useEffect)(() => {
        if (!_) return;
        o.current.clearLayers();
        let m = t.current.getBounds();
        x.filter(
          (E) =>
            V.includes(E.kind) &&
            E.lat != null &&
            E.lon != null &&
            m.contains([E.lat, E.lon]),
        ).forEach((E) => {
          let O = Ci.find((Le) => Le.id === E.kind),
            H = Fu(E, je),
            G = `<button type="button" class="market-sign" data-kind="${ch(E.kind)}" style="--pin:${O.color}" aria-label="${ch(E.name + " \xB7 " + H)}"><div class="sign-face"><strong>${ch(E.name)}</strong><small class="${H.includes("en cours") ? "sign-open" : ""}">${ch(H)}</small>${E.approx ? '<span class="sign-approx">Centre de la ville</span>' : ""}</div></button>`,
            ne = i.current.marker([E.lat, E.lon], {
              icon: i.current.divIcon({
                className: "place-pin",
                html: G,
                iconSize: [180, 100],
                iconAnchor: [90, 100],
              }),
            });
          (ne.on("click", () => ts.current(E)), ne.addTo(o.current));
          let _e = ne.getElement()?.querySelector("img");
          _e &&
            _e.addEventListener(
              "error",
              () => {
                let Le = document.createElement("span");
                ((Le.textContent = O.symbol), _e.replaceWith(Le));
              },
              { once: !0 },
            );
        });
      }, [x, V, _, je, P, y]),
      (0, R.useEffect)(() => {
        if (!_ || !q) return;
        let m = K && te ? sl(q, te.points) : q,
          A = z.vehicle + ":" + z.trailer + ":" + K,
          E = Ko.current,
          O =
            E && E.profile === A
              ? E
              : {
                  fix: m,
                  profile: A,
                  car: m.heading,
                  trailer: m.heading,
                  targetTrailer: m.heading,
                  camera: -(t.current.getBearing?.() || 0),
                };
        (O.fix !== m &&
          ((O.targetTrailer = tL(O.fix, O.targetTrailer, m, st.length)),
          (O.fix = m)),
          (Ko.current = O));
        let H = `<div class="vehicle-pointer ${z.trailer !== "none" ? "towing" : ""} ${St ? "speed-sway" : ""}" style="transform:rotate(0deg)"><div class="vehicle-icons"><img data-rig-car src="${Ct.navigationImage}" alt="">${z.trailer !== "none" ? '<div class="rig-trailer" data-rig-trailer><img src="' + st.navigationImage + '" alt=""></div>' : ""}</div></div>`,
          G = i.current.divIcon({
            className: "position-icon",
            html: H,
            iconSize: z.trailer !== "none" ? [80, 160] : [80, 98],
            iconAnchor: [40, 45],
          });
        (l.current
          ? (l.current.setLatLng([m.lat, m.lon]),
            es.current !== A && l.current.setIcon(G))
          : (l.current = i.current
              .marker([m.lat, m.lon], {
                icon: G,
                pane: "gpsPosition",
                zIndexOffset: 1e4,
                interactive: !1,
                keyboard: !1,
              })
              .addTo(t.current)),
          (es.current = A));
        let ne = l.current.getElement();
        ne && (ne.style.display = K ? "none" : "");
        let _e = (K ? s.current : ne)?.querySelector(".vehicle-pointer");
        if (_e) {
          if ((_e.classList.toggle("speed-sway", !!St), K)) {
            let pt = z.trailer === "none" ? 66 : 109;
            ((_e.style.transformOrigin = "40px " + pt + "px"),
              (s.current.style.transform = "translate(-40px,-" + pt + "px)"));
          }
          Wt();
          K && ut.current && Ka(m);
          K && te && gpsClipRoad(te.points, m, f.current);
        }
        let Le = 0,
          se = performance.now(),
          Be = !1,
          mt = (pt) => {
            if (Be) return;
            let bt = Math.min(0.1, Math.max(0, (pt - se) / 1e3));
            ((se = pt),
              (O.car = tf(O.car, m.heading, bt, 0.12)),
              (O.trailer = tf(O.trailer, O.targetTrailer, bt, 0.24)),
              (O.camera = K
                ? tf(O.camera, m.heading, bt, 0.6)
                : -(t.current.getBearing?.() || 0)),
              K && ut.current && (t.current.setBearing(-O.camera), Ka(m, !0)));
            let Rt = K ? s.current : l.current?.getElement(),
              ga = Rt?.querySelector("[data-rig-car]"),
              La = Rt?.querySelector("[data-rig-trailer]"),
              _o = aL(O.car, O.camera);
            (ga &&
              (K
                ? dh(
                    ga,
                    O.camera,
                    O.car,
                    z.vehicle === "truck" ? 2.5 : 2.1,
                    Ct.length,
                    gl.current.has(Ct.turnImage),
                    Ct.turnImage,
                  )
                : (ga.style.transform =
                    "rotate(" + jt(O.camera, O.car) + "deg)")),
              La &&
                ((La.style.left = _o.x - (K ? 38 : 30) + "px"),
                (La.style.top = _o.y - (K ? 26 : 4) + "px"),
                K
                  ? dh(
                      La,
                      O.camera,
                      O.trailer,
                      2.5,
                      st.length,
                      gl.current.has(st.turnImage),
                      st.turnImage,
                    )
                  : (La.style.transform =
                      "rotate(" + jt(O.camera, O.trailer) + "deg)")),
              K && gpsRigMotion(Rt, m, O.car, O.trailer, O.camera));
            (Math.abs(jt(O.car, m.heading)) > 0.05 ||
              Math.abs(jt(O.trailer, O.targetTrailer)) > 0.05 ||
              (K && Math.abs(jt(O.camera, m.heading)) > 0.05)) &&
              (Le = requestAnimationFrame(mt));
          };
        return (
          (Le = requestAnimationFrame(mt)),
          () => {
            ((Be = !0), cancelAnimationFrame(Le));
          }
        );
      }, [q, z, _, K, St, te, sf]),
      (0, R.useEffect)(() => {
        _ && !K && t.current.setBearing?.(0);
      }, [_, K]),
      (0, R.useEffect)(() => {
        if (!te || !q || !K) return;
        let m = te.points[te.points.length - 1];
        m &&
          q.accuracy <= 30 &&
          Date.now() - go.current < 10000 &&
          (gpsGuide46(te,q)?.fraction||0) > .97 &&
          Fa(q.lat, q.lon, m[0], m[1]) < 0.04 &&
          yl();
      }, [q, te, K, Ye]),
      (0, R.useEffect)(() => {
        if (!te || !q || !K || Date.now() - go.current > 10000) return;
        const g = gpsGuide46(te, q);
        if (!g) return;
        ha.current = g.along / te.summary.lengthInMeters;
        Xo((Math.max(0, 1 - g.fraction) * te.summary.lengthInMeters) / 1000);
        cl(
          Date.now() +
            Math.max(0, 1 - g.fraction) * te.summary.travelTimeInSeconds * 1000,
        );
        fo(g.index);
        window.dispatchEvent(new CustomEvent('couteau-gps-guidance',{detail:{distance:g.distance,message:te.instructions[g.index]?.message||'',remaining:Math.max(0,1-g.fraction)*te.summary.lengthInMeters}}));
        if (Ye && !St) gpsSpeakGuide46(g, te);
      }, [q, te, K, Ye, St]));
    let [It, vl] = (0, R.useState)(!1),
      Ya = (0, R.useRef)({ since: 0, count: 0, last: 0, busy: !1 }),
      pa = (0, R.useRef)(null),
      qe = (0, R.useRef)(!1);
    ((qe.current = K),
      (0, R.useEffect)(() => {
        K ||
          ((Ya.current.since = 0),
          (Ya.current.count = 0),
          pa.current?.abort(),
          (Ya.current.busy = !1),
          vl(!1));
      }, [K]),
      (0, R.useEffect)(() => {
        if (
          !K ||
          !q ||
          !te ||
          !Y ||
          q.accuracy > 30 ||
          Date.now() - go.current > 15e3 ||
          sl(q, te.points).waiting
        )
          return;
        let m = Ya.current;
        if (ef(q.lat, q.lon, te.points).offset <= 45) {
          ((m.since = 0), (m.count = 0));
          return;
        }
        if (
          (m.since || (m.since = Date.now()),
          m.count++,
          m.busy ||
            m.count < 3 ||
            Date.now() - m.since < 8e3 ||
            Date.now() - m.last < 3e4)
        )
          return;
        ((m.busy = !0), (m.last = Date.now()), vl(!0));
        let E = Ot.current?.started,
          O = new AbortController();
        ((pa.current = O),
          fetch("/gps/api/route", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            signal: O.signal,
            body: JSON.stringify({
              from: [q.lat, q.lon],
              to: [Y.lat, Y.lon],
              profile: z,
            }),
          })
            .then(async (H) => {
              let G = await H.json();
              if (!H.ok || !Array.isArray(G.points) || !G.points.length)
                throw Error(G.error);
              O.signal.aborted ||
                !qe.current ||
                Ot.current?.started !== E ||
                (Kt(G),
                (ha.current = 0),
                (Mi.current = -1),
                (m.since = 0),
                (m.count = 0),
                f.current && f.current.remove(),
                (f.current = i.current
                  .featureGroup([
                    i.current.polyline(G.points, {
                      color: "#ffffff",
                      weight: 12,
                      opacity: 0.95,
                    }),
                    i.current.polyline(G.points, {
                      color: "#2466ed",
                      weight: 7,
                      opacity: 1,
                    }),
                  ])
                  .addTo(t.current)));
            })
            .catch((error) => {if(!O.signal.aborted) T(error.message || "Recalcul indisponible. Réessayez.");})
            .finally(() => {
              pa.current === O && ((m.busy = !1), vl(!1));
            }));
      }, [q, te, K, Y, z]));
    function Wt() {
      let m = t.current,
        A = wa.current || q;
      if (!m || !A) return;
      let E = K ? s.current : l.current?.getElement(),
        O = E?.querySelector(".vehicle-pointer");
      if (!O) return;
      let H = z.trailer === "none" ? (z.vehicle === "truck" ? 2.5 : 2.1) : 2.5,
        G = z.trailer === "none" ? 60 : 76,
        ne = 1;
      if (K) {
        let _e = e.current,
          Le = m.getSize(),
          se = m.latLngToContainerPoint([
            l.current?.getLatLng().lat ?? A.lat,
            l.current?.getLatLng().lng ?? A.lon,
          ]),
          Be = $1(se.x, se.y, Le.x, Le.y, _e.offsetLeft, _e.offsetTop);
        ((ne = Be.magnification),
          !ut.current &&
            s.current &&
            ((s.current.style.left = Be.x + "px"),
            (s.current.style.top = Be.y + "px")));
      }
      O.style.transform =
        "scale(" + (K ? 0.8 : eL(A.lat, m.getZoom(), H, G, ne)) + ")";
    }
    ((0, R.useEffect)(() => {
      if (!_) return;
      let m = t.current,
        A = () => Wt(),
        E = () => {
          ut.current = !1;
        },
        O = () => {
          X.current || E();
        };
      const rememberZoom=()=>{gpsNavigationZoom.current=m.getZoom();};
      return (
        m.on("dragstart", E),
        m.on("zoomstart", O),
        m.on("zoomend", rememberZoom),
        m.on("move zoom", A),
        A(),
        () => {
          (m.off("dragstart", E), m.off("zoomstart", O), m.off("zoomend", rememberZoom), m.off("move zoom", A));
        }
      );
    }, [_, K, z]),
      (0, R.useEffect)(() => {
        _ && Wt();
      }, [q, _, K, z, y]));
    const GPS_DRIVING_ZOOM = 19;
    const gpsNavigationZoom = (0, R.useRef)(GPS_DRIVING_ZOOM);
    function Ka(m, A = !1) {
      let E = t.current;
      if (!E) return;
      let O = e.current,
        H = O.parentElement.getBoundingClientRect(),
        G = E.getSize(),
        ne = H.width,
        _e = H.height,
        Le = document.querySelector(".top-controls")?.getBoundingClientRect(),
        se = document.querySelector(".navigation-hud")?.getBoundingClientRect(),
        Be = ne > _e && _e < 600,
        mt = ne / 2,
        pt = _e - (z.trailer === "none" ? 48 : 100);
      s.current &&
        ((s.current.style.left = mt + "px"), (s.current.style.top = pt + "px"));
      let bt = J1(mt, pt, G.x, G.y, O.offsetLeft, O.offsetTop);
      if (!A) {
        ((ut.current = !0),
          E.setBearing(-(Ko.current?.camera ?? m.heading)),
          (X.current = !0));
        try {
          E.setView([m.lat, m.lon], gpsNavigationZoom.current, { animate: !1 });
        } finally {
          X.current = !1;
        }
      }
      let Rt = E.latLngToContainerPoint([m.lat, m.lon]);
      Math.hypot(Rt.x - bt.x, Rt.y - bt.y) > 0.3 &&
        E.panBy([Rt.x - bt.x, Rt.y - bt.y], { animate: !1 });
    }
    (0, R.useEffect)(() => {
      if (!_) return;
      let timer, frame;
      const refresh = () => {
          const map = t.current,
            container = e.current;
          if (
            !map ||
            !container ||
            container.clientWidth < 1 ||
            container.clientHeight < 1
          )
            return;
          map.invalidateSize({ animate: false, pan: false });
          if (K && ut.current && wa.current && te) {
            const pos = sl(wa.current, te.points);
            if (Number.isFinite(pos.lat) && Number.isFinite(pos.lon)) Ka(pos);
          }
        },
        schedule = () => {
          clearTimeout(timer);
          cancelAnimationFrame(frame);
          frame = requestAnimationFrame(() => {
            refresh();
            timer = setTimeout(refresh, 350);
          });
        };
      schedule();
      window.addEventListener("resize", schedule);
      window.addEventListener("orientationchange", schedule);
      window.visualViewport?.addEventListener("resize", schedule);
      const observer =
        typeof ResizeObserver !== "undefined"
          ? new ResizeObserver(schedule)
          : null;
      observer?.observe(e.current);
      return () => {
        clearTimeout(timer);
        cancelAnimationFrame(frame);
        observer?.disconnect();
        window.removeEventListener("resize", schedule);
        window.removeEventListener("orientationchange", schedule);
        window.visualViewport?.removeEventListener("resize", schedule);
      };
    }, [_, K, te]);
    (0, R.useEffect)(() => {
      if(!t.current||!i.current||!_)return;
      const layer=i.current.layerGroup().addTo(t.current);
      const draw=event=>{
        layer.clearLayers();
        for(const station of (event?.detail||window.gpsFuelMarkers||[])){
          if(!Number.isFinite(station.lat)||!Number.isFinite(station.lon))continue;
          const label=document.createElement('div');
          const title=document.createElement('strong');title.textContent='⛽ '+station.name;
          const prices=document.createElement('div');prices.textContent=station.prices;
          label.append(title,prices);
          i.current.marker([station.lat,station.lon],{icon:i.current.divIcon({className:'gps-route-fuel-marker',html:'<span aria-hidden="true">⛽</span>',iconSize:[30,30],iconAnchor:[15,15]}),title:'Station sur le trajet : '+station.name}).bindPopup(label).addTo(layer);
        }
      };
      window.addEventListener('gps-fuel-markers',draw);draw();
      return ()=>{window.removeEventListener('gps-fuel-markers',draw);layer.remove();};
    },[_]);
    const gpsBoot37 = (0, R.useRef)(true);
    (0, R.useEffect)(() => {
      if (te && Y && K) {
        try { sessionStorage.setItem('gps-session-v37', JSON.stringify({at:Date.now(),route:te,destination:Y,profile:z,active:K})); } catch {}
      }
    }, [te,Y,K,z]);
    (0, R.useEffect)(() => {
      if (!_ || !i.current || !t.current) return;
      window.couteauGps = {
        start({route,destination,profile}) {
          if (!Array.isArray(route?.points) || route.points.length<2 || !route.summary || !destination) throw Error('Trajet invalide.');
          pa.current?.abort();
          if(profile.travelMode!=='pedestrian')gpsNavigationZoom.current=GPS_DRIVING_ZOOM;
          ue(profile); Ze(destination); Kt(route); fo(0); Mi.current=-1; mo(null); T('');
          f.current?.remove();
          f.current=i.current.featureGroup([
            i.current.polyline(route.points,{color:'#ffffff',weight:12,opacity:.95}),
            i.current.polyline(route.points,{color:'#2466ed',weight:7,opacity:1})
          ]).addTo(t.current);
          Bi(route);
        },
        stop() {
          pa.current?.abort(); qe.current=false; zt(false); Kt(null); Ze(null); mo(null);
          f.current?.remove(); gpsSetOptions([]); T('');
          if(navigator.geolocation && Ma.current!==null) {navigator.geolocation.clearWatch(Ma.current);Ma.current=null;}
          try {sessionStorage.removeItem('gps-session-v37');speechSynthesis.cancel();} catch {}
        },
        getState:()=>({route:te,destination:Y,profile:z,active:K,position:q,zoom:t.current?.getZoom()}),
        zoom(delta){ut.current=false;const map=t.current;map.stop();map.setZoom(Math.max(8,Math.min(20,map.getZoom()+delta)),{animate:false});gpsNavigationZoom.current=map.getZoom();},
        recenter(){if(z.travelMode!=='pedestrian')gpsNavigationZoom.current=GPS_DRIVING_ZOOM;ut.current=true;Wa(true);if(q)Ka(sl(q,te?.points||[[q.lat,q.lon],[q.lat,q.lon]]));}
      };
      window.dispatchEvent(new Event('couteau-gps-ready'));
      return () => {delete window.couteauGps;};
    },[_,te,Y,K,z,q]);
    (0, R.useEffect)(()=>{window.dispatchEvent(new CustomEvent('couteau-gps-state',{detail:{active:K,destination:Y,profile:z,arrived:!!wi}}));},[K,Y,z,wi]);
    function Bi(m = te) {
      if (!m) return;
      if(z.travelMode!=='pedestrian')gpsNavigationZoom.current=GPS_DRIVING_ZOOM;
      gpsGuideStates46.delete(m);
      ((Va.current.next = Date.now() + (180 + Math.random() * 180) * 1e3),
        (ut.current = !0),
        Xe(!1),
        Wa(!0),
        (Wo.current = 0));
      let A = Date.now();
      ((Ot.current = {
        started: A,
        planned: A + m.summary.travelTimeInSeconds * 1e3,
        finished: !1,
      }),
        (ha.current = 0),
        Xo(m.summary.lengthInMeters / 1e3),
        cl(Ot.current.planned),
        mo(null),
        (Mi.current = -1),
        zt(!0));
    }
    function yl() {
      try {
        sessionStorage.removeItem("gps-session-v37");
      } catch {}
      if (!Ot.current || Ot.current.finished) return;
      Ot.current.finished = !0;
      let m = Date.now();
      if (
        (zt(!1),
        Xo(0),
        cl(m),
        mo({
          planned: Ot.current.planned,
          actual: m,
          delta: Math.round((m - Ot.current.planned) / 6e4),
          duration: Math.round((m - Ot.current.started) / 6e4),
          km: te.summary.lengthInMeters / 1e3,
        }),
        "speechSynthesis" in window && (speechSynthesis.cancel(), Ye))
      ) {
        let A = new SpeechSynthesisUtterance(
          "Vous êtes arrivé à destination. " +
            W1(Math.round((m - Ot.current.planned) / 6e4)),
        );
        ((A.lang = "fr-FR"), speechSynthesis.speak(A));
      }
    }
    (0, R.useEffect)(() => {
      if (!wi) return;
      let m = setTimeout(() => {
        (mo(null), Kt(null), Ze(null), f.current?.remove());
      }, 1e4);
      return () => clearTimeout(m);
    }, [wi]);
    let Qa = (m) =>
      new Date(m).toLocaleTimeString("fr-FR", {
        hour: "2-digit",
        minute: "2-digit",
        timeZone: "Europe/Paris",
      });
    async function Da(m) {
      if(window.couteauGpsPlanner) {window.couteauGpsPlanner.open(m);return;}
      if (
        ((m.id.startsWith("address-") ||
          m.id === "couteau-destination" ||
          m.id === "home") &&
          Wu(),
        Ze(m),
        Xe(!1),
        T(""),
        m.lat != null &&
          t.current &&
          (t.current.stop(),
          t.current.setView([m.lat, m.lon], 14, { animate: !1 })),
        m.approx &&
          m.id !== "home" &&
          !m.id.startsWith("address-") &&
          m.id !== "couteau-destination")
      )
        try {
          let O = (
            await (
              await fetch(
                "/gps/api/geocode?q=" +
                  encodeURIComponent(m.address + " " + m.city),
              )
            ).json()
          ).results?.[0];
          if (O && ["housenumber", "street"].includes(O.precision)) {
            let H = { ...m, lat: O.lat, lon: O.lon, approx: !1 };
            (Ze((G) => (G?.id === m.id ? H : G)),
              B((G) => G.map((ne) => (ne.id === m.id ? H : ne))));
          }
        } catch {}
      if (m.key)
        try {
          let A = await fetch("/gps/api/place-details", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ key: m.key }),
          });
          if (A.ok) {
            let E = await A.json();
            Ze((O) => (O?.id === m.id ? { ...O, ...E } : O));
          }
        } catch {}
    }
    ts.current = (place) => {
      if (
        ["marche", "foire", "brocante", "voyageur", "noel"].includes(place.kind)
      ) {
        gpsSetSignError("");
        gpsSetSignChoice(place);
      } else Da(place);
    };
    async function xl() { ja(); Wa(); }
    function Wa(m = !1) {
      if ((m || (ut.current = !0), T(""), !navigator.geolocation)) {
        T("La localisation n\u2019est pas disponible sur cet appareil.");
        return;
      }
      (Yt(!0),
        (pl.current = !m),
        Ma.current !== null &&
          (navigator.geolocation.clearWatch(Ma.current), (Ma.current = null)),
        (Ma.current = navigator.geolocation.watchPosition(
          (A) => {
            let E = iL(A.coords, wa.current);
            ((wa.current = E),
              (go.current = Date.now()),
              as(Date.now()),
              fe(E),
              Yt(!1),
              t.current &&
                pl.current &&
                (t.current.setView([E.lat, E.lon], 17), (pl.current = !1)));
          },
          (A) => {
            (Yt(!1),
              T(
                A.code === 1
                  ? "Autorisez la localisation dans les r\xE9glages du t\xE9l\xE9phone pour lancer le GPS."
                  : "Position introuvable. R\xE9essayez \xE0 l\u2019ext\xE9rieur.",
              ));
          },
          { enableHighAccuracy: !0, timeout: 15e3, maximumAge: 3e3 },
        )));
    }
    function tn(m, A) {
      (ue((E) => ({
        ...E,
        travelMode: "drive",
        vehicle: m,
        trailer: A,
        ...Jr(m, A),
        weight: A === "large" ? "3500" : "6000",
        confirmed: true,
      })),
        f.current && f.current.remove(),
        Kt(null),
        zt(!1));
    }
    let [gpsOptions, gpsSetOptions] = (0, R.useState)([]),
      [gpsChoice, gpsSetChoice] = (0, R.useState)(z.roadMode || "main"),
      [gpsPreviewBusy, gpsSetPreviewBusy] = (0, R.useState)(false),
      [gpsPreviewTick, gpsSetPreviewTick] = (0, R.useState)(0),
      [gpsPlanNow, gpsSetPlanNow] = (0, R.useState)(Date.now());
    let gpsPlanKey = JSON.stringify([
      Y?.id,
      Y?.lat,
      Y?.lon,
      z.travelMode,
      z.vehicle,
      z.trailer,
      z.tolls,
      z.roadMode, z.height, z.width, z.length, z.weight,
    ]);
    const gpsFuelLive41 = (0, R.useRef)(null);
    gpsFuelLive41.current = {
      q,
      z,
      ready: _,
      start: async (station, signal) => {
        if (
          !q ||
          q.waiting ||
          !Number.isFinite(q.lat) ||
          !Number.isFinite(q.lon)
        )
          throw Error("Activez votre position avant de lancer le guidage.");
        if (!_ || !i.current || !t.current)
          throw Error("La carte se prépare. Réessayez dans un instant.");
        const response = await fetch("/gps/api/route", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal,
          body: JSON.stringify({
            from: [q.lat, q.lon],
            to: [station.lat, station.lon],
            profile: z,
          }),
        });
        const route = await response.json();
        if (
          !response.ok ||
          !Array.isArray(route.points) ||
          route.points.length < 2 ||
          !route.summary
        )
          throw Error(route.error || "Impossible de calculer ce trajet.");
        if (signal.aborted) throw Error("Calcul annulé.");
        pa.current?.abort();
        const destination = {
          id: "fuel-" + station.id,
          kind: "fuel",
          name: station.name || "Station-service",
          address: station.address || "",
          city: station.city || "",
          lat: station.lat,
          lon: station.lon,
          approx: false,
          hours: "Station-service",
          day: "",
          merchants: "",
        };
        Ze(destination);
        Kt(route);
        fo(0);
        Mi.current = -1;
        f.current?.remove();
        f.current = i.current
          .featureGroup([
            i.current.polyline(route.points, {
              color: "#ffffff",
              weight: 12,
              opacity: 0.95,
            }),
            i.current.polyline(route.points, {
              color: "#2466ed",
              weight: 7,
              opacity: 1,
            }),
          ])
          .addTo(t.current);
        j(false);
        Xe(false);
        Bi(route);
        T("");
      },
    };
    (0, R.useEffect)(() => {
      let active = null;
      const reply = (requestId, ok, error) =>
        window.dispatchEvent(
          new CustomEvent("gps-fuel-navigate-result-v41", {
            detail: { requestId, ok, error },
          }),
        );
      const begin = (event) => {
        const { station, requestId } = event.detail || {};
        if (!requestId) return;
        if (active) {
          reply(requestId, false, "Un trajet est déjà en cours de calcul.");
          return;
        }
        if (
          !station ||
          !Number.isFinite(station.lat) ||
          !Number.isFinite(station.lon) ||
          Math.abs(station.lat) > 90 ||
          Math.abs(station.lon) > 180
        ) {
          reply(requestId, false, "Position de la station indisponible.");
          return;
        }
        const controller = new AbortController(),
          timer = setTimeout(() => controller.abort(), 25000);
        active = { requestId, controller };
        void gpsFuelLive41.current
          .start(station, controller.signal)
          .then(() => reply(requestId, true))
          .catch((error) =>
            reply(
              requestId,
              false,
              error.name === "AbortError"
                ? "Calcul interrompu. Réessayez."
                : error.message || "Trajet indisponible.",
            ),
          )
          .finally(() => {
            clearTimeout(timer);
            if (active?.requestId === requestId) active = null;
          });
      };
      const cancel = (event) => {
        if (active?.requestId === event.detail?.requestId)
          active.controller.abort();
      };
      window.addEventListener("gps-fuel-navigate-v41", begin);
      window.addEventListener("gps-fuel-navigate-cancel-v41", cancel);
      return () => {
        active?.controller.abort();
        window.removeEventListener("gps-fuel-navigate-v41", begin);
        window.removeEventListener("gps-fuel-navigate-cancel-v41", cancel);
      };
    }, []);

    (0, R.useEffect)(() => {
      const option = gpsOptions.find(
        (o) => o.id === gpsChoice && o.key === gpsPlanKey && o.route,
      );
      const selectedRoute = K ? te : Y ? option?.route || null : te;
      const selectedProfile = K ? z : { ...z, roadMode: gpsChoice };
      window.dispatchEvent(
        new CustomEvent("gps-fuel-state-v35", {
          detail: {
            route: selectedRoute,
            position: q,
            active: K,
            profile: selectedProfile,
          },
        }),
      );
    }, [te, q, K, z, Y, gpsOptions, gpsChoice, gpsPlanKey]);

    (0, R.useEffect)(() => {
      if (!Y || K || !q || !Number.isFinite(Y.lat) || !Number.isFinite(Y.lon)) {
        gpsSetOptions([]);
        gpsSetPreviewBusy(false);
        return;
      }
      let controller = new AbortController(),
        origin = [q.lat, q.lon],
        key = gpsPlanKey;
      gpsSetOptions([]);
      gpsSetPreviewBusy(true);
      gpsSetChoice((selected) =>
        z.travelMode === "pedestrian"
          ? "direct"
          : selected || z.roadMode || "main",
      );
      async function calculate(id) {
        try {
          let response = await fetch("/gps/api/route", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            signal: controller.signal,
            body: JSON.stringify({
              from: origin,
              to: [Y.lat, Y.lon],
              profile: { ...z, roadMode: id },
            }),
          });
          let route = await response.json();
          if (
            !response.ok ||
            !Array.isArray(route.points) ||
            route.points.length < 2
          )
            throw Error(route.error || "Trajet indisponible");
          let reports = null,
            partial = false;
          if (z.travelMode !== "pedestrian")
            try {
              const bounds = gpsRouteBounds(route.points);
              const reportResponse = await fetch(
                "/gps/api/route-reports?bounds=" +
                  encodeURIComponent(bounds.join(",")),
                { signal: controller.signal },
              );
              if (reportResponse.ok) {
                const data = await reportResponse.json();
                reports = data.reports;
                partial = !!data.partial;
              }
            } catch (error) {
              if (controller.signal.aborted) throw error;
            }
          const stats =
            z.travelMode === "pedestrian"
              ? { known: 0, reports: [] }
              : gpsRouteStats(route, Y1, ef, reports, Date.now());
          return {
            id,
            route,
            origin,
            key,
            known: stats.known,
            reports: stats.reports,
            partial,
          };
        } catch (error) {
          return { id, key, error: error.message };
        }
      }
      Promise.all(
        (z.travelMode === "pedestrian" ? ["direct"] : ["direct", "main"]).map(
          calculate,
        ),
      ).then((options) => {
        if (controller.signal.aborted) return;
        gpsSetOptions(options);
        gpsSetPreviewBusy(false);
        gpsSetChoice((selected) =>
          options.some((o) => o.id === selected && o.route)
            ? selected
            : options.find((o) => o.route)?.id || selected,
        );
      });
      return () => controller.abort();
    }, [
      gpsPlanKey,
      !!q,
      K,
      gpsPreviewTick,
      Math.round((q?.lat || 0) * 2000),
      Math.round((q?.lon || 0) * 2000),
    ]);
    (0, R.useEffect)(() => {
      if (!Y || K) return;
      const timer = setInterval(() => gpsSetPlanNow(Date.now()), 1000);
      return () => clearInterval(timer);
    }, [!!Y, K]);
    (0, R.useEffect)(() => {
      if (!Y || K) return;
      const timer = setInterval(() => gpsSetPreviewTick((v) => v + 1), 120000);
      return () => clearInterval(timer);
    }, [!!Y, K]);
    (0, R.useEffect)(() => {
      if (K || !_ || !Y) return;
      const option = gpsOptions.find(
        (o) => o.id === gpsChoice && o.key === gpsPlanKey && o.route,
      );
      if (!option) return;
      f.current?.remove();
      f.current = i.current
        .featureGroup([
          i.current.polyline(option.route.points, {
            color: "#ffffff",
            weight: 12,
            opacity: 0.95,
          }),
          i.current.polyline(option.route.points, {
            color: "#2466ed",
            weight: 7,
            opacity: 1,
          }),
        ])
        .addTo(t.current);
    }, [gpsOptions, gpsChoice, K, _, gpsPlanKey]);

    async function an(m = Y) {
      if (!m) return;
      if (!q) {
        Wa();
        T("Activez votre position pour calculer le trajet.");
        return;
      }
      if (!Number.isFinite(m.lat) || !Number.isFinite(m.lon)) {
        T("Choisissez une adresse sur la carte.");
        return;
      }
      const selected = gpsOptions.find(
        (o) => o.id === gpsChoice && o.key === gpsPlanKey && o.route,
      );
      if (!selected || m.lat !== Y?.lat || m.lon !== Y?.lon) {
        gpsSetPreviewTick((v) => v + 1);
        return;
      }
      bi(true);
      T("");
      try {
        let route = selected.route;
        if (Fa(q.lat, q.lon, selected.origin[0], selected.origin[1]) > 0.1) {
          const response = await fetch("/gps/api/route", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              from: [q.lat, q.lon],
              to: [m.lat, m.lon],
              profile: { ...z, roadMode: gpsChoice },
            }),
          });
          route = await response.json();
          if (!response.ok) throw Error(route.error || "Trajet indisponible");
        }
        ue((p) => ({ ...p, roadMode: gpsChoice }));
        Kt(route);
        fo(0);
        Mi.current = -1;
        f.current?.remove();
        f.current = i.current
          .featureGroup([
            i.current.polyline(route.points, {
              color: "#ffffff",
              weight: 12,
              opacity: 0.95,
            }),
            i.current.polyline(route.points, {
              color: "#2466ed",
              weight: 7,
              opacity: 1,
            }),
          ])
          .addTo(t.current);
        Bi(route);
      } catch (error) {
        T(error.message || "Trajet indisponible.");
      } finally {
        bi(false);
      }
    }
    const gpsSearch42 = (0, R.useRef)({ id: 0, controller: null });
    const [gpsSearchNote42, gpsSetSearchNote42] = (0, R.useState)("");
    (0, R.useEffect)(() => {
      gpsSearch42.current.id++;
      gpsSearch42.current.controller?.abort();
      gpsSetSearchNote42("");
      ee(false);
    }, [Ca]);
    async function on() {
      if (Ca.trim().length < 3) return;
      const state = gpsSearch42.current;
      state.controller?.abort();
      const id = ++state.id,
        controller = new AbortController();
      state.controller = controller;
      ee(true);
      T("");
      $([]);
      gpsSetSearchNote42("Recherche des adresses et des commerces…");
      try {
        const params = new URLSearchParams({ q: Ca });
        if (
          q &&
          !q.waiting &&
          Number.isFinite(q.lat) &&
          Number.isFinite(q.lon)
        ) {
          params.set("lat", q.lat);
          params.set("lon", q.lon);
        }
        const response = await fetch("/gps/api/search?" + params, {
          signal: controller.signal,
        });
        const data = await response.json();
        if (!response.ok) throw Error(data.error || "Recherche indisponible.");
        if (id !== state.id) return;
        $(data.results || []);
        gpsSetSearchNote42(data.note || "");
        if (!data.results?.length && !data.note)
          T("Aucun résultat trouvé. Précisez votre recherche.");
      } catch (error) {
        if (id === state.id && error.name !== "AbortError") {
          gpsSetSearchNote42("");
          T(error.message);
        }
      } finally {
        if (id === state.id) ee(false);
      }
    }
    async function ns() {
      if (!(co.trim().length < 3)) {
        (Go(!0), T(""));
        try {
          let m = await fetch("/gps/api/geocode?q=" + encodeURIComponent(co)),
            A = await m.json();
          if (!m.ok) throw Error(A.error);
          (fl(A.results || []),
            A.results?.length ||
              T("Adresse introuvable. Pr\xE9cisez la ville."));
        } catch (m) {
          T(m.message);
        } finally {
          Go(!1);
        }
      }
    }
    function Sl(m) {
      (rl(m), ho(m.name), fl([]));
      try {
        localStorage.setItem("gps-voyage-home", JSON.stringify(m));
      } catch {
        T("Impossible d\u2019enregistrer l\u2019adresse sur cet appareil.");
      }
    }
    function ls(m) {
      let A = window.SpeechRecognition || window.webkitSpeechRecognition;
      if (!A) {
        T(
          "Pour dicter, utilisez le micro du clavier de votre t\xE9l\xE9phone.",
        );
        return;
      }
      $u.current?.abort();
      let E = new A();
      (($u.current = E),
        (E.lang = "fr-FR"),
        (E.interimResults = !1),
        (E.onstart = () => Vo(!0)),
        (E.onend = () => Vo(!1)),
        (E.onerror = () => {
          (Vo(!1),
            T("Dict\xE9e interrompue. Vous pouvez \xE9crire l\u2019adresse."));
        }),
        (E.onresult = (O) => {
          let H = O.results[0][0].transcript;
          m === "home" ? ho(H) : (et(H), Xe(!0), Ze(null));
        }),
        E.start());
    }
    function ae() {
      if (!Ia) {
        (j(!0), T("Enregistrez votre adresse de retour."));
        return;
      }
      let m = {
        id: "home",
        kind: "terrain",
        name: "Mon adresse",
        city: "",
        address: Ia.name,
        day: "",
        hours: "",
        merchants: "",
        lat: Ia.lat,
        lon: Ia.lon,
        approx: !["housenumber", "street"].includes(Ia.precision),
      };
      Da(m);
    }
    return (0, S.jsxs)("main", {
      className:
        "gps-app " +
        (K ? "is-navigating " : "") +
        (z.travelMode === "pedestrian" ? "is-pedestrian" : ""),
      children: [
        gpsSignChoice &&
          (0, S.jsx)("div", {
            className: "gps-sign-shade",
            children: (0, S.jsxs)("section", {
              className: "gps-sign-dialog",
              role: "dialog",
              "aria-modal": true,
              "aria-labelledby": "gps-sign-title",
              children: [
                (0, S.jsx)("h2", {
                  id: "gps-sign-title",
                  children: "Voulez-vous y aller ?",
                }),
                (0, S.jsx)("strong", { children: gpsSignChoice.name }),
                (0, S.jsx)("p", { children: Fu(gpsSignChoice, je) }),
                (0, S.jsx)("p", {
                  children: [gpsSignChoice.address, gpsSignChoice.city]
                    .filter(Boolean)
                    .join(" · "),
                }),
                gpsSignChoice.approx &&
                  (0, S.jsx)("small", {
                    children: "Position approximative : centre de la ville.",
                  }),
                gpsSignError &&
                  (0, S.jsx)("p", { role: "alert", children: gpsSignError }),
                (0, S.jsxs)("div", {
                  className: "gps-sign-actions",
                  children: [
                    (0, S.jsx)("button", {
                      type: "button",
                      className: "primary",
                      disabled: gpsSignBusy,
                      onClick: gpsGoToSign,
                      children: gpsSignBusy
                        ? "Calcul du trajet…"
                        : "Oui, y aller",
                    }),
                    (0, S.jsx)("button", {
                      type: "button",
                      className: "secondary",
                      disabled: gpsSignBusy,
                      onClick: () => gpsSetSignChoice(null),
                      children: "Non, rester sur la carte",
                    }),
                  ],
                }),
              ],
            }),
          }),
        (0, S.jsx)("div", { className: "map", ref: e }),
        K &&
          (0, S.jsx)("div", {
            className: "navigation-rig",
            ref: s,
            "aria-label": Di,
            children: (0, S.jsx)("div", {
              className:
                "vehicle-pointer " +
                (z.trailer !== "none" ? "towing " : "") +
                (St ? "speed-sway" : ""),
              children: (0, S.jsxs)("div", {
                className: "vehicle-icons",
                children: [
                  (0, S.jsxs)("div", {
                    "data-rig-car": "",
                    className: "turn-sprite",
                    children: [
                      (0, S.jsx)("img", {
                        "data-view-rear": "",
                        src: Ct.navigationImage,
                        alt: "",
                      }),
                      (0, S.jsx)("span", {
                        "data-view-side": "",
                        style: { backgroundImage: `url(${Ct.turnImage})` },
                      }),
                    ],
                  }),
                  z.trailer !== "none" &&
                    (0, S.jsxs)("div", {
                      className: "rig-trailer turn-sprite",
                      "data-rig-trailer": "",
                      children: [
                        (0, S.jsx)("img", {
                          "data-view-rear": "",
                          src: st.navigationImage,
                          alt: "",
                        }),
                        (0, S.jsx)("span", {
                          "data-view-side": "",
                          style: { backgroundImage: `url(${st.turnImage})` },
                        }),
                      ],
                    }),
                ],
              }),
            }),
          }),
        (0, S.jsx)("aside", {
          className: "road-report-tools",
          "aria-label": "Signaler sur la route",
          children: Zu.map((m) =>
            (0, S.jsxs)(
              "button",
              {
                "aria-label": "Signaler : " + m.label,
                disabled: Jo,
                onClick: () => Me(m.id),
                children: [
                  m.id === "danger"
                    ? (0, S.jsx)("span", {
                        dangerouslySetInnerHTML: { __html: $r },
                      })
                    : (0, S.jsx)("span", { children: m.symbol }),
                  (0, S.jsx)("small", { children: m.label }),
                ],
              },
              m.id,
            ),
          ),
        }),
        Ai &&
          (0, S.jsx)("div", {
            className: "report-message",
            role: "status",
            children: Ai,
          }),
        Ie &&
          (0, S.jsxs)("section", {
            className: "road-alert",
            role: "alert",
            children: [
              (0, S.jsx)("button", {
                className: "alert-close",
                "aria-label": "Fermer l\u2019alerte",
                onClick: () => Ti(null),
                children: (0, S.jsx)(Na, { size: 22 }),
              }),
              Ie.report.kind === "danger" &&
                (0, S.jsx)("span", {
                  className: "alert-illustration",
                  dangerouslySetInnerHTML: { __html: $r },
                }),
              (0, S.jsx)("strong", {
                children:
                  Ie.report.kind === "danger"
                    ? rh(Ie.distance)
                    : Zu.find((m) => m.id === Ie.report.kind)?.label +
                      " dans " +
                      Ie.distance +
                      " m",
              }),
              Ie.report.source !== "official" &&
                (0, S.jsxs)("div", {
                  children: [
                    (0, S.jsx)("button", {
                      disabled: Jo,
                      onClick: () => Me(Ie.report.kind, Ie.report.id, !0),
                      children: "Oui, toujours l\xE0",
                    }),
                    (0, S.jsx)("button", {
                      disabled: Jo,
                      onClick: () => Me(Ie.report.kind, Ie.report.id, !1),
                      children: "Non, termin\xE9",
                    }),
                  ],
                }),
            ],
          }),
        (0, S.jsxs)("header", {
          className: "appbar",
          children: [
            (0, S.jsx)("a", {
              className: "gps-return",
              href: "/",
              "aria-label": "Retour \xE0 Couteau Suisse",
              children: (0, S.jsx)(Bu, { size: 24 }),
            }),
            (0, S.jsxs)("div", {
              className: "brand",
              children: [
                (0, S.jsx)("span", {
                  className: "brandmark",
                  children: (0, S.jsx)(ku, { size: 26 }),
                }),
                (0, S.jsxs)("div", {
                  children: [
                    (0, S.jsx)("strong", { children: "GPS Voyage" }),
                    (0, S.jsx)("small", { children: "FRANCE" }),
                  ],
                }),
              ],
            }),
            (0, S.jsxs)("button", {
              className: "settings-button",
              onClick: () => j(!0),
              children: [
                (0, S.jsx)(Eu, { size: 20 }),
                (0, S.jsx)("span", { children: "R\xE9glages" }),
              ],
            }),
          ],
        }),
        (0, S.jsxs)("section", {
          className: "top-controls",
          children: [
            (0, S.jsxs)("form", {
              className: "search-box",
              onSubmit: (m) => {
                (m.preventDefault(), on());
              },
              children: [
                (0, S.jsx)(Ru, { size: 21 }),
                (0, S.jsx)("input", {
                  "aria-label": "Destination",
                  placeholder: "Adresse, commerce, tabac, McDo…",
                  value: Ca,
                  onChange: (m) => {
                    (et(m.target.value), $([]), Xe(!0), Ze(null));
                  },
                }),
                Ca &&
                  (0, S.jsx)("button", {
                    type: "button",
                    "aria-label": "Effacer la recherche",
                    onClick: () => {
                      (et(""), $([]));
                    },
                    children: (0, S.jsx)(Na, { size: 18 }),
                  }),
                (0, S.jsx)("button", {
                  type: "button",
                  "aria-label": "Dicter une adresse",
                  onClick: () => ls("destination"),
                  children: (0, S.jsx)(Fo, { size: 19 }),
                }),
                (0, S.jsx)("button", {
                  className: "search-submit",
                  type: "submit",
                  children: Xu ? "\u2026" : "Chercher",
                }),
              ],
            }),
            gpsSearchNote42 &&
              (0, S.jsx)("div", {
                className: "commerce-search-note",
                role: "status",
                children: gpsSearchNote42,
              }),
            Ii.length > 0 &&
              (0, S.jsx)("div", {
                className: "address-results",
                children: Ii.map((m, A) =>
                  (0, S.jsxs)(
                    "button",
                    {
                      onClick: () => {
                        $([]);
                        gpsSetSearchNote42("");
                        Da({
                          id: "address-" + (m.id || A),
                          kind: "terrain",
                          name: m.name,
                          city: m.city || "",
                          address: m.address || m.name,
                          day: "",
                          hours: m.hours || "",
                          merchants: "",
                          lat: m.lat,
                          lon: m.lon,
                          approx: !["housenumber", "street", "poi"].includes(
                            m.precision,
                          ),
                        });
                      },
                      children: [
                        (0, S.jsx)(No, { size: 18 }),
                        m.label || m.name,
                      ],
                    },
                    A,
                  ),
                ),
              }),
          ],
        }),
        (0, S.jsxs)("aside", {
          className: "places-panel " + (De ? "" : "collapsed"),
          children: [
            (0, S.jsxs)("div", {
              className: "panel-top",
              children: [
                (0, S.jsxs)("div", {
                  children: [
                    (0, S.jsx)("span", {
                      className: "eyebrow",
                      children: "\xC0 D\xC9COUVRIR",
                    }),
                    (0, S.jsx)("h1", {
                      children: Ca ? "R\xE9sultats" : "Sur votre carte",
                    }),
                  ],
                }),
                (0, S.jsx)("button", {
                  "aria-label": "Fermer la liste",
                  onClick: () => Xe(!1),
                  children: (0, S.jsx)(Na, { size: 20 }),
                }),
              ],
            }),
            (0, S.jsxs)("div", {
              className: "panel-meta",
              children: [
                P
                  ? "Chargement des lieux\u2026"
                  : `${ma.length.toLocaleString("fr-FR")} lieux`,
                (0, S.jsx)("span", { children: b }),
              ],
            }),
            (0, S.jsxs)("div", {
              className: "place-list",
              children: [
                oe.map((m) => {
                  let A = Ci.find((O) => O.id === m.kind),
                    E = Fu(m, je);
                  return (0, S.jsxs)(
                    "button",
                    {
                      className: "place-card",
                      onClick: () => Da(m),
                      children: [
                        m.photo
                          ? (0, S.jsx)(
                              "img",
                              {
                                className: "list-photo",
                                src: m.photo,
                                alt: m.name,
                                loading: "lazy",
                                onError: (O) => {
                                  O.currentTarget.style.display = "none";
                                },
                              },
                              m.photo + c,
                            )
                          : (0, S.jsx)("span", {
                              className: "category-icon",
                              style: {
                                background: A.color + "15",
                                color: A.color,
                              },
                              children: A.symbol,
                            }),
                        (0, S.jsxs)("div", {
                          children: [
                            (0, S.jsx)("strong", { children: m.name }),
                            (0, S.jsx)("span", {
                              className: "place-city",
                              children: m.city,
                            }),
                            (0, S.jsx)("small", {
                              className: E.includes("en cours")
                                ? "open-status"
                                : "",
                              children: E,
                            }),
                            /\d/.test(m.merchants) &&
                              (0, S.jsxs)("small", {
                                children: [m.merchants, " commer\xE7ants"],
                              }),
                          ],
                        }),
                        q &&
                          m.lat != null &&
                          (0, S.jsxs)("span", {
                            className: "km",
                            children: [
                              Math.round(Fa(q.lat, q.lon, m.lat, m.lon)),
                              " km",
                            ],
                          }),
                      ],
                    },
                    m.id,
                  );
                }),
                !P &&
                  !ma.length &&
                  (0, S.jsx)("p", {
                    className: "empty",
                    children:
                      "Aucun lieu renseign\xE9 pour cette s\xE9lection.",
                  }),
              ],
            }),
            (0, S.jsxs)("div", {
              className: "panel-footer",
              children: [
                (0, S.jsx)("span", { className: "sync-dot" }),
                P
                  ? "Actualisation\u2026"
                  : "Les lieux suivent la zone de la carte",
              ],
            }),
          ],
        }),
        (0, S.jsx)("div", {
          className: "map-tools",
          children: (0, S.jsx)("button", {
            "aria-label": "Ma position",
            className: "locate",
            onClick: () => Wa(),
            children: (0, S.jsx)(nl, {}),
          }),
        }),
        gpsSpeedVisible &&
          !gpsAlertsMuted &&
          St &&
          (0, S.jsxs)("div", {
            className: "speed-warning",
            role: "alert",
            children: [
              (0, S.jsx)("strong", { children: St }),
              (0, S.jsxs)("span", {
                children: [Math.round(q?.speed || 0), " km/h"],
              }),
              (0, S.jsx)("button", {
                type: "button",
                onClick: () => gpsSetSpeedVisible(false),
                children: "Compris",
              }),
              (0, S.jsx)("button", {
                type: "button",
                className: "mute-attelage",
                onClick: gpsToggleAlerts,
                children: "Désactiver ces notifications",
              }),
            ],
          }),
        Ku &&
          (0, S.jsxs)("div", {
            className: "toast",
            children: [(0, S.jsx)(Fo, { size: 18 }), "Je vous \xE9coute\u2026"],
          }),
        ca &&
          (0, S.jsx)("div", {
            className: "toast",
            children: "Recherche de votre position\u2026",
          }),
        w &&
          (0, S.jsxs)("div", {
            className: "toast warning",
            role: "alert",
            children: [
              (0, S.jsx)("span", { children: w }),
              (0, S.jsx)("button", {
                "aria-label": "Fermer le message",
                onClick: () => T(""),
                children: (0, S.jsx)(Na, { size: 18 }),
              }),
            ],
          }),
        Y &&
          !K &&
          !wi &&
          (0, S.jsxs)("section", {
            className: "destination-card " + (K ? "guiding" : ""),
            children: [
              (0, S.jsxs)("div", {
                className: "destination-heading",
                children: [
                  (0, S.jsx)("span", {
                    className: "category-icon",
                    style: { color: Ci.find((m) => m.id === Y.kind)?.color },
                    children: Ci.find((m) => m.id === Y.kind)?.symbol,
                  }),
                  (0, S.jsxs)("div", {
                    children: [
                      (0, S.jsx)("small", {
                        children:
                          Y.id === "couteau-destination"
                            ? "Votre destination"
                            : Ci.find((m) => m.id === Y.kind)?.label,
                      }),
                      (0, S.jsx)("h2", { children: Y.name }),
                    ],
                  }),
                  (0, S.jsx)("button", {
                    "aria-label": "Fermer la fiche",
                    onClick: () => {
                      (Ze(null), Kt(null), zt(!1), f.current?.remove());
                    },
                    children: (0, S.jsx)(Na, {}),
                  }),
                ],
              }),
              Y.photo &&
                (0, S.jsx)(
                  "img",
                  {
                    className: "place-photo",
                    src: Y.photo,
                    alt: Y.name,
                    onLoad: (m) => {
                      m.currentTarget.style.display = "block";
                    },
                    onError: (m) => {
                      m.currentTarget.style.display = "none";
                    },
                  },
                  Y.photo,
                ),
              !Y.photo &&
                ml &&
                (0, S.jsx)("div", {
                  className: "street-view",
                  children: po
                    ? (0, S.jsxs)(S.Fragment, {
                        children: [
                          (0, S.jsx)(
                            "iframe",
                            {
                              title: "Vue de la rue pr\xE8s de la destination",
                              src: po.viewer,
                              allow: "fullscreen",
                              referrerPolicy: "strict-origin-when-cross-origin",
                            },
                            po.viewer,
                          ),
                          (0, S.jsxs)("small", {
                            children: [
                              "Vue de la rue \xB7 ",
                              po.distance,
                              " m de la destination",
                            ],
                          }),
                        ],
                      })
                    : (0, S.jsx)("small", {
                        children: Ju
                          ? "Recherche d\u2019une vue de la rue\u2026"
                          : uf
                            ? "Vue momentan\xE9ment indisponible."
                            : "Aucune vue de la rue disponible ici.",
                      }),
                }),
              z.trailer === "large" &&
                z.travelMode !== "pedestrian" &&
                (0, S.jsx)("p", {
                  className: "attelage-note",
                  role: "note",
                  children:
                    "Guidage grand attelage gratuit · 12 m · 2,50 m · 3,5 t chargé. Largeur du convoi : 2,50 m. Restrictions selon OpenStreetMap : respectez la signalisation.",
                }),
              (0, S.jsxs)("section", {
                className: "convoy-choice48",
                children: [
                  (0, S.jsxs)("button", {
                    type: "button",
                    "aria-pressed":
                      z.vehicle === "truck" && z.trailer === "large",
                    onClick: () => {
                      gpsSetConfirmed46(null);
                      ue((p) => ({ ...p, travelMode: "drive" }));
                      tn("truck", "large");
                    },
                    children: [
                      (0, S.jsx)("strong", { children: "MODE CONVOI" }),
                      (0, S.jsx)("span", {
                        children: "Camion + caravane · Itinéraire poids lourd",
                      }),
                    ],
                  }),
                  (0, S.jsx)("button", {
                    type: "button",
                    "aria-pressed":
                      z.travelMode !== "pedestrian" &&
                      z.vehicle === "car" &&
                      z.trailer === "none",
                    onClick: () => {
                      gpsSetConfirmed46(null);
                      ue((p) => ({
                        ...p,
                        travelMode: "drive",
                        vehicle: "car",
                        trailer: "none",
                        ...Jr("car", "none"),
                        confirmed: true,
                      }));
                      Kt(null);
                      zt(false);
                      f.current?.remove();
                    },
                    children: "MODE NORMAL · Voiture",
                  }),
                  (0, S.jsx)("button", {
                    type: "button",
                    "aria-pressed": z.travelMode === "pedestrian",
                    onClick: () => {
                      gpsSetConfirmed46(null);
                      ue((p) => ({
                        ...p,
                        travelMode: "pedestrian",
                        vehicle: "car",
                        trailer: "none",
                        ...Jr("car", "none"),
                        confirmed: true,
                      }));
                      Kt(null);
                      zt(false);
                      f.current?.remove();
                    },
                    children: "MODE PIÉTON · À pied",
                  }),
                  (0, S.jsx)("p", {
                    children:
                      z.vehicle === "truck" && z.trailer === "large"
                        ? "Camion + grande caravane sélectionnés"
                        : "Véhicule sélectionné : " +
                          Ct.name +
                          (z.trailer === "none"
                            ? " sans remorque"
                            : " + " + st.name),
                  }),
                ],
              }),
              gpsHeavy48 &&
                (0, S.jsx)("div", {
                  className: "heavy-confirm48",
                  role: "dialog",
                  "aria-modal": true,
                  "aria-label": "Confirmer le mode poids lourd",
                  children: (0, S.jsxs)("section", {
                    children: [
                      (0, S.jsx)("h2", {
                        children: "Vous êtes en mode gros gabarit",
                      }),
                      (0, S.jsx)("p", {
                        children:
                          Ct.name +
                          " + " +
                          st.name +
                          ". Longueur : " +
                          z.length +
                          " m. Hauteur : " +
                          z.height +
                          " m. Largeur : " +
                          z.width +
                          " m. Poids : " +
                          Number(z.weight) / 1000 +
                          " t.",
                      }),
                      (0, S.jsx)("p", {
                        children:
                          "Les restrictions connues de la carte sont prises en compte. Respectez la signalisation sur place.",
                      }),
                      (0, S.jsx)("button", {
                        type: "button",
                        className: "primary",
                        onClick: () => {
                          const option = gpsOptions.find(
                            (o) =>
                              o.id === gpsChoice &&
                              o.key === gpsPlanKey &&
                              o.route,
                          );
                          if (!option?.route?.vehicleRestrictionsChecked) {
                            gpsSetHeavy48(false);
                            T("Attendez le calcul du trajet adapté au convoi.");
                            return;
                          }
                          gpsSetHeavy48(false);
                          an();
                        },
                        children: "CONFIRMER",
                      }),
                      (0, S.jsx)("button", {
                        type: "button",
                        className: "secondary",
                        onClick: () => {
                          gpsSetHeavy48(false);
                          gpsSetConfirmed46(null);
                          tn(z.vehicle, "none");
                          T("Véhicule seul sélectionné. Recalcul des trajets…");
                        },
                        children: "MODE NORMAL — VÉHICULE SEUL",
                      }),
                    ],
                  }),
                }),
              gpsRouteCards(
                S,
                gpsOptions,
                gpsChoice,
                gpsSetChoice,
                gpsPreviewBusy,
                () => gpsSetPreviewTick((v) => v + 1),
                z.travelMode === "pedestrian",
                gpsPlanNow,
                Qa,
              ),
              !q &&
                (0, S.jsx)("button", {
                  type: "button",
                  className: "secondary",
                  onClick: () => Wa(),
                  children: "Activer ma position pour voir les trajets",
                }),
              (0, S.jsxs)("p", {
                children: [
                  (0, S.jsx)(No, { size: 16 }),
                  Y.address,
                  Y.approx &&
                    (0, S.jsx)("span", {
                      className: "approx",
                      children: "Centre du lieu",
                    }),
                ],
              }),
              (Y.day || Y.hours || Y.start) &&
                (0, S.jsxs)("p", {
                  className: Fu(Y, je).includes("en cours")
                    ? "open-status"
                    : "",
                  children: [(0, S.jsx)(Pu, { size: 16 }), Fu(Y, je)],
                }),
              /\d/.test(Y.merchants) &&
                (0, S.jsxs)("p", {
                  children: [
                    (0, S.jsx)(Uu, { size: 16 }),
                    Y.merchants,
                    " commer\xE7ants",
                  ],
                }),
              Y.phone &&
                (0, S.jsxs)("a", {
                  className: "phone",
                  href: "tel:" + Y.phone.replace(/[^+0-9]/g, ""),
                  children: [(0, S.jsx)(Ou, { size: 16 }), Y.phone],
                }),
              (0, S.jsxs)("button", {
                className: "primary",
                disabled:
                  Zo ||
                  gpsPreviewBusy ||
                  !gpsOptions.some(
                    (o) =>
                      o.id === gpsChoice && o.key === gpsPlanKey && o.route,
                  ),
                onClick: () => {
                  const option = gpsOptions.find(
                    (o) =>
                      o.id === gpsChoice && o.key === gpsPlanKey && o.route,
                  );
                  if (!option) return;
                  if (gpsConfirmed46 === option.route) {
                    if (
                      ["large", "small", "trailer"].includes(z.trailer) &&
                      z.travelMode !== "pedestrian"
                    )
                      gpsSetHeavy48(true);
                    else an();
                  } else gpsSetConfirmed46(option.route);
                },
                children: [
                  (0, S.jsx)(so, { size: 20 }),
                  Zo
                    ? "Préparation…"
                    : gpsConfirmed46 ===
                        gpsOptions.find(
                          (o) =>
                            o.id === gpsChoice &&
                            o.key === gpsPlanKey &&
                            o.route,
                        )?.route
                      ? "Y ALLER"
                      : "CONFIRMER",
                ],
              }),
              (0, S.jsx)("button", {
                className: "secondary destination-no",
                onClick: () => {
                  (Ze(null), Kt(null), zt(!1), f.current?.remove());
                },
                children: "Non",
              }),
            ],
          }),
        K &&
          te &&
          (0, S.jsxs)(S.Fragment, {
            children: [
              (0, S.jsxs)("section", {
                className: "trip-progress",
                "aria-label": "Progression du trajet",
                children: [
                  (0, S.jsxs)("div", {
                    className: "trip-destination",
                    children: [
                      (0, S.jsx)("strong", {
                        title: Y?.address || Y?.name,
                        children: Y?.address || Y?.name || "Destination",
                      }),
                      (0, S.jsxs)("span", {
                        children: [
                          (
                            dl ?? te.summary.lengthInMeters / 1e3
                          ).toLocaleString("fr-FR", {
                            maximumFractionDigits: 1,
                          }),
                          " km restants",
                        ],
                      }),
                    ],
                  }),
                  (0, S.jsxs)("div", {
                    className: "trip-track",
                    role: "progressbar",
                    "aria-label": "Trajet parcouru",
                    "aria-valuemin": 0,
                    "aria-valuemax": 100,
                    "aria-valuenow": Math.round(ha.current * 100),
                    children: [
                      (0, S.jsx)("span", {
                        className: "trip-fill",
                        style: { width: `${ha.current * 100}%` },
                      }),
                      (0, S.jsxs)("span", {
                        className: "trip-vehicle",
                        style: {
                          left: `${Math.max(0, Math.min(100, ha.current * 100))}%`,
                        },
                        children: [
                          (0, S.jsx)("img", { src: Ct.image, alt: "" }),
                          z.trailer !== "none" &&
                            (0, S.jsx)("img", { src: st.image, alt: "" }),
                        ],
                      }),
                    ],
                  }),
                ],
              }),
              (0, S.jsxs)("section", {
                className: "navigation-hud",
                "aria-label": "Guidage",
                children: [
                  (0, S.jsxs)("div", {
                    className: "hud-totals",
                    children: [
                      (0, S.jsxs)("strong", {
                        children: [
                          Ga ? Qa(Ga) : "\u2014",
                          (0, S.jsx)("small", { children: "Arriv\xE9e" }),
                        ],
                      }),
                      (0, S.jsxs)("button", {
                        className: "recenter-trip",
                        onClick: () => {
                          if(z.travelMode!=='pedestrian')gpsNavigationZoom.current=GPS_DRIVING_ZOOM;
                          q && (Ka(sl(q, te.points)), Wt());
                        },
                        children: [(0, S.jsx)(nl, { size: 15 }), "Recentrer"],
                      }),
                    ],
                  }),
                  (0, S.jsxs)("div", {
                    className: "hud-direction",
                    children: [
                      (0, S.jsx)(so, { size: 20 }),
                      (0, S.jsx)("strong", {
                        children: It
                          ? "Nouveau trajet en cours\u2026"
                          : (() => {
                              const message =
                                  te.instructions[Za]?.message ||
                                  "Suivez le trajet",
                                offset = Number(
                                  te.instructions[Za]?.routeOffsetInMeters,
                                ),
                                length = Number(te.summary?.lengthInMeters),
                                progress = Number(ha.current);
                              if (
                                !q ||
                                !Number.isFinite(offset) ||
                                !Number.isFinite(length) ||
                                !Number.isFinite(progress)
                              )
                                return message;
                              const d = Math.max(0, offset - progress * length),
                                label =
                                  d <= 12
                                    ? "Maintenant"
                                    : d < 1000
                                      ? "Dans " +
                                        Math.max(10, Math.round(d / 10) * 10) +
                                        " m"
                                      : "Dans " +
                                        (d / 1000)
                                          .toFixed(1)
                                          .replace(".", ",") +
                                        " km";
                              return [
                                (0, S.jsx)(
                                  "span",
                                  {
                                    className: "gps-turn-distance",
                                    children: label,
                                  },
                                  "distance",
                                ),
                                message,
                              ];
                            })(),
                      }),
                    ],
                  }),
                  (0, S.jsxs)("div", {
                    className: "hud-actions",
                    children: [
                      (0, S.jsx)("button", {
                        "aria-label": "Activer ou couper la voix",
                        onClick: () => {
                          (ju(!Ye), Ye && speechSynthesis.cancel());
                        },
                        children: Ye
                          ? (0, S.jsx)(ll, { size: 19 })
                          : (0, S.jsx)(ul, { size: 19 }),
                      }),
                      (0, S.jsx)("button", {
                        onClick: () => {
                          window.couteauGpsPlanner.open(Y);
                        },
                        className: "gps-stop-legacy",
                        children: "Arr\xEAter",
                      }),
                    ],
                  }),
                ],
              }),
            ],
          }),
        wi &&
          (0, S.jsxs)("div", {
            className: "arrival-notification",
            role: "status",
            children: [
              (0, S.jsx)(da, { size: 28 }),
              (0, S.jsxs)("div", {
                children: [
                  (0, S.jsx)("strong", { children: "Vous \xEAtes arriv\xE9" }),
                  (0, S.jsx)("p", { children: W1(wi.delta) }),
                  (0, S.jsx)("small", {
                    children:
                      "Arrivée prévue : " +
                      Qa(wi.planned) +
                      " · Arrivée réelle : " +
                      Qa(wi.actual),
                  }),
                  (0, S.jsx)("button", {
                    className: "arrival-understood",
                    onClick: () => {
                      mo(null);
                      Kt(null);
                      Ze(null);
                      f.current?.remove();
                    },
                    children: "Compris",
                  }),
                ],
              }),
            ],
          }),
        F &&
          (0, S.jsx)("div", {
            className: "modal-backdrop",
            onClick: () => j(!1),
            children: (0, S.jsxs)("section", {
              className: "vehicle-modal",
              role: "dialog",
              "aria-modal": "true",
              "aria-labelledby": "vehicle-title",
              onClick: (m) => m.stopPropagation(),
              children: [
                (0, S.jsxs)("div", {
                  className: "modal-heading",
                  children: [
                    (0, S.jsxs)("div", {
                      children: [
                        (0, S.jsx)("span", {
                          className: "eyebrow",
                          children: "R\xC9GLAGES",
                        }),
                        (0, S.jsx)("h2", {
                          id: "vehicle-title",
                          children: "Mon v\xE9hicule",
                        }),
                      ],
                    }),
                    (0, S.jsx)("button", {
                      "aria-label": "Fermer les r\xE9glages",
                      onClick: () => j(!1),
                      children: (0, S.jsx)(Na, {}),
                    }),
                  ],
                }),
                (0, S.jsxs)("section", {
                  className: "travel-mode",
                  children: [
                    (0, S.jsx)("h3", { children: "Mode de déplacement" }),
                    (0, S.jsx)("div", {
                      className: "road-options",
                      children: [
                        { id: "drive", name: "Voiture" },
                        { id: "pedestrian", name: "Piéton" },
                      ].map((mode) =>
                        (0, S.jsx)(
                          "button",
                          {
                            type: "button",
                            "aria-pressed":
                              (z.travelMode || "drive") === mode.id,
                            className:
                              (z.travelMode || "drive") === mode.id
                                ? "chosen"
                                : "",
                            onClick: () => {
                              ue((p) => ({
                                ...p,
                                travelMode: mode.id,
                                vehicle: "car",
                                trailer: "none",
                                ...Jr("car", "none"),
                                confirmed: true,
                              }));
                              Kt(null);
                              zt(false);
                              f.current?.remove();
                            },
                            children: mode.name,
                          },
                          mode.id,
                        ),
                      ),
                    }),
                  ],
                }),
                z.trailer === "large" &&
                  (0, S.jsxs)("section", {
                    className: "setting-section",
                    children: [
                      (0, S.jsx)("h3", {
                        children: "Grande caravane — ensemble complet",
                      }),
                      (0, S.jsx)("p", {
                        children:
                          "Longueur : 12 m · Hauteur : 2,50 m · Poids chargé : 3,5 t",
                      }),
                      (0, S.jsx)("p", {
                        children: "Largeur du convoi : 2,50 m.",
                      }),
                      (0, S.jsx)("p", {
                        role: "note",
                        children:
                          "Guidage gratuit grand attelage : restrictions connues dans OpenStreetMap prises en compte. Service public à capacité limitée. Respectez les panneaux ; les données peuvent être incomplètes.",
                      }),
                    ],
                  }),
                (0, S.jsxs)("section", {
                  className: "setting-section",
                  children: [
                    (0, S.jsx)("h3", {
                      children: "Alerte caravane et remorque",
                    }),
                    (0, S.jsx)("p", {
                      children:
                        "À partir de 110 km/h · notification de 7 secondes",
                    }),
                    (0, S.jsx)("button", {
                      type: "button",
                      className: "secondary",
                      "aria-pressed": !gpsAlertsMuted,
                      onClick: gpsToggleAlerts,
                      children: gpsAlertsMuted
                        ? "Réactiver les notifications"
                        : "Désactiver les notifications",
                    }),
                  ],
                }),
                (0, S.jsxs)("details", {
                  className: "setting-section",
                  children: [
                    (0, S.jsxs)("summary", {
                      children: [
                        "Route ",
                        (0, S.jsx)("span", {
                          children:
                            z.roadMode === "direct"
                              ? "Par les villes"
                              : "Grandes routes",
                        }),
                      ],
                    }),
                    (0, S.jsx)("div", {
                      className: "road-options",
                      children: [
                        {
                          id: "direct",
                          title: "Par les villes",
                          subtitle: "Petites villes et travers\xE9es possibles",
                        },
                        {
                          id: "main",
                          title: "Grandes routes",
                          subtitle: "D\xE9tour possible",
                        },
                      ].map((m) =>
                        (0, S.jsxs)(
                          "button",
                          {
                            className: z.roadMode === m.id ? "chosen" : "",
                            onClick: () => {
                              (ue((A) => ({ ...A, roadMode: m.id })),
                                Kt(null),
                                zt(!1),
                                f.current?.remove());
                            },
                            children: [
                              (0, S.jsx)("div", {
                                children: (0, S.jsx)("strong", {
                                  children: m.title,
                                }),
                              }),
                              z.roadMode === m.id &&
                                (0, S.jsx)(da, { size: 18 }),
                            ],
                          },
                          m.id,
                        ),
                      ),
                    }),
                  ],
                }),
                (0, S.jsxs)("details", {
                  className: "setting-section",
                  children: [
                    (0, S.jsxs)("summary", {
                      children: [
                        "P\xE9age ",
                        (0, S.jsx)("span", {
                          children: z.tolls ? "Avec p\xE9age" : "Sans p\xE9age",
                        }),
                      ],
                    }),
                    (0, S.jsx)("div", {
                      className: "toll-options",
                      children: [!0, !1].map((m) =>
                        (0, S.jsxs)(
                          "button",
                          {
                            className: z.tolls === m ? "chosen" : "",
                            onClick: () => {
                              (ue((A) => ({ ...A, tolls: m })),
                                Kt(null),
                                zt(!1),
                                f.current?.remove());
                            },
                            children: [
                              m
                                ? "Avec p\xE9age"
                                : "Sans p\xE9age \xB7 \xC9vite les autoroutes",
                              z.tolls === m && (0, S.jsx)(da, { size: 17 }),
                            ],
                          },
                          String(m),
                        ),
                      ),
                    }),
                  ],
                }),
                (0, S.jsxs)("details", {
                  className: "setting-section",
                  children: [
                    (0, S.jsxs)("summary", {
                      children: [
                        "Mon adresse ",
                        (0, S.jsx)("span", {
                          children: Ia ? "Enregistr\xE9e" : "Ajouter",
                        }),
                      ],
                    }),
                    (0, S.jsxs)("div", {
                      className: "home-entry",
                      children: [
                        (0, S.jsx)("input", {
                          "aria-label": "Mon adresse de retour",
                          placeholder: "Num\xE9ro, rue et ville",
                          value: co,
                          onChange: (m) => {
                            (ho(m.target.value), fl([]));
                          },
                        }),
                        (0, S.jsx)("button", {
                          "aria-label": "Dicter mon adresse",
                          onClick: () => ls("home"),
                          children: (0, S.jsx)(Fo, { size: 20 }),
                        }),
                      ],
                    }),
                    (0, S.jsx)("button", {
                      className: "secondary small-action",
                      onClick: ns,
                      children: nf
                        ? "Recherche\u2026"
                        : "Rechercher mon adresse",
                    }),
                    Yu.map((m, A) =>
                      (0, S.jsxs)(
                        "button",
                        {
                          className: "home-result",
                          onClick: () => Sl(m),
                          children: [
                            (0, S.jsx)(No, { size: 16 }),
                            m.name,
                            (0, S.jsx)(da, { size: 17 }),
                          ],
                        },
                        A,
                      ),
                    ),
                    Ia &&
                      (0, S.jsxs)(S.Fragment, {
                        children: [
                          (0, S.jsxs)("p", {
                            className: "saved-address",
                            children: [(0, S.jsx)(da, { size: 15 }), Ia.name],
                          }),
                          (0, S.jsx)("button", {
                            className: "secondary small-action",
                            onClick: () => {
                              (j(!1), ae());
                            },
                            children: "Retourner \xE0 mon adresse",
                          }),
                        ],
                      }),
                  ],
                }),
                (0, S.jsxs)("details", {
                  className: "setting-section",
                  children: [
                    (0, S.jsxs)("summary", {
                      children: [
                        "Lieux sur la carte ",
                        (0, S.jsxs)("span", {
                          children: [V.length, " cat\xE9gories"],
                        }),
                      ],
                    }),
                    Ci.map((m) =>
                      (0, S.jsxs)(
                        "button",
                        {
                          className: "layer-row",
                          onClick: () =>
                            W((A) =>
                              A.includes(m.id)
                                ? A.filter((E) => E !== m.id)
                                : [...A, m.id],
                            ),
                          children: [
                            (0, S.jsx)("strong", { children: m.label }),
                            (0, S.jsx)("span", {
                              className:
                                "switch " + (V.includes(m.id) ? "on" : ""),
                            }),
                          ],
                        },
                        m.id,
                      ),
                    ),
                  ],
                }),
                (0, S.jsxs)("details", {
                  className: "setting-section",
                  children: [
                    (0, S.jsxs)("summary", {
                      children: [
                        "Voix ",
                        (0, S.jsx)("span", {
                          children: ba
                            ? "Petites phrases activ\xE9es"
                            : "Guidage uniquement",
                        }),
                      ],
                    }),
                    (0, S.jsxs)("button", {
                      className: "layer-row",
                      "aria-pressed": ba,
                      onClick: lf,
                      children: [
                        (0, S.jsx)("strong", { children: "Petites phrases" }),
                        (0, S.jsx)("span", {
                          className: "switch " + (ba ? "on" : ""),
                        }),
                      ],
                    }),
                  ],
                }),
                (0, S.jsx)("h3", { children: "Je roule avec" }),
                (0, S.jsx)("div", {
                  className: "vehicle-options",
                  children: Hu.map((m) =>
                    (0, S.jsxs)(
                      "button",
                      {
                        className:
                          z.vehicle === m.id
                            ? "vehicle-option chosen"
                            : "vehicle-option",
                        onClick: () => tn(m.id, z.trailer),
                        children: [
                          (0, S.jsx)("img", { src: m.image, alt: m.name }),
                          (0, S.jsx)("strong", { children: m.name }),
                          z.vehicle === m.id &&
                            (0, S.jsx)("span", {
                              className: "check",
                              children: (0, S.jsx)(da, { size: 15 }),
                            }),
                        ],
                      },
                      m.id,
                    ),
                  ),
                }),
                (0, S.jsx)("h3", { children: "J\u2019attelle" }),
                (0, S.jsx)("div", {
                  className: "trailer-options",
                  children: Nu.map((m) =>
                    (0, S.jsxs)(
                      "button",
                      {
                        className:
                          z.trailer === m.id
                            ? "vehicle-option chosen"
                            : "vehicle-option",
                        onClick: () => tn(z.vehicle, m.id),
                        children: [
                          m.image
                            ? (0, S.jsx)("img", { src: m.image, alt: m.name })
                            : (0, S.jsx)("span", {
                                className: "no-trailer",
                                children: (0, S.jsx)(zu, { size: 34 }),
                              }),
                          (0, S.jsx)("strong", { children: m.name }),
                          (0, S.jsx)("small", {
                            children: m.detail || "V\xE9hicule seul",
                          }),
                          z.trailer === m.id &&
                            (0, S.jsx)("span", {
                              className: "check",
                              children: (0, S.jsx)(da, { size: 15 }),
                            }),
                        ],
                      },
                      m.id,
                    ),
                  ),
                }),
                (0, S.jsxs)("div", {
                  className: "length-result",
                  children: [
                    (0, S.jsx)("span", {
                      children: "Longueur de l\u2019ensemble",
                    }),
                    (0, S.jsxs)("strong", {
                      children: [
                        z.length.toLocaleString("fr-FR"),
                        " ",
                        (0, S.jsx)("small", { children: "m" }),
                      ],
                    }),
                  ],
                }),
                (0, S.jsxs)("button", {
                  className: "primary",
                  onClick: () => {
                    (ue((m) => ({ ...m, confirmed: !0 })), j(!1), T(""));
                  },
                  children: [
                    (0, S.jsx)(da, { size: 19 }),
                    "Enregistrer mon v\xE9hicule",
                  ],
                }),
                (0, S.jsx)("button", {
                  className: "secondary",
                  onClick: () => j(!1),
                  children: "Retour \xE0 la carte",
                }),
              ],
            }),
          }),
      ],
    });
  }
  var cL = ka(Vu(), 1);
  (0, dL.createRoot)(document.getElementById("gps-root")).render(
    (0, cL.jsx)(hh, {}),
  );
})();
/*! Bundled license information:

scheduler/cjs/scheduler.production.js:
  (**
   * @license React
   * scheduler.production.js
   *
   * Copyright (c) Meta Platforms, Inc. and affiliates.
   *
   * This source code is licensed under the MIT license found in the
   * LICENSE file in the root directory of this source tree.
   *)

react/cjs/react.production.js:
  (**
   * @license React
   * react.production.js
   *
   * Copyright (c) Meta Platforms, Inc. and affiliates.
   *
   * This source code is licensed under the MIT license found in the
   * LICENSE file in the root directory of this source tree.
   *)

react-dom/cjs/react-dom.production.js:
  (**
   * @license React
   * react-dom.production.js
   *
   * Copyright (c) Meta Platforms, Inc. and affiliates.
   *
   * This source code is licensed under the MIT license found in the
   * LICENSE file in the root directory of this source tree.
   *)

react-dom/cjs/react-dom-client.production.js:
  (**
   * @license React
   * react-dom-client.production.js
   *
   * Copyright (c) Meta Platforms, Inc. and affiliates.
   *
   * This source code is licensed under the MIT license found in the
   * LICENSE file in the root directory of this source tree.
   *)

react/cjs/react-jsx-runtime.production.js:
  (**
   * @license React
   * react-jsx-runtime.production.js
   *
   * Copyright (c) Meta Platforms, Inc. and affiliates.
   *
   * This source code is licensed under the MIT license found in the
   * LICENSE file in the root directory of this source tree.
   *)

leaflet/dist/leaflet-src.js:
  (* @preserve
   * Leaflet 1.9.4, a JS library for interactive maps. https://leafletjs.com
   * (c) 2010-2023 Vladimir Agafonkin, (c) 2010-2011 CloudMade
   *)

lucide-react/dist/esm/shared/src/utils/mergeClasses.mjs:
lucide-react/dist/esm/shared/src/utils/toKebabCase.mjs:
lucide-react/dist/esm/shared/src/utils/toCamelCase.mjs:
lucide-react/dist/esm/shared/src/utils/toPascalCase.mjs:
lucide-react/dist/esm/defaultAttributes.mjs:
lucide-react/dist/esm/shared/src/utils/hasA11yProp.mjs:
lucide-react/dist/esm/context.mjs:
lucide-react/dist/esm/Icon.mjs:
lucide-react/dist/esm/createLucideIcon.mjs:
lucide-react/dist/esm/icons/check.mjs:
lucide-react/dist/esm/icons/chevron-left.mjs:
lucide-react/dist/esm/icons/clock.mjs:
lucide-react/dist/esm/icons/compass.mjs:
lucide-react/dist/esm/icons/locate-fixed.mjs:
lucide-react/dist/esm/icons/map-pin.mjs:
lucide-react/dist/esm/icons/mic.mjs:
lucide-react/dist/esm/icons/minus.mjs:
lucide-react/dist/esm/icons/navigation.mjs:
lucide-react/dist/esm/icons/phone.mjs:
lucide-react/dist/esm/icons/search.mjs:
lucide-react/dist/esm/icons/settings-2.mjs:
lucide-react/dist/esm/icons/users.mjs:
lucide-react/dist/esm/icons/volume-2.mjs:
lucide-react/dist/esm/icons/volume-x.mjs:
lucide-react/dist/esm/icons/x.mjs:
lucide-react/dist/esm/lucide-react.mjs:
  (**
   * @license lucide-react v1.31.0 - ISC
   *
   * This source code is licensed under the ISC license.
   * See the LICENSE file in the root directory of this source tree.
   *)
*/

function gpsRigMotion(root, fix, carHeading, trailerHeading, cameraHeading) {
  if (!root) return;
  const moving = !fix.waiting && fix.accuracy <= 50 && fix.speed > 2;
  root.classList.toggle("rig-rolling", moving);
  const car = root.querySelector("[data-rig-car]");
  const trailer = root.querySelector("[data-rig-trailer]");
  if (!car || !trailer) return;
  // Both sprites pivot at the coupling; trailer heading is integrated from travel distance.
  trailer.style.left = "2px";
  trailer.style.top = "62.5px";
  trailer.style.setProperty("transform-origin", "38px 5.5px", "important");
  car.style.transformOrigin = "30px 66px";
  const yaw =
    ((((trailerHeading - cameraHeading + 540) % 360) - 180) * Math.PI) / 180;
  let hitch = root.querySelector("[data-rig-hitch]");
  if (!hitch) {
    hitch = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    hitch.setAttribute("data-rig-hitch", "");
    hitch.setAttribute("viewBox", "0 0 80 190");
    hitch.setAttribute("aria-hidden", "true");
    hitch.innerHTML =
      '<path stroke="#16202b" stroke-width="4" fill="none"/><path stroke="#b5bdc5" stroke-width="2" fill="none"/><circle r="2.5" fill="#dde2e6" stroke="#39434f"/>';
    root.querySelector(".vehicle-icons").prepend(hitch);
  }
  const point = (x, y) => [
    40 + x * Math.cos(yaw) - y * Math.sin(yaw),
    68 + x * Math.sin(yaw) + y * Math.cos(yaw),
  ];
  const a = point(-5, 6),
    b = point(5, 6);
  const d = "M40 66 L" + a[0] + " " + a[1] + " M40 66 L" + b[0] + " " + b[1];
  hitch.querySelectorAll("path").forEach((p) => p.setAttribute("d", d));
  const ball = hitch.querySelector("circle");
  ball.setAttribute("cx", "40");
  ball.setAttribute("cy", "66");
}
