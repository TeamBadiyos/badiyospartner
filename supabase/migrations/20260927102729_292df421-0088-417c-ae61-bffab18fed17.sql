CREATE OR REPLACE FUNCTION public.courier_business_trip_display(_order_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
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
    'business_name', nullif(p.business_name,''),
    'trip_no', b.trip_no,
    'trip_label', nullif(b.trip_label,''),
    'drop_labels', coalesce((
      SELECT jsonb_object_agg(bo.drop_stop_id::text, x.label)
      FROM jsonb_to_recordset(coalesce(b.drop_labels, '[]'::jsonb)) AS x(receiver_id uuid, label text)
      JOIN public.business_orders bo ON bo.receiver_id = x.receiver_id AND bo.batch_id = b.id
      JOIN public.courier_order_stops s ON s.id = bo.drop_stop_id AND s.order_id = _order_id AND s.stop_type = 'drop'
      WHERE x.label IS NOT NULL
    ), '{}'::jsonb)
  ) INTO _result
  FROM public.business_batches b
  LEFT JOIN public.business_profiles p ON p.merchant_id = b.merchant_id
  WHERE b.courier_order_id = _order_id
  ORDER BY b.created_at DESC LIMIT 1;
  RETURN coalesce(_result, '{}'::jsonb);
END
$function$;