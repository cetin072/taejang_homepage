(() => {
  'use strict';

  let accessContext = null;
  let capabilitySet = new Set();
  let refreshPromise = null;

  const array = value => Array.isArray(value) ? value : [];
  const roleCodes = value => array(value).map(role => typeof role === 'string' ? role : role?.code).filter(Boolean);

  function installApi(context, version = 1) {
    const app = window.TaejangApp;
    if (!app) return;
    accessContext = context || app.getContext?.() || null;
    capabilitySet = new Set(array(accessContext?.capabilities));

    app.getAccessContext = () => accessContext;
    app.getActualRoles = () => roleCodes(accessContext?.actual_roles || accessContext?.roles);
    app.getEffectiveRoles = () => roleCodes(accessContext?.effective_roles || accessContext?.roles);
    app.getCapabilities = () => [...capabilitySet];
    app.hasCapabilityContract = () => Number(accessContext?.access_contract_version || version) >= 2;
    app.can = capability => app.hasCapabilityContract() && capabilitySet.has(capability);
  }

  function isMissingV2(error) {
    const message = String(error?.message || '');
    return error?.status === 404
      || /get_my_access_context_v2|PGRST202|function.*does not exist/i.test(message);
  }

  async function refresh() {
    if (refreshPromise) return refreshPromise;
    refreshPromise = (async () => {
      const app = window.TaejangApp;
      if (!app?.rpc) return null;

      // Install a safe legacy contract immediately. Migrated feature modules must
      // use their old role/route guard while hasCapabilityContract() is false.
      installApi(app.getContext?.(), 1);

      try {
        const context = await app.rpc('get_my_access_context_v2');
        if (!context || Number(context.access_contract_version) < 2) throw new Error('INVALID_CAPABILITY_CONTEXT');
        installApi(context, 2);
        document.dispatchEvent(new CustomEvent('taejang-capabilities-ready', {
          detail: {
            version: 2,
            capabilities: [...capabilitySet],
            actualRoles: app.getActualRoles(),
            effectiveRoles: app.getEffectiveRoles(),
          },
        }));
        return context;
      } catch (error) {
        if (!isMissingV2(error)) {
          console.warn('Capability context unavailable; keeping legacy route guards for this session.', error);
        }
        installApi(app.getContext?.(), 1);
        document.dispatchEvent(new CustomEvent('taejang-capabilities-ready', {
          detail: { version: 1, capabilities: [], fallback: true },
        }));
        return app.getContext?.() || null;
      } finally {
        refreshPromise = null;
      }
    })();
    return refreshPromise;
  }

  document.addEventListener('taejang-app-ready', () => { void refresh(); });

  window.TaejangCapabilityAccess = {
    refresh,
    getContext: () => accessContext,
    can: capability => capabilitySet.has(capability),
  };
})();
