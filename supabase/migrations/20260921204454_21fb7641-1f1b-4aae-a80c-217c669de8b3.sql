CREATE OR REPLACE FUNCTION public.expert_service_schedule(_service_key text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _city text;
  _flag record;
  _lead numeric;
  _buffer numeric;
BEGIN
  SELECT COALESCE(z.city, 'Latur') INTO _city
  FROM public.experts e
  LEFT JOIN public.zones z ON z.id = e.zone_id
  WHERE e.auth_user_id = auth.uid()
  LIMIT 1;
  IF _city IS NULL THEN _city := 'Latur'; END IF;

  SELECT COALESCE(NULLIF(value, '')::numeric, 2) INTO _lead
    FROM public.ops_settings WHERE key = 'advance_booking_expire_before_slot_hours';
  SELECT COALESCE(NULLIF(value, '')::numeric, 30) INTO _buffer
    FROM public.ops_settings WHERE key = 'courier_last_order_buffer_minutes';

  SELECT * INTO _flag FROM public.service_flags
   WHERE service_key = _service_key AND city = _city
   ORDER BY created_at LIMIT 1;

  RETURN jsonb_build_object(
    'city', _city,
    'advance_lead_hours', COALESCE(_lead, 2),
    'courier_last_order_buffer_minutes', COALESCE(_buffer, 30),
    'state', public.service_effective_state(_service_key, _city, now()),
    'hours', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'weekday', h.weekday, 'open_time', h.open_time,
               'close_time', h.close_time, 'is_closed', h.is_closed) ORDER BY h.weekday)
      FROM public.service_hours h WHERE _flag.id IS NOT NULL AND h.service_flag_id = _flag.id
    ), '[]'::jsonb),
    'holidays', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'id', x.id, 'start_date', x.start_date, 'end_date', x.end_date,
               'reason', x.reason, 'reason_mr', x.reason_mr) ORDER BY x.start_date)
      FROM (
        SELECT sh.* FROM public.service_holidays sh
        WHERE (_flag.id IS NOT NULL AND sh.service_flag_id = _flag.id) OR sh.service_flag_id IS NULL
          AND COALESCE(sh.end_date, sh.start_date) >= (now() AT TIME ZONE 'Asia/Kolkata')::date
        ORDER BY sh.start_date LIMIT 20
      ) x
    ), '[]'::jsonb)
  );
END $$;

REVOKE ALL ON FUNCTION public.expert_service_schedule(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.expert_service_schedule(text) TO authenticated;