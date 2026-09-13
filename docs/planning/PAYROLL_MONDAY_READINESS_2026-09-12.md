# Payroll Monday readiness — 2026-09-12

## Priority

1. Practical payroll ledger
2. Security-vendor fingerprint attendance Excel import
3. Payroll ledger XLSX export
4. Income/local income tax automation later

## Completed before vendor workbook arrives

- Practical ledger UI exposes attendance, weekly holiday, base pay, weekly holiday pay, gross, four-insurance deduction preview, total deduction, net and review state.
- Browser-side payroll ledger `.xlsx` export exists without adding a spreadsheet server dependency.
- Export omits resident-registration, bank-account and other Sensitive HR values.
- Monthly salary rows are displayed as monthly salary, not hourly-rate review.
- Ledger validator checks employee-count mismatch, duplicate employee IDs/UUIDs and gross-deduction-net arithmetic before export.
- Local attendance `.xlsx` analyzer scans workbook sheets, detects common Korean identity/date/clock-in/clock-out headers and flags invalid/duplicate rows without writing to DB.
- Partial-month employment is withheld from automatic full-month statutory deduction input; gross calculation remains independent.
- Historical `as_paid` deduction fallback is display-only and is allowed only when historical gross matches current Shadow gross. Gross-basis mismatch fails closed to review-required.

## Staging aggregate verification

- 2026-08 payroll result rows: 23
- Historical gross compatible with current Shadow gross: 11
- Historical gross mismatch: 12
- Compatible rows failing gross-deduction=net arithmetic: 0
- 2026-09 full-month statutory-profile candidates after employment-relationship guard: 21

## Waiting only for Monday vendor workbook

The remaining vendor-specific step is to confirm the actual workbook structure and then connect the already prepared local analyzer to the existing accepted attendance-import pipeline. Do not make users rearrange columns manually if the vendor format can be recognized deterministically.

## Gates unchanged

No Production deployment, PR Ready transition, main merge, real payroll month lock/finalization, payment or Kakao send without explicit approval.
