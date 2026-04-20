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
