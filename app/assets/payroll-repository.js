(function initPayrollRepository(root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
  if (root) {
    root.TaejangPayrollRepository = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function payrollRepositoryFactory() {
  'use strict';

  function clone(value) {
    if (value === undefined) return undefined;
    return JSON.parse(JSON.stringify(value));
  }

  function normalizeMonth(month) {
    const value = String(month || '').trim();
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(value)) {
      throw new Error(`Invalid payroll month: ${month}`);
    }
    return value;
  }

  function createMemoryPayrollRepository(initial = {}) {
    const computations = new Map();
    const monthStates = new Map();
    const adjustments = new Map();
    const accounting = new Map();

    Object.entries(initial.computations || {}).forEach(([month, runs]) => {
      computations.set(normalizeMonth(month), clone(runs || []));
    });
    Object.entries(initial.monthStates || {}).forEach(([month, state]) => {
      monthStates.set(normalizeMonth(month), clone(state));
    });
    Object.entries(initial.adjustments || {}).forEach(([month, rows]) => {
      adjustments.set(normalizeMonth(month), clone(rows || []));
    });
    Object.entries(initial.accounting || {}).forEach(([month, value]) => {
      accounting.set(normalizeMonth(month), clone(value));
    });

    return Object.freeze({
      async saveComputation(run) {
        const month = normalizeMonth(run.month);
        const current = computations.get(month) || [];
        const next = current.concat([clone(run)]);
        computations.set(month, next);
        return clone(run);
      },

      async getLatestComputation(monthValue) {
        const month = normalizeMonth(monthValue);
        const runs = computations.get(month) || [];
        return runs.length ? clone(runs[runs.length - 1]) : null;
      },

      async listComputations(monthValue) {
        const month = normalizeMonth(monthValue);
        return clone(computations.get(month) || []);
      },

      async saveMonthState(state) {
        const month = normalizeMonth(state.month);
        monthStates.set(month, clone(state));
        return clone(state);
      },

      async getMonthState(monthValue) {
        const month = normalizeMonth(monthValue);
        return clone(monthStates.get(month) || null);
      },

      async replaceAdjustments(monthValue, rows) {
        const month = normalizeMonth(monthValue);
        adjustments.set(month, clone(rows || []));
        return clone(rows || []);
      },

      async listAdjustments(monthValue) {
        const month = normalizeMonth(monthValue);
        return clone(adjustments.get(month) || []);
      },

      async listAdjustmentsTargeting(monthValue) {
        const targetMonth = normalizeMonth(monthValue);
        const rows = [];
        for (const sourceRows of adjustments.values()) {
          for (const row of sourceRows || []) {
            if (row && row.targetMonth === targetMonth) rows.push(clone(row));
          }
        }
        return rows;
      },

      async saveAccountingComparison(value) {
        const month = normalizeMonth(value.month);
        accounting.set(month, clone(value));
        return clone(value);
      },

      async getAccountingComparison(monthValue) {
        const month = normalizeMonth(monthValue);
        return clone(accounting.get(month) || null);
      },

      async exportDebugState() {
        const mapToObject = (map) => Object.fromEntries(
          [...map.entries()].map(([key, value]) => [key, clone(value)])
        );
        return {
          computations: mapToObject(computations),
          monthStates: mapToObject(monthStates),
          adjustments: mapToObject(adjustments),
          accounting: mapToObject(accounting),
        };
      },
    });
  }

  function assertPayrollRepository(repository) {
    const required = [
      'saveComputation',
      'getLatestComputation',
      'saveMonthState',
      'getMonthState',
      'replaceAdjustments',
      'listAdjustments',
      'listAdjustmentsTargeting',
      'saveAccountingComparison',
      'getAccountingComparison',
    ];
    const missing = required.filter((name) => !repository || typeof repository[name] !== 'function');
    if (missing.length) {
      throw new Error(`Payroll repository contract missing: ${missing.join(', ')}`);
    }
    return repository;
  }

  return Object.freeze({
    clone,
    normalizeMonth,
    createMemoryPayrollRepository,
    assertPayrollRepository,
  });
});
