// Only transport failures are retried. A different build must never be accepted.
export async function readExactPreviewAsset(url, expected, {
  request = fetch,
  wait = ms => new Promise(resolve => setTimeout(resolve, ms)),
  onRetry = () => {}
} = {}) {
  const address = new URL(url).origin + new URL(url).pathname;
  const attempts = 3;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    let response, bytes, reason;
    try {
      response = await request(url, { signal: AbortSignal.timeout(8000), cache: 'no-store' });
      if (response.status === 200) bytes = Buffer.from(await response.arrayBuffer());
    } catch (error) {
      // Log only the error class and public path, never headers/body/query data.
      reason = 'NETWORK_' + (error?.name || 'Error');
    }
    if (!reason && response.status !== 200) {
      reason = 'HTTP_' + response.status;
      const transient = [408, 429, 500, 502, 503, 504].includes(response.status);
      await response.body?.cancel();
      if (!transient) throw new Error(`PREVIEW_ASSET_${reason}:${address}`);
    }
    if (reason) {
      if (attempt === attempts) throw new Error(`PREVIEW_ASSET_RETRY_EXHAUSTED:${reason}:${address}`);
      onRetry(`PREVIEW_ASSET_RETRY:${attempt}/${attempts}:${reason}:${address}`);
      await wait(500);
      continue;
    }
    // Keep this outside the transport catch: byte mismatch is never retried.
    if (!bytes.equals(expected)) throw new Error('exact-head Preview bytes mismatch ' + address);
    return bytes;
  }
}
