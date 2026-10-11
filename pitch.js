/* Pitch Bookings add-on for killeshingaa.ie
   1. "Today at the Club" strip on the home page, below Buy tickets and above
      Next match. For supporters: tap = full list for today, long press = quick
      overview bubble. Stays on the main site, no link to Pitch Bookings.
   2. "Pitch bookings" and "What's on today" tiles at the top of the Club page.
   3. "Pitch bookings" button in the More menu.
   Loaded by one line at the bottom of index.html:  <script src="pitch.js"></script> */
(function(){
  "use strict";
  var BOOKINGS = 'bookings.html';
  var SCORER = 'score.html';
  var SUPA_URL = 'https://joyfilfyeruaifpwlkfo.supabase.co';
  var SUPA_KEY = 'sb_publishable_THA4FVrKQzkCl6TcAmhk-A_tyMYNdPJ';

  var PITCH = {1:'Old Pitch',2:'Old Pitch',3:'Juvenile Pitch',4:'Juvenile Pitch',5:'Senior Pitch',6:'Senior Pitch'};
  var SIDE  = {1:'Clubhouse',2:'Cappalug',3:'Front',4:'Back',5:'Back',6:'Front'};
  var PAIRS = [[1,2],[3,4],[5,6]];

  var ICON = {
    pitch: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M12 4v16M3 12h4M17 12h4"/><circle cx="12" cy="12" r="2.6"/></svg>',
    score: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="2.5" y="5" width="19" height="13" rx="2"/><path d="M12 5v13M7 15V9l-1.5 1M15.5 9h2.5l-2.5 6"/><path d="M8 21h8"/></svg>',
    clock: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
    pin:   '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21s7-5.7 7-11a7 7 0 1 0-14 0c0 5.3 7 11 7 11z"/><circle cx="12" cy="10" r="2.5"/></svg>'
  };

  /* ---------- styles, matching the site ---------- */
  var css = document.createElement('style');
  css.textContent =
    /* club page tiles */
    '.ptile{display:flex;align-items:center;gap:15px;padding:16px 17px;margin-bottom:10px;border-radius:20px;position:relative;overflow:hidden;text-decoration:none;color:inherit;background:linear-gradient(158deg,#FFFFFF 0%,#FFFFFF 48%,#EDF8F1 100%);border:1px solid rgba(31,130,74,.22);box-shadow:inset 0 1px 0 rgba(255,255,255,.95),0 5px 18px -7px rgba(17,73,46,.28)}' +
    '.ptile::after{content:"";position:absolute;right:-30px;top:-34px;width:132px;height:132px;border-radius:50%;background:radial-gradient(circle,rgba(58,205,119,.16),transparent 68%);pointer-events:none}' +
    '.ptile .tile{width:52px;height:52px;flex:none;border-radius:15px;display:grid;place-items:center;position:relative;z-index:1;background:linear-gradient(160deg,var(--green),var(--green-dk));box-shadow:inset 0 1px 0 rgba(255,255,255,.45),0 4px 10px -3px rgba(31,130,74,.6)}' +
    '.ptile .tile svg{width:25px;height:25px;stroke:#fff;stroke-width:1.9;fill:none;stroke-linecap:round;stroke-linejoin:round}' +
    '.ptile .tx{flex:1;min-width:0;position:relative;z-index:1}' +
    '.ptile .tx b{display:block;font-size:17.5px;font-weight:800;line-height:1.25;font-family:"Bricolage Grotesque",Archivo,sans-serif;letter-spacing:-.01em}' +
    '.ptile .tx span{display:block;font-size:13px;color:var(--grey);margin-top:3px;line-height:1.4}' +
    '.ptile .go{flex:none;position:relative;z-index:1;width:30px;height:30px;border-radius:50%;display:grid;place-items:center;background:var(--green-lt);color:var(--green-dk);font-size:15px;font-weight:800}' +
    '.ptile:active{transform:translateY(1px)}' +
    '.pgrid{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:10px}' +
    '.ptile.half{flex-direction:column;align-items:flex-start;gap:11px;margin:0;padding:15px 14px 14px}' +
    '.ptile.half .tile{width:46px;height:46px;border-radius:13px}' +
    '.ptile.half .tile svg{width:23px;height:23px}' +
    '.ptile.half .tx b{font-size:16px}' +
    '.ptile.half .tx span{font-size:12.5px}' +
    '.sheet a.pbtn{display:flex;align-items:center;gap:14px;width:100%;text-align:left;padding:15px 17px;margin-bottom:9px;border-radius:14px;font-size:16.5px;font-weight:700;background:var(--green-lt);color:var(--green-dk);border:1.5px solid #BFDFCD;box-shadow:0 3px 0 #BFDFCD;text-decoration:none}' +
    '.sheet a.pbtn svg{width:22px;height:22px;stroke:currentColor;stroke-width:1.9;fill:none;stroke-linecap:round;stroke-linejoin:round;flex:none}' +
    /* the Today at the Club strip */
    '#tatc{box-sizing:border-box;display:flex;align-items:center;gap:13px;width:calc(100% - 32px);margin:12px 16px 2px;padding:13px 15px;text-align:left;border-radius:18px;cursor:pointer;color:#fff;position:relative;overflow:hidden;-webkit-touch-callout:none;-webkit-user-select:none;user-select:none;background:linear-gradient(150deg,var(--forest) 0%,var(--deep) 100%);border:1px solid rgba(17,73,46,.4);box-shadow:0 5px 16px -6px rgba(17,73,46,.45)}' +
    '#tatc::before{content:"";position:absolute;inset:-20%;pointer-events:none;background:repeating-linear-gradient(114deg,rgba(255,255,255,.05) 0 1px,transparent 1px 9px),repeating-linear-gradient(114deg,rgba(58,205,119,.14) 0 2px,transparent 2px 34px)}' +
    '#tatc>*{position:relative;z-index:1}' +
    '#tatc[hidden]{display:none!important}' +
    '#tatc .ic{width:42px;height:42px;flex:none;border-radius:13px;display:grid;place-items:center;background:rgba(255,255,255,.12);border:1px solid rgba(255,255,255,.18)}' +
    '#tatc .ic svg{width:22px;height:22px;stroke:#fff;stroke-width:1.9;fill:none;stroke-linecap:round;stroke-linejoin:round}' +
    '#tatc .tx{flex:1;min-width:0}' +
    '#tatc .tx b{display:flex;align-items:center;gap:8px;font-size:11px;font-weight:800;letter-spacing:.17em;text-transform:uppercase;color:#8FD6AE}' +
    '#tatc .tx b i{width:8px;height:8px;border-radius:50%;background:var(--green);display:none;animation:tatcPulse 1.6s infinite}' +
    '#tatc.live .tx b i{display:inline-block}' +
    '#tatc .tx span{display:block;font-size:15px;font-weight:700;margin-top:3px;line-height:1.35;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}' +
    '#tatc .tx small{display:block;font-size:12px;color:#A9CFBB;margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}' +
    '#tatc .wxs{flex:none;display:flex;flex-direction:column;align-items:center;line-height:1.1;min-width:38px}' +
    '#tatc .wxs span{font-size:20px}' +
    '#tatc .wxs b{font-size:14px;font-weight:800;color:#fff;margin-top:2px}' +
    '#tatc .go{flex:none;width:30px;height:30px;border-radius:50%;display:grid;place-items:center;background:rgba(58,205,119,.22);color:#C9F0DA;font-weight:800;font-size:15px}' +
    '#tatc:active{transform:translateY(1px)}' +
    '#tatc.pressing{transform:scale(.985);transition:transform .35s}' +
    '@keyframes tatcPulse{0%{box-shadow:0 0 0 0 rgba(58,205,119,.6)}70%{box-shadow:0 0 0 8px rgba(58,205,119,0)}100%{box-shadow:0 0 0 0 rgba(58,205,119,0)}}' +
    '@media (prefers-reduced-motion:reduce){#tatc .tx b i{animation:none}}' +
    /* the overview bubble */
    '#tatcSheet .panel{height:min(84vh,780px);overflow-y:auto;-webkit-overflow-scrolling:touch;overscroll-behavior:contain;padding-top:0}' +
    '#tatcSheet .grab{margin-top:10px}' +
    '#tatcSheet .dhead{position:sticky;top:0;z-index:2;background:var(--paper-2,#EFF4F0);padding:4px 0 8px;margin:0 -2px}' +
    '#tatcSheet h3{font-family:"Bricolage Grotesque",Archivo,sans-serif;font-weight:800;font-size:20px;margin:0}' +
    '#tatcSheet .dt{font-size:13.5px;color:var(--grey);margin:3px 0 12px}' +
    '#tatcSheet .grp{font-size:10.5px;font-weight:800;letter-spacing:.15em;text-transform:uppercase;color:var(--grey);margin:14px 2px 7px}' +
    '#tatcSheet .grp.now{color:var(--green-dk)}' +
    '#tatcSheet .it{display:grid;grid-template-columns:62px 1fr;gap:10px;padding:10px 12px;border-radius:13px;background:#fff;border:1px solid var(--line);margin-bottom:6px}' +
    '#tatcSheet .it.live{border-color:var(--green);box-shadow:0 0 0 3px rgba(58,205,119,.18)}' +
    '#tatcSheet .it.m{background:linear-gradient(180deg,#FFFDF6,#FBF1DC);border-color:rgba(184,125,18,.35)}' +
    '#tatcSheet .it.done{opacity:.55}' +
    '#tatcSheet .it .t{font-family:"Bricolage Grotesque",Archivo,sans-serif;font-weight:800;font-size:17px;color:var(--deep);line-height:1.1}' +
    '#tatcSheet .it .t small{display:block;font-family:Archivo,sans-serif;font-size:11px;color:var(--grey);font-weight:600}' +
    '#tatcSheet .it .k{font-size:10px;font-weight:800;letter-spacing:.1em;text-transform:uppercase;color:var(--green-dk)}' +
    '#tatcSheet .it.m .k{color:#7A5210}' +
    '#tatcSheet .it .w{display:block;font-weight:800;font-size:15px;line-height:1.3}' +
    '#tatcSheet .it .p{display:flex;gap:5px;align-items:center;font-size:12.5px;color:var(--grey);margin-top:2px}' +
    '#tatcSheet .it .p svg{width:12px;height:12px;stroke:var(--green-dk);stroke-width:2;fill:none;flex:none}' +
    '#tatcBubble{box-sizing:border-box;position:absolute;z-index:80;background:#fff;border-radius:16px;padding:8px 12px;border:1px solid rgba(31,130,74,.3);box-shadow:0 14px 34px -8px rgba(10,30,20,.45);animation:tatcPop .14s ease-out}' +
    '#tatcBubble .arrow{position:absolute;top:-7px;left:34px;width:14px;height:14px;background:#fff;border-left:1px solid rgba(31,130,74,.3);border-top:1px solid rgba(31,130,74,.3);transform:rotate(45deg)}' +
    '#tatcBubble .bi{display:flex;gap:11px;padding:8px 0;border-top:1px solid var(--line)}' +
    '#tatcBubble .bi:first-of-type{border-top:0}' +
    '#tatcBubble .bt{flex:none;width:48px;font-family:"Bricolage Grotesque",Archivo,sans-serif;font-weight:800;font-size:16px;color:var(--deep)}' +
    '#tatcBubble .bw{flex:1;min-width:0}' +
    '#tatcBubble .bw em{display:block;font-style:normal;font-size:10px;font-weight:800;letter-spacing:.1em;text-transform:uppercase;color:var(--grey)}' +
    '#tatcBubble .bw em.on{color:var(--green-dk)}' +
    '#tatcBubble .bw b{display:block;font-size:14.5px;line-height:1.3}' +
    '#tatcBubble .bw small{display:block;font-size:12px;color:var(--grey)}' +
    '#tatcBubble .bnone{font-size:14px;color:var(--grey);padding:8px 0}' +
    '#tatcBubble .bmore{font-size:12px;font-weight:700;color:var(--green-dk);padding:7px 0 3px;border-top:1px solid var(--line)}' +
    '@keyframes tatcPop{from{opacity:0;transform:translateY(-4px)}to{opacity:1;transform:none}}' +
    '#tatcSheet .dnav{display:flex;align-items:center;gap:8px;height:48px}' +
    '#tatcSheet .dn{flex:none;width:44px;height:44px;border-radius:12px;font-size:24px;font-weight:800;line-height:1;background:var(--green-lt);color:var(--green-dk);border:1.5px solid #BFDFCD;box-shadow:0 3px 0 #BFDFCD}' +
    '#tatcSheet .dn:active{box-shadow:0 1px 0 #BFDFCD;transform:translateY(2px)}' +
    '#tatcSheet .dd{flex:1;min-width:0;text-align:center;position:relative;cursor:pointer}' +
    '#tatcSheet .dd b{display:block;font-family:"Bricolage Grotesque",Archivo,sans-serif;font-weight:800;font-size:18px;line-height:22px;height:22px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}' +
    '#tatcSheet .dd span{display:block;font-size:13px;line-height:18px;height:18px;color:var(--grey);margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}' +
    '#tatcSheet .dd em{font-style:normal;color:var(--green-dk);font-size:11px}' +
    '#tatcSheet .dpick{position:absolute;inset:0;width:100%;height:100%;opacity:0;cursor:pointer;-webkit-appearance:none;appearance:none}' +
    '#tatcSheet .tchip{display:block;height:32px;margin:6px auto 0;padding:7px 14px;border-radius:999px;font-size:13px;font-weight:700;background:#fff;color:var(--green-dk);border:1px solid #BFDFCD}' +
    '#tatcSheet .wxb{display:flex;align-items:center;gap:12px;margin:8px 0 2px;padding:11px 13px;border-radius:14px;background:linear-gradient(160deg,#F2FBF6,#E4F5EB);border:1px solid rgba(31,130,74,.22)}' +
    '#tatcSheet .wxb .wi{font-size:28px;line-height:1}' +
    '#tatcSheet .wxb b{display:block;font-size:15px}' +
    '#tatcSheet .wxb small{display:block;font-size:12.5px;color:var(--grey);margin-top:1px}' +
    '#tatcSheet .wxc{display:inline-block;margin-top:5px;font-size:12px;font-weight:700;color:var(--green-dk);background:var(--green-lt);border-radius:999px;padding:2px 9px}' +
    '#tatcBubble .bwx{font-size:13px;font-weight:700;color:var(--green-dk);padding:7px 0 8px;border-bottom:1px solid var(--line)}' +
    '#tatcSheet .none{font-size:14.5px;color:var(--grey);padding:10px 2px}' +
    '#tatcSheet .open{display:block;width:100%;text-align:center;margin-top:14px;padding:15px;border-radius:12px;background:var(--forest);color:#fff;font-weight:800;font-size:15px;border:1.5px solid #0F5C34;box-shadow:0 3px 0 #0F5C34;text-decoration:none}';
  document.head.appendChild(css);

  /* ---------- weather (Killeshin, from open-meteo) ---------- */
  var WX = null, WX_AT = 0;
  var WXT = {0:'Clear',1:'Mostly clear',2:'Partly cloudy',3:'Overcast',45:'Fog',48:'Fog',51:'Light drizzle',53:'Drizzle',
    55:'Heavy drizzle',61:'Light rain',63:'Rain',65:'Heavy rain',66:'Freezing rain',67:'Freezing rain',71:'Light snow',
    73:'Snow',75:'Heavy snow',80:'Showers',81:'Showers',82:'Heavy showers',95:'Thunderstorms',96:'Thunderstorms',99:'Thunderstorms'};
  function wxIcon(c){
    if(c === 0 || c === 1) return '\u2600\uFE0F';
    if(c === 2) return '\u26C5';
    if(c === 3 || c === 45 || c === 48) return '\u2601\uFE0F';
    if(c >= 71 && c <= 77) return '\u2744\uFE0F';
    if(c >= 95) return '\u26C8\uFE0F';
    if(c >= 51) return '\uD83C\uDF27\uFE0F';
    return '\u2601\uFE0F';
  }
  function weather(){
    if(WX && Date.now() - WX_AT < 30*60000) return Promise.resolve(WX);
    return fetch('https://api.open-meteo.com/v1/forecast?latitude=52.85&longitude=-7.02' +
        '&current=temperature_2m,weather_code' +
        '&hourly=temperature_2m,precipitation_probability,weather_code' +
        '&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max' +
        '&timezone=Europe%2FDublin&past_days=7&forecast_days=16')
      .then(function(r){ if(!r.ok) throw 0; return r.json(); })
      .then(function(j){ WX = j; WX_AT = Date.now(); return j; })
      .catch(function(){ return null; });
  }
  function wxAt(day, time){            // the forecast for one hour
    if(!WX || !WX.hourly) return null;
    var i = WX.hourly.time.indexOf(day + 'T' + String(time).slice(0,2) + ':00');
    if(i < 0) return null;
    return {t: Math.round(WX.hourly.temperature_2m[i]), rain: WX.hourly.precipitation_probability[i], code: WX.hourly.weather_code[i]};
  }
  function wxDay(day){                 // the forecast for the whole day
    if(!WX || !WX.daily) return null;
    var i = WX.daily.time.indexOf(day);
    if(i < 0) return null;
    return {hi: Math.round(WX.daily.temperature_2m_max[i]), lo: Math.round(WX.daily.temperature_2m_min[i]),
            rain: WX.daily.precipitation_probability_max[i], code: WX.daily.weather_code[i]};
  }
  function wxChip(day, time){
    var w = wxAt(day, time);
    return w ? '<span class="wxc">' + wxIcon(w.code) + ' ' + w.t + '\u00b0' + (w.rain >= 30 ? ' \u00b7 ' + w.rain + '% rain' : '') + '</span>' : '';
  }
  function wxBanner(day){
    var w = wxDay(day);
    if(!w) return '';
    return '<div class="wxb"><span class="wi">' + wxIcon(w.code) + '</span><span><b>' + esc(WXT[w.code] || 'Forecast') +
      '</b><small>High ' + w.hi + '\u00b0 \u00b7 low ' + w.lo + '\u00b0 \u00b7 ' + (w.rain == null ? '' : w.rain + '% chance of rain') +
      '</small></span></div>';
  }

  /* ---------- data ---------- */
  function pad(n){ return (n < 10 ? '0' : '') + n; }
  function todayStr(){ var d = new Date(); return d.getFullYear() + '-' + pad(d.getMonth()+1) + '-' + pad(d.getDate()); }
  function toMin(t){ var p = String(t).slice(0,5).split(':'); return (+p[0])*60 + (+p[1]); }
  function hm(t){ return String(t).slice(0,5); }
  function esc(t){ return String(t == null ? '' : t).replace(/[&<>"]/g, function(c){
    return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]; }); }
  function where(h){
    if(!h || !h.length) return 'Club grounds \u00b7 pitch to be confirmed';
    var out = [];
    PAIRS.forEach(function(pr){
      var a = h.indexOf(pr[0]) > -1, b = h.indexOf(pr[1]) > -1;
      if(a && b) out.push(PITCH[pr[0]] + ' (full pitch)');
      else if(a) out.push(PITCH[pr[0]] + ' \u00b7 ' + SIDE[pr[0]] + ' side');
      else if(b) out.push(PITCH[pr[1]] + ' \u00b7 ' + SIDE[pr[1]] + ' side');
    });
    return out.join(', ');
  }
  function kindOf(b){ return b.kind === 'match' ? 'Match' : b.practice ? 'Practice match' : 'Training'; }
  function title(b){ return b.team + (b.opponent ? ' v ' + b.opponent : ''); }

  var ITEMS = [], LOADED = false, SHEET_DAY = null, SITE_CACHE = null, SITE_AT = 0;

  function siteData(){
    if(SITE_CACHE && Date.now() - SITE_AT < 60000) return Promise.resolve(SITE_CACHE);
    return fetch('data.json?t=' + Date.now(), {cache:'no-store'})
      .then(function(r){ if(!r.ok) throw 0; return r.json(); })
      .then(function(j){ SITE_CACHE = j; SITE_AT = Date.now(); return j; });
  }
  function homeGamesFromSite(day){
    return siteData()
      .then(function(j){
        return (j.fixtures || []).filter(function(f){
          if(f.date !== day || !/^\d{1,2}:\d{2}$/.test(f.time || '')) return false;
          var v = (f.venue || '').toLowerCase();
          return v.indexOf('killeshin') > -1 || v.indexOf('hearns') > -1 || v.indexOf('sonny byrne') > -1 ||
                 (f.isHome && (!f.venue || /^tbc/i.test(f.venue)));
        }).map(function(f){
          var st = toMin(f.time);
          return {kind:'match', start_time: pad(Math.floor(st/60)) + ':' + pad(st%60),
                  end_time: pad(Math.floor(Math.min(st+90,1439)/60)) + ':' + pad(Math.min(st+90,1439)%60),
                  team: (f.branch === 'ladies' ? 'Ladies ' : '') + f.grade + ' v ' + f.opponent, halves: []};
        });
      })
      .catch(function(){ return []; });
  }

  function addDays(day, n){
    var p = day.split('-'), d = new Date(+p[0], p[1]-1, +p[2]); d.setDate(d.getDate() + n);
    return d.getFullYear() + '-' + pad(d.getMonth()+1) + '-' + pad(d.getDate());
  }
  /* Everything on the club pitches for one day: bookings, plus any home game
     on the website that hasn't been booked yet */
  function fetchDay(day){
    var bookings = fetch(SUPA_URL + '/rest/v1/public_schedule?select=*&day=eq.' + day + '&status=eq.confirmed&order=start_time',
        {headers: {apikey: SUPA_KEY}, cache: 'no-store'})
      .then(function(r){ if(!r.ok) throw 0; return r.json(); })
      .catch(function(){ return null; });
    return Promise.all([bookings, homeGamesFromSite(day)]).then(function(res){
      var rows = res[0] || [];
      res[1].forEach(function(g){
        var st = toMin(g.start_time);
        var dup = rows.some(function(b){ return b.kind === 'match' && Math.abs(toMin(b.start_time) - st) <= 90; });
        if(!dup) rows.push(g);
      });
      rows.sort(function(a,b){ return toMin(a.start_time) - toMin(b.start_time); });
      rows.ok = res[0] !== null;
      return rows;
    });
  }

  function load(){
    var day = todayStr();
    return fetchDay(day).then(function(rows){
      ITEMS = rows; LOADED = rows.ok || rows.length > 0;
      paintStrip();
      var sh = document.getElementById('tatcSheet');
      if(sh && sh.classList.contains('open') && SHEET_DAY === day) paintSheet(day, rows);
    });
  }

  /* Today splits into on now / later / earlier. Other days are all one list. */
  function split(rows, day){
    var t = todayStr();
    if(day && day > t) return {live:[], later:rows, done:[]};
    if(day && day < t) return {live:[], later:[], done:rows};
    var d = new Date(), n = d.getHours()*60 + d.getMinutes();
    return {
      live:  rows.filter(function(b){ return toMin(b.start_time) <= n && n < toMin(b.end_time); }),
      later: rows.filter(function(b){ return toMin(b.start_time) > n; }),
      done:  rows.filter(function(b){ return toMin(b.end_time) <= n; })
    };
  }

  /* ---------- the strip ---------- */
  function strip(){
    var el = document.getElementById('tatc');
    if(el) return el;
    el = document.createElement('button');
    el.id = 'tatc';
    el.type = 'button';
    el.setAttribute('aria-label', 'Today at the Club. Tap for everything on today, press and hold for a quick look.');
    el.innerHTML = '<span class="ic">' + ICON.clock + '</span>' +
      '<span class="tx"><b><i></i>Today at the Club</b><span id="tatcLine">Checking what\u2019s on\u2026</span><small id="tatcSub"></small></span>' +
      '<span class="wxs" id="tatcWx"></span><span class="go">\u203A</span>';
    wirePress(el);
    return el;
  }

  function paintStrip(){
    var el = document.getElementById('tatc'); if(!el) return;
    var s = split(ITEMS), line, sub;
    if(!ITEMS.length){
      line = LOADED ? 'Nothing on the club pitches today' : 'Tap to see what\u2019s on';
      sub = LOADED ? 'Check back later' : '';
    } else if(s.live.length){
      line = 'On now: ' + title(s.live[0]) + (s.live.length > 1 ? ' +' + (s.live.length-1) + ' more' : '');
      sub = s.later.length ? 'Next: ' + hm(s.later[0].start_time) + ' ' + title(s.later[0]) : 'Nothing else later today';
    } else if(s.later.length){
      line = 'Next: ' + hm(s.later[0].start_time) + ' \u00b7 ' + title(s.later[0]);
      sub = s.later.length > 1 ? (s.later.length - 1) + ' more later today' : kindOf(s.later[0]) + ' \u00b7 ' + where(s.later[0].halves);
    } else {
      line = 'All done for today';
      sub = ITEMS.length + (ITEMS.length === 1 ? ' session' : ' sessions') + ' earlier';
    }
    el.classList.toggle('live', s.live.length > 0);
    document.getElementById('tatcLine').textContent = line;
    document.getElementById('tatcSub').textContent = sub;
    var wx = document.getElementById('tatcWx');
    if(wx && WX && WX.current){
      wx.innerHTML = '<span>' + wxIcon(WX.current.weather_code) + '</span><b>' + Math.round(WX.current.temperature_2m) + '\u00b0</b>';
      wx.title = WXT[WX.current.weather_code] || '';
    }
  }

  /* Tap opens the full view. Press and hold opens the overview bubble. */
  function wirePress(el){
    var timer = null, held = false, sx = 0, sy = 0;
    function clear(){ clearTimeout(timer); timer = null; el.classList.remove('pressing'); }
    el.addEventListener('pointerdown', function(e){
      held = false; sx = e.clientX; sy = e.clientY;
      el.classList.add('pressing');
      timer = setTimeout(function(){
        held = true; el.classList.remove('pressing');
        if(navigator.vibrate) try { navigator.vibrate(12); } catch(err){}
        openBubble();
      }, 450);
    });
    el.addEventListener('pointermove', function(e){
      if(timer && Math.hypot(e.clientX - sx, e.clientY - sy) > 10) clear();
    });
    el.addEventListener('pointerup', clear);
    el.addEventListener('pointercancel', clear);
    el.addEventListener('pointerleave', clear);
    el.addEventListener('contextmenu', function(e){ e.preventDefault(); });
    el.addEventListener('click', function(e){
      if(held){ e.preventDefault(); held = false; return; }
      openSheet();
    });
  }

  /* ---------- the overview bubble ---------- */
  function sheet(){
    var sh = document.getElementById('tatcSheet');
    if(sh) return sh;
    sh = document.createElement('div');
    sh.className = 'sheet';
    sh.id = 'tatcSheet';
    sh.setAttribute('role', 'dialog');
    sh.setAttribute('aria-label', 'Today at the Club');
    sh.innerHTML = '<div class="panel"><div class="grab"></div><div id="tatcBody"></div></div>';
    sh.addEventListener('click', function(e){
      if(!e.target.closest('.panel') || e.target.closest('#tatcClose')){ sh.classList.remove('open'); return; }
      var dn = e.target.closest('.dn');
      if(dn){ showDay(addDays(SHEET_DAY, +dn.dataset.d)); return; }
      if(e.target.closest('.tchip')){ showDay(todayStr()); }
    });
    sh.addEventListener('change', function(e){
      if(e.target.classList.contains('dpick') && e.target.value) showDay(e.target.value);
    });
    var sx = 0, sy = 0;
    sh.addEventListener('touchstart', function(e){ var t = e.touches[0]; sx = t.clientX; sy = t.clientY; }, {passive: true});
    sh.addEventListener('touchend', function(e){
      var t = e.changedTouches[0], dx = t.clientX - sx, dy = t.clientY - sy;
      if(Math.abs(dx) > 60 && Math.abs(dy) < 45) showDay(addDays(SHEET_DAY, dx < 0 ? 1 : -1));
    }, {passive: true});
    document.body.appendChild(sh);
    return sh;
  }
  function item(b, cls, day){
    var m = b.kind === 'match' || b.practice;
    return '<div class="it ' + cls + (m ? ' m' : '') + '"><div class="t">' + hm(b.start_time) +
      '<small>to ' + hm(b.end_time) + '</small></div><div><span class="k">' + kindOf(b) + '</span>' +
      '<span class="w">' + esc(title(b)) + '</span><span class="p">' + ICON.pin + esc(where(b.halves)) + '</span>' +
      (day ? wxChip(day, b.start_time) : '') + '</div></div>';
  }
  function dayTitle(day){
    var t = todayStr();
    if(day === t) return 'Today at the Club';
    if(day === addDays(t, 1)) return 'Tomorrow at the Club';
    if(day === addDays(t, -1)) return 'Yesterday at the Club';
    var p = day.split('-');
    return new Date(+p[0], p[1]-1, +p[2]).toLocaleDateString('en-IE', {weekday:'long'}) + ' at the Club';
  }
  function dayLong(day){
    var p = day.split('-');
    return new Date(+p[0], p[1]-1, +p[2]).toLocaleDateString('en-IE', {weekday:'short', day:'numeric', month:'long', year:'numeric'});
  }
  function header(day){
    var t = todayStr();
    return '<div class="dhead"><div class="dnav">' +
        '<button class="dn" type="button" data-d="-1" aria-label="Previous day">\u2039</button>' +
        '<label class="dd"><b>' + esc(dayTitle(day)) + '</b>' +
          '<span>' + esc(dayLong(day)) + ' <em>\u25BE</em></span>' +
          '<input type="date" class="dpick" value="' + day + '" aria-label="Pick a day"></label>' +
        '<button class="dn" type="button" data-d="1" aria-label="Next day">\u203A</button>' +
      '</div>' +
      '<button class="tchip" type="button"' + (day === t ? ' style="visibility:hidden" tabindex="-1" aria-hidden="true"' : '') + '>Back to today</button></div>';
  }
  function paintSheet(day, rows){
    var t = todayStr(), s = split(rows, day), html = header(day) + wxBanner(day);
    if(!rows.length) html += '<p class="none">' + (day === t ? 'Nothing on the club pitches today.'
      : day > t ? 'Nothing booked on the club pitches yet.' : 'Nothing was on the club pitches.') + '</p>';
    if(day === t){
      if(s.live.length)  html += '<div class="grp now">On now</div>' + s.live.map(function(b){ return item(b,'live',day); }).join('');
      if(s.later.length) html += '<div class="grp">' + (s.live.length ? 'Later today' : 'Coming up') + '</div>' + s.later.map(function(b){ return item(b,'',day); }).join('');
      if(s.done.length)  html += '<div class="grp">Earlier today</div>' + s.done.map(function(b){ return item(b,'done',day); }).join('');
    } else if(rows.length){
      html += '<div class="grp">' + (day > t ? 'What\u2019s on' : 'What was on') + '</div>' + rows.map(function(b){ return item(b,'',day); }).join('');
    }
    html += '<button class="open" type="button" id="tatcClose">Close</button>';
    document.getElementById('tatcBody').innerHTML = html;
    var pn = document.querySelector('#tatcSheet .panel'); if(pn) pn.scrollTop = 0;
  }
  function showDay(day){
    SHEET_DAY = day;
    if(!WX) weather().then(function(){ if(SHEET_DAY === day) showDay(day); });
    var body = document.getElementById('tatcBody');
    if(day === todayStr() && LOADED){ paintSheet(day, ITEMS); return; }
    body.innerHTML = header(day) + '<p class="none">Loading\u2026</p>';
    fetchDay(day).then(function(rows){ if(SHEET_DAY === day) paintSheet(day, rows); });
  }
  /* Quick look: a small bubble just under the strip, on now and next only */
  function openBubble(){
    closeBubble();
    var el = document.getElementById('tatc'); if(!el) return;
    var s = split(ITEMS), r = el.getBoundingClientRect();
    var rows = s.live.map(function(b){ return ['On now', b]; })
      .concat(s.later.slice(0, Math.max(1, 3 - s.live.length)).map(function(b){ return ['Next', b]; }));
    var body = rows.length ? rows.map(function(x){ var b = x[1];
        return '<div class="bi"><span class="bt">' + hm(b.start_time) + '</span><span class="bw"><em class="' +
          (x[0] === 'On now' ? 'on' : '') + '">' + x[0] + ' \u00b7 ' + kindOf(b) + '</em><b>' + esc(title(b)) +
          '</b><small>' + esc(where(b.halves)) + '</small></span></div>'; }).join('')
      : '<div class="bnone">' + (ITEMS.length ? 'All done for today.' : 'Nothing on the club pitches today.') + '</div>';
    var bub = document.createElement('div');
    bub.id = 'tatcBubble';
    bub.style.top = (r.bottom + window.scrollY + 10) + 'px';
    bub.style.left = (r.left + window.scrollX) + 'px';
    bub.style.width = r.width + 'px';
    var now = (WX && WX.current) ? '<div class="bwx">' + wxIcon(WX.current.weather_code) + ' ' +
      Math.round(WX.current.temperature_2m) + '\u00b0 \u00b7 ' + esc(WXT[WX.current.weather_code] || '') + ' now at the club</div>' : '';
    bub.innerHTML = '<span class="arrow"></span>' + now + body +
      (ITEMS.length > rows.length ? '<div class="bmore">Tap the strip to see all ' + ITEMS.length + ' today</div>' : '');
    document.body.appendChild(bub);
    setTimeout(function(){
      document.addEventListener('pointerdown', closeBubble, {once: true});
      window.addEventListener('scroll', closeBubble, {once: true, passive: true});
    }, 0);
  }
  function closeBubble(){ var b = document.getElementById('tatcBubble'); if(b) b.remove(); }

  function openSheet(day){ var sh = sheet(); showDay(day || todayStr()); requestAnimationFrame(function(){ sh.classList.add('open'); }); }

  /* Only on the home (Fixtures) page, between the filters and Next match */
  function placeStrip(){
    var top = document.getElementById('top');
    if(!top) return;
    var el = strip();
    if(el.nextSibling !== top) top.parentNode.insertBefore(el, top);
    el.hidden = !!top.hidden;
  }

  /* ---------- Club page tiles and More menu ---------- */
  function clubTiles(){
    var wrap = document.createElement('div');
    wrap.id = 'pitchBookings';
    wrap.innerHTML =
      '<div class="sec"><span class="lbl">Club apps</span></div>' +
      '<div class="pgrid">' +
        '<a class="ptile half" href="' + BOOKINGS + '"><span class="tile">' + ICON.pitch + '</span>' +
          '<span class="tx"><b>Pitch Bookings</b><span>Book training or a practice match</span></span></a>' +
        '<a class="ptile half" href="' + SCORER + '"><span class="tile">' + ICON.score + '</span>' +
          '<span class="tx"><b>Live Scorer</b><span>Score a match live for the website</span></span></a>' +
      '</div>' +
      '<a class="ptile" href="#" id="tatcTile"><span class="tile">' + ICON.clock + '</span>' +
        '<span class="tx"><b>Today at the Club</b><span>Training, practice matches and home games on the club pitches</span></span>' +
        '<span class="go">\u203A</span></a>';
    return wrap;
  }
  function addToClub(){
    var out = document.getElementById('out');
    if(!out || document.getElementById('pitchBookings')) return;
    if(!out.querySelector('.feat[data-feat], a.act')) return;
    var t = clubTiles();
    out.insertBefore(t, out.firstChild);
    t.querySelector('#tatcTile').addEventListener('click', function(e){ e.preventDefault(); openSheet(); });
  }
  function addToMore(){
    var panel = document.querySelector('#sheet .panel');
    if(!panel || panel.querySelector('.pbtn')) return;
    var a = document.createElement('a');
    a.className = 'pbtn'; a.href = BOOKINGS; a.innerHTML = ICON.pitch + 'Pitch bookings';
    panel.appendChild(a);
    var sc = document.createElement('a');
    sc.className = 'pbtn'; sc.href = SCORER; sc.innerHTML = ICON.score + 'Live scorer';
    panel.appendChild(sc);
  }

  function start(){
    addToMore();
    addToClub();
    placeStrip();
    var out = document.getElementById('out');
    if(out && window.MutationObserver) new MutationObserver(addToClub).observe(out, {childList: true});
    var top = document.getElementById('top');
    if(top && window.MutationObserver) new MutationObserver(placeStrip).observe(top, {attributes: true, attributeFilter: ['hidden']});
    weather().then(paintStrip);
    load();
    setInterval(load, 60000);
    setInterval(function(){ weather().then(paintStrip); }, 30*60000);          /* fresh bookings every minute */
    setInterval(paintStrip, 30000);    /* "on now" rolls over between loads */
  }
  if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
