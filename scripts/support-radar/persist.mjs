import { collect } from './bizinfo.mjs';
import { randomUUID } from 'node:crypto';
// Authenticated existing RPC transport is injected; no hosted URL, service key or scheduler here.
export async function persistCollection(result, rpc, runId) {
  const failures = new Set(['not_connected','authentication_failed','http_error','network_error','invalid_response']);
  const success = ['success_new','success_no_new'].includes(result?.status);
  if (!success && !failures.has(result?.status)) throw new Error('INVALID_COLLECTION_RESULT');
  if (success && !Array.isArray(result.items)) throw new Error('COLLECTED_ITEMS_REQUIRED');
  return rpc('support_record_bizinfo_collection', { p_run_id: runId, p_status: success ? 'success' : result.status, p_items: success ? result.items : [] });
}

// Manual invocation only. The caller supplies its existing authenticated RPC transport.
export async function collectAndPersist({ rpc, runId = randomUUID(), ...options }) {
  const result = await collect(options);
  return { collection: result, saved: await persistCollection(result, rpc, runId) };
}
