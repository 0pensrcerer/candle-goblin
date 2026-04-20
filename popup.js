const fmt = (n) =>
  '$' + Math.abs(n).toLocaleString('en-US', { maximumFractionDigits: 0 });

function renderStats(data) {
  document.getElementById('bankroll').textContent = fmt(data.bankroll ?? 100000);
  document.getElementById('wins').textContent     = data.wins   ?? 0;
  document.getElementById('trades').textContent   = data.trades ?? 0;
  document.getElementById('loans').textContent    = data.loans  ?? 0;

  const t = data.trades ?? 0;
  const w = data.wins   ?? 0;
  document.getElementById('winpct').textContent =
    t > 0 ? Math.round((w / t) * 100) + '%' : '—';
}

async function getCurrentTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

// Ask the content script for stats
async function fetchStats() {
  const tab = await getCurrentTab();
  if (!tab || !tab.url || !tab.url.includes('app.bigshort.com')) {
    document.getElementById('status').textContent = 'Navigate to app.bigshort.com to play';
    return;
  }

  document.getElementById('status').textContent = '';

  // Read last-saved values from localStorage via scripting (reliable even without content script)
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => ({
        bankroll: parseFloat(localStorage.getItem('bsg_bankroll') ?? '100000'),
        loans:    parseInt(localStorage.getItem('bsg_loans')    ?? '0',  10),
        trades:   parseInt(localStorage.getItem('bsg_trades')   ?? '0',  10),
        wins:     parseInt(localStorage.getItem('bsg_wins')     ?? '0',  10),
      }),
    });
    if (results && results[0] && results[0].result) {
      renderStats(results[0].result);
    }
  } catch (_) {
    // scripting not available (shouldn't happen with the permission)
  }
}

// Toggle the game panel
document.getElementById('toggle-btn').addEventListener('click', async () => {
  const tab = await getCurrentTab();
  if (!tab) return;
  if (!tab.url || !tab.url.includes('app.bigshort.com')) {
    document.getElementById('status').textContent = 'Navigate to app.bigshort.com first';
    return;
  }
  chrome.tabs.sendMessage(tab.id, { action: 'toggleGame' }).catch(() => {
    // Content script not yet injected — programmatically inject then retry
    chrome.scripting.executeScript(
      { target: { tabId: tab.id }, files: ['content.js'] },
      () => chrome.tabs.sendMessage(tab.id, { action: 'toggleGame' }).catch(() => {})
    );
  });
  window.close();
});

// On popup open, load stats
fetchStats();

// Jaunty 5-second theme on popup open
(function playTheme() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const master = ctx.createGain();
    master.gain.setValueAtTime(0.18, ctx.currentTime);
    master.connect(ctx.destination);

    // Helper: schedule a note
    // type: oscillator type, freq: Hz, start: seconds, dur: seconds, vol: 0-1
    function note(type, freq, start, dur, vol) {
      const osc  = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, ctx.currentTime + start);
      gain.gain.setValueAtTime(0, ctx.currentTime + start);
      gain.gain.linearRampToValueAtTime(vol, ctx.currentTime + start + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + start + dur);
      osc.connect(gain);
      gain.connect(master);
      osc.start(ctx.currentTime + start);
      osc.stop(ctx.currentTime + start + dur + 0.05);
    }

    // Jaunty melody in C major — "market bell" feel
    // (beat = 0.18s at ~167bpm)
    const b = 0.18;
    const melody = [
      // bar 1 — ascending fanfare
      [523.25, 0*b, 1.0*b], // C5
      [659.25, 1*b, 0.5*b], // E5
      [783.99, 1.5*b, 0.5*b], // G5
      [1046.5, 2*b, 1.5*b], // C6
      [987.77, 3.5*b, 0.5*b], // B5
      // bar 2 — playful bounce
      [880.00, 4*b, 0.5*b], // A5
      [783.99, 4.5*b, 0.5*b], // G5
      [880.00, 5*b, 0.5*b], // A5
      [1046.5, 5.5*b, 1.0*b], // C6
      // bar 3 — descend & trill
      [987.77, 6.5*b, 0.4*b], // B5
      [880.00, 7*b, 0.4*b],   // A5
      [783.99, 7.5*b, 0.4*b], // G5
      [659.25, 8*b, 0.4*b],   // E5
      [523.25, 8.5*b, 0.4*b], // C5
      // bar 4 — resolution climb
      [659.25, 9*b, 0.5*b],   // E5
      [783.99, 9.5*b, 0.5*b], // G5
      [880.00, 10*b, 0.5*b],  // A5
      [1046.5, 10.5*b, 1.2*b],// C6 held
      // bar 5 — tag flourish
      [1174.66,12*b, 0.4*b],  // D6
      [1046.5, 12.4*b,0.4*b], // C6
      [987.77, 12.8*b,0.4*b], // B5
      [1046.5, 13.2*b,0.8*b], // C6
      [1318.5, 14*b, 1.2*b],  // E6 — big finish
      // final decay
      [1046.5, 15.4*b,0.5*b], // C6 echo
      [783.99, 16*b,  0.5*b], // G5 echo
      [523.25, 16.6*b,0.8*b], // C5 end
    ];

    melody.forEach(function([freq, start, dur]) {
      note('triangle', freq, start, dur * 0.85, 1.0);
    });

    // Simple oom-pah bass — longer sustain
    const bass = [
      [130.81, 0*b,  3.0*b], // C2
      [164.81, 2*b,  3.0*b], // E2
      [130.81, 4*b,  3.0*b], // C2
      [146.83, 6*b,  3.0*b], // D2
      [130.81, 8*b,  3.0*b], // C2
      [164.81, 10*b, 3.0*b], // E2
      [196.00, 12*b, 3.0*b], // G2
      [130.81, 14*b, 5.0*b], // C2 hold to end
    ];
    bass.forEach(function([freq, start, dur]) {
      note('sine', freq, start, dur * 0.7, 0.6);
    });

    // Fade master out at ~5s
    master.gain.setValueAtTime(0.18, ctx.currentTime + 4.0);
    master.gain.linearRampToValueAtTime(0.0, ctx.currentTime + 5.2);
  } catch(e) {}
})();
