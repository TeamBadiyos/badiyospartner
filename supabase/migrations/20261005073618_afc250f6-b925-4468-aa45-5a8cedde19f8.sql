-- Decouple expert availability from service open/closed status.
-- 1) expert_set_online: remove the service-hours/orderability gate. Going online
--    is never blocked by service status; going offline was never blocked.
CREATE OR REPLACE FUNCTION public.expert_set_online(_online boolean)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare
  _expert_id uuid;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  _expert_id := public.get_expert_id_for_auth(auth.uid());
  if _expert_id is null then raise exception 'Not an expert'; end if;

  update public.experts
     set is_online = coalesce(_online, false),
         offline_after_job = false
   where id = _expert_id;

  if coalesce(_online, false) then
    perform public.rebroadcast_pending_advance_to_expert(_expert_id);
  end if;
end $function$;

REVOKE ALL ON FUNCTION public.expert_set_online(boolean) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.expert_set_online(boolean) TO authenticated;

-- 2) Stop auto-offlining experts when a service closes or is temporarily
--    stopped. The cron schedule is left in place (cron.job is not writable
--    from migrations) but the function is now a no-op, so the job does nothing.
CREATE OR REPLACE FUNCTION public.service_hours_autooffline()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  -- Service-hours auto-offline has been decoupled from expert availability.
  -- Intentionally does nothing.
  RETURN;
END $$;

REVOKE ALL ON FUNCTION public.service_hours_autooffline() FROM PUBLIC, anon, authenticated;