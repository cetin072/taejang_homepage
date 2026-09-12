# Taejang Payroll — Monthly Salary Support Contract

Status: **LIMITED STAGING IMPLEMENTATION / FULL-MONTH FIXED SALARY ONLY**

Goal: #142

## Why this is required

Historical Taejang payroll material includes both hourly short-time workers and fixed-monthly executives. The hourly engine remains unchanged. A narrow monthly-salary branch now exists so a fixed full-month salary can appear in the same trusted calculation workflow without manufacturing attendance or reusing hourly arithmetic.

## Implemented automatic scope

A monthly-salary employee may be automatically shown as a complete monthly gross preview only when all of the following are true:

1. exactly one `monthly` employment/pay term covers the entire payroll month;
2. `monthly_salary` is present and greater than zero;
3. the employee relationship covers the entire payroll month;
4. there is no midmonth pay-type or monthly-salary change;
5. there is no attendance/correction evidence that could require a salary adjustment;
6. the record is otherwise free of conflicting payroll terms.

For this narrow complete case:

- gross preview = contractual `monthly_salary`;
- do not derive gross from clock-in/out duration;
- do not add hourly weekly-holiday hours on top of the fixed monthly salary automatically;
- `hourly_rate` remains null;
- calculation detail records `pay_type = monthly` and the contractual monthly salary;
- accounting/insurance/tax confirmed values remain separate downstream confirmation values.

This is a payroll-system contract for reproducing an approved fixed monthly amount, not a legal conclusion that every monthly salary always includes every possible allowance.

## Mandatory review-required cases

Do **not** invent automatic proration for:

- hire after the first calendar day of the payroll month;
- termination before the last calendar day of the payroll month;
- monthly-salary change within the month;
- hourly ↔ monthly pay-type change within the month;
- unpaid absence or attendance correction that may require salary deduction;
- any case where the approved historical/accounting rule for partial-month salary is not yet documented.

These cases must show `월급 계산 확인 필요` and withhold the employee gross preview until an approved rule/value is supplied.

## Attendance boundary

Current main excludes CEO/operations-manager roles from personal mobile attendance. Payroll must not manufacture attendance for those roles.

For monthly salary:

- mobile attendance absence must not silently convert into a salary deduction;
- vendor/fingerprint attendance must not be required merely to show a fixed monthly executive salary when that person is not an attendance subject;
- a monthly employee who *is* an attendance subject and has an absence-related salary adjustment remains review-required until the payroll rule is explicit.

## Data/output contract

The trusted result distinguishes:

- `pay_type = hourly | monthly` in calculation detail;
- hourly rate only when applicable;
- contractual monthly salary only when applicable;
- calculation status (`complete` vs `review_required`);
- review reason;
- gross preview (nullable).

Do not overload `hourly_rate` or work-hour totals to represent monthly salary.

## Validation requirement

Before Production use of monthly salary calculation:

1. use anonymized historical monthly-salary rows as Golden references;
2. confirm fixed full-month salary reproduction;
3. separately document and test any approved partial-month/proration rules if they are ever automated;
4. do not infer those rules from a single payroll amount.

## Approval boundaries unchanged

This limited Staging implementation does not authorize Production deployment, month lock, payment execution, retroactive payment, or real Kakao paystub sending.
