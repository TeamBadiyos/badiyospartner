-- Rider-scoped business-trip display fields, tolerant of metadata added later.
CREATE OR REPLACE FUNCTION public.courier_business_trip_display(_order_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE _eid uuid; _result jsonb;
BEGIN
  _eid := public.get_expert_id_for_auth(auth.uid());
  IF _eid IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.courier_orders o
    WHERE o.id = _order_id AND o.source = 'business'
      AND (o.assigned_expert_id = _eid OR EXISTS (
        SELECT 1 FROM public.courier_offers f
        WHERE f.order_id = o.id AND f.expert_id = _eid
          AND f.status = 'pending' AND f.expires_at > now()
      ))
  ) THEN RAISE EXCEPTION 'Not assigned to this business trip' USING errcode = '42501'; END IF;

  SELECT jsonb_build_object(
    'business_name', coalesce(nullif(p.business_name,''), nullif(m.store_name,'')),
    'trip_no', nullif(to_jsonb(b)->>'trip_no',''),
    'trip_label', coalesce(nullif(to_jsonb(b)->>'trip_label',''), nullif(to_jsonb(b)->>'label','')),
    'drop_labels', coalesce((
      SELECT jsonb_object_agg(s.id::text, labels.label)
      FROM public.courier_order_stops s
      LEFT JOIN LATERAL (
        SELECT coalesce(nullif(to_jsonb(s)->>'drop_label',''),
          (SELECT nullif(to_jsonb(bo)->>'drop_label','') FROM public.business_orders bo
           WHERE bo.drop_stop_id = s.id AND bo.batch_id = b.id LIMIT 1)) AS label
      ) labels ON true
      WHERE s.order_id = _order_id AND s.stop_type = 'drop' AND labels.label IS NOT NULL
    ), '{}'::jsonb)
  ) INTO _result
  FROM public.business_batches b
  LEFT JOIN public.business_profiles p ON p.merchant_id = b.merchant_id
  LEFT JOIN public.merchants m ON m.id = b.merchant_id
  WHERE b.courier_order_id = _order_id
  ORDER BY b.created_at DESC LIMIT 1;
  RETURN coalesce(_result, '{}'::jsonb);
END
$function$;
REVOKE ALL ON FUNCTION public.courier_business_trip_display(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.courier_business_trip_display(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.courier_rider_offers()
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
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
      'earning', round(o.base_amount + o.extra_fee - (o.base_amount + o.extra_fee) * o.commission_pct / 100, 2),
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