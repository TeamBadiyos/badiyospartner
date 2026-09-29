create table if not exists public.business_slot_notice_log (
  notice_date date not null,
  slot_time time not null,
  notified_at timestamptz not null default now(),
  primary key (notice_date, slot_time)
);

grant all on public.business_slot_notice_log to service_role;

alter table public.business_slot_notice_log enable row level security;

CREATE OR REPLACE FUNCTION public.business_slot_tick()
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare _r record; _t time; _now timestamptz := now(); _local timestamp := (now() at time zone 'Asia/Kolkata');
        _state public.business_dispatch_state%rowtype; _e record; _skill uuid; _slot record; _ins int;
begin
  select id into _skill from public.service_categories where slug='bulk-delivery' and is_active order by rank limit 1;

  -- 1. Heads-up notice: one notification per distinct slot time, no business name
  if _skill is not null then
    for _slot in
      select distinct t as slot_time
        from public.business_profiles bp
        join public.bulk_dispatch_plans p on p.id=bp.dispatch_plan_id and p.is_active
        join public.merchants m on m.id=bp.merchant_id
        cross join lateral unnest(coalesce(p.slot_times, '{}'::time[])) as t
       where bp.pricing_plan_id is not null and p.slots_enabled
         and m.delivery_enabled and m.delivery_status='active'
         and t >= time '00:15'
         and (now() at time zone 'Asia/Kolkata')::time >= (t - interval '15 minutes')
         and (now() at time zone 'Asia/Kolkata')::time < t
    loop
      insert into public.business_slot_notice_log(notice_date, slot_time)
      values (_local::date, _slot.slot_time)
      on conflict (notice_date, slot_time) do nothing;
      get diagnostics _ins = row_count;
      if _ins > 0 then
        for _e in select e.id from public.experts e
                   where e.is_online and e.status='active'
                     and exists (select 1 from public.partner_skills ps
                                  where ps.expert_id=e.id and ps.status='approved' and ps.service_category_id=_skill)
        loop
          perform public.notify_push_event('expert', _e.id, 'bulk_slot_notice',
            'Trips Ready Soon',
            'Trips ready at ' || to_char(_slot.slot_time,'HH12:MI AM') || '. Stay online to get these trips.',
            jsonb_build_object('type','bulk_slot_notice','route','/courier'));
        end loop;
      end if;
    end loop;
  end if;

  -- 2. Actual batching per merchant (unchanged)
  for _r in
    select bp.merchant_id, bp.business_name, p.slot_times, p.slots_enabled
      from public.business_profiles bp
      join public.bulk_dispatch_plans p on p.id=bp.dispatch_plan_id and p.is_active
      join public.merchants m on m.id=bp.merchant_id
     where bp.pricing_plan_id is not null and p.slots_enabled
       and m.delivery_enabled and m.delivery_status='active'
  loop
    select * into _state from public.business_dispatch_state where merchant_id=_r.merchant_id;
    foreach _t in array coalesce(_r.slot_times, '{}'::time[]) loop
      if _local::time >= _t
         and (_state.merchant_id is null
              or _state.last_slot_date is distinct from _local::date
              or _state.last_slot_time is null or _state.last_slot_time < _t) then
        perform public.business_group_and_batch(_r.merchant_id, 'slot', null);
        insert into public.business_dispatch_state(merchant_id, last_slot_date, last_slot_time)
        values (_r.merchant_id, _local::date, _t)
        on conflict (merchant_id) do update set last_slot_date=excluded.last_slot_date, last_slot_time=excluded.last_slot_time;
        select * into _state from public.business_dispatch_state where merchant_id=_r.merchant_id;
      end if;
    end loop;
  end loop;

  update public.business_batches set status='planning', claimed_at=null
   where status='awaiting_balance' and updated_at < _now - interval '2 minutes';
  update public.business_batches set claimed_at=null
   where status='planning' and claimed_at is not null and claimed_at < _now - interval '5 minutes';
  update public.business_dispatch_runs set claimed_at=null
   where status='planning' and claimed_at is not null and claimed_at < _now - interval '5 minutes';

  perform public.business_batches_wake();
exception when others then
  raise warning 'business_slot_tick failed: %', sqlerrm;
end $function$;

-- cleanup old notice rows
delete from public.business_slot_notice_log where notice_date < current_date - 7;