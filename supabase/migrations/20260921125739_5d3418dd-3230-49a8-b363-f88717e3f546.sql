create or replace function public.courier_rider_advance(_order_id uuid, _to_status text, _lat numeric default null, _lng numeric default null, _accuracy_m numeric default null, _fix_at timestamp with time zone default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare _eid uuid; _o public.courier_orders%rowtype; _dist numeric; _otp text;
begin
  _eid := public.get_expert_id_for_auth(auth.uid());
  if _eid is null then raise exception 'Not a rider' using errcode='42501'; end if;
  select * into _o from public.courier_orders where id=_order_id for update;
  if _o.id is null or _o.assigned_expert_id <> _eid then raise exception 'Forbidden' using errcode='42501'; end if;

  perform set_config('app.courier_actor_type','rider',true);
  perform set_config('app.courier_actor_id', _eid::text, true);

  if _to_status = 'ARRIVED_PICKUP' then
    if _o.status <> 'DRIVER_ASSIGNED' then raise exception 'Order is not in assigned state'; end if;

    -- Geofence / GPS-freshness gating disabled: riders may mark arrival from anywhere.
    if _lat is not null and _lng is not null and _o.pickup_lat is not null and _o.pickup_lng is not null then
      _dist := public.haversine_km(_lat, _lng, _o.pickup_lat, _o.pickup_lng) * 1000;
    end if;

    insert into public.courier_order_events(order_id, from_status, to_status, actor_type, actor_id, meta)
    values (_order_id, _o.status, 'ARRIVED_PICKUP', 'rider', _eid,
            jsonb_build_object('event','arrival_recorded','accuracy_m',_accuracy_m,'fix_at',_fix_at,'distance_m',_dist));

    update public.courier_orders set status='ARRIVED_PICKUP', arrived_pickup_at=now() where id=_order_id;
    _otp := public.courier_issue_otp(_order_id, 'pickup');
    perform public.notify_customer_user_push(_o.customer_id, 'Rider reached pickup',
      'Share the pickup OTP with the rider to hand over the parcel.', 'home');
    return jsonb_build_object('ok', true, 'otp_issued', true);

  elsif _to_status = 'IN_TRANSIT' then
    if _o.status <> 'PICKED_UP' then raise exception 'Parcel has not been picked up yet'; end if;
    update public.courier_orders set status='IN_TRANSIT', in_transit_at=now() where id=_order_id;
    _otp := public.courier_issue_otp(_order_id, 'delivery');
    perform public.notify_customer_user_push(_o.customer_id, 'On the way',
      'Your parcel is on the way to the drop location.', 'home');
    return jsonb_build_object('ok', true, 'otp_issued', true);
  end if;

  raise exception 'Unsupported status %', _to_status;
end $$;

revoke all on function public.courier_rider_advance(uuid, text, numeric, numeric, numeric, timestamp with time zone) from public, anon;
grant execute on function public.courier_rider_advance(uuid, text, numeric, numeric, numeric, timestamp with time zone) to authenticated;
