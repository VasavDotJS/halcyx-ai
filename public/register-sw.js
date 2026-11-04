/*
 * Registers the service worker next to this script, so the app works at the domain root or
 * under a sub-path. If the host didn't send cross-origin isolation headers, the worker adds
 * them, and the page reloads once it is in control.
 */
(function () {
  if (!('serviceWorker' in navigator) || !document.currentScript) return;
  const src = document.currentScript.src;
  const key = 'halcyx-coi-reload';
  if (window.crossOriginIsolated) {
    try {
      sessionStorage.removeItem(key);
    } catch {}
  }
  navigator.serviceWorker
    .register(new URL('sw.js', src).href, { scope: new URL('./', src).pathname })
    .then(function () {
      if (window.crossOriginIsolated) return;
      try {
        if (sessionStorage.getItem(key)) return;
        sessionStorage.setItem(key, '1');
      } catch {
        return;
      }
      if (navigator.serviceWorker.controller) location.reload();
      else
        navigator.serviceWorker.addEventListener('controllerchange', function () {
          location.reload();
        });
    })
    .catch(function () {});
})();
