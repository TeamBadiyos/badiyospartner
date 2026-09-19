
CREATE OR REPLACE FUNCTION public.notify_courier_offer_push(_offer_id uuid, _expert_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  _base text := 'https://dkneclwmmjlqswovtqno.supabase.co/functions/v1';
  _secret text;
BEGIN
  BEGIN
    IF _offer_id IS NULL OR _expert_id IS NULL THEN RETURN; END IF;
    SELECT value INTO _secret FROM public.edge_runtime_config WHERE key = 'push_trigger_secret';
    IF _secret IS NULL OR _secret = '' THEN RETURN; END IF;

    PERFORM net.http_post(
      url := _base || '/expert-send-push',
      headers := jsonb_build_object(
        'content-type','application/json',
        'x-trigger-secret', _secret
      ),
      body := jsonb_build_object(
        'type','courier_offer',
        'offer_id', _offer_id,
        'expert_id', _expert_id
      )
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING '[notify_courier_offer_push] failed for offer %: %', _offer_id, SQLERRM;
  END;
END;$function$;

REVOKE ALL ON FUNCTION public.notify_courier_offer_push(uuid, uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.courier_dispatch_next(_order_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare _o public.courier_orders%rowtype; _r record; _timeout int; _radius numeric;
        _offer public.courier_offers%rowtype;
begin
  select * into _o from public.courier_orders where id = _order_id for update;
  if _o.id is null or _o.status <> 'SEARCHING' then return false; end if;
  if exists (select 1 from public.courier_offers
              where order_id = _order_id and status = 'pending' and expires_at > now()) then
    return true;
  end if;

  _timeout := public.courier_setting('courier_offer_timeout_seconds', 30)::int;
  _radius := coalesce(_o.current_search_radius_km,
                      (select broadcast_radius_km from public.dispatch_config limit 1), 5);

  select * into _r from public.courier_eligible_riders(_order_id, _radius) limit 1;
  if _r.expert_id is null then return false; end if;

  insert into public.courier_offers (order_id, expert_id, distance_km, expires_at)
  values (_order_id, _r.expert_id, _r.distance_km, now() + make_interval(secs => _timeout))
  on conflict (order_id, expert_id) do update
    set status = 'pending', sent_at = now(), expires_at = now() + make_interval(secs => _timeout)
  returning * into _offer;

  -- Push is built entirely from DB data inside the expert-send-push edge fn,
  -- which also picks notification-vs-data mode from courier_native_alert_enabled.
  perform public.notify_courier_offer_push(_offer.id, _r.expert_id);

  return true;
end $function$;
