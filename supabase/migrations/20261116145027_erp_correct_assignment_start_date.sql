-- Let an operator correct the current manager's start date without rewriting saved sales.
create or replace function public.erp_sales_assign_agent(p_party_id uuid,p_agent_id uuid,p_relationship text,p_starts_on date,p_reason text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
 v_row public.erp_sales_assignments;
 v_old public.erp_sales_assignments;
 v_previous public.erp_sales_assignments;
 v_previous_after public.erp_sales_assignments;
begin
 perform private.erp_sales_guard('write');
 perform 1 from public.erp_sales_parties where id=p_party_id and organization_key='taejang' and active for update;
 if not found or not exists(select 1 from public.erp_sales_agents where id=p_agent_id and organization_key='taejang' and active) or p_starts_on is null then raise exception 'ERP_INVALID_ASSIGNMENT'; end if;
 if p_relationship='management' then
  select * into v_old from public.erp_sales_assignments where party_id=p_party_id and relationship='management' and ends_on is null for update;
  if found then
   if p_starts_on<v_old.starts_on then
    if p_agent_id<>v_old.agent_id then raise exception 'ERP_ASSIGNMENT_DATE_ORDER';end if;
    select * into v_previous from public.erp_sales_assignments
    where party_id=p_party_id and relationship='management'
      and ends_on>starts_on and ends_on>p_starts_on and ends_on<=v_old.starts_on
    order by ends_on desc,starts_on desc,id limit 1 for update;
    if found then
     if p_starts_on<v_previous.starts_on then raise exception 'ERP_ASSIGNMENT_HISTORY_OVERLAP';end if;
     update public.erp_sales_assignments set ends_on=p_starts_on where id=v_previous.id returning * into v_previous_after;
     perform private.erp_sales_history('assignment',v_previous.id,'correct_end',to_jsonb(v_previous),to_jsonb(v_previous_after));
    end if;
    update public.erp_sales_assignments set starts_on=p_starts_on,reason=p_reason where id=v_old.id returning * into v_row;
    perform private.erp_sales_history('assignment',v_old.id,'correct_start',to_jsonb(v_old),to_jsonb(v_row));
    return to_jsonb(v_row);
   end if;
   update public.erp_sales_assignments set ends_on=p_starts_on where id=v_old.id;
   perform private.erp_sales_history('assignment',v_old.id,'end',to_jsonb(v_old),to_jsonb(v_old)||jsonb_build_object('ends_on',p_starts_on));
  end if;
 end if;
 insert into public.erp_sales_assignments(party_id,agent_id,relationship,starts_on,reason,created_by) values(p_party_id,p_agent_id,p_relationship,p_starts_on,p_reason,auth.uid()) returning * into v_row;
 perform private.erp_sales_history('assignment',v_row.id,'assign',null,to_jsonb(v_row));return to_jsonb(v_row);
end $$;
