/**
 * Candle Goblin — game-chart.js
 * Highcharts detection (DOM-first / Wicky approach), OHLC extraction,
 * market-open helper, and the black cover div that hides future candles.
 *
 * Depends on: game-state.js (dbg, rt, GOBLIN_URL,
 *             removeOverlay, setMessage, showIdleButtons)
 *
 * NOTE: setMessage / showIdleButtons are defined in game-ui.js which
 * loads after this file, but they are only ever called inside
 * setTimeout/MutationObserver callbacks — by that time all scripts
 * are fully loaded, so forward references are safe.
 */
'use strict';

/* ---- Chart detection — Wicky-style DOM-first approach ----------- */
//
// BigShort bundles Highcharts as a private module so window.Highcharts is
// never set.  Instead we watch for the DOM elements Highcharts writes when
// it finishes rendering — specifically the individual candlestick <path>
// elements (.highcharts-candlestick-series .highcharts-point).
//
// Highcharts stores a reference on every SVG point element:
//   svgEl.point              → Highcharts Point
//   svgEl.point.series       → Series
//   svgEl.point.series.chart → Chart  ← this is what we need
//
// This bypasses window.Highcharts entirely and fires only once the chart
// is actually painted — exactly like Wicky watches for span.higlight-number.

function findReadyChart(verbose) {
  var seriesEls = document.querySelectorAll(
    '.highcharts-candlestick-series, .highcharts-ohlc-series'
  );
  if (verbose) dbg('findReadyChart: candlestick series els=' + seriesEls.length);

  for (var si = 0; si < seriesEls.length; si++) {
    var pts = seriesEls[si].querySelectorAll('.highcharts-point');
    if (verbose) dbg('  series[' + si + '] .highcharts-point count=' + pts.length);
    if (!pts.length) continue;

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

  var resolved  = false;
  var debounceId;
  var timeoutId;
  var pollId;
  var pollCount = 0;
  var paused    = false;

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

  var observer = new MutationObserver(function() {
    clearTimeout(debounceId);
    debounceId = setTimeout(function() { check('MutationObserver'); }, 120);
  });
  dbg('waitForChart: observing body for .highcharts-candlestick-series');
  observer.observe(document.body, { childList: true, subtree: true });

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

  rt.cancelWait = hardStop;
  rt.pauseWait  = function() { paused = true;  dbg('waitForChart: paused'); };
  rt.resumeWait = function() { paused = false; dbg('waitForChart: resumed'); check('resume'); };
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

/* ---- Market open helper ----------------------------------------- */
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
  for (var j = 0; j < allData.length; j++) {
    var d2 = new Date(allData[j][0]);
    var m2 = d2.getUTCHours() * 60 + d2.getUTCMinutes();
    if (m2 >= OPEN_EDT) return j;
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
  if (GOBLIN_URL) {
    cover.style.backgroundImage = 'url(' + GOBLIN_URL + ')';
  }
  container.appendChild(cover);
  updateCoverPosition(false);

  if (_resizeObserver) _resizeObserver.disconnect();
  var resizeDebounce;
  _resizeObserver = new ResizeObserver(function() {
    clearTimeout(resizeDebounce);
    resizeDebounce = setTimeout(function() { updateCoverPosition(false); }, 80);
  });
  _resizeObserver.observe(container);
}

function updateCoverPosition(animate) {
  var cover = document.getElementById('bsg-chart-cover');
  if (!cover || !rt.chart || !rt.allData.length) return;

  var revealIdx = Math.min(rt.revealedCount, rt.allData.length) - 1;
  var chartH    = rt.chart.chartHeight;

  // Read position directly from the rendered SVG candle element.
  // Pixel-perfect regardless of zoom, pan, or resize — no axis math.
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
  var xAxis    = rt.chart.xAxis[0];
  var fraction = (rt.allData[revealIdx][0] + rt.candleInterval * 0.7 - xAxis.min) / (xAxis.max - xAxis.min);
  var leftPx2  = rt.chart.plotLeft + fraction * rt.chart.plotWidth;
  leftPx2      = Math.max(rt.chart.plotLeft, Math.min(leftPx2, rt.chart.plotLeft + rt.chart.plotWidth));
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
