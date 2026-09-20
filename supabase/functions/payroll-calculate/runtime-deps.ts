// Payroll runtime dependencies vendored from one reviewed immutable source commit.
// The source commit is provenance only; deployed code loads local bundled modules and
// never depends on GitHub/network availability at Edge Function startup.
export const PAYROLL_RUNTIME_SOURCE_COMMIT = '78f11ec235d3a4165f9558934305392d63a8aef6';

import './runtime/payroll-term-validator.js';
import './runtime/payroll-preflight.js';
import './runtime/payroll-engine.js';
import './runtime/payroll-weekly-holiday-policy.js';
import './runtime/payroll-db-input-adapter.js';
import './runtime/payroll-statutory-deductions.js';
import './runtime/payroll-calculate-core.js';

type RuntimeGlobal = typeof globalThis & {
  TaejangPayrollTermValidator?: unknown;
  TaejangPayrollPreflight?: unknown;
  TaejangPayrollEngine?: unknown;
  TaejangPayrollWeeklyHolidayPolicy?: unknown;
  TaejangPayrollDbInputAdapter?: unknown;
  TaejangPayrollStatutoryDeductions?: unknown;
  TaejangPayrollCalculateCore?: unknown;
};

export function getPayrollRuntimeModules() {
  const runtime = globalThis as RuntimeGlobal;
  if (!runtime.TaejangPayrollPreflight) throw new Error('PAYROLL_PREFLIGHT_MODULE_MISSING');
  if (!runtime.TaejangPayrollEngine) throw new Error('PAYROLL_ENGINE_MODULE_MISSING');
  if (!runtime.TaejangPayrollWeeklyHolidayPolicy) throw new Error('PAYROLL_WEEKLY_POLICY_MODULE_MISSING');
  if (!runtime.TaejangPayrollDbInputAdapter) throw new Error('PAYROLL_DB_ADAPTER_MODULE_MISSING');
  if (!runtime.TaejangPayrollStatutoryDeductions) throw new Error('PAYROLL_STATUTORY_MODULE_MISSING');
  if (!runtime.TaejangPayrollCalculateCore) throw new Error('PAYROLL_CALCULATE_CORE_MODULE_MISSING');

  const policy = runtime.TaejangPayrollWeeklyHolidayPolicy as {
    wrapEngine: (engine: Record<string, unknown>) => Record<string, unknown>;
  };
  if (typeof policy.wrapEngine !== 'function') throw new Error('PAYROLL_WEEKLY_POLICY_WRAPPER_MISSING');

  return {
    preflight: runtime.TaejangPayrollPreflight as Record<string, unknown>,
    engine: policy.wrapEngine(runtime.TaejangPayrollEngine as Record<string, unknown>),
    adapter: runtime.TaejangPayrollDbInputAdapter as Record<string, unknown>,
    statutory: runtime.TaejangPayrollStatutoryDeductions as Record<string, unknown>,
    core: runtime.TaejangPayrollCalculateCore as Record<string, unknown>,
  };
}
