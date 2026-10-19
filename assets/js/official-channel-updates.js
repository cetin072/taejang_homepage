(function () {
  'use strict';
  const hub = window.TAEJANG_CONTENT?.hub;
  if (!Array.isArray(hub)) return;

  // Static data generated from verified official public feeds. Not a runtime request.
  const items = /* OFFICIAL_ITEMS_START */
[]
  /* OFFICIAL_ITEMS_END */;
  const present = new Set(hub.map((item) => item.id));
  for (const item of items) {
    if (present.has(item.id)) continue;
    if (item.status !== 'published' || item.type !== 'external') continue;
    hub.push(item);
    present.add(item.id);
  }
}());
