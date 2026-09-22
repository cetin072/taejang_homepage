(() => {
  'use strict';

  // The authenticated app shell publishes this once after Auth and the access
  // context are settled. Business branches may arrive later, so their initial
  // handler is replayed individually instead of holding the shell behind a
  // whole-app module barrier.
  let readyDetail = null;
  let ready = false;
  const branchHandlers = new Set();
  const nativeAddEventListener = document.addEventListener.bind(document);

  function deliver(handler, detail) {
    Promise.resolve().then(() => handler(new CustomEvent('taejang-app-ready', { detail })));
  }

  function releaseBranchHandlers(detail) {
    const handlers = [...branchHandlers];
    branchHandlers.clear();
    handlers.forEach(handler => deliver(handler, detail));
  }

  // Only dynamically registered business modules opt into this lifecycle.
  // All other document events retain their native behavior.
  document.addEventListener = (type, handler, options) => {
    if (type === 'taejang-app-ready' && document.currentScript?.dataset?.branchModule === '1') {
      if (ready) deliver(handler, readyDetail);
      else branchHandlers.add(handler);
      return;
    }
    nativeAddEventListener(type, handler, options);
  };

  nativeAddEventListener('taejang-app-ready', event => {
    if (ready) return;
    ready = true;
    readyDetail = event.detail || {};
    releaseBranchHandlers(readyDetail);
  }, true);

  window.TaejangAppLifecycle = {
    isReady: () => ready,
    getReadyDetail: () => readyDetail
  };
})();
