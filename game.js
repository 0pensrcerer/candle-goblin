/**
 * Candle Goblin - game.js
 * Page-context script (injected via content.js).
 *
 * MASKING STRATEGY:
 *   The chart loads fully and renders all candles normally.
 *   A black cover <div> is placed over the chart container and
 *   positioned so it hides everything to the RIGHT of the last
 *   revealed candle.  On each guess the cover slides left by one
 *   candle width (CSS transition) to reveal the next candle and
 *   every sub-pane indicator beneath it - no Highcharts API calls,
 *   no 404s.
 *
 * FLOW:
 *   1. "New Game" -> random weekday in last 90 days -> navigate.
 *   2. Page reloads -> sessionStorage flag -> full-screen overlay.
 *   3. Wait for Highcharts to render ALL candles.
 *   4. Place black cover hiding all but the first INITIAL_REVEAL candles.
 *   5. Player guesses LONG / SHORT -> cover slides to reveal next candle.
 *   6. $100k bankroll in localStorage, persisted across games.
 */
(function () {
  'use strict';

  /* ---- Debug logger ------------------------------------------------ */
  var DEBUG = false; // set true to enable on-screen debug log
  function dbg() {
    if (!DEBUG) return;
    var args = Array.prototype.slice.call(arguments);
    var msg  = '[BSG] ' + args.join(' ');
    console.log(msg);
    var log = document.getElementById('bsg-debug-log');
    if (!log) {
      log = document.createElement('div');
      log.id = 'bsg-debug-log';
      log.style.cssText = [
        'position:fixed','bottom:8px','left:8px','width:420px','max-height:180px',
        'overflow-y:auto','background:rgba(0,0,0,0.88)','color:#7dd3fc',
        'font:11px/1.5 monospace','padding:6px 8px','border-radius:6px',
        'z-index:2147483645','pointer-events:none','white-space:pre-wrap'
      ].join(';');
      document.body.appendChild(log);
    }
    var line = document.createElement('div');
    line.textContent = new Date().toISOString().slice(11,23) + '  ' + msg;
    log.appendChild(line);
    // keep last 40 lines
    while (log.children.length > 40) log.removeChild(log.firstChild);
    log.scrollTop = log.scrollHeight;
  }

  var SS_KEY         = 'bsg_session';
  var LS_BANKROLL    = 'bsg_bankroll';
  var LS_LOANS       = 'bsg_loans';
  var LS_TRADES      = 'bsg_trades';
  var LS_WINS        = 'bsg_wins';
  var START_BANKROLL = 100000;
  var LOAN_THRESHOLD = 25000;
  var INITIAL_REVEAL = 5;

  /* ---- Persistent bankroll (localStorage) ------------------------- */
  var persist = {
    get bankroll() { return parseFloat(localStorage.getItem(LS_BANKROLL) || START_BANKROLL); },
    set bankroll(v) { localStorage.setItem(LS_BANKROLL, String(v)); },
    get loans()    { return parseInt(localStorage.getItem(LS_LOANS)  || '0', 10); },
    set loans(v)   { localStorage.setItem(LS_LOANS,  String(v)); },
    get trades()   { return parseInt(localStorage.getItem(LS_TRADES) || '0', 10); },
    set trades(v)  { localStorage.setItem(LS_TRADES, String(v)); },
    get wins()     { return parseInt(localStorage.getItem(LS_WINS)   || '0', 10); },
    set wins(v)    { localStorage.setItem(LS_WINS,   String(v)); }
  };

  /* ---- Session state (survives same-tab navigation) --------------- */
  function loadSession() {
    try { return JSON.parse(sessionStorage.getItem(SS_KEY) || 'null'); } catch(e) { return null; }
  }
  function saveSession(data) {
    try { sessionStorage.setItem(SS_KEY, JSON.stringify(data)); } catch(e) {}
  }
  function clearSession() {
    try { sessionStorage.removeItem(SS_KEY); } catch(e) {}
  }

  /* ---- Runtime (in-memory) ---------------------------------------- */
  var rt = {
    chart:           null,
    allData:         [],
    revealedCount:   INITIAL_REVEAL,
    candleInterval:  60000,
    bet:             1000,
    waitingForGuess: false,
    cancelWait:      null,  // hard-stops waitForChart (on timeout/resolve)
    pauseWait:       null,  // called by stopGame — keeps observer alive
    resumeWait:      null   // called by startNewGame — re-activates check()
  };

  /* ---- Helpers ---------------------------------------------------- */
  var KNOWN_SECTIONS = ['sfsegregated','sf3segregated','smartflow','sfm2','ultraflow'];

  function getUrlParts() {
    var parts = window.location.pathname.split('/').filter(Boolean);
    for (var i = 0; i < parts.length - 1; i++) {
      if (KNOWN_SECTIONS.indexOf(parts[i].toLowerCase()) !== -1) {
        var sym = parts[i + 1];
        if (sym && /^[A-Z0-9]{1,6}$/i.test(sym)) {
          return { section: parts[i], symbol: sym.toUpperCase() };
        }
      }
    }
    var inp = document.querySelector('.search-input');
    return { section: 'sfSegregated', symbol: (inp && inp.value.trim()) ? inp.value.trim().toUpperCase() : 'SPY' };
  }

  function getSymbolFromUrl() { return getUrlParts().symbol; }

  function randomTradingDate() {
    var today = new Date();
    for (var a = 0; a < 400; a++) {
      var days = Math.floor(Math.random() * 88) + 1;
      var d = new Date(today);
      d.setDate(today.getDate() - days);
      var dow = d.getDay();
      if (dow >= 1 && dow <= 5) {
        var yyyy = d.getFullYear();
        var mm   = String(d.getMonth() + 1).padStart(2, '0');
        var dd   = String(d.getDate()).padStart(2, '0');
        return '' + yyyy + mm + dd;
      }
    }
    return null;
  }

  /* ---- Full-screen loading overlay -------------------------------- */
  function createOverlay() {
    if (document.getElementById('bsg-overlay')) return;
    var ov = document.createElement('div');
    ov.id = 'bsg-overlay';
    ov.innerHTML = '<div id="bsg-overlay-msg"><div class="bsg-spinner"></div><p>Loading game...</p></div>';
    document.body.appendChild(ov);
  }
  function removeOverlay() {
    var ov = document.getElementById('bsg-overlay');
    if (ov) ov.remove();
  }

  /* ---- Chart detection — Wicky-style DOM-first approach ----------- */
  //
  // BigShort bundles Highcharts as a private module so window.Highcharts is
  // never set.  Instead we watch for the DOM elements Highcharts writes when
  // it finishes rendering — specifically the individual candlestick <path>
  // elements (.highcharts-candlestick-series .highcharts-point).
  //
  // Highcharts stores a reference on every SVG point element:
  //   svgEl.point          → Highcharts Point
  //   svgEl.point.series   → Series
  //   svgEl.point.series.chart → Chart  ← this is what we need
  //
  // This bypasses window.Highcharts entirely and fires only once the chart
  // is actually painted — exactly like Wicky watches for span.higlight-number.

  function findReadyChart(verbose) {
    // Primary: read chart ref from rendered SVG point elements (Wicky approach)
    var seriesEls = document.querySelectorAll(
      '.highcharts-candlestick-series, .highcharts-ohlc-series'
    );
    if (verbose) dbg('findReadyChart: candlestick series els=' + seriesEls.length);

    for (var si = 0; si < seriesEls.length; si++) {
      var pts = seriesEls[si].querySelectorAll('.highcharts-point');
      if (verbose) dbg('  series[' + si + '] .highcharts-point count=' + pts.length);
      if (!pts.length) continue;

      // Walk points until we find one with a live .point reference
      for (var pi = 0; pi < pts.length; pi++) {
        var svgEl = pts[pi];
        var point = svgEl.point;
        if (!point) continue;
        var chart = point.series && point.series.chart;
        if (!chart || !chart.xAxis || !chart.xAxis[0]) continue;
        var xData = point.series.xData;
        if (!xData || !xData.length) continue;
        dbg('findReadyChart: FOUND via DOM point — xData.len=' + xData.length +
            ' type=' + point.series.type);
        return chart;
      }
    }

    // Fallback: window.Highcharts (works if BigShort ever exposes it)
    var HC = window.Highcharts;
    if (HC && HC.charts) {
      if (verbose) dbg('findReadyChart: trying window.Highcharts (' + HC.charts.length + ' slots)');
      for (var ci = 0; ci < HC.charts.length; ci++) {
        var chart2 = HC.charts[ci];
        if (!chart2 || !chart2.series || !chart2.xAxis || !chart2.xAxis[0]) continue;
        for (var s2i = 0; s2i < chart2.series.length; s2i++) {
          var s2 = chart2.series[s2i];
          if ((s2.type === 'candlestick' || s2.type === 'ohlc') && s2.xData && s2.xData.length) {
            dbg('findReadyChart: FOUND via window.Highcharts[' + ci + ']');
            return chart2;
          }
        }
      }
    }

    if (verbose) dbg('findReadyChart: not ready yet');
    return null;
  }

  function waitForChart(cb) {
    dbg('waitForChart: immediate check...');
    var chart = findReadyChart(true);
    if (chart) { dbg('waitForChart: already ready'); cb(chart); return; }

    var resolved   = false;
    var debounceId;
    var timeoutId;
    var pollId;
    var pollCount  = 0;
    var paused     = false;

    function hardStop() {
      if (resolved) return;
      resolved = true;
      clearTimeout(timeoutId);
      clearTimeout(debounceId);
      clearInterval(pollId);
      observer.disconnect();
      rt.cancelWait = rt.pauseWait = rt.resumeWait = null;
    }

    function resolve(c, via) {
      if (resolved) return;
      hardStop();
      dbg('waitForChart: resolved via ' + via);
      cb(c);
    }

    function check(via) {
      if (paused) return;
      var c = findReadyChart(false);
      if (c) resolve(c, via);
    }

    // Watch for Highcharts writing candlestick SVG elements into the DOM
    // (same pattern Wicky uses for span.higlight-number.shade1)
    var observer = new MutationObserver(function() {
      clearTimeout(debounceId);
      debounceId = setTimeout(function() { check('MutationObserver'); }, 120);
    });
    dbg('waitForChart: observing body for .highcharts-candlestick-series');
    observer.observe(document.body, { childList: true, subtree: true });

    // Polling fallback every 2s
    pollId = setInterval(function() {
      if (paused) return;
      pollCount++;
      dbg('waitForChart: poll #' + pollCount);
      check('poll#' + pollCount);
    }, 2000);

    timeoutId = setTimeout(function() {
      if (resolved) return;
      hardStop();
      dbg('waitForChart: TIMEOUT after 45s');
      removeOverlay();
      setMessage('Chart took too long to load. Try a new game.', 'warn');
      showIdleButtons();
    }, 45000);

    rt.cancelWait  = hardStop;
    rt.pauseWait   = function() { paused = true;  dbg('waitForChart: paused'); };
    rt.resumeWait  = function() { paused = false; dbg('waitForChart: resumed'); check('resume'); };
  }

  function findCandleSeriesIdx(chart) {
    for (var i = 0; i < chart.series.length; i++) {
      var s = chart.series[i];
      if ((s.type === 'candlestick' || s.type === 'ohlc') && s.xData && s.xData.length > 0) return i;
    }
    return -1;
  }

  function extractOHLC(series) {
    var xData = series.xData || [];
    var yData = series.yData || [];
    if (xData.length && yData.length) {
      return xData.map(function(ts, i) {
        return [ts, yData[i][0], yData[i][1], yData[i][2], yData[i][3]];
      });
    }
    var raw = (series.options && series.options.data) || [];
    return raw.map(function(d) {
      return Array.isArray(d) ? d : [d.x, d.open, d.high, d.low, d.close];
    });
  }

  /* ---- Market open helper --------------------------------------- */
  // 9:30 AM ET = 13:30 UTC (EDT, Apr-Oct) or 14:30 UTC (EST, Nov-Mar)
  // 4:00 PM ET close = 20:00 UTC (EDT) or 21:00 UTC (EST)
  function findMarketOpenIdx(allData) {
    var OPEN_EDT = 13 * 60 + 30; // 13:30 UTC
    var OPEN_EST = 14 * 60 + 30; // 14:30 UTC
    // First pass: exact match
    for (var i = 0; i < allData.length; i++) {
      var d = new Date(allData[i][0]);
      var m = d.getUTCHours() * 60 + d.getUTCMinutes();
      if (m === OPEN_EDT || m === OPEN_EST) return i;
    }
    // Second pass: first candle at or after 13:30 UTC
    for (var i = 0; i < allData.length; i++) {
      var d = new Date(allData[i][0]);
      var m = d.getUTCHours() * 60 + d.getUTCMinutes();
      if (m >= OPEN_EDT) return i;
    }
    return 0;
  }

  /* ---- Black cover div -------------------------------------------- */
  var _resizeObserver = null;

  function createChartCover() {
    var existing = document.getElementById('bsg-chart-cover');
    if (existing) existing.remove();

    var container = (rt.chart && rt.chart.renderTo) || document.getElementById('container');
    if (!container) { dbg('ERROR: chart container not found — cover cannot be placed'); return; }
    dbg('createChartCover: container=' + (container.id || '(no id)') + ' size=' + container.offsetWidth + 'x' + container.offsetHeight);

    var cover = document.createElement('div');
    cover.id = 'bsg-chart-cover';
    var lbl = document.createElement('div');
    lbl.id = 'bsg-cover-label';
    lbl.textContent = '?';
    cover.appendChild(lbl);
    container.appendChild(cover);
    updateCoverPosition(false);

    // Reposition cover whenever the chart container is resized
    // (window resize, panel toggle, zoom change, etc.)
    if (_resizeObserver) _resizeObserver.disconnect();
    var resizeDebounce;
    _resizeObserver = new ResizeObserver(function() {
      clearTimeout(resizeDebounce);
      resizeDebounce = setTimeout(function() {
        updateCoverPosition(false);
      }, 80);
    });
    _resizeObserver.observe(container);
  }

  function updateCoverPosition(animate) {
    var cover = document.getElementById('bsg-chart-cover');
    if (!cover || !rt.chart || !rt.allData.length) return;

    var revealIdx = Math.min(rt.revealedCount, rt.allData.length) - 1;
    var chartH    = rt.chart.chartHeight;

    // Read position directly from the rendered SVG candle element.
    // This is pixel-perfect regardless of zoom, pan, or resize —
    // no axis math, no dependency on xAxis.min/max sync timing.
    var container = cover.parentElement;
    var seriesEl  = container && container.querySelector(
      '.highcharts-candlestick-series, .highcharts-ohlc-series'
    );
    if (seriesEl) {
      var points = seriesEl.querySelectorAll('.highcharts-point');
      var pt = points[revealIdx];
      if (pt) {
        var ptRect = pt.getBoundingClientRect();
        var ctRect = container.getBoundingClientRect();
        // Left edge of cover = right edge of the revealed candle,
        // clamped to the plot area boundaries.
        var leftPx = Math.max(
          rt.chart.plotLeft,
          Math.min(ptRect.right - ctRect.left, rt.chart.plotLeft + rt.chart.plotWidth)
        );
        dbg('cover pos: revealIdx=' + revealIdx
          + ' candleRight=' + Math.round(ptRect.right - ctRect.left)
          + ' left=' + Math.round(leftPx)
          + ' chartH=' + chartH);
        cover.style.transition = animate ? 'left 0.45s ease' : 'none';
        cover.style.left   = leftPx + 'px';
        cover.style.height = chartH + 'px';
        return;
      }
    }

    // Fallback: linear interpolation if SVG elements not found
    var xAxis     = rt.chart.xAxis[0];
    var fraction  = (rt.allData[revealIdx][0] + rt.candleInterval * 0.7 - xAxis.min) / (xAxis.max - xAxis.min);
    var leftPx2   = rt.chart.plotLeft + fraction * rt.chart.plotWidth;
    leftPx2       = Math.max(rt.chart.plotLeft, Math.min(leftPx2, rt.chart.plotLeft + rt.chart.plotWidth));
    dbg('cover pos (fallback): revealIdx=' + revealIdx + ' left=' + Math.round(leftPx2));
    cover.style.transition = animate ? 'left 0.45s ease' : 'none';
    cover.style.left   = leftPx2 + 'px';
    cover.style.height = chartH  + 'px';

    var lbl = document.getElementById('bsg-cover-label');
    if (!lbl) {
      lbl = document.createElement('div');
      lbl.id = 'bsg-cover-label';
      lbl.textContent = '?';
      cover.appendChild(lbl);
    }
  }

  function removeChartCover() {
    if (_resizeObserver) { _resizeObserver.disconnect(); _resizeObserver = null; }
    var cover = document.getElementById('bsg-chart-cover');
    if (cover) cover.remove();
  }

  /* ---- Sound effects (Web Audio API — no external files) ----------- */
  var _audioCtx = null;
  function getAudioCtx() {
    if (!_audioCtx) _audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    return _audioCtx;
  }

  function playWin() {
    try {
      var ctx  = getAudioCtx();
      var now  = ctx.currentTime;
      // Ascending major arpeggio: C5 E5 G5 C6
      var notes = [523.25, 659.25, 783.99, 1046.50];
      notes.forEach(function(freq, i) {
        var osc  = ctx.createOscillator();
        var gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, now + i * 0.08);
        gain.gain.setValueAtTime(0, now + i * 0.08);
        gain.gain.linearRampToValueAtTime(0.25, now + i * 0.08 + 0.01);
        gain.gain.exponentialRampToValueAtTime(0.001, now + i * 0.08 + 0.25);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(now + i * 0.08);
        osc.stop(now + i * 0.08 + 0.3);
      });
    } catch(e) {}
  }

  function playLoss() {
    try {
      var ctx  = getAudioCtx();
      var now  = ctx.currentTime;
      // Descending minor "wah-wah": Bb4 G4 Eb4 Bb3
      var notes = [466.16, 392.00, 311.13, 233.08];
      notes.forEach(function(freq, i) {
        var osc  = ctx.createOscillator();
        var gain = ctx.createGain();
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(freq, now + i * 0.18);
        osc.frequency.linearRampToValueAtTime(freq * 0.97, now + i * 0.18 + 0.15);
        gain.gain.setValueAtTime(0.22, now + i * 0.18);
        gain.gain.exponentialRampToValueAtTime(0.001, now + i * 0.18 + 0.35);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(now + i * 0.18);
        osc.stop(now + i * 0.18 + 0.4);
      });
    } catch(e) {}
  }

  function playSpooky() {
    try {
      var ctx = getAudioCtx();
      var now = ctx.currentTime;
      // Eerie descending tritone wobble
      var freqs = [369.99, 311.13, 261.63, 233.08];
      freqs.forEach(function(freq, i) {
        var osc      = ctx.createOscillator();
        var lfo      = ctx.createOscillator();
        var lfoGain  = ctx.createGain();
        var gain     = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, now + i * 0.3);
        lfo.frequency.setValueAtTime(3.5 + i * 0.4, now);
        lfoGain.gain.setValueAtTime(8, now);
        lfo.connect(lfoGain);
        lfoGain.connect(osc.frequency);
        gain.gain.setValueAtTime(0, now + i * 0.3);
        gain.gain.linearRampToValueAtTime(0.18, now + i * 0.3 + 0.08);
        gain.gain.exponentialRampToValueAtTime(0.001, now + i * 0.3 + 0.55);
        osc.connect(gain);
        gain.connect(ctx.destination);
        lfo.start(now + i * 0.3);
        osc.start(now + i * 0.3);
        osc.stop(now + i * 0.3 + 0.6);
        lfo.stop(now + i * 0.3 + 0.6);
      });
    } catch(e) {}
  }

  function waitAndSee() {
    if (!rt.waitingForGuess) return;
    if (rt.revealedCount >= rt.allData.length) { endOfCandles(); return; }

    playSpooky();
    rt.waitingForGuess = false;
    setGuessButtonsDisabled(true);

    // Reveal the next candle without any bet or trade recorded
    rt.revealedCount++;
    updateCoverPosition(true);

    var candle    = rt.allData[rt.revealedCount - 1];
    var prevClose = rt.allData[rt.revealedCount - 2][4];
    var col = candle[4] >= prevClose ? '#22c55e' : '#f87171';
    var dir = candle[4] >= prevClose ? '\u25b2' : '\u25bc';
    var el = document.getElementById('bsg-result');
    if (el) {
      el.innerHTML = '<span class="bsg-info">\ud83d\udc7b Watching… <span style="color:' + col + '">' + dir + ' $' + candle[4].toFixed(2) + '</span></span>';
      el.style.display = 'block';
    }
    updateProgress();

    setTimeout(function() {
      if (rt.revealedCount >= rt.allData.length) { endOfCandles(); return; }
      clearResult();
      rt.waitingForGuess = true;
      setGuessButtonsDisabled(false);
      updateCandleInfo();
    }, 1800);
  }

  function playDirge() {
    try {
      var ctx  = getAudioCtx();
      var now  = ctx.currentTime;
      // Slow descending minor funeral tones with tremolo
      var notes = [220.00, 196.00, 174.61, 164.81, 146.83];
      notes.forEach(function(freq, i) {
        var osc     = ctx.createOscillator();
        var tremOsc = ctx.createOscillator();
        var tremGain = ctx.createGain();
        var gain    = ctx.createGain();
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(freq, now + i * 0.55);
        tremOsc.frequency.setValueAtTime(5, now);
        tremGain.gain.setValueAtTime(0.06, now);
        tremOsc.connect(tremGain);
        tremGain.connect(osc.frequency);
        gain.gain.setValueAtTime(0, now + i * 0.55);
        gain.gain.linearRampToValueAtTime(0.3, now + i * 0.55 + 0.05);
        gain.gain.exponentialRampToValueAtTime(0.001, now + i * 0.55 + 0.5);
        osc.connect(gain);
        gain.connect(ctx.destination);
        tremOsc.start(now + i * 0.55);
        osc.start(now + i * 0.55);
        osc.stop(now + i * 0.55 + 0.6);
        tremOsc.stop(now + i * 0.55 + 0.6);
      });
    } catch(e) {}
  }

  /* ---- Game actions ----------------------------------------------- */
  function startNewGame() {
    var dateStr = randomTradingDate(); // YYYYMMDD
    if (!dateStr) { setMessage('Could not pick a date. Try again.', 'warn'); return; }

    var parts  = getUrlParts();
    var url    = 'https://app.bigshort.com/' + parts.section + '/' + parts.symbol + '/' + dateStr;
    dbg('startNewGame: navigating to', url);

    // Save game state so init() on the new page resumes automatically
    if (rt.resumeWait) rt.resumeWait = null; // new page will create fresh waitForChart
    saveSession({ active: true, revealedCount: INITIAL_REVEAL, bet: rt.bet });
    createOverlay();
    window.location.href = url;
  }

  function initGame(session) {
    dbg('initGame: waiting for chart...');
    waitForChart(function(chart) {
      dbg('Chart ready — series count:', chart.series.length);
      var idx = findCandleSeriesIdx(chart);
      dbg('findCandleSeriesIdx result:', idx);
      if (idx === -1) {
        removeOverlay();
        clearSession();
        setMessage('No candle data for this date. Trying another...', 'warn');
        showIdleButtons();
        setTimeout(startNewGame, 1500);
        return;
      }

      rt.chart   = chart;
      rt.allData = extractOHLC(chart.series[idx]);
      rt.bet     = (session && session.bet) ? session.bet : rt.bet;

      if (rt.allData.length < INITIAL_REVEAL + 2) {
        removeOverlay();
        clearSession();
        setMessage('Not enough candles for this date. Trying another...', 'warn');
        showIdleButtons();
        setTimeout(startNewGame, 1500);
        return;
      }

      if (rt.allData.length > 1) {
        rt.candleInterval = rt.allData[1][0] - rt.allData[0][0];
      }

      // Find the 9:30 AM ET (market open) candle and start there
      var openIdx = findMarketOpenIdx(rt.allData);
      rt.revealedCount = openIdx + 1; // reveal the open candle itself
      dbg('marketOpenIdx=' + openIdx + ' ts=' + new Date(rt.allData[openIdx][0]).toISOString().slice(11,16));

      // Zoom the chart to regular market hours so pre-market is off-screen
      // setExtremes(min, max, redraw, animate)
      var openTs  = rt.allData[openIdx][0];
      var closeTs = openTs + (6.5 * 60 * 60 * 1000); // 9:30 AM + 6.5h = 4:00 PM
      try {
        chart.xAxis[0].setExtremes(openTs, closeTs, true, false);
        dbg('xAxis zoomed to market hours');
      } catch(e) {
        dbg('setExtremes failed (non-fatal):', e.message);
      }

      dbg('allData.length=' + rt.allData.length + ' revealedCount=' + rt.revealedCount + ' interval=' + rt.candleInterval + 'ms');
      dbg('first ts:', new Date(rt.allData[0][0]).toISOString(), 'last ts:', new Date(rt.allData[rt.allData.length-1][0]).toISOString());

      createChartCover();
      removeOverlay();
      clearSession(); // consumed
      dbg('Cover placed, overlay removed');
      document.body.classList.add('bsg-game-mode');

      showPlayingButtons();
      rt.waitingForGuess = true;
      updateCandleInfo();
      updateProgress();
      clearResult();
      updateUI();
    });
  }

  function makeGuess(direction) {
    if (!rt.waitingForGuess) return;
    if (rt.revealedCount >= rt.allData.length) { endOfCandles(); return; }

    rt.waitingForGuess = false;
    setGuessButtonsDisabled(true);

    var prevClose  = rt.allData[rt.revealedCount - 1][4];
    var nextCandle = rt.allData[rt.revealedCount];
    var nextClose  = nextCandle[4];
    var actual     = nextClose > prevClose ? 'long' : 'short';
    var correct    = direction === actual;

    if (persist.bankroll <= 0) {
      var lr = document.getElementById('bsg-loan-row');
      if (lr) lr.style.display = 'block';
      updateUI();
      return;
    }

    var bet   = Math.min(rt.bet, persist.bankroll);
    var delta = correct ? bet : -bet;
    persist.bankroll = Math.max(0, persist.bankroll + delta);
    persist.trades   = persist.trades + 1;
    if (correct) { persist.wins = persist.wins + 1; playWin(); } else { playLoss(); }

    rt.revealedCount++;
    updateCoverPosition(true);

    showResult(correct, delta, nextCandle, prevClose);
    updateUI();

    setTimeout(function() {
      if (rt.revealedCount >= rt.allData.length) { endOfCandles(); return; }
      if (persist.bankroll <= 0) {
        playDirge();
        setMessage('Bankroll depleted!', 'warn');
        var lr2 = document.getElementById('bsg-loan-row');
        if (lr2) lr2.style.display = 'block';
        updateUI();
        return;
      }
      clearResult();
      rt.waitingForGuess = true;
      setGuessButtonsDisabled(false);
      updateCandleInfo();
      updateProgress();
    }, 1800);
  }

  function getLoan() {
    persist.bankroll = START_BANKROLL;
    persist.loans    = persist.loans + 1;
    document.getElementById('bsg-loan-row').style.display = 'none';
    clearResult();
    updateUI();
    if (rt.revealedCount < rt.allData.length) {
      rt.waitingForGuess = true;
      setGuessButtonsDisabled(false);
    }
  }

  function stopGame() {
    if (rt.pauseWait) rt.pauseWait();
    removeChartCover();
    document.body.classList.remove('bsg-game-mode');
    rt.chart           = null;
    rt.allData         = [];
    rt.waitingForGuess = false;
    removeOverlay();
    showIdleButtons();
    clearResult();
    var el;
    el = document.getElementById('bsg-candle-info');   if (el) el.innerHTML   = '';
    el = document.getElementById('bsg-progress-label'); if (el) el.textContent = '';
    el = document.getElementById('bsg-progress-fill');  if (el) el.style.width = '0%';
    el = document.getElementById('bsg-loan-row');       if (el) el.style.display = 'none';
    updateUI();
  }

  function endOfCandles() {
    rt.waitingForGuess = false;
    removeChartCover();
    document.body.classList.remove('bsg-game-mode');
    showIdleButtons();
    setMessage('All candles revealed! Start a new game to keep playing.', 'info');
    updateUI();
  }

  /* ---- Panel HTML -------------------------------------------------- */
  function createPanel() {
    if (document.getElementById('bsg-panel')) return;
    var panel = document.createElement('div');
    panel.id = 'bsg-panel';
    panel.innerHTML = [
      '<div id="bsg-header">',
        '<span id="bsg-logo">&#x1F47B; Candle Goblin</span>',
        '<button id="bsg-min-btn">&#8722;</button>',
        '<button id="bsg-close-btn">&#x2715;</button>',
      '</div>',
      '<div id="bsg-body">',
        '<div id="bsg-bankroll-row">',
          '<span class="bsg-lbl">Bankroll</span>',
          '<span id="bsg-bankroll">$100,000</span>',
        '</div>',
        '<div id="bsg-stats-row">',
          '<span id="bsg-winrate">No trades yet</span>',
          '<span id="bsg-loan-count"></span>',
        '</div>',
        '<div id="bsg-bet-section">',
          '<span class="bsg-lbl">Bet per candle</span>',
          '<div id="bsg-bet-btns">',
            '<button class="bsg-bet" data-amt="500">$500</button>',
            '<button class="bsg-bet active" data-amt="1000">$1K</button>',
            '<button class="bsg-bet" data-amt="2500">$2.5K</button>',
            '<button class="bsg-bet" data-amt="5000">$5K</button>',
            '<button class="bsg-bet" data-amt="10000">$10K</button>',
            '<button class="bsg-bet" data-amt="25000">$25K</button>',
            '<input id="bsg-bet-custom" type="number" min="1" step="100" placeholder="Custom" title="Custom bet amount" />',
          '</div>',
        '</div>',
        '<div id="bsg-candle-info"></div>',
        '<div id="bsg-control-row">',
          '<button id="bsg-new-btn" class="bsg-btn bsg-primary">New Game</button>',
          '<button id="bsg-stop-btn" class="bsg-btn bsg-dim" style="display:none;">Stop</button>',
        '</div>',
        '<div id="bsg-guess-row" style="display:none;">',
          '<button id="bsg-long-btn"  class="bsg-btn bsg-bull">LONG</button>',
          '<button id="bsg-short-btn" class="bsg-btn bsg-bear">SHORT</button>',
          '<button id="bsg-wait-btn"  class="bsg-btn bsg-wait">&#128373; Wait</button>',
        '</div>',
        '<div id="bsg-result"></div>',
        '<div id="bsg-loan-row" style="display:none;">',
          '<p class="bsg-loan-msg">Bankroll below $25k!</p>',
          '<button id="bsg-loan-btn" class="bsg-btn bsg-neutral">Take a $100k Loan</button>',
        '</div>',
        '<div id="bsg-progress-wrap">',
          '<div id="bsg-progress-track"><div id="bsg-progress-fill"></div></div>',
          '<span id="bsg-progress-label"></span>',
        '</div>',
      '</div>'
    ].join('');
    document.body.appendChild(panel);

    document.getElementById('bsg-close-btn').addEventListener('click', function() { stopGame(); panel.remove(); });
    document.getElementById('bsg-min-btn').addEventListener('click', function() {
      var body = document.getElementById('bsg-body');
      var btn  = document.getElementById('bsg-min-btn');
      if (body.style.display === 'none') { body.style.display = ''; btn.innerHTML = '&#8722;'; }
      else { body.style.display = 'none'; btn.textContent = '+'; }
    });
    document.getElementById('bsg-new-btn').addEventListener('click', startNewGame);
    document.getElementById('bsg-stop-btn').addEventListener('click', stopGame);
    document.getElementById('bsg-long-btn').addEventListener('click', function() { makeGuess('long'); });
    document.getElementById('bsg-short-btn').addEventListener('click', function() { makeGuess('short'); });
    document.getElementById('bsg-wait-btn').addEventListener('click', waitAndSee);
    document.getElementById('bsg-loan-btn').addEventListener('click', getLoan);

    document.querySelectorAll('.bsg-bet').forEach(function(btn) {
      btn.addEventListener('click', function() {
        document.querySelectorAll('.bsg-bet').forEach(function(b) { b.classList.remove('active'); });
        btn.classList.add('active');
        rt.bet = parseInt(btn.getAttribute('data-amt'), 10);
        document.getElementById('bsg-bet-custom').value = '';
        var sess = loadSession();
        if (sess) { sess.bet = rt.bet; saveSession(sess); }
      });
    });

    document.getElementById('bsg-bet-custom').addEventListener('change', function() {
      var val = parseInt(this.value, 10);
      if (!val || val < 1) { this.value = ''; return; }
      rt.bet = val;
      document.querySelectorAll('.bsg-bet').forEach(function(b) { b.classList.remove('active'); });
      var sess = loadSession();
      if (sess) { sess.bet = rt.bet; saveSession(sess); }
    });

    document.getElementById('bsg-bet-custom').addEventListener('keydown', function(e) {
      if (e.key === 'Enter') this.blur();
    });

    makeDraggable(panel, document.getElementById('bsg-header'));
    updateUI();
  }

  /* ---- UI helpers -------------------------------------------------- */
  function fmt(n) {
    return '$' + Math.abs(n).toLocaleString('en-US', { maximumFractionDigits: 0 });
  }

  function showIdleButtons() {
    var nb = document.getElementById('bsg-new-btn');
    var sb = document.getElementById('bsg-stop-btn');
    var gr = document.getElementById('bsg-guess-row');
    if (nb) nb.style.display = 'inline-block';
    if (sb) sb.style.display = 'none';
    if (gr) gr.style.display = 'none';
  }

  function showPlayingButtons() {
    var nb = document.getElementById('bsg-new-btn');
    var sb = document.getElementById('bsg-stop-btn');
    var gr = document.getElementById('bsg-guess-row');
    if (nb) nb.style.display = 'none';
    if (sb) sb.style.display = 'inline-block';
    if (gr) gr.style.display = 'flex';
    setGuessButtonsDisabled(false);
  }

  function updateUI() {
    var brEl = document.getElementById('bsg-bankroll');
    if (brEl) {
      brEl.textContent = fmt(persist.bankroll);
      brEl.className   =
        persist.bankroll >= START_BANKROLL ? 'bsg-neutral-val' :
        persist.bankroll < 50000           ? 'bsg-down'        : 'bsg-mid';
    }
    var wrEl = document.getElementById('bsg-winrate');
    if (wrEl) {
      var t = persist.trades, w = persist.wins;
      wrEl.textContent = t > 0
        ? (w + 'W / ' + (t - w) + 'L  (' + Math.round((w / t) * 100) + '%)')
        : 'No trades yet';
    }
    var lcEl = document.getElementById('bsg-loan-count');
    if (lcEl) lcEl.textContent = persist.loans > 0 ? ('Loans: ' + persist.loans) : '';
    var lrEl = document.getElementById('bsg-loan-row');
    if (lrEl) {
      lrEl.style.display = (rt.allData.length > 0 && persist.bankroll < LOAN_THRESHOLD) ? 'block' : 'none';
    }
  }

  function updateCandleInfo() {
    var el = document.getElementById('bsg-candle-info');
    if (!el || !rt.allData.length) return;
    var c   = rt.allData[rt.revealedCount - 1];
    var col = c[4] >= c[1] ? '#22c55e' : '#f87171';
    var dir = c[4] >= c[1] ? '\u25b2' : '\u25bc';
    var rem = rt.allData.length - rt.revealedCount;
    el.innerHTML =
      '<span class="bsg-lbl">Last close</span> ' +
      '<strong style="color:' + col + '">' + dir + ' $' + c[4].toFixed(2) + '</strong>' +
      '<span class="bsg-lbl" style="margin-left:6px">Open $' + c[1].toFixed(2) + '</span>' +
      '<span class="bsg-lbl" style="margin-left:6px">' + rem + ' hidden</span>';
  }

  function updateProgress() {
    if (!rt.allData.length) return;
    var pct = Math.min(100, Math.round((rt.revealedCount / rt.allData.length) * 100));
    var rem = rt.allData.length - rt.revealedCount;
    var fill  = document.getElementById('bsg-progress-fill');
    var label = document.getElementById('bsg-progress-label');
    if (fill)  fill.style.width  = pct + '%';
    if (label) label.textContent = rem + ' candle' + (rem !== 1 ? 's' : '') + ' hidden';
  }

  function showResult(correct, delta, candle, prevClose) {
    var el = document.getElementById('bsg-result');
    if (!el) return;
    var amt = fmt(Math.abs(delta));
    var col = candle[4] >= prevClose ? '#22c55e' : '#f87171';
    var dir = candle[4] >= prevClose ? '\u25b2' : '\u25bc';
    el.innerHTML = correct
      ? '<span class="bsg-win">\u2713 CORRECT! +' + amt + '</span><small>Closed <span style="color:' + col + '">' + dir + ' $' + candle[4].toFixed(2) + '</span></small>'
      : '<span class="bsg-loss">\u2717 WRONG  \u2212' + amt + '</span><small>Closed <span style="color:' + col + '">' + dir + ' $' + candle[4].toFixed(2) + '</span></small>';
    el.style.display = 'block';
  }

  function clearResult() {
    var el = document.getElementById('bsg-result');
    if (el) { el.innerHTML = ''; el.style.display = 'none'; }
  }

  function setMessage(msg, type) {
    var el = document.getElementById('bsg-result');
    if (!el) return;
    el.innerHTML = '<span class="' + (type === 'warn' ? 'bsg-loss' : 'bsg-info') + '">' + msg + '</span>';
    el.style.display = 'block';
  }

  function setGuessButtonsDisabled(disabled) {
    var l = document.getElementById('bsg-long-btn');
    var s = document.getElementById('bsg-short-btn');
    var w = document.getElementById('bsg-wait-btn');
    if (l) l.disabled = disabled;
    if (s) s.disabled = disabled;
    if (w) w.disabled = disabled;
  }

  /* ---- Draggable panel -------------------------------------------- */
  function makeDraggable(el, handle) {
    var ox, oy, sl, st;
    handle.style.cursor = 'grab';
    handle.addEventListener('mousedown', function(e) {
      e.preventDefault();
      var r = el.getBoundingClientRect();
      ox = e.clientX; oy = e.clientY; sl = r.left; st = r.top;
      handle.style.cursor = 'grabbing';
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });
    function onMove(e) {
      el.style.left   = (sl + e.clientX - ox) + 'px';
      el.style.top    = (st + e.clientY - oy) + 'px';
      el.style.right  = 'auto';
      el.style.bottom = 'auto';
    }
    function onUp() {
      handle.style.cursor = 'grab';
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    }
  }

  /* ---- External message listeners --------------------------------- */
  window.addEventListener('bsg:toggle', function() {
    var panel = document.getElementById('bsg-panel');
    if (panel) { stopGame(); panel.remove(); } else { createPanel(); }
  });

  window.addEventListener('bsg:requestStats', function() {
    window.dispatchEvent(new CustomEvent('bsg:stats', {
      detail: { bankroll: persist.bankroll, trades: persist.trades, wins: persist.wins, loans: persist.loans }
    }));
  });

  /* ---- Boot ------------------------------------------------------- */
  function init() {
    dbg('init: url=' + window.location.href);

    // Always scrub stale DOM elements from a previous run
    document.body.classList.remove('bsg-game-mode');
    ['bsg-overlay','bsg-chart-cover','bsg-debug-log'].forEach(function(id) {
      var el = document.getElementById(id); if (el) el.remove();
    });

    var session = loadSession();
    dbg('init: session=' + JSON.stringify(session));

    if (session && session.active) {
      // We navigated here via startNewGame.
      // Show overlay immediately; start watching for the chart right away
      // using the DOM-first approach (no fixed delay needed).
      createOverlay();
      setTimeout(function() {
        createPanel();
        showPlayingButtons();
        setMessage('Loading chart data...', 'info');
        initGame(session);
      }, 300);
    } else {
      setTimeout(createPanel, 2500);
    }
  }

  if (document.readyState === 'complete') { init(); }
  else { window.addEventListener('load', init); }
})();
