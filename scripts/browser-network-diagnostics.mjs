// Record public asset metadata only: no headers, bodies, query strings or credentials.
export function recordBrowserDiagnostics(page, entries = []) {
  const address = raw => {
    const url = new URL(raw);
    return url.origin + url.pathname;
  };
  const relevant = request => ['document', 'script', 'stylesheet'].includes(request.resourceType());
  page.on('request', request => {
    if (relevant(request)) entries.push('REQUEST ' + request.resourceType() + ' ' + address(request.url()));
  });
  page.on('response', response => {
    if (relevant(response.request())) entries.push('RESPONSE ' + response.status() + ' ' + address(response.url()));
  });
  page.on('requestfailed', request => {
    if (relevant(request)) entries.push('REQUESTFAILED ' + address(request.url()) + ' ' + request.failure()?.errorText);
  });
  page.on('pageerror', error => entries.push('PAGEERROR ' + error.message));
  return entries;
}
