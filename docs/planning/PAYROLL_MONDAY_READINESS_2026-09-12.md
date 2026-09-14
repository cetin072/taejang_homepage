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

## 2026-09-14 operations-manager pilot approval

The user explicitly approved promoting the current operations-manager payroll pilot into `main` after final automated QA so that the authenticated operations-manager can see and open `근태·급여관리` from the normal staff platform and collect hands-on feedback.

This approval is limited to the pilot surface already implemented and verified: authenticated operations-manager navigation/dashboard entry, Staging-backed attendance editing, provisional payroll calculation, read-only payroll ledger review and safe XLSX export. It does **not** authorize real payroll finalization, month lock, payment execution, retroactive payment, Kakao delivery, Sensitive HR permission expansion, or lower-role payroll access.

## Gates unchanged except approved pilot promotion

Production frontend visibility and the required `main` merge for the operations-manager pilot are approved after the final QA gate. Real payroll month lock/finalization, payment, retroactive payment, Kakao send, Sensitive HR permission expansion, or lower-role payroll access still require separate explicit approval.
