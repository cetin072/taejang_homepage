-- Schema-only fixture, no operational rows. Only exercised columns/constraints are modeled.
create schema private;
create type public.account_status as enum ('pending','active','inactive','suspended','departed','deleted');
alter table public.profiles alter column account_status type public.account_status using account_status::public.account_status;
create table private.employee_sensitive_identity (
employee_uuid uuid,
resident_secret_id uuid,
birth_date date,
national_pension_under18_opt_out_confirmed boolean,
national_pension_over60_exception text,
employment_insurance_over65_status text,
updated_by uuid,
created_at timestamp with time zone,
updated_at timestamp with time zone
);
create table public.account_person_links (
id uuid,
profile_id uuid,
person_id uuid,
linked_by uuid,
linked_at timestamp with time zone,
revoked_by uuid,
revoked_at timestamp with time zone,
reason text
);
create table public.account_status_history (
id bigint,
profile_id uuid,
previous_status account_status,
new_status account_status,
reason text,
changed_by uuid,
created_at timestamp with time zone
);
create table public.attendance_events (
id uuid,
profile_id uuid,
work_date date,
event_type text,
status text,
event_at timestamp with time zone,
requested_at timestamp with time zone,
latitude double precision,
longitude double precision,
accuracy_m double precision,
distance_m double precision,
location_id uuid,
failure_code text,
reviewed_by uuid,
reviewed_at timestamp with time zone,
created_at timestamp with time zone,
updated_at timestamp with time zone
);
create table public.audit_logs (
id bigint,
actor_profile_id uuid,
action text,
target_type text,
target_id text,
outcome text,
reason_summary text,
metadata jsonb,
correlation_id uuid,
created_at timestamp with time zone
);
create table public.departments (
id uuid,
code text,
name text,
active boolean,
sort_order integer,
created_at timestamp with time zone,
updated_at timestamp with time zone
);
create table public.employee_change_requests (
id uuid,
employee_uuid uuid,
request_type text,
requested_changes jsonb,
requested_by uuid,
requested_at timestamp with time zone,
status text,
decided_by uuid,
decided_at timestamp with time zone,
decision_comment text
);
create table public.employee_field_audits (
employee_uuid uuid,
identity_verified boolean,
app_install_status text,
note text,
checked_by uuid,
checked_at timestamp with time zone,
updated_at timestamp with time zone
);
create table public.employee_photos (
id uuid,
employee_uuid uuid,
photo_type text,
storage_path text,
is_current boolean,
uploaded_by uuid,
created_at timestamp with time zone
);
create table public.employee_reset_attempts (
id uuid,
actor_id uuid,
employee_uuid uuid,
profile_id uuid,
employee_number text,
reason text,
mode text,
state text,
code text,
created_at timestamp with time zone,
finished_at timestamp with time zone
);
create table public.employee_reset_exceptions (
slot smallint,
employee_uuid uuid,
profile_id uuid,
expires_at timestamp with time zone,
consumed_at timestamp with time zone
);
create table public.employee_self_service_contact_requests (
id uuid,
profile_id uuid,
proposed_phone text,
requested_at timestamp with time zone,
status text,
decided_by uuid,
decided_at timestamp with time zone,
decision_comment text
);
create table public.employees (
id uuid,
employee_id text,
person_id uuid,
employment_status text,
department_id uuid,
position_id uuid,
hired_on date,
departed_on date,
attendance_required boolean,
created_at timestamp with time zone,
updated_at timestamp with time zone,
archived_at timestamp with time zone,
archived_by uuid,
archive_reason text,
archive_snapshot jsonb
);
create table public.payroll_statutory_profiles (
id uuid,
employee_uuid uuid,
effective_from date,
effective_to date,
national_pension_status text,
health_insurance_status text,
employment_insurance_status text,
livelihood_recipient_status text,
disability_tax_deduction_status text,
national_pension_acquired_on date,
national_pension_lost_on date,
health_insurance_acquired_on date,
health_insurance_lost_on date,
employment_insurance_acquired_on date,
employment_insurance_lost_on date,
pension_standard_monthly_income numeric(14,2),
health_monthly_remuneration numeric(14,2),
tax_dependent_count integer,
withholding_rate_percent integer,
source_kind text,
source_ref text,
review_note text,
reviewed_at timestamp with time zone,
reviewed_by uuid,
created_at timestamp with time zone,
national_pension_acquisition_month_opt_in boolean,
national_pension_deduction_override boolean,
health_insurance_deduction_override boolean,
employment_insurance_deduction_override boolean
);
create table public.people (
id uuid,
full_name text,
created_at timestamp with time zone,
updated_at timestamp with time zone
);
create table public.positions (
id uuid,
code text,
name text,
description text,
active boolean,
sort_order integer,
created_at timestamp with time zone,
updated_at timestamp with time zone
);
alter table public.profiles add column work_email text;
alter table public.profiles add column department_id uuid;
alter table public.profiles add column position_id uuid;
alter table public.profiles add column approved_at timestamp with time zone;
alter table public.profiles add column approved_by uuid;
alter table public.profiles add column status_changed_at timestamp with time zone;
alter table public.profiles add column status_changed_by uuid;
alter table public.profiles add column status_reason text;
alter table public.profiles add column created_at timestamp with time zone;
alter table public.profiles add column updated_at timestamp with time zone;
alter table public.profiles add column signup_phone text;
alter table public.profiles add column signup_hired_on date;
