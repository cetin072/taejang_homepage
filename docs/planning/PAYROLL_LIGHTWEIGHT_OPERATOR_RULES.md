# Payroll lightweight operator rules

Issue #182 / Goal #142 guardrail.

## Operator workflow

The first payroll MVP must stay small:

1. Attendance is entered or imported.
2. The operator selects a payroll month.
3. The monthly payroll ledger is displayed.
4. Only unresolved exceptions require review.

Do not add a separate statutory-profile maintenance screen, duplicate employee master, or recurring manual insurance input step for this MVP.

## Reuse existing evidence

Statutory inputs should be reconstructed from protected existing HR/payroll evidence when deterministic. Historical paid values, external confirmations, and corrected references remain separate records.

Zero historical deduction is not proof of non-enrollment. When eligibility or basis cannot be established, keep the field pending review instead of guessing.

## UI scope

The main employee table should stay compact. Show gross pay, deduction total, net pay, and a review status. Individual statutory components may remain backend/export detail unless an exception must be investigated.

## Safety

- Historical facts are never overwritten.
- Sensitive payroll/HR evidence stays outside GitHub fixtures, comments, and browser payloads.
- Unknown statutory conditions fail to review-required without blocking already-valid gross payroll calculation.
- Production, month lock, payment, Ready, and main merge remain separate approval gates.
