/* TOP 000 — Rundown operacional (V3)
   Offline-first. Nada aqui depende de rede para funcionar. */
(function () {
  "use strict";

  var CFG = window.TOP000_CONFIG || {};
  var LS = "top1833:"; // keep earlier saved team and completed cues
  var D = null;
  var lang = "en";
  var theme = get("theme", "dark");
  var myDept = get("myDept", "all");
  var onlyMine = get("onlyMine", "0") === "1";
  var done = JSON.parse(get("done", "{}"));
  var delay = parseInt(get("delay", "0"), 10) || 0;
  var delayMeta = null;
  try { delayMeta = JSON.parse(get("delayMeta", "null")); } catch (e) { delayMeta = null; }
  var state = { day: "all", block: "all", secs: [], q: "" };
  var nowTimer = null;

  function get(k, d) { try { var v = localStorage.getItem(LS + k); return v === null ? d : v; } catch (e) { return d; } }
  function set(k, v) { try { localStorage.setItem(LS + k, v); } catch (e) {} }
  function $(s) { return document.querySelector(s); }
  function $$(s) { return Array.prototype.slice.call(document.querySelectorAll(s)); }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) {
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  function t(k) { return (D && D.ui[lang] && D.ui[lang][k]) || k; }
  function deptName(c) { return D.depts[c] ? (D.depts[c][lang] || D.depts[c].en) : c; }

  /* ---------- tempo ---------- */
  function eventNowAbs() {
    var s = new Date().toLocaleString("en-US", { timeZone: D.event.timezone,
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", hour12: false });
    var m = s.match(/(\d+)\/(\d+)\/(\d+),?\s+(\d+):(\d+)/);
    if (!m) return null;
    var h = (+m[4] === 24) ? 0 : +m[4];
    var cur = Date.UTC(+m[3], +m[1] - 1, +m[2], h, +m[5]);
    var b = D.event.dayDates["1"].split("-");
    return Math.round((cur - Date.UTC(+b[0], +b[1] - 1, +b[2], 0, 0)) / 60000);
  }
  function pad(n) { return (n < 10 ? "0" : "") + n; }
  function shift(hhmm, mins) {
    if (!mins) return hhmm;
    var p = hhmm.split(":"), v = (+p[0] * 60 + +p[1] + mins) % 1440;
    if (v < 0) v += 1440;
    return pad(Math.floor(v / 60)) + ":" + pad(v % 60);
  }
  function fmtDur(m) {
    var h = Math.floor(m / 60), mm = m % 60;
    if (h && mm) return h + "h " + pad(mm) + "m";
    return h ? h + "h" : mm + "m";
  }
  function fmtGap(m) {
    m = Math.abs(m);
    if (m < 60) return m + " " + t("min");
    return Math.floor(m / 60) + "h " + pad(m % 60) + "m";
  }

  /* ---------- boot ---------- */
  fetch("data/rundown.json", { cache: "no-cache" })
    .then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); })
    .then(function (j) { D = j; init(); })
    .catch(function (e) {
      $("#boot").innerHTML = '<div class="boot-in"><p>Load error</p><span style="background:none;' +
        'color:#AFC0D6;font-family:Barlow;height:auto;font-size:13px;letter-spacing:0">' +
        esc(e.message) + "</span></div>";
    });

  function init() {
    lang = (D.languages && D.languages[0]) || "en";
    document.documentElement.lang = lang;
    document.body.dataset.theme = theme;
    $("#nightBtn").setAttribute("aria-pressed", theme === "night");
    document.querySelector('meta[name="theme-color"]').setAttribute("content", theme === "night" ? "#11151a" : "#f7f8fa");
    if (!D.languages || D.languages.length < 2) $("#langBtn").hidden = true;
    buildStatic();
    render();
    renderDelayBar();
    wire();
    startNow();
    syncPull();
    setTimeout(function () { $("#boot").classList.add("gone"); }, 200);
    setTimeout(function () { var b = $("#boot"); if (b) b.remove(); }, 850);
  }

  function buildStatic() {
    $("#mastSub").textContent = "Operational schedule · " + t("subtitle");
    $("#eventDates").textContent = D.event.dates[lang];
    $("#eventLocation").textContent = D.event.location;
    $("#q").placeholder = t("search");
    // Reset button has a visible icon and label in the new layout.
    // The jump button has a descriptive label in the new layout.
    $("#sheetTitle").textContent = t("settings");
    $("#lblMyDept").textContent = t("mydept");
    $("#lblDelay").textContent = t("delay");
    $("#clearDone").textContent = t("clear_done");
    $("#glossBox").querySelector("summary").textContent = t("glossary");
    $("#notesBox").querySelector("summary").textContent = t("notes");
    $("#keyBox").querySelector("summary").textContent = t("deptkey");
    $("#delayHint").textContent = syncOn()
      ? "Shifts the schedule for everyone."
      : "Shifts every displayed time on this phone only.";
    $("#footTxt").textContent = D.event.location + " · " + D.event.dates[lang] + " · local time (24h)";

    var dr = $("#dayRow");
    dr.innerHTML = '<button class="chip day" data-day="all" aria-pressed="true">' +
      esc(t("all_days")) + "</button>";
    [1, 2, 3, 4].forEach(function (d) {
      dr.insertAdjacentHTML("beforeend", '<button class="chip day" data-day="' + d +
        '" aria-pressed="false">' + esc(D.days[d][lang].label) + "</button>");
    });

    var sr = $("#secRow");
    sr.innerHTML = "";
    Object.keys(D.sections).forEach(function (k) {
      sr.insertAdjacentHTML("beforeend", '<button class="chip sec" data-sec="' + esc(k) +
        '" aria-pressed="false">' + esc(D.sections[k][lang] || k) + "</button>");
    });

    var opts = '<option value="all">' + esc(t("all_depts")) + "</option>";
    Object.keys(D.depts).sort(function (a, b) {
      return deptName(a).localeCompare(deptName(b)); }).forEach(function (k) {
      opts += '<option value="' + k + '">' + esc(deptName(k)) + "</option>";
    });
    $("#deptSel").innerHTML = opts;
    $("#myDept").innerHTML = opts;
    $("#deptSel").value = myDept;
    $("#myDept").value = myDept;
    $("#modeAll").textContent = t("all_cues");
    $("#modeMine").textContent = t("only_mine");

    fillBlocks();

    $("#gloss").innerHTML = D.glossary[lang].map(function (g) {
      return "<dt>" + esc(g.t) + "</dt><dd>" + esc(g.d) + "</dd>"; }).join("");
    $("#notes").innerHTML = D.cues.filter(function (c) { return c[lang].flag; })
      .map(function (c) { return "<li><b>" + esc(c.ref) + "</b> — " +
        esc(c[lang].flag) + "</li>"; }).join("");
    $("#deptKey").innerHTML = Object.keys(D.depts).map(function (k) {
      return '<span class="tag" style="background:' + D.depts[k].color + '">' +
        esc(deptName(k)) + "</span>"; }).join("");
    $("#verTxt").textContent = "Data version: " + D.event.version +
      " · rev " + D.event.revision + " · " + D.cues.length + " cues";
  }

  function fillBlocks() {
    var seen = [], sel = $("#blockSel"), cur = state.block;
    D.cues.forEach(function (c) {
      if (state.day !== "all" && String(c.day) !== state.day) return;
      if (seen.indexOf(c[lang].block) < 0) seen.push(c[lang].block);
    });
    sel.innerHTML = '<option value="all">' + esc(t("all_moments")) + "</option>" +
      seen.map(function (b) { return '<option value="' + esc(b) + '">' + esc(b) + "</option>"; }).join("");
    sel.value = seen.indexOf(cur) >= 0 ? cur : "all";
    state.block = sel.value;
  }

  /* ---------- filtros ---------- */
  function mine(c) { return myDept !== "all" && c.depts.indexOf(myDept) >= 0; }

  function match(c) {
    if (state.day !== "all" && String(c.day) !== state.day) return false;
    if (onlyMine && myDept !== "all" && !mine(c)) return false;
    if (state.block !== "all" && c[lang].block !== state.block) return false;
    if (state.secs.length && state.secs.indexOf(c.section) < 0) return false;
    if (state.q) {
      var hay = [c[lang].activity, c[lang].lead, c[lang].direction, c[lang].outcome,
        c[lang].block, c[lang].section, c.ref].concat(
        Object.keys(c.tasks).map(function (k) { return c.tasks[k]; })).join(" ").toLowerCase();
      if (hay.indexOf(state.q) < 0) return false;
    }
    return true;
  }

  function render() {
    var rows = D.cues.filter(match);
    var html = "", curDay = null, curBlock = null;
    rows.forEach(function (c) {
      if (c.day !== curDay) {
        curDay = c.day; curBlock = null;
        html += '<div class="dayhd"><b>' + esc(D.days[c.day][lang].label) + "</b><span>" +
          esc(D.days[c.day][lang].date) + "</span></div>";
      }
      if (c[lang].block !== curBlock) {
        curBlock = c[lang].block;
        var bl = rows.filter(function (x) { return x.day === c.day && x[lang].block === curBlock; });
        html += '<div class="blkhd"><h2>' + esc(curBlock) + "</h2><em>" +
          esc(shift(bl[0].start, delay)) + " – " +
          esc(shift(bl[bl.length - 1].end, delay)) + "</em></div>";
      }
      html += cueHTML(c);
    });
    $("#list").innerHTML = html;
    $("#empty").hidden = rows.length > 0;
    $("#empty").textContent = t("empty");

    var marked = D.cues.filter(function (c) { return !!done[c.ref]; }).length;
    $("#statAll").textContent = D.cues.length;
    $("#statVisible").textContent = rows.length;
    $("#statDone").textContent = marked;
    $("#statDays").textContent = Object.keys(D.days).length;
    var pct = Math.round(marked * 100 / (D.cues.length || 1));
    $("#progressText").textContent = pct + "% complete";
    $("#progressFill").style.width = pct + "%";
    var mineN = rows.filter(mine).length;
    $("#count").innerHTML = "<b>" + rows.length + "</b> " + esc(t("shown")) +
      (myDept !== "all" ? ' · <b class="hl">' + mineN + "</b> " + esc(t("mine_count")) : "");

    var cs = $("#csBanner");
    if (myDept !== "all") {
      cs.hidden = false;
      $("#csTitle").textContent = deptName(myDept);
      $("#csSub").textContent = mineN + " " + t("cues") + " · " +
        (onlyMine ? t("only_mine") : t("all_cues"));
    } else cs.hidden = true;

    $("#modeRow").hidden = (myDept === "all");
    $("#modeAll").setAttribute("aria-pressed", String(!onlyMine));
    $("#modeMine").setAttribute("aria-pressed", String(onlyMine));
    paintNow();
  }

  function cueHTML(c) {
    var L = c[lang], isMine = mine(c);
    var tags = c.depts.map(function (d) {
      return '<span class="tag' + (d === myDept ? ' own' : '') +
        '" style="background:' + D.depts[d].color + '">' + esc(deptName(d)) + '</span>';
    }).join('');
    var job = isMine ? '<div class="job"><b>' + esc(t('your_job')).toUpperCase() +
      '</b>' + esc(c.tasks[myDept] || t('no_task')) + '</div>' : '';
    var dl = '<dl>';
    [['lead',L.lead],['direction',L.direction],['outcome',L.outcome]].forEach(function (item) {
      if (item[1]) dl += '<div><dt>' + esc(t(item[0])) + '</dt><dd>' + esc(item[1]) + '</dd></div>';
    });
    dl += '</dl>';
    var tasks = Object.keys(c.tasks).map(function (k) {
      return '<div class="trow' + (k === myDept ? ' own' : '') + '"><span class="tag" style="background:' +
        D.depts[k].color + '">' + esc(deptName(k)) + '</span><p>' + esc(c.tasks[k]) + '</p></div>';
    }).join('');
    var teamBlock = tasks ? '<div class="teams"><b>' + esc(t('team_tasks')).toUpperCase() +
      '</b><div class="teams-grid">' + tasks + '</div></div>' : '';
    var flag = L.flag ? '<div class="flag"><b>' + esc(t('check')) + '</b>' + esc(L.flag) + '</div>' : '';
    return '<article class="cue' + (done[c.ref] ? ' is-done' : '') +
      (isMine ? ' is-mine' : '') + '" data-ref="' + esc(c.ref) +
      '" data-abs="' + c.absStart + '" data-absend="' + c.absEnd + '">' +
      '<div class="cue-hd">' +
      '<div class="tcol"><span class="t1">' + esc(shift(c.start, delay)) + '</span><span class="t2">' +
      esc(shift(c.end, delay)) + ' · ' + esc(fmtDur(c.durMin)) + '</span></div>' +
      '<div class="mid"><div class="cue-kicker"><span>CUE ' + esc(c.ref) + '</span><i></i><span>' +
      esc(fmtDur(c.durMin)) + '</span></div><h3 class="act">' + esc(L.activity) + '</h3>' +
      '<div class="meta"><span class="tag secTag" style="background:' + c.sectionColor + '">' +
      esc(L.section) + '</span>' + tags + '</div>' + job + '</div>' +
      '<div class="cue-actions"><button class="tick" aria-label="' + esc(t('done')) + '" aria-pressed="' +
      String(!!done[c.ref]) + '">✓</button><button type="button" class="cue-chevron" aria-expanded="false" aria-label="Show details for cue ' + esc(c.ref) + '">⌄</button></div></div>' +
      '<div class="cue-bd">' + dl + teamBlock + flag + '</div></article>';
  }

  function renderCountersOnly() {
    var marked = D.cues.filter(function (c) { return !!done[c.ref]; }).length;
    $("#statDone").textContent = marked;
    var pct = Math.round(marked * 100 / (D.cues.length || 1));
    $("#progressText").textContent = pct + "% complete";
    $("#progressFill").style.width = pct + "%";
  }

  /* ---------- agora ---------- */
  function startNow() { paintNow(); if (nowTimer) clearInterval(nowTimer); nowTimer = setInterval(paintNow, 20000); }

  function paintNow() {
    var abs = eventNowAbs(), bar = $("#nowbar");
    if (abs === null) { bar.hidden = true; return; }
    var adj = abs - delay;
    var all = D.cues;
    var first = all[0];
    var last = all.reduce(function (a, b) { return b.absEnd > a.absEnd ? b : a; });

    $$(".cue").forEach(function (el) {
      var s = +el.dataset.abs, e = +el.dataset.absend;
      el.classList.toggle("is-now", adj >= s && adj < e);
      el.classList.toggle("is-past", adj >= e);
    });

    var label;
    if (adj < first.absStart) {
      label = t("not_started") + " · " + t("starts_in") + " " + fmtGap(first.absStart - adj);
    } else if (adj >= last.absEnd) {
      label = t("finished");
    } else {
      var cur = all.filter(function (c) { return adj >= c.absStart && adj < c.absEnd; });
      // em cues simultâneos, o da minha equipe ganha
      var pick = cur.filter(mine)[0] || cur[0];
      if (pick) {
        label = pick.ref + " · " + pick[lang].activity + " — " +
          t("ends_in") + " " + fmtGap(pick.absEnd - adj);
      } else {
        var nx = all.filter(function (c) { return c.absStart > adj; })
          .sort(function (a, b) { return a.absStart - b.absStart; })[0];
        label = nx ? (t("next") + ": " + nx.ref + " · " + nx[lang].activity + " — " +
          t("starts_in") + " " + fmtGap(nx.absStart - adj)) : t("finished");
      }
    }
    $("#nowLabel").textContent = label;
    bar.hidden = false;
  }

  function jumpNow() {
    var el = $(".cue.is-now") || $(".cue:not(.is-past)");
    if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  /* ---------- atraso ---------- */
  function renderDelayBar() {
    var bar = $("#delaybar");
    if (!delay) { bar.hidden = true; return; }
    bar.hidden = false;
    var who = "";
    if (syncOn() && delayMeta && delayMeta.by) {
      who = " · " + delayMeta.by + (delayMeta.at ? " " + agoTxt(delayMeta.at) : "");
    }
    bar.textContent = t("delay_on") + " " + (delay > 0 ? "+" : "") + delay +
                      " " + t("min") + who;
  }

  function applyDelay(mins, push, meta) {
    delay = mins; set("delay", String(mins));
    if (meta) { delayMeta = meta; set("delayMeta", JSON.stringify(meta)); }
    $("#delayVal").textContent = (mins > 0 ? "+" : "") + mins;
    var bar = $("#delaybar");
    if (mins) {
      bar.hidden = false;
      var who = "";
      if (syncOn() && delayMeta && delayMeta.by) {
        who = " · " + delayMeta.by + (delayMeta.at ? " " + agoTxt(delayMeta.at) : "");
      }
      bar.textContent = t("delay_on") + " " + (mins > 0 ? "+" : "") + mins +
                        " " + t("min") + who;
    } else bar.hidden = true;
    render();
    if (push) syncPush();
  }

  /* ---------- sync ---------- */
  function pill(cls, txt) { var p = $("#syncPill"); p.className = "pill " + cls; p.textContent = txt; }
  function syncOn() { return !!(CFG.syncUrl && CFG.syncUrl.indexOf("http") === 0); }
  // sem sincronizacao: cada um ajusta o proprio aparelho.
  // com sincronizacao: so quem tem a chave de coordenacao altera a grade de todos.
  function canEdit() { return !syncOn() || !!CFG.coordKey; }

  function agoTxt(ms) {
    if (!ms) return "";
    var m = Math.round((Date.now() - ms) / 60000);
    if (m < 1) return "just now";
    if (m < 60) return m + " min " + t("ago");
    return Math.floor(m / 60) + "h " + (m % 60) + "m " + t("ago");
  }

  function syncPull() {
    if (!syncOn()) {
      pill("off", "Local only");
      $("#syncPill").title = "Saved on this device. Cross-device sync requires a separate backend.";
      return;
    }
    if (!navigator.onLine) { pill("off", t("offline")); return; }
    fetch(CFG.syncUrl, { cache: "no-store" })
      .then(function (r) { return r.ok ? r.json() : Promise.reject(new Error("http")); })
      .then(function (j) {
        if (typeof j.delay === "number") {
          var changed = (j.delay !== delay);
          delayMeta = { by: j.by, at: j.at };
          set("delayMeta", JSON.stringify(delayMeta));
          if (changed) applyDelay(j.delay, false, delayMeta);
          else renderDelayBar();
        }
        pill("ok", t("synced"));
      })
      .catch(function () { pill("err", t("offline")); });
  }

  function syncPush() {
    if (!syncOn() || !navigator.onLine) return;
    fetch(CFG.syncUrl, { method: "POST",
      headers: { "Content-Type": "application/json", "X-Coord-Key": CFG.coordKey || "" },
      body: JSON.stringify({ delay: delay, by: CFG.deviceName || "coordinator", at: Date.now() })
    }).then(function (r) { pill(r.ok ? "ok" : "err", r.ok ? t("synced") : t("offline")); })
      .catch(function () { pill("err", t("offline")); });
  }

  /* ---------- eventos ---------- */
  function setDept(v) {
    myDept = v; set("myDept", v);
    $("#deptSel").value = v; $("#myDept").value = v;
    render();
  }

  function wire() {
    document.addEventListener("click", function (ev) {
      var chip = ev.target.closest(".chip.day");
      if (chip) {
        $$(".chip.day").forEach(function (o) { o.setAttribute("aria-pressed", String(o === chip)); });
        state.day = chip.dataset.day; fillBlocks(); render(); return;
      }
      var sc = ev.target.closest(".chip.sec");
      if (sc) {
        var on = sc.getAttribute("aria-pressed") === "true";
        sc.setAttribute("aria-pressed", String(!on));
        var k = sc.dataset.sec, i = state.secs.indexOf(k);
        if (on) { if (i >= 0) state.secs.splice(i, 1); } else if (i < 0) state.secs.push(k);
        render(); return;
      }
      var md = ev.target.closest("#modeAll,#modeMine");
      if (md) { onlyMine = (md.id === "modeMine"); set("onlyMine", onlyMine ? "1" : "0"); render(); return; }
      var tick = ev.target.closest(".tick");
      if (tick) {
        ev.stopPropagation();
        var art = tick.closest(".cue"), ref = art.dataset.ref;
        if (done[ref]) delete done[ref]; else done[ref] = 1;
        set("done", JSON.stringify(done));
        art.classList.toggle("is-done");
        tick.setAttribute("aria-pressed", String(!!done[ref]));
        renderCountersOnly();
        return;
      }
      var hd = ev.target.closest(".cue-hd");
      if (hd) { hd.parentNode.classList.toggle("open"); hd.querySelector(".cue-chevron").setAttribute("aria-expanded", String(hd.parentNode.classList.contains("open"))); return; }
      var db = ev.target.closest("[data-delay]");
      if (db) {
        if (!canEdit()) return;   // sem chave: leitura apenas
        applyDelay(db.classList.contains("zero") ? 0 : delay + (+db.dataset.delay), true,
                   { by: CFG.deviceName || "coordinator", at: Date.now() });
        return;
      }
      if (ev.target.closest("[data-close]")) { $("#sheet").hidden = true; return; }
    });

    $("#deptSel").addEventListener("change", function (e) { setDept(e.target.value); });
    $("#myDept").addEventListener("change", function (e) { setDept(e.target.value); });
    $("#blockSel").addEventListener("change", function (e) { state.block = e.target.value; render(); });
    $("#q").addEventListener("input", function (e) { state.q = e.target.value.toLowerCase().trim(); render(); });
    $("#nowBtn").addEventListener("click", jumpNow);
    $("#quickNowBtn").addEventListener("click", function () { $("#schedule").scrollIntoView({behavior:"smooth"}); jumpNow(); });
    $("#sidebarSetBtn").addEventListener("click", function () { $("#setBtn").click(); });
    $("#mobileSetBtn").addEventListener("click", function () { $("#setBtn").click(); });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape") $("#sheet").hidden = true;
    });

    $("#resetBtn").addEventListener("click", function () {
      state = { day: "all", block: "all", secs: [], q: "" };
      $$(".chip.day").forEach(function (o) { o.setAttribute("aria-pressed", String(o.dataset.day === "all")); });
      $$(".chip.sec").forEach(function (o) { o.setAttribute("aria-pressed", "false"); });
      $("#q").value = "";
      fillBlocks(); render();
    });

    $("#nightBtn").addEventListener("click", function () {
      theme = (theme === "night") ? "dark" : "night"; set("theme", theme);
      document.body.dataset.theme = theme;
      this.setAttribute("aria-pressed", String(theme === "night"));
      document.querySelector('meta[name="theme-color"]')
        .setAttribute("content", theme === "night" ? "#11151a" : "#f7f8fa");
    });

    $("#setBtn").addEventListener("click", function () {
      $("#delayVal").textContent = (delay > 0 ? "+" : "") + delay;
      var ro = !canEdit();
      $$("[data-delay]").forEach(function (b) {
        b.disabled = ro;
        b.setAttribute("aria-disabled", String(ro));
      });
      $("#delayctl").classList.toggle("readonly", ro);
      $("#delayHint").textContent = ro
        ? ("Set by coordination — your app follows it automatically." +
           (delayMeta && delayMeta.by ? " Last change by " + delayMeta.by +
            (delayMeta.at ? " " + agoTxt(delayMeta.at) : "") + "." : ""))
        : (syncOn()
            ? "Shifts the schedule for everyone. Agree it before you change it."
            : "Shifts every displayed time on this phone only.");
      $("#sheet").hidden = false;
    });

    $("#clearDone").addEventListener("click", function () {
      done = {}; set("done", "{}");
      $$(".cue").forEach(function (a) { a.classList.remove("is-done"); var b = a.querySelector(".tick"); if (b) b.setAttribute("aria-pressed","false"); });
      renderCountersOnly();
    });

    window.addEventListener("online", syncPull);
    window.addEventListener("offline", function () { pill("off", t("offline")); });
    document.addEventListener("visibilitychange", function () {
      if (!document.hidden) { paintNow(); syncPull(); }
    });
    if (syncOn()) setInterval(syncPull, 60000);

    window.addEventListener("beforeinstallprompt", function (e) {
      e.preventDefault();
      var b = $("#installBtn");
      b.textContent = "Add to home screen";
      b.hidden = false;
      b.onclick = function () { b.hidden = true; e.prompt(); };
    });
  }

  if ("serviceWorker" in navigator) {
    window.addEventListener("load", function () {
      navigator.serviceWorker.register("sw.js").catch(function () {});
    });
  }
})();
