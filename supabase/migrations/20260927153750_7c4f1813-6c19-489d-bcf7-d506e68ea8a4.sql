CREATE OR REPLACE FUNCTION public.courier_rider_offers()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _eid uuid;
BEGIN
  _eid := public.get_expert_id_for_auth(auth.uid());
  IF _eid IS NULL THEN RAISE EXCEPTION 'Not a rider' USING errcode='42501'; END IF;
  RETURN coalesce((
    SELECT jsonb_agg(jsonb_build_object(
      'offer_id', f.id, 'order_id', o.id, 'order_code', o.order_code,
      'expires_at', f.expires_at, 'distance_to_pickup_km', round(f.distance_km,2),
      'pickup_area', split_part(o.pickup_address, ',', 1),
      'drop_area', split_part(o.drop_address, ',', 1),
      'trip_km', o.distance_km,
      'earning', round((o.base_amount + o.extra_fee + coalesce(o.stops_fee,0))
                       * (100 - o.commission_pct) / 100, 2),
      'parcel', (select name from public.courier_types where id = o.courier_type_id),
      'source', case when o.store_order_id is not null then 'store' else o.source end,
      'store_name', (select m.store_name from public.merchant_orders mo join public.merchants m on m.id = mo.merchant_id where mo.id = o.store_order_id),
      'item_count', (select coalesce(sum(i.quantity),0) from public.merchant_order_items i where i.order_id = o.store_order_id),
      'pickup_count', (select count(*) from public.courier_order_stops s where s.order_id = o.id and s.stop_type = 'pickup'),
      'drop_count', (select count(*) from public.courier_order_stops s where s.order_id = o.id and s.stop_type = 'drop'),
      'business_trip', case when o.source = 'business' then public.courier_business_trip_display(o.id) else null end
    ) order by f.expires_at)
    FROM public.courier_offers f
    JOIN public.courier_orders o ON o.id = f.order_id
    WHERE f.expert_id = _eid AND f.status = 'pending' AND f.expires_at > now()
      AND o.status = 'SEARCHING'
  ), '[]'::jsonb);
END
$function$;