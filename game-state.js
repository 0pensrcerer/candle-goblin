/**
 * Candle Goblin — game-state.js
 * Shared globals: constants, persistent bankroll, session helpers,
 * runtime object, URL utilities, overlay, and asset-URL helpers.
 *
 * Loaded FIRST. Every symbol declared here is a top-level global
 * available to all subsequent modules (game-chart, game-sounds,
 * game-ui, game).  No IIFE — intentional, so later scripts can
 * read and mutate rt / persist directly.
 */
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
  while (log.children.length > 40) log.removeChild(log.firstChild);
  log.scrollTop = log.scrollHeight;
}

/* ---- Asset URLs (passed from extension context via data attributes) */
var GOBLIN_URL = document.documentElement.getAttribute('data-bsg-goblin-url') || '';
var WIN_URLS   = (document.documentElement.getAttribute('data-bsg-win-urls')  || '').split(',').filter(Boolean);
var LOSS_URLS  = (document.documentElement.getAttribute('data-bsg-loss-urls') || '').split(',').filter(Boolean);

function randomReaction(correct) {
  // null = Wait & See — pick from the full pool
  if (correct === null) {
    var all = WIN_URLS.concat(LOSS_URLS);
    return all.length ? all[Math.floor(Math.random() * all.length)] : GOBLIN_URL;
  }
  var pool = correct ? WIN_URLS : LOSS_URLS;
  if (!pool.length) return GOBLIN_URL;
  return pool[Math.floor(Math.random() * pool.length)];
}

function setCoverImage(url) {
  var cover = document.getElementById('bsg-chart-cover');
  if (cover) cover.style.backgroundImage = url ? 'url(' + url + ')' : 'none';
}

/* ---- Constants --------------------------------------------------- */
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

/* ---- Runtime (in-memory per page load) -------------------------- */
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

/* ---- URL helpers ------------------------------------------------- */
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

/* ---- Misc formatting helper ------------------------------------- */
function fmt(n) {
  return '$' + Math.abs(n).toLocaleString('en-US', { maximumFractionDigits: 0 });
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
