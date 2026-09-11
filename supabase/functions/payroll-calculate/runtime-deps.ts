// Staging payroll runtime dependencies pinned to the reviewed PR #143 source commit.
// Immutable URLs prevent a branch update from silently changing deployed calculation rules.
await import('https://raw.githubusercontent.com/cetin072/taejang_homepage/04bccd6878db2fea65a5dea3cf7bebdd9b7adc4c/app/assets/payroll-term-validator.js');
await import('https://raw.githubusercontent.com/cetin072/taejang_homepage/04bccd6878db2fea65a5dea3cf7bebdd9b7adc4c/app/assets/payroll-preflight.js');
await import('https://raw.githubusercontent.com/cetin072/taejang_homepage/04bccd6878db2fea65a5dea3cf7bebdd9b7adc4c/app/assets/payroll-engine.js');
await import('https://raw.githubusercontent.com/cetin072/taejang_homepage/04bccd6878db2fea65a5dea3cf7bebdd9b7adc4c/app/assets/payroll-db-input-adapter.js');
await import('https://raw.githubusercontent.com/cetin072/taejang_homepage/04bccd6878db2fea65a5dea3cf7bebdd9b7adc4c/prototypes/payroll-backend/edge-runtime/payroll-calculate-core.js');

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
