// DESIGN CANDIDATE ONLY / NOT DEPLOYED.
// Reuse the existing tested UMD payroll modules instead of copying payroll rules.
// These imports intentionally execute in order because payroll-preflight depends on
// TaejangPayrollTermValidator already being present on globalThis.

await import('../../../../../app/assets/payroll-term-validator.js');
await import('../../../../../app/assets/payroll-preflight.js');
await import('../../../../../app/assets/payroll-engine.js');
await import('../../../../../app/assets/payroll-db-input-adapter.js');
await import('../payroll-calculate-core.js');

type RuntimeGlobal = typeof globalThis & {
  TaejangPayrollTermValidator?: unknown;
  TaejangPayrollPreflight?: unknown;
  TaejangPayrollEngine?: unknown;
  TaejangPayrollDbInputAdapter?: unknown;
  TaejangPayrollCalculateCore?: unknown;
};

export function getPayrollRuntimeModules() {
  const runtime = globalThis as RuntimeGlobal;
  if (!runtime.TaejangPayrollPreflight) throw new Error('PAYROLL_PREFLIGHT_MODULE_MISSING');
  if (!runtime.TaejangPayrollEngine) throw new Error('PAYROLL_ENGINE_MODULE_MISSING');
  if (!runtime.TaejangPayrollDbInputAdapter) throw new Error('PAYROLL_DB_ADAPTER_MODULE_MISSING');
  if (!runtime.TaejangPayrollCalculateCore) throw new Error('PAYROLL_CALCULATE_CORE_MODULE_MISSING');

  return {
    preflight: runtime.TaejangPayrollPreflight as Record<string, unknown>,
    engine: runtime.TaejangPayrollEngine as Record<string, unknown>,
    adapter: runtime.TaejangPayrollDbInputAdapter as Record<string, unknown>,
    core: runtime.TaejangPayrollCalculateCore as Record<string, unknown>,
  };
}
