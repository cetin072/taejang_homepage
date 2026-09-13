# Staging Golden reconciliation receipt — 2026-09-13

## Scope

This receipt records the user-approved **Staging-only** reconciliation of historical payroll data for PR #143.

Approval did **not** authorize Production deployment, PR Ready transition, main merge, a real payroll-month lock/finalization, payment, bank transfer, or employee messaging.

Sensitive fields were intentionally excluded. No resident-registration number, payroll bank account, disability information, health information, address, phone number, or welfare field is recorded here or in GitHub fixtures.

## Source basis

The uploaded finalized August payroll ledger and payroll bank-transfer ledger were used as the historical Golden basis.

- finalized payroll ledger SHA-256: `4881e175be3fd3b93735a58671aadd5dfed5aab17bf8f3a28ce61d6ea891f54a`
- finalized transfer ledger SHA-256: `5f2b0d0133edcf6d5e69b70b5e65fbe603c8897a1f3fc071be015c5e9929fa17`
- finalized August roster SHA-256: `4c0a26eb788ad9d617faead24d6203d671ccabe4e1a1a67dc8c76632539c0b27`

August payroll / transfer reconciliation was complete for 23 payroll employees and the transfer ledger matched the finalized net-pay total.

## Staging historical write

The pre-existing `as_paid / payroll_ledger_confirmed` history was **not overwritten or deleted**.

Instead, 23 additive rows were written as:

- `record_role = corrected_reference`
- `source_kind = historical_reconciliation`
- `revision_no = 1`
- every row links to its previous history through `supersedes_history_id`
- every row has its own source fingerprint

Verified corrected-reference aggregates:

| Check | Result |
| --- | ---: |
| rows | 23 |
| linked to prior history | 23 |
| distinct employee mappings | 23 |
| distinct row fingerprints | 23 |
| arithmetic errors (`gross - deduction != net`) | 0 |
| gross | 17,244,720 |
| total deduction | 1,432,060 |
| net | 15,812,660 |

## Read fallback safety

Two additive Staging migrations were introduced and applied:

1. `payroll_ledger_corrected_reference_fallback`
2. `payroll_corrected_reference_gross_guard`

Final behavior is fail-closed:

1. current calculated statutory values win;
2. if calculated values are unavailable, corrected Golden history is preferred over the older as-paid import;
3. historical deduction/net fallback is allowed only when historical gross equals current Shadow gross;
4. a gross mismatch remains `review_required` and does not mix bases.

Before the weekly-holiday policy correction, the current persisted August Shadow run had 11 matching gross rows and 12 gross mismatches, so only those 11 were eligible for historical fallback.

## Golden-backed weekly-holiday policy

A staged runtime adapter was added instead of rewriting the canonical payroll engine in place.

The policy is backed by the finalized July/August patterns and current Staging attendance/terms:

- a payroll month owns a weekly holiday only for a Monday-Friday workweek fully inside that month;
- the 15-hour threshold uses the current workweek's scheduled hours;
- the weekly-holiday candidate uses the current workweek schedule rather than a 28-day smoothed lookback;
- existing absence, relationship, unresolved, and cutoff rules remain fail-closed.

Synthetic anonymous regression cases cover constant schedules, effective-dated schedule changes, and a recent hire.

A read-only Staging projection against the current August attendance/terms and corrected Golden history produced:

| Check | Result |
| --- | ---: |
| employees evaluated | 23 |
| exact Golden gross matches | 23 |
| gross mismatches | 0 |
| projected gross | 17,244,720 |
| Golden gross | 17,244,720 |

No real August attendance row or payroll result was modified by this projection.

## Edge runtime promotion

The Staging `payroll-calculate` function was promoted to the reviewed policy runtime:

- function status: ACTIVE
- version: 5
- JWT verification: enabled
- calculation version: `payroll-engine-workweek-golden-v2`
- runtime dependency pin: `94cc0bcbc885eafed4c2ec27139917a08ecabbce`

The corresponding payroll regression was GREEN before the Staging function promotion.

## Persisted-run note

The existing August `latest_run` remains the prior persisted Shadow result until an authenticated payroll operator legitimately triggers recalculation through the guarded Edge Function. This receipt does not bypass user JWT authorization or directly write a replacement calculation run.

## July limitation

The July finalized payroll source contains two identities that are not currently mapped to shared `public.employees` records in Staging. No shared employee record was created and July was not partially represented as a complete reconciliation.

Resolving those historical identities remains a separate shared-identity approval/data-quality task.

## Safety conclusion

- Staging-only historical reference: complete for August.
- Corrected Golden rows: additive and auditable.
- Gross-basis fallback guard: preserved.
- Golden-backed workweek policy: projected 23/23 exact August gross matches.
- Staging Edge Function: promoted with JWT verification enabled.
- Production: untouched.
- Real payroll lock/finalization/payment: not executed.
