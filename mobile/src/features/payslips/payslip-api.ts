import type { PlatformSupabaseClient } from '@/src/platform/supabase';

export type PayslipSummary = { payroll_month: string; gross_pay: number | null; total_deduction: number | null; net_pay: number | null; confirmed_at: string | null };
export type PayslipDetail = PayslipSummary & { deductions: Array<{ label: string; amount: number | null }> };

export async function loadMyFinalPayslips(client: PlatformSupabaseClient): Promise<PayslipSummary[]> {
  const { data, error } = await client.rpc('get_my_final_payslip_list');
  if (error) throw error;
  return Array.isArray(data) ? data as PayslipSummary[] : [];
}

export async function loadMyFinalPayslip(client: PlatformSupabaseClient, payrollMonth: string): Promise<PayslipDetail> {
  const { data, error } = await client.rpc('get_my_final_payslip', { p_payroll_month: payrollMonth });
  if (error) throw error;
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('급여명세서를 불러오지 못했습니다.');
  return data as PayslipDetail;
}

export const payslipPath = (payrollMonth: string) => `/payslips/${encodeURIComponent(payrollMonth)}`;
