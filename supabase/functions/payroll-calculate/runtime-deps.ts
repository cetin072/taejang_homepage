// Staging payroll runtime dependencies pinned to one reviewed PR #143 source commit.
// Immutable URLs prevent a branch update from silently changing deployed calculation rules.
const PAYROLL_RUNTIME_COMMIT = '17677e28bee262ed14ca0a0d9abc0fcbef54d15c';

await import(`https://raw.githubusercontent.com/cetin072/taejang_homepage/${PAYROLL_RUNTIME_COMMIT}/app/assets/payroll-term-validator.js`);
await import(`https://raw.githubusercontent.com/cetin072/taejang_homepage/${PAYROLL_RUNTIME_COMMIT}/app/assets/payroll-preflight.js`);
await import(`https://raw.githubusercontent.com/cetin072/taejang_homepage/${PAYROLL_RUNTIME_COMMIT}/app/assets/payroll-engine.js`);
await import(`https://raw.githubusercontent.com/cetin072/taejang_homepage/${PAYROLL_RUNTIME_COMMIT}/app/assets/payroll-db-input-adapter.js`);
await import(`https://raw.githubusercontent.com/cetin072/taejang_homepage/${PAYROLL_RUNTIME_COMMIT}/app/assets/payroll-statutory-deductions.js`);
await import(`https://raw.githubusercontent.com/cetin072/taejang_homepage/${PAYROLL_RUNTIME_COMMIT}/prototypes/payroll-backend/edge-runtime/payroll-calculate-core.js`);

type RuntimeGlobal = typeof globalThis & {
  TaejangPayrollTermValidator?: unknown;
  TaejangPayrollPreflight?: unknown;
  TaejangPayrollEngine?: unknown;
  TaejangPayrollDbInputAdapter?: unknown;
  TaejangPayrollStatutoryDeductions?: unknown;
  TaejangPayrollCalculateCore?: unknown;
};

export function getPayrollRuntimeModules() {
  const runtime = globalThis as RuntimeGlobal;
  if (!runtime.TaejangPayrollPreflight) throw new Error('PAYROLL_PREFLIGHT_MODULE_MISSING');
  if (!runtime.TaejangPayrollEngine) throw new Error('PAYROLL_ENGINE_MODULE_MISSING');
  if (!runtime.TaejangPayrollDbInputAdapter) throw new Error('PAYROLL_DB_ADAPTER_MODULE_MISSING');
  if (!runtime.TaejangPayrollStatutoryDeductions) throw new Error('PAYROLL_STATUTORY_MODULE_MISSING');
  if (!runtime.TaejangPayrollCalculateCore) throw new Error('PAYROLL_CALCULATE_CORE_MODULE_MISSING');

  return {
    preflight: runtime.TaejangPayrollPreflight as Record<string, unknown>,
    engine: runtime.TaejangPayrollEngine as Record<string, unknown>,
    adapter: runtime.TaejangPayrollDbInputAdapter as Record<string, unknown>,
    statutory: runtime.TaejangPayrollStatutoryDeductions as Record<string, unknown>,
    core: runtime.TaejangPayrollCalculateCore as Record<string, unknown>,
  };
}
