-- Phase 2A CMS foundation candidate.
-- Review before applying to a Supabase project. Do not run in production yet.

create extension if not exists pgcrypto;

create type public.admin_account_status as enum ('active', 'suspended', 'departed');
create type public.admin_role as enum ('staff', 'admin', 'super_admin');
create type public.content_kind as enum ('native', 'external');
create type public.content_source as enum ('homepage