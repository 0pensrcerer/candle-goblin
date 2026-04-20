// Inject game.js into the page context so it can access Highcharts
(function injectGameScript() {
  // Pass extension asset URLs to page context via data attributes
  // (game.js runs in page context and can't call chrome.runtime.getURL directly)
  document.documentElement.setAttribute(
    'data-bsg-goblin-url',
    chrome.runtime.getURL('icon_goblin.png')
  );

  var winImgs  = ['tendiessecured','onegreengenius','diamondhands','eatingthedip','positivetoxicrelationship'];
  var lossImgs = ['Guh','margincalled','boughtthetop','technicalastrology'];
  document.documentElement.setAttribute(
    'data-bsg-win-urls',
    winImgs.map(function(n){ return chrome.runtime.getURL('reactionimages/' + n + '.png'); }).join(',')
  );
  document.documentElement.setAttribute(
    'data-bsg-loss-urls',
    lossImgs.map(function(n){ return chrome.runtime.getURL('reactionimages/' + n + '.png'); }).join(',')
  );

  const script = document.createElement('script');
  script.src = chrome.runtime.getURL('game.js');
  script.setAttribute('data-bsg', '1');
  document.documentElement.appendChild(script);
  script.remove();
})();

// Listen for messages from the popup (toggle panel)
chrome.runtime.onMessage.addListener((message) => {
  if (message.action === 'toggleGame') {
    window.dispatchEvent(new CustomEvent('bsg:toggle'));
  }
  if (message.action === 'getStats') {
    // Re-dispatch so game.js can respond via another event
    window.dispatchEvent(new CustomEvent('bsg:requestStats'));
  }
});

// Relay stats from game.js back to popup
window.addEventListener('bsg:stats', (e) => {
  chrome.runtime.sendMessage({ action: 'stats', data: e.detail }).catch(() => {});
});
