CREATE OR REPLACE FUNCTION public.courier_rider_offers()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare _eid uuid;
begin
  _eid := public.get_expert_id_for_auth(auth.uid());
  if _eid is null then raise exception 'Not a rider' using errcode='42501'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'offer_id', f.id, 'order_id', o.id, 'order_code', o.order_code,
      'expires_at', f.expires_at, 'distance_to_pickup_km', round(f.distance_km,2),
      'pickup_area', split_part(o.pickup_address, ',', 1),
      'drop_area', split_part(o.drop_address, ',', 1),
      'trip_km', o.distance_km,
      'earning', round(o.base_amount + o.extra_fee - (o.base_amount + o.extra_fee) * o.commission_pct / 100, 2),
      'parcel', (select name from public.courier_types where id = o.courier_type_id),
      'source', case when o.store_order_id is not null then 'store' else o.source end,
      'store_name', (select m.store_name from public.merchant_orders mo join public.merchants m on m.id = mo.merchant_id where mo.id = o.store_order_id),
      'item_count', (select coalesce(sum(i.quantity),0) from public.merchant_order_items i where i.order_id = o.store_order_id),
      'pickup_count', (select count(*) from public.courier_order_stops s where s.order_id = o.id and s.stop_type = 'pickup'),
      'drop_count', (select count(*) from public.courier_order_stops s where s.order_id = o.id and s.stop_type = 'drop')
    ) order by f.expires_at)
    from public.courier_offers f
    join public.courier_orders o on o.id = f.order_id
    where f.expert_id = _eid and f.status = 'pending' and f.expires_at > now()
      and o.status = 'SEARCHING'
  ), '[]'::jsonb);
end $function$;