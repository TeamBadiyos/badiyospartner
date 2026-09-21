CREATE OR REPLACE FUNCTION public.courier_dispatch_next(_order_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare _o public.courier_orders%rowtype; _r record; _timeout int; _radius numeric;
        _offer public.courier_offers%rowtype; _sent int := 0; _expires timestamptz;
begin
  select * into _o from public.courier_orders where id = _order_id for update;
  if _o.id is null or _o.status <> 'SEARCHING' then return false; end if;

  _timeout := public.courier_setting('courier_offer_timeout_seconds', 180)::int;
  _radius := coalesce(_o.current_search_radius_km,
                      (select broadcast_radius_km from public.dispatch_config limit 1), 5);
  _expires := now() + make_interval(secs => _timeout);

  -- Broadcast mode: offer to every eligible rider in radius at once
  -- (first rider to accept wins; courier_offer_respond cancels the rest).
  for _r in select * from public.courier_eligible_riders(_order_id, _radius) limit 20
  loop
    insert into public.courier_offers (order_id, expert_id, distance_km, expires_at)
    values (_order_id, _r.expert_id, _r.distance_km, _expires)
    on conflict (order_id, expert_id) do update
      set status = 'pending', sent_at = now(), expires_at = _expires
    returning * into _offer;

    perform public.notify_courier_offer_push(_offer.id, _r.expert_id);
    _sent := _sent + 1;
  end loop;

  return _sent > 0;
end $function$;