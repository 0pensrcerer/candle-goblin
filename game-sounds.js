/**
 * Candle Goblin — game-sounds.js
 * All Web Audio API sound effects. No external audio files.
 *
 * Depends on: game-state.js (nothing from state is needed at load time)
 *
 * Public API:
 *   playWin()    — random win fanfare
 *   playLoss()   — random loss sound
 *   playSpooky() — eerie wait-and-see tone
 *   playDirge()  — bankruptcy funeral march
 */
'use strict';

var _audioCtx = null;
function getAudioCtx() {
  if (!_audioCtx) _audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  return _audioCtx;
}

/* ---- Win sounds -------------------------------------------------- */

// Win 1: ascending major arpeggio (C5 E5 G5 C6)
function playWin1() {
  try {
    var ctx  = getAudioCtx();
    var now  = ctx.currentTime;
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

// Win 2: cheerful coin-collect blips (square wave, high register)
function playWin2() {
  try {
    var ctx = getAudioCtx();
    var now = ctx.currentTime;
    var freqs = [880, 1108.73, 1318.51, 1760];
    freqs.forEach(function(freq, i) {
      var osc  = ctx.createOscillator();
      var gain = ctx.createGain();
      osc.type = 'square';
      osc.frequency.setValueAtTime(freq, now + i * 0.06);
      osc.frequency.linearRampToValueAtTime(freq * 1.05, now + i * 0.06 + 0.04);
      gain.gain.setValueAtTime(0.15, now + i * 0.06);
      gain.gain.exponentialRampToValueAtTime(0.001, now + i * 0.06 + 0.12);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now + i * 0.06);
      osc.stop(now + i * 0.06 + 0.15);
    });
  } catch(e) {}
}

// Win 3: triumphant brass fanfare — two quick stabs then a held note
function playWin3() {
  try {
    var ctx = getAudioCtx();
    var now = ctx.currentTime;
    [[392.00, 0], [523.25, 0.15], [659.25, 0.30]].forEach(function(pair) {
      var freq = pair[0], t = pair[1];
      var osc  = ctx.createOscillator();
      var gain = ctx.createGain();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(freq, now + t);
      gain.gain.setValueAtTime(0, now + t);
      gain.gain.linearRampToValueAtTime(0.28, now + t + 0.02);
      gain.gain.setValueAtTime(0.28, now + t + (t === 0.30 ? 0.25 : 0.08));
      gain.gain.exponentialRampToValueAtTime(0.001, now + t + (t === 0.30 ? 0.55 : 0.14));
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now + t);
      osc.stop(now + t + 0.6);
    });
  } catch(e) {}
}

// Win 4: bubbly xylophone run (triangle wave, smooth scale)
function playWin4() {
  try {
    var ctx = getAudioCtx();
    var now = ctx.currentTime;
    var notes = [523.25, 587.33, 659.25, 698.46, 783.99, 880.00];
    notes.forEach(function(freq, i) {
      var osc  = ctx.createOscillator();
      var gain = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq, now + i * 0.055);
      gain.gain.setValueAtTime(0, now + i * 0.055);
      gain.gain.linearRampToValueAtTime(0.22, now + i * 0.055 + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.001, now + i * 0.055 + 0.18);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now + i * 0.055);
      osc.stop(now + i * 0.055 + 0.22);
    });
  } catch(e) {}
}

function playWin() {
  var fns = [playWin1, playWin2, playWin3, playWin4];
  fns[Math.floor(Math.random() * fns.length)]();
}

/* ---- Loss sounds ------------------------------------------------- */

// Loss 1: descending minor wah-wah (Bb4 G4 Eb4 Bb3)
function playLoss1() {
  try {
    var ctx  = getAudioCtx();
    var now  = ctx.currentTime;
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

// Loss 2: sad trombone glide down (A4 → A3)
function playLoss2() {
  try {
    var ctx = getAudioCtx();
    var now = ctx.currentTime;
    var osc  = ctx.createOscillator();
    var gain = ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(440, now);
    osc.frequency.linearRampToValueAtTime(220, now + 0.9);
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(0.3, now + 0.05);
    gain.gain.setValueAtTime(0.3, now + 0.6);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 1.0);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 1.05);
  } catch(e) {}
}

// Loss 3: three descending buzzy wrong-answer blurts
function playLoss3() {
  try {
    var ctx = getAudioCtx();
    var now = ctx.currentTime;
    [300, 240, 180].forEach(function(freq, i) {
      var osc  = ctx.createOscillator();
      var gain = ctx.createGain();
      osc.type = 'square';
      osc.frequency.setValueAtTime(freq, now + i * 0.22);
      osc.frequency.linearRampToValueAtTime(freq * 0.85, now + i * 0.22 + 0.18);
      gain.gain.setValueAtTime(0.2, now + i * 0.22);
      gain.gain.exponentialRampToValueAtTime(0.001, now + i * 0.22 + 0.2);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now + i * 0.22);
      osc.stop(now + i * 0.22 + 0.25);
    });
  } catch(e) {}
}

// Loss 4: descending chromatic spiral
function playLoss4() {
  try {
    var ctx = getAudioCtx();
    var now = ctx.currentTime;
    var freqs = [415.30, 369.99, 329.63, 293.66, 261.63, 233.08];
    freqs.forEach(function(freq, i) {
      var osc  = ctx.createOscillator();
      var gain = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq, now + i * 0.09);
      gain.gain.setValueAtTime(0.2, now + i * 0.09);
      gain.gain.exponentialRampToValueAtTime(0.001, now + i * 0.09 + 0.2);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now + i * 0.09);
      osc.stop(now + i * 0.09 + 0.22);
    });
  } catch(e) {}
}

function playLoss() {
  var fns = [playLoss1, playLoss2, playLoss3, playLoss4];
  fns[Math.floor(Math.random() * fns.length)]();
}

/* ---- Special sounds --------------------------------------------- */

// Eerie descending tritone wobble — played on Wait & See
function playSpooky() {
  try {
    var ctx = getAudioCtx();
    var now = ctx.currentTime;
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

// Slow descending minor funeral march — played on bankruptcy
function playDirge() {
  try {
    var ctx  = getAudioCtx();
    var now  = ctx.currentTime;
    var notes = [220.00, 196.00, 174.61, 164.81, 146.83];
    notes.forEach(function(freq, i) {
      var osc      = ctx.createOscillator();
      var tremOsc  = ctx.createOscillator();
      var tremGain = ctx.createGain();
      var gain     = ctx.createGain();
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
