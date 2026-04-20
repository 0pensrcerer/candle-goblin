/**
 * Candle Goblin — game-ui.js
 * Panel HTML, UI update helpers, draggable, and external message
 * listeners.  Called by game.js after all other modules are loaded.
 *
 * Depends on: game-state.js (rt, persist, fmt, START_BANKROLL,
 *             LOAN_THRESHOLD, loadSession, saveSession)
 *             game.js (startNewGame, stopGame, makeGuess, waitAndSee,
 *             getLoan) — forward refs, safe because only called
 *             from event handlers at runtime.
 */
'use strict';

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

/* ---- UI state helpers ------------------------------------------- */
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
  updateCoverCandle(c);
}

function updateProgress() {
  if (!rt.allData.length) return;
  var pct   = Math.min(100, Math.round((rt.revealedCount / rt.allData.length) * 100));
  var rem   = rt.allData.length - rt.revealedCount;
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
