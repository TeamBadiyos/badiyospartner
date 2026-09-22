CREATE OR REPLACE FUNCTION public.expert_set_online(_online boolean)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare
  _expert_id uuid;
  _enforce boolean;
  _allowed boolean := false;
  _has_courier boolean := false;
  _state jsonb;
  _reason text;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  _expert_id := public.get_expert_id_for_auth(auth.uid());
  if _expert_id is null then raise exception 'Not an expert'; end if;

  -- Going offline is never blocked.
  if not coalesce(_online, false) then
    update public.experts set is_online = false where id = _expert_id;
    return;
  end if;

  -- Master switch: while service_hours_enforce <> '1' there is no gating at all.
  select coalesce((select value from public.ops_settings where key = 'service_hours_enforce'), '0') = '1'
    into _enforce;

  if _enforce and not public.service_hours_bypass() then
    -- Expert may go online if ANY service they are approved for is orderable.
    select exists (
      select 1
      from public.partner_skills ps
      join public.service_categories sc on sc.id = ps.service_category_id
      where ps.expert_id = _expert_id
        and ps.status = 'approved'
        and sc.slug = 'courier-delivery'
    ) into _has_courier;

    if public.service_can_order('clean', now()) then
      _allowed := true;
    elsif _has_courier and public.service_can_order('courier', now()) then
      _allowed := true;
    end if;

    if not _allowed then
      _state := public.service_effective_state('clean');
      _reason := coalesce(
        _state ->> 'message_en',
        case _state ->> 'reason_code'
          when 'coming_soon' then 'Service is not live yet.'
          when 'temporarily_stopped' then 'Service is temporarily stopped.'
          when 'holiday' then 'Service is closed today (holiday).'
          when 'weekly_off' then 'Service is closed today.'
          when 'before_open' then 'Service has not opened yet today.'
          when 'after_close' then 'Service is closed for today.'
          when 'closed_today' then 'Service is closed today.'
          when 'closed_until' then 'Service is closed right now.'
          else 'Service is closed right now.'
        end
      );
      raise exception 'SERVICE_CLOSED:%', _reason;
    end if;
  end if;

  update public.experts set is_online = true where id = _expert_id;

  perform public.rebroadcast_pending_advance_to_expert(_expert_id);
end $function$;

REVOKE ALL ON FUNCTION public.expert_set_online(boolean) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.expert_set_online(boolean) TO authenticated;