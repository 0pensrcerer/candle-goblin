/**
 * Candle Goblin — game.js
 * Game logic: guessing, scoring, navigation, session lifecycle.
 *
 * Load order (all injected by content.js as plain <script> tags):
 *   1. game-state.js  — constants, rt, persist, session, URL helpers, overlay
 *   2. game-chart.js  — Highcharts detection, cover div
 *   3. game-sounds.js — Web Audio sound effects
 *   4. game-ui.js     — panel HTML, UI helpers, draggable
 *   5. game.js        — this file
 */
'use strict';

/* ---- Wait & See -------------------------------------------------- */
function waitAndSee() {
  if (!rt.waitingForGuess) return;
  if (rt.revealedCount >= rt.allData.length) { endOfCandles(); return; }

  playSpooky();
  rt.waitingForGuess = false;
  setGuessButtonsDisabled(true);

  // Reveal the next candle without any bet or trade recorded
  rt.revealedCount++;
  updateCoverPosition(true);
  setCoverImage(randomReaction(null)); // null = neutral/spooky

  var candle    = rt.allData[rt.revealedCount - 1];
  var prevClose = rt.allData[rt.revealedCount - 2][4];
  var col = candle[4] >= prevClose ? '#22c55e' : '#f87171';
  var dir = candle[4] >= prevClose ? '\u25b2' : '\u25bc';
  var el = document.getElementById('bsg-result');
  if (el) {
    el.innerHTML = '<span class="bsg-info">\ud83d\udc7b Watching\u2026 <span style="color:' + col + '">' + dir + ' $' + candle[4].toFixed(2) + '</span></span>';
    el.style.display = 'block';
  }
  updateProgress();

  setTimeout(function() {
    if (rt.revealedCount >= rt.allData.length) { endOfCandles(); return; }
    clearResult();
    rt.waitingForGuess = true;
    setGuessButtonsDisabled(false);
    updateCandleInfo();
    setCoverImage(GOBLIN_URL);
  }, 1800);
}

/* ---- Game actions ----------------------------------------------- */
function startNewGame() {
  var dateStr = randomTradingDate(); // YYYYMMDD
  if (!dateStr) { setMessage('Could not pick a date. Try again.', 'warn'); return; }

  var parts  = getUrlParts();
  var url    = 'https://app.bigshort.com/' + parts.section + '/' + parts.symbol + '/' + dateStr;
  dbg('startNewGame: navigating to', url);

  if (rt.resumeWait) rt.resumeWait = null;
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
    rt.revealedCount = openIdx + 1;
    dbg('marketOpenIdx=' + openIdx + ' ts=' + new Date(rt.allData[openIdx][0]).toISOString().slice(11,16));

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
    clearSession();
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
  setCoverImage(randomReaction(correct));

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
    setCoverImage(GOBLIN_URL);
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

  document.body.classList.remove('bsg-game-mode');
  ['bsg-overlay','bsg-chart-cover','bsg-debug-log'].forEach(function(id) {
    var el = document.getElementById(id); if (el) el.remove();
  });

  var session = loadSession();
  dbg('init: session=' + JSON.stringify(session));

  if (session && session.active) {
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
