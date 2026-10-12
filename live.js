/* Live score banner for the club website.
   Reads what the scorer page saves. A match shows only after the scorer
   taps Go live, and comes off by itself 5 minutes after full time.

   The banner is pinned to the bottom of the screen, sitting just above the
   tab bar, so the score stays in view while the page scrolls behind it.
   With one match live it shows the full scoreboard. With two or more, each
   shrinks to a slim version so the stack doesn't swallow the page; the full
   details are still a tap away. */
(function () {
  var C = window.KGAA_LIVE || {};
  var DB = (C.dbUrl || '').replace(/\/$/, '');
  if (!DB || DB.indexOf('YOUR-') > -1) return;

  var AFTER_FT = 5 * 60000;          /* how long the final score stays up */
  var TOO_OLD = 12 * 3600000;        /* forgotten matches never linger */
  var PULL_EVERY = 15000;            /* fetch new scores from the scorer */
  var TICK_EVERY = 10000;            /* move the match clock on screen */
  var matches = {}, box = null;

  var css =
    /* Fixed above the tab bar. Its bottom offset is set in layout() once the
       tab bar's real height is known, so it never overlaps the tabs. */
    '.lv{position:fixed;left:0;right:0;bottom:0;z-index:58;max-width:600px;margin:0 auto;' +
      'padding:0 10px 8px;pointer-events:none}' +
    '.lv.nobar{padding-bottom:calc(8px + env(safe-area-inset-bottom))}' +
    '.lv-stack{max-height:46vh;overflow-y:auto;-webkit-overflow-scrolling:touch;pointer-events:auto;' +
      'border-radius:18px}' +
    /* White scoreboard with a green frame: stands out against both the dark
       match panel and the pale page behind it, and keeps club colours. */
    '.lv-card{background:#fff;color:#101A14;border-radius:18px;position:relative;overflow:hidden;' +
      'padding:14px 15px 12px;margin-top:8px;border:2px solid #1F824A;' +
      'box-shadow:0 -8px 28px rgba(10,30,20,.35),0 4px 14px rgba(10,30,20,.25);' +
      'font-family:Archivo,-apple-system,"Helvetica Neue",Arial,sans-serif}' +
    '.lv-card:first-child{margin-top:0}' +
    '.lv-card::before{content:"";position:absolute;left:0;right:0;top:0;height:4px;background:#3ACD77}' +
    '.lv-top{display:flex;align-items:center;gap:10px;margin-bottom:8px;min-width:0}' +
    '.lv-pill{flex:none;display:inline-flex;align-items:center;gap:7px;background:#E5484D;color:#fff;' +
      'font-size:11.5px;font-weight:800;letter-spacing:.06em;padding:5px 11px;border-radius:999px;white-space:nowrap}' +
    '.lv-pill.idle{background:#E8F6EE;color:#12703F;border:1px solid #BFDFCD}' +
    '.lv-pill.delay{background:#F2B544;color:#2B1D00;border:0}' +                  /* amber: match delayed */
    '.lv-pill i{width:7px;height:7px;border-radius:50%;background:#fff;animation:lvp 1.4s infinite}' +
    '@keyframes lvp{50%{opacity:.25}}' +
    '.lv-comp{flex:1;min-width:0;font-size:12.5px;font-weight:600;color:#4E5A53;' +
      'overflow:hidden;text-overflow:ellipsis;white-space:nowrap}' +
    '.lv-row{display:flex;justify-content:space-between;gap:14px}' +
    '.lv-side{flex:1;min-width:0;display:flex;flex-direction:column}' +
    '.lv-side.r{text-align:right;align-items:flex-end}' +
    '.lv-id{display:flex;align-items:center;gap:8px;min-width:0;max-width:100%;margin-bottom:3px}' +
    '.lv-side.r .lv-id{flex-direction:row-reverse}' +
    '.lv-c{width:30px;height:30px;flex:none;border-radius:50%;background:#fff;display:grid;place-items:center;' +
      'overflow:hidden;box-shadow:0 0 0 1.5px #C2D0C7}' +
    '.lv-c img{width:76%;height:76%;object-fit:contain;display:block}' +
    '.lv-c b{font-family:"Bricolage Grotesque",Archivo,sans-serif;font-weight:800;font-size:10.5px;' +
      'color:#11492E;letter-spacing:.01em;line-height:1}' +
    '.lv-n{min-width:0;font-size:14px;font-weight:700;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}' +
    '.lv-s{font-family:"Bricolage Grotesque",Archivo,sans-serif;font-weight:800;font-size:28px;line-height:1.1;' +
      'letter-spacing:-.02em;font-variant-numeric:tabular-nums;white-space:nowrap;color:#11492E}' +
    '.lv-s small{font-size:16px;font-weight:700;color:#6B7A72;margin-left:6px;letter-spacing:0}' +
    '.lv-scr{margin-top:9px;padding-top:8px;border-top:1px solid #E2EAE5;font-size:12.5px;line-height:1.45;color:#4E5A53}' +
    '.lv-scr b{color:#11492E;font-weight:800;font-variant-numeric:tabular-nums}' +
    '.lv-card{cursor:pointer}' +
    '.lv-more{flex:none;font-size:12px;font-weight:800;color:#12703F;background:#E8F6EE;border:1px solid #BFDFCD;' +
      'border-radius:999px;padding:4px 10px;white-space:nowrap}' +
    /* slim scoreboard, used when more than one match is live */
    '.lv-card.lv-slim{padding:10px 12px 9px;margin-top:6px;border-radius:14px}' +
    '.lv-card.lv-slim:first-child{margin-top:0}' +
    '.lv-card.lv-slim::before{height:3px}' +
    '.lv-card.lv-slim .lv-top{margin-bottom:6px;gap:8px}' +
    '.lv-card.lv-slim .lv-pill{font-size:10.5px;padding:3px 9px;gap:6px}' +
    '.lv-card.lv-slim .lv-pill i{width:6px;height:6px}' +
    '.lv-card.lv-slim .lv-comp{font-size:12px;font-weight:700;color:#11492E}' +
    '.lv-card.lv-slim .lv-more{font-size:11px;padding:2px 9px}' +
    '.lv-mrow{display:flex;align-items:center;gap:8px;min-width:0}' +
    '.lv-ms-side{flex:1;min-width:0;display:flex;align-items:center;gap:7px}' +
    '.lv-ms-side.r{flex-direction:row-reverse}' +
    '.lv-ms-side .lv-c{width:24px;height:24px}' +
    '.lv-ms-side .lv-c b{font-size:9px}' +
    '.lv-ms-side .lv-n{font-size:13.5px}' +
    '.lv-ms{flex:none;font-family:"Bricolage Grotesque",Archivo,sans-serif;font-weight:800;font-size:20px;line-height:1;' +
      'letter-spacing:-.02em;font-variant-numeric:tabular-nums;white-space:nowrap;color:#11492E}' +
    '.lv-dash{flex:none;color:#9AA7A0;font-weight:700}' +
    /* match details sheet */
    '.lvd{position:fixed;inset:0;z-index:90;background:rgba(10,30,20,.5);display:flex;align-items:flex-end;' +
      'font-family:Archivo,-apple-system,"Helvetica Neue",Arial,sans-serif}' +
    '.lvd-panel{width:100%;max-width:600px;margin:0 auto;background:#fff;color:#101A14;border-radius:22px 22px 0 0;' +
      'max-height:90vh;overflow-y:auto;-webkit-overflow-scrolling:touch;padding-bottom:calc(20px + env(safe-area-inset-bottom))}' +
    '.lvd-board{background:linear-gradient(160deg,#1D5C3C 0%,#11492E 70%);color:#fff;padding:14px 18px 18px;position:sticky;top:0;z-index:2}' +
    '.lvd-bar{display:flex;align-items:center;gap:10px;margin-bottom:12px}' +
    '.lvd-bar .lv-comp{color:#A9CFBB}' +
    '.lvd-x{flex:none;width:36px;height:36px;border-radius:50%;border:0;background:rgba(255,255,255,.14);color:#fff;font-size:20px;line-height:1;cursor:pointer}' +
    '.lvd-board .lv-n{color:#fff}.lvd-board .lv-s{color:#fff}.lvd-board .lv-s small{color:#8FD6AE}' +
    '.lvd-board .lv-c{box-shadow:0 0 0 2px rgba(58,205,119,.55)}' +
    '.lvd-sec{padding:16px 18px 4px}' +
    '.lvd-sec h4{margin:0 0 8px;font-size:11.5px;font-weight:800;letter-spacing:.12em;text-transform:uppercase;color:#12703F}' +
    '.lvd-sr{display:flex;justify-content:space-between;gap:12px;padding:9px 0;border-top:1px solid #E2EAE5}' +
    '.lvd-sr:first-of-type{border-top:0}' +
    '.lvd-sr b{font-size:15px}.lvd-sr span{display:block;font-size:12.5px;color:#6B7A72;margin-top:1px}' +
    '.lvd-sr u{text-decoration:none;font-family:"Bricolage Grotesque",Archivo,sans-serif;font-weight:800;font-size:19px;' +
      'color:#11492E;font-variant-numeric:tabular-nums;white-space:nowrap}' +
    '.lvd-note{font-size:12.5px;color:#6B7A72;margin:6px 0 0}' +
    '.lvd-report{margin:0;font-size:14.5px;line-height:1.6;color:#101A14}' +
    '.lvd-ev{display:flex;align-items:flex-start;gap:11px;padding:9px 0;border-top:1px solid #EEF3EF;font-size:14.5px;line-height:1.4}' +
    '.lvd-ev:first-of-type{border-top:0}' +
    '.lvd-min{flex:none;width:44px;font-weight:800;color:#12703F;font-variant-numeric:tabular-nums;font-size:13.5px;padding-top:1px}' +
    '.lvd-ic{flex:none;width:24px;height:24px;border-radius:50%;display:grid;place-items:center;font-size:11px;font-weight:800;color:#fff;background:#1F824A}' +
    '.lvd-ic.o{background:#9AA7A0}.lvd-ic.sub{background:#2F6FB5}' +
    '.lvd-ic.cy,.lvd-ic.cb,.lvd-ic.cr{width:16px;height:22px;border-radius:3px;margin:1px 4px 0}' +
    '.lvd-ic.cy{background:#F2C94C}.lvd-ic.cb{background:#111}.lvd-ic.cr{background:#E5484D}' +
    '.lvd-tx{flex:1;min-width:0}.lvd-tx small{display:block;color:#6B7A72;font-size:12.5px}' +
    '.lvd-mark{margin:10px 0 2px;padding:7px 12px;border-radius:10px;background:#EFF4F0;font-size:12.5px;font-weight:800;' +
      'letter-spacing:.06em;text-transform:uppercase;color:#4E5A53;display:flex;justify-content:space-between;align-items:baseline;gap:10px;flex-wrap:wrap}' +
    '.lvd-mark span+span{text-transform:none;letter-spacing:0;font-weight:700;color:#11492E}' +
    /* Match stats button added to finished results on the Results tab */
    '.lv-statsbtn{display:inline-flex;align-items:center;gap:6px;margin-top:11px;padding:7px 14px;border-radius:999px;cursor:pointer;' +
      'font:800 12.5px Archivo,-apple-system,"Helvetica Neue",Arial,sans-serif;color:#12703F;' +
      'background:linear-gradient(180deg,#FFFFFF,#EAF6EF);border:1px solid rgba(31,130,74,.3);box-shadow:0 1px 2px rgba(17,73,46,.08)}' +
    '.lv-statsbtn:active{transform:translateY(1px);box-shadow:none}' +
    '@media (prefers-reduced-motion:reduce){.lv-pill i{animation:none}}';
  var st = document.createElement('style');
  st.textContent = css;
  document.head.appendChild(st);

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function fmt(g, p) { return g + '-' + (p < 10 ? '0' : '') + p; }
  function club() { return 'Killeshin'; }
  /* v is 'g' (goal, 3), '2' (two-pointer, 2 in the points column) or 'p' (point, 1). */
  function tally(m) {
    var r = { kg: 0, kp: 0, og: 0, op: 0 }, ev = m.events || {};
    for (var k in ev) {
      var e = ev[k]; if (!e || (e.s !== 'k' && e.s !== 'o')) continue;
      if (e.v === 'g') r[e.s + 'g']++; else r[e.s + 'p'] += (e.v === '2' ? 2 : 1);
    }
    return r;
  }
  /* Worked out from the half's start time on every tick, so the clock keeps
     moving on its own between score fetches. */
  function mins(t) { return t ? ' ' + (Math.floor((Date.now() - t) / 60000) + 1) + '\u2032' : ''; }

  function state(m) {
    if (m.delayed) return { t: m.status && m.status !== 'pre' && m.status !== 'ft' ? 'Match delayed \u00b7 play stopped' : 'Match delayed', on: false, d: true };
    switch (m.status) {
      case '1h': return { t: 'Live \u00b7 1st half' + mins(m.t1h), on: true };
      case 'ht': return { t: 'Half-time', on: false };
      case '2h': return { t: 'Live \u00b7 2nd half' + mins(m.t2h), on: true };
      case 'etb': return { t: 'Extra time to come', on: false };
      case 'et1': return { t: 'Live \u00b7 ET 1st half' + mins(m.tet1), on: true };
      case 'etht': return { t: 'Extra time half-time', on: false };
      case 'et2': return { t: 'Live \u00b7 ET 2nd half' + mins(m.tet2), on: true };
      case 'ft': return { t: 'Full time', on: false };
      default: return { t: 'Throw-in soon', on: false };
    }
  }
  /* The same, in as few characters as possible, for the slim scoreboard. */
  function shortState(m) {
    if (m.delayed) return { t: 'Delayed', on: false, d: true };
    switch (m.status) {
      case '1h': return { t: '1H' + mins(m.t1h), on: true };
      case 'ht': return { t: 'HT', on: false };
      case '2h': return { t: '2H' + mins(m.t2h), on: true };
      case 'etb': return { t: 'ET next', on: false };
      case 'et1': return { t: 'ET1' + mins(m.tet1), on: true };
      case 'etht': return { t: 'ET HT', on: false };
      case 'et2': return { t: 'ET2' + mins(m.tet2), on: true };
      case 'ft': return { t: 'FT', on: false };
      default: return { t: 'Soon', on: false };
    }
  }

  function showing(m) {
    if (!m || m.live === false) return false;                  /* Go live not tapped yet */
    if (Date.now() - (m.created || 0) > TOO_OLD) return false;
    if (m.status === 'ft') return !!m.tft && Date.now() - m.tft < AFTER_FT;
    return true;
  }

  /* ---- crests ----
     Our own crest comes with the site. The opposition's is looked up in
     crests.json by a loose version of the name the scorer typed, so
     "Portarlington GAA" and "portarlington" both find it. Initials stand in
     when there is no crest, or the image fails to load. */
  var CRESTS = {};
  function looseKey(n) {
    return String(n || '').toLowerCase()
      .replace(/\b(gaa|clg|club|lgfa|ladies)\b/g, ' ')
      .replace(/[^a-z0-9]/g, '');
  }
  function initials(name) {
    var clean = String(name || '').replace(/\b(GAA|CLG|Club|Gaels|Parish)\b/gi, ' ').trim();
    var words = clean.split(/\s+/).filter(Boolean);
    if (!words.length) return '?';
    if (words.length === 1) return words[0].slice(0, 3).toUpperCase();
    return words.slice(0, 3).map(function (w) { return w.charAt(0).toUpperCase(); }).join('');
  }
  function crestImg(url, name) {
    var t = initials(name).replace(/[^A-Z0-9?]/g, '');
    return '<span class="lv-c"><img src="' + esc(url) + '" alt="" ' +
      'onerror="this.parentNode.innerHTML=\'<b>' + t + '</b>\'"></span>';
  }
  function ourCrest(m) { return crestImg(m.branch === 'ladies' ? 'crest-ladies.png' : 'crest.png', club(m)); }
  function theirCrest(name) {
    var url = CRESTS[looseKey(name)];
    return url ? crestImg(url, name) : '<span class="lv-c"><b>' + esc(initials(name)) + '</b></span>';
  }
  function loadCrests() {
    fetch('crests.json?t=' + Date.now(), { cache: 'no-store' })
      .then(function (r) { if (!r.ok) throw 0; return r.json(); })
      .then(function (j) {
        if (!j || typeof j !== 'object') return;
        for (var k in j) CRESTS[looseKey(k)] = j[k];
        render();
      })
      .catch(function () { /* initials stand in */ });
  }

  function side(name, g, p, right, crest) {
    return '<div class="lv-side' + (right ? ' r' : '') + '"><span class="lv-id">' + crest +
      '<span class="lv-n">' + esc(name) + '</span></span>' +
      '<span class="lv-s">' + fmt(g, p) + '<small>(' + (g * 3 + p) + ')</small></span></div>';
  }

  /* Killeshin scorers, top scorer first, e.g. "Lowry 1-04 · Deering 0-02". */
  function scorersLine(m) {
    var by = {}, ev = m.events || {}, k;
    for (k in ev) {
      var e = ev[k]; if (!e || e.s !== 'k' || !e.n) continue;
      var id = String(e.n).toLowerCase().replace(/[^a-z0-9]+/g, '');
      var r = by[id] || (by[id] = { n: e.n, g: 0, p: 0 });
      if (e.v === 'g') r.g++; else r.p += (e.v === '2' ? 2 : 1);
    }
    var list = Object.keys(by).map(function (x) { return by[x]; })
      .sort(function (a, b) { return (b.g * 3 + b.p) - (a.g * 3 + a.p) || a.n.localeCompare(b.n); });
    if (!list.length) return '';
    return '<div class="lv-scr">' + esc(club(m)) + ': ' + list.map(function (r) {
      return esc(r.n) + ' <b>' + fmt(r.g, r.p) + '</b>'; }).join(' \u00b7 ') + '</div>';
  }

  /* ---------- match details: tap a banner to open ---------- */
  var TNAME = { free: 'free', pen: 'penalty', '45': '45', mark: 'mark', side: 'sideline' };
  var SUFFIX = { free: 'f', pen: ' pen', '45': ' 45', mark: ' m', side: ' sl' };
  var openId = null, sheet = null;
  function worth(e) { return e.v === 'g' ? 3 : e.v === '2' ? 2 : 1; }
  function scoreWord(v) { return v === 'g' ? 'Goal' : v === '2' ? '2-pointer' : 'Point'; }
  function when(m, ts) {
    var L = [['tet2', 'ET2 '], ['tet1', 'ET1 '], ['t2h', '2H '], ['t1h', '1H ']];   /* half lengths differ by grade, so minutes count from each half's start */
    for (var i = 0; i < L.length; i++) {
      var t = m[L[i][0]];
      if (t && ts >= t) {
        return L[i][1] + (Math.floor((ts - t) / 60000) + 1) + '\u2032';
      }
    }
    return '';
  }
  function scoreAt(m, ts) {
    var r = { kg: 0, kp: 0, og: 0, op: 0 }, ev = m.events || {};
    for (var k in ev) { var e = ev[k]; if (!e || e.ts > ts) continue; if (e.v === 'g') r[e.s + 'g']++; else r[e.s + 'p'] += worth(e); }
    return r;
  }
  function lineScore(m, r) {
    var a = club(m) + ' ' + fmt(r.kg, r.kp), b = (m.opp || 'Opposition') + ' ' + fmt(r.og, r.op);
    return m.venue === 'away' ? b + ' \u2013 ' + a : a + ' \u2013 ' + b;
  }
  /* Each scorer's total with the dead-ball scores in brackets, the way the
     papers write it: Deering 0-05 (0-03f, 0-01 45). */
  function breakdown(m) {
    var by = {}, ev = m.events || {}, k;
    for (k in ev) {
      var e = ev[k]; if (!e || e.s !== 'k' || !e.n) continue;
      var id = String(e.n).toLowerCase().replace(/[^a-z0-9]+/g, '');
      var r = by[id] || (by[id] = { n: e.n, g: 0, p: 0, x: {}, tp: 0 });
      if (e.v === 'g') r.g++; else r.p += worth(e);
      if (e.v === '2') r.tp++;
      if (e.t && SUFFIX[e.t]) { var x = r.x[e.t] || (r.x[e.t] = { g: 0, p: 0 }); if (e.v === 'g') x.g++; else x.p += worth(e); }
    }
    return Object.keys(by).map(function (q) { return by[q]; })
      .sort(function (a, b) { return (b.g * 3 + b.p) - (a.g * 3 + a.p) || a.n.localeCompare(b.n); });
  }

  function joinList(a) {
    if (a.length <= 1) return a[0] || '';
    return a.slice(0, -1).join(', ') + ' and ' + a[a.length - 1];
  }

  /* A short, fact-only recap, built only from what the scorer actually
     recorded: the final score, the half-time score, the top scorer's tally
     and any cards. Nothing here is invented or guessed - it reads the same
     events and log that the scorer list and timeline below it already show,
     just turned into a couple of sentences. Only shown once a match is
     actually at full time. */
  function matchReport(m) {
    var t = tally(m), opp = esc(m.opp || 'the opposition');
    var us = t.kg * 3 + t.kp, them = t.og * 3 + t.op;
    var ourScore = fmt(t.kg, t.kp), theirScore = fmt(t.og, t.op);
    var lines = [];

    if (us > them) lines.push('Killeshin beat ' + opp + ', ' + ourScore + ' to ' + theirScore + '.');
    else if (us < them) lines.push(opp + ' beat Killeshin, ' + theirScore + ' to ' + ourScore + '.');
    else lines.push('Killeshin drew with ' + opp + ', ' + ourScore + ' apiece.');

    if (m.tht) {
      var ht = scoreAt(m, m.tht);
      var htUs = ht.kg * 3 + ht.kp, htThem = ht.og * 3 + ht.op;
      lines.push('Half-time: ' + fmt(ht.kg, ht.kp) + ' to ' + fmt(ht.og, ht.op) + '.');
      if (htUs !== htThem && us !== them) {
        var ledAtHalf = htUs > htThem ? 'Killeshin' : opp;
        var ledAtFull = us > them ? 'Killeshin' : opp;
        if (ledAtHalf !== ledAtFull) lines.push(ledAtFull + ' trailed at the break but came out on top.');
      }
    }

    var list = breakdown(m);
    if (list.length) {
      var top = list[0];
      var extra = top.tp ? ', including ' + top.tp + ' two-' + (top.tp === 1 ? 'pointer' : 'pointers') : '';
      lines.push(esc(top.n) + ' top-scored for Killeshin with ' + fmt(top.g, top.p) + extra + '.');
    }

    var ours = [], theirs = [], k, log = m.log || {};
    for (k in log) {
      var l = log[k]; if (!l || l.k !== 'card') continue;
      var word = { y: 'a yellow card', b: 'a black card', r: 'a red card' }[l.c] || 'a card';
      if (l.s === 'o') theirs.push(word + (l.n ? ' for ' + esc(l.n) : ''));
      else ours.push(word + (l.n ? ' for ' + esc(l.n) : ''));
    }
    if (ours.length) lines.push('Killeshin picked up ' + joinList(ours) + '.');
    if (theirs.length) lines.push(opp + ' picked up ' + joinList(theirs) + '.');

    return lines.join(' ');
  }

  function detail(m) {
    var t = tally(m), s = state(m), opp = m.opp || 'Opposition', away = m.venue === 'away';
    var us = side(club(m), t.kg, t.kp, away, ourCrest(m)), them = side(opp, t.og, t.op, !away, theirCrest(opp));
    var info = [m.team, m.comp].filter(Boolean).map(esc).join(' \u00b7 ');
    var h = '<div class="lvd-board"><div class="lvd-bar"><span class="lv-pill' + (s.d ? ' delay' : s.on ? '' : ' idle') + '" style="' +
      (s.on || s.d ? '' : 'background:rgba(255,255,255,.18);color:#fff;border:0') + '">' + (s.on ? '<i></i>' : '') + esc(s.t) + '</span>' +
      '<span class="lv-comp">' + info + '</span><button class="lvd-x" data-close aria-label="Close">\u00d7</button></div>' +
      '<div class="lv-row">' + (away ? them + us : us + them) + '</div></div>';

    if (m.status === 'ft') {
      var rep = matchReport(m);
      if (rep) h += '<div class="lvd-sec"><h4>Match report</h4><p class="lvd-report">' + rep + '</p></div>';
    }

    var list = breakdown(m);
    var unnamed = 0, ev = m.events || {}, k;
    for (k in ev) if (ev[k] && ev[k].s === 'k' && !ev[k].n) unnamed++;
    if (list.length || unnamed) {
      h += '<div class="lvd-sec"><h4>' + esc(club(m)) + ' scorers</h4>' + list.map(function (r) {
        var extra = Object.keys(r.x).map(function (q) { return fmt(r.x[q].g, r.x[q].p) + SUFFIX[q]; });
        if (r.tp) extra.push(r.tp + (r.tp === 1 ? ' two-pointer' : ' two-pointers'));
        return '<div class="lvd-sr"><div><b>' + esc(r.n) + '</b>' + (extra.length ? '<span>' + esc(extra.join(', ')) + '</span>' : '') +
          '</div><u>' + fmt(r.g, r.p) + '</u></div>';
      }).join('') + (unnamed ? '<p class="lvd-note">' + unnamed + (unnamed === 1 ? ' score' : ' scores') + ' not yet credited to a player.</p>' : '') + '</div>';
    }

    /* Everything that has happened, newest first. */
    var items = [];
    for (k in ev) if (ev[k]) items.push({ ts: ev[k].ts, e: ev[k] });
    var log = m.log || {};
    for (k in log) if (log[k]) items.push({ ts: log[k].ts, l: log[k] });
    [['t1h', 'Throw-in', false], ['tht', 'Half-time', true], ['t2h', 'Second half under way', false], ['tetb', 'End of normal time', true],
     ['tet1', 'Extra time under way', false], ['tetht', 'Extra-time half-time', true], ['tet2', 'Extra-time 2nd half', false],
     ['tft', 'Full time', true]].forEach(function (x) { if (m[x[0]]) items.push({ ts: m[x[0]], mk: x[1], sc: x[2] }); });
    items.sort(function (a, b) { return b.ts - a.ts; });
    if (items.length) {
      h += '<div class="lvd-sec"><h4>Timeline</h4>' + items.map(function (it) {
        if (it.mk) return '<div class="lvd-mark"><span>' + esc(it.mk) + '</span>' + (it.sc ? '<span>' + esc(lineScore(m, scoreAt(m, it.ts))) + '</span>' : '') + '</div>';
        var min = '<span class="lvd-min">' + esc(when(m, it.ts)) + '</span>';
        if (it.e) {
          var e = it.e, ours = e.s === 'k', how = e.t && TNAME[e.t] ? ' (' + TNAME[e.t] + ')' : '';
          var ic = '<span class="lvd-ic' + (ours ? '' : ' o') + '">' + (e.v === 'g' ? 'G' : e.v === '2' ? '2' : 'P') + '</span>';
          var who = ours ? (e.n ? esc(e.n) : esc(club(m))) : esc(opp);
          var r = scoreAt(m, e.ts);
          return '<div class="lvd-ev">' + min + ic + '<span class="lvd-tx"><b>' + scoreWord(e.v) + '</b> \u2013 ' + who + esc(how) +
            '<small>' + esc(lineScore(m, r)) + '</small></span></div>';
        }
        var l = it.l;
        if (l.k === 'sub') {
          return '<div class="lvd-ev">' + min + '<span class="lvd-ic sub">\u21c4</span><span class="lvd-tx"><b>Substitution</b> \u2013 ' +
            esc(l.on || '') + (l.off ? ' on for ' + esc(l.off) : ' comes on') + '</span></div>';
        }
        if (l.k === 'card') {
          var cw = { y: 'Yellow card', b: 'Black card', r: 'Red card' }[l.c] || 'Card';
          var cwho = l.s === 'o' ? esc(opp) + (l.n ? ' (' + esc(l.n) + ')' : '') : esc(l.n || club(m));
          return '<div class="lvd-ev">' + min + '<span class="lvd-ic c' + esc(l.c) + '"></span><span class="lvd-tx"><b>' + cw + '</b> \u2013 ' + cwho + '</span></div>';
        }
        return '';
      }).join('') + '</div>';
    } else {
      h += '<div class="lvd-sec"><p class="lvd-note">Nothing yet \u2013 scores, subs and cards will appear here as they happen.</p></div>';
    }
    return h;
  }
  function renderSheet() {
    if (!openId) return;
    var m = openId === STATS_OPEN ? statsMatch : matches[openId];
    if (!m) { closeSheet(); return; }
    if (!sheet) {
      sheet = document.createElement('div');
      sheet.className = 'lvd';
      sheet.setAttribute('role', 'dialog');
      sheet.setAttribute('aria-label', 'Match details');
      sheet.innerHTML = '<div class="lvd-panel"></div>';
      sheet.addEventListener('click', function (ev) {
        if (ev.target === sheet || ev.target.closest('[data-close]')) closeSheet();
      });
      document.body.appendChild(sheet);
      document.documentElement.style.overflow = 'hidden';
    }
    sheet.firstChild.innerHTML = detail(m);                   /* the panel stays put, so its scroll position does too */
  }
  function closeSheet() {
    openId = null; statsMatch = null;
    if (sheet) { sheet.remove(); sheet = null; }
    document.documentElement.style.overflow = '';
  }
  document.addEventListener('keydown', function (ev) { if (ev.key === 'Escape' && openId) closeSheet(); });

  function card(m, id) {
    var t = tally(m), s = state(m);
    var opp = m.opp || 'Opposition', away = m.venue === 'away';
    var mine = ourCrest(m), theirs = theirCrest(opp);
    /* home team always on the left */
    var us = side(club(m), t.kg, t.kp, away, mine);
    var them = side(opp, t.og, t.op, !away, theirs);
    var info = [m.team, m.comp].filter(Boolean).map(esc).join(' \u00b7 ');
    return '<div class="lv-card" data-id="' + esc(id) + '" role="button" tabindex="0" aria-label="Match details">' +
      '<div class="lv-top"><span class="lv-pill' + (s.d ? ' delay' : s.on ? '' : ' idle') + '">' + (s.on ? '<i></i>' : '') + esc(s.t) + '</span>' +
      '<span class="lv-comp">' + info + '</span><span class="lv-more">Details \u203a</span></div>' +
      '<div class="lv-row">' + (m.venue === 'away' ? them + us : us + them) + '</div>' + scorersLine(m) + '</div>';
  }

  /* Slim scoreboard for when two or more matches are live: the team (so two
     Killeshin games can be told apart), the clock, then one line of score.
     No scorers line; that is in the details, a tap away. */
  function miniCard(m, id) {
    var t = tally(m), s = shortState(m);
    var opp = m.opp || 'Opposition', away = m.venue === 'away';
    function half(name, crest, right) {
      return '<span class="lv-ms-side' + (right ? ' r' : '') + '">' + crest + '<span class="lv-n">' + esc(name) + '</span></span>';
    }
    var usHalf = half(club(m), ourCrest(m), away), themHalf = half(opp, theirCrest(opp), !away);
    var usScore = '<span class="lv-ms">' + fmt(t.kg, t.kp) + '</span>', themScore = '<span class="lv-ms">' + fmt(t.og, t.op) + '</span>';
    var row = away
      ? themHalf + themScore + '<span class="lv-dash">\u2013</span>' + usScore + usHalf
      : usHalf + usScore + '<span class="lv-dash">\u2013</span>' + themScore + themHalf;
    var info = [m.team, m.comp].filter(Boolean).map(esc).join(' \u00b7 ');
    return '<div class="lv-card lv-slim" data-id="' + esc(id) + '" role="button" tabindex="0" aria-label="Match details">' +
      '<div class="lv-top"><span class="lv-pill' + (s.d ? ' delay' : s.on ? '' : ' idle') + '">' + (s.on ? '<i></i>' : '') + esc(s.t) + '</span>' +
      '<span class="lv-comp">' + info + '</span><span class="lv-more">Details \u203a</span></div>' +
      '<div class="lv-mrow">' + row + '</div></div>';
  }

  /* Sit just above the tab bar, and pad the page so the last card can
     always be scrolled clear of the banner. */
  function layout() {
    if (!box) return;
    var bar = document.getElementById('bar');
    var barH = bar ? bar.offsetHeight : 0;
    box.style.bottom = barH + 'px';
    box.classList.toggle('nobar', !bar);
    document.body.style.paddingBottom = box.hidden ? '' : (barH + box.offsetHeight + 10) + 'px';
  }

  function render() {
    if (!box) return;
    var ids = Object.keys(matches).filter(function (k) { return showing(matches[k]); })
      .sort(function (a, b) { return (matches[a].created || 0) - (matches[b].created || 0); });
    if (!ids.length) {
      box.hidden = true; box.innerHTML = '';
    } else {
      var slim = ids.length > 1;                                /* two or more live: slim scoreboards */
      box.innerHTML = '<div class="lv-stack">' + ids.map(function (k) {
        return slim ? miniCard(matches[k], k) : card(matches[k], k);
      }).join('') + '</div>';
      box.hidden = false;
    }
    layout();
    renderSheet();
  }

  function pull() {
    fetch(DB + '/live/matches.json?t=' + Date.now(), { cache: 'no-store' })
      .then(function (r) { if (!r.ok) throw 0; return r.json(); })
      .then(function (j) { matches = j || {}; render(); })
      .catch(function () { render(); /* keep the last score, but keep the clock moving */ });
  }

  function mount() {
    box = document.createElement('section');
    box.className = 'lv';
    box.id = 'liveBanner';
    box.hidden = true;
    box.setAttribute('aria-live', 'polite');
    box.setAttribute('aria-label', 'Live scores');
    document.body.appendChild(box);
    box.addEventListener('click', function (ev) {
      var c = ev.target.closest('.lv-card'); if (!c) return;
      openId = c.getAttribute('data-id'); renderSheet();
    });
    box.addEventListener('keydown', function (ev) {
      if ((ev.key === 'Enter' || ev.key === ' ') && ev.target.classList.contains('lv-card')) { ev.preventDefault(); ev.target.click(); }
    });
  }

  /* ---------- match stats on the Results tab ----------
     The scorer moves each finished match to live/stats once its county
     board result is on the site, with a link to that result (date, branch,
     grade, opposition). Each result card on the Results tab is matched to
     one of those by the same four things, and gets a Match stats button that
     opens the full details. No change to the rest of the site is needed. */
  var STATS_OPEN = '__stats', statsMatch = null, STATS = {}, statsIdx = {}, statsIdxLoose = {};
  var MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var DAY = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  function longDate(s) { var p = String(s).split('-'), x = new Date(+p[0], p[1] - 1, +p[2]); return DAY[x.getDay()] + ' ' + x.getDate() + ' ' + MON[x.getMonth()]; }
  function statsKey(day, branch, grade, opp) { return [day, branch, String(grade).trim(), looseKey(opp)].join('|'); }
  /* A fallback that drops the grade from the key. Used only when the exact
     key misses - a scorer might type a grade slightly differently from how
     the county board publishes it (e.g. "Minor" vs "Minor B"), and date +
     branch + opponent is almost always enough on its own. If two different
     matches ever do share the same date, branch and opponent, this is
     marked null rather than guessing, so a mismatch never shows the wrong
     match's stats in place of none at all. */
  function looseStatsKey(day, branch, opp) { return [day, branch, looseKey(opp)].join('|'); }
  function loadStats() {
    fetch(DB + '/live/stats.json?t=' + Date.now(), { cache: 'no-store' })
      .then(function (r) { if (!r.ok) throw 0; return r.json(); })
      .then(function (j) {
        STATS = j || {}; statsIdx = {}; statsIdxLoose = {};
        Object.keys(STATS).forEach(function (id) {
          var l = STATS[id] && STATS[id].link; if (!l) return;
          var day = longDate(l.date);
          statsIdx[statsKey(day, l.branch, l.grade, l.opp)] = id;
          var lk = looseStatsKey(day, l.branch, l.opp);
          statsIdxLoose[lk] = (lk in statsIdxLoose && statsIdxLoose[lk] !== id) ? null : id;
        });
        addStatsButtons();
      })
      .catch(function () { /* no buttons this time */ });
  }
  function addStatsButtons() {
    var out = document.getElementById('out'); if (!out) return;
    var cards = out.querySelectorAll('.card.win,.card.loss,.card.draw');
    Array.prototype.forEach.call(cards, function (card) {
      if (card.querySelector('.lv-statsbtn')) return;
      var dh = card.previousElementSibling;
      while (dh && !dh.classList.contains('dayhead')) dh = dh.previousElementSibling;
      var gr = card.querySelector('.fx-grade, .gchip');                /* grade chip: both card layouts */
      if (!dh || !gr) return;
      var names = Array.prototype.map.call(card.querySelectorAll('.sl .n > span:not(.mini)'), function (x) { return x.textContent.trim(); });
      var opp = names.filter(function (n) { return n !== 'Killeshin'; })[0];
      if (!opp) return;
      var day = dh.textContent.trim(), branch = card.classList.contains('lad') ? 'ladies' : 'men';
      var id = statsIdx[statsKey(day, branch, gr.textContent, opp)];
      if (!id) id = statsIdxLoose[looseStatsKey(day, branch, opp)];
      if (!id) return;
      var b = document.createElement('button');
      b.className = 'lv-statsbtn'; b.type = 'button'; b.setAttribute('data-stats', id);
      b.textContent = 'Match stats \u203a';
      card.appendChild(b);
    });
  }
  document.addEventListener('click', function (ev) {
    var b = ev.target.closest && ev.target.closest('.lv-statsbtn'); if (!b) return;
    var m = STATS[b.getAttribute('data-stats')]; if (!m) return;
    statsMatch = m; openId = STATS_OPEN; renderSheet();
  });
  (function watchResults() {
    var out = document.getElementById('out');
    if (!out || !window.MutationObserver) return;
    new MutationObserver(addStatsButtons).observe(out, { childList: true });   /* the site redraws the list: put the buttons back */
  })();

  mount();
  loadCrests();
  loadStats();
  setInterval(function () { if (!document.hidden) loadStats(); }, 10 * 60000);
  pull();
  setInterval(function () { if (!document.hidden) pull(); }, PULL_EVERY);
  setInterval(render, TICK_EVERY);                              /* moves the clock and drops finished games */
  document.addEventListener('visibilitychange', function () { if (!document.hidden) pull(); });
  window.addEventListener('resize', layout);
  window.addEventListener('orientationchange', function () { setTimeout(layout, 300); });
  if (window.ResizeObserver) {
    var ro = new ResizeObserver(layout);
    ro.observe(box);
    var bar = document.getElementById('bar');
    if (bar) ro.observe(bar);
  }
})();
