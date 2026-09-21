-- lovable-cron-fallback-reviewed: closing time is wall-clock based; a 5-minute check keeps the max "still online after close" window at 5 minutes. 288 runs/day, early-exit when enforcement is off.
GRANT SELECT ON public.service_hours TO authenticated;
GRANT SELECT ON public.service_holidays TO authenticated;
GRANT SELECT ON public.service_flags TO authenticated;
GRANT EXECUTE ON FUNCTION public.service_effective_state(text, text, timestamptz) TO authenticated;

ALTER TABLE public.experts ADD COLUMN IF NOT EXISTS offline_after_job boolean NOT NULL DEFAULT false;

INSERT INTO public.ops_settings(key, value, label) VALUES
  ('service_hours_enforce', '0', 'Service hours enforcement (0 = off)'),
  ('courier_last_order_buffer_minutes', '30', 'Courier last-order buffer before close (minutes)'),
  ('service_hours_bypass_phones', '9999900000', 'Phones exempt from service-hours auto offline')
ON CONFLICT (key) DO NOTHING;

CREATE OR REPLACE FUNCTION public.service_hours_autooffline()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _enforce int;
  _bypass text;
  e record;
  _keys text[];
  _closed boolean;
  k text;
  _open boolean;
  _busy boolean;
BEGIN
  SELECT COALESCE(NULLIF(value, '')::numeric, 0)::int INTO _enforce
    FROM public.ops_settings WHERE key = 'service_hours_enforce';
  IF COALESCE(_enforce, 0) <> 1 THEN RETURN; END IF;

  SELECT COALESCE(value, '') INTO _bypass FROM public.ops_settings WHERE key = 'service_hours_bypass_phones';
  _bypass := COALESCE(_bypass, '');

  IF NOT EXISTS (SELECT 1 FROM public.experts WHERE is_online = true OR offline_after_job = true) THEN
    RETURN;
  END IF;

  CREATE TEMP TABLE IF NOT EXISTS _svc_state(service_key text, city text, is_open boolean) ON COMMIT DROP;
  DELETE FROM _svc_state;

  INSERT INTO _svc_state(service_key, city, is_open)
  SELECT d.service_key, d.city,
         COALESCE((public.service_effective_state(d.service_key, d.city, now())->>'open')::boolean, true)
  FROM (
    SELECT DISTINCT sk.service_key, c.city
    FROM (
      SELECT DISTINCT COALESCE(z.city, 'Latur') AS city
      FROM public.experts e2
      LEFT JOIN public.zones z ON z.id = e2.zone_id
      WHERE e2.is_online = true OR e2.offline_after_job = true
    ) c
    CROSS JOIN (SELECT unnest(ARRAY['clean', 'courier']) AS service_key) sk
  ) d;

  FOR e IN
    SELECT ex.id, ex.phone, ex.is_online, ex.offline_after_job, COALESCE(z.city, 'Latur') AS city
    FROM public.experts ex
    LEFT JOIN public.zones z ON z.id = ex.zone_id
    WHERE ex.is_online = true OR ex.offline_after_job = true
  LOOP
    BEGIN
      IF _bypass <> '' AND EXISTS (
        SELECT 1 FROM unnest(string_to_array(_bypass, ',')) p
        WHERE btrim(p) <> ''
          AND right(regexp_replace(btrim(p), '\D', '', 'g'), 10) = right(regexp_replace(COALESCE(e.phone, ''), '\D', '', 'g'), 10)
      ) THEN
        CONTINUE;
      END IF;

      SELECT ARRAY(
        SELECT DISTINCT CASE WHEN sc.slug = 'courier-delivery' THEN 'courier' ELSE 'clean' END
        FROM public.partner_skills ps
        JOIN public.service_categories sc ON sc.id = ps.service_category_id
        WHERE ps.expert_id = e.id AND ps.status = 'approved'
      ) INTO _keys;
      IF _keys IS NULL OR array_length(_keys, 1) IS NULL THEN
        _keys := ARRAY['clean'];
      END IF;

      _closed := true;
      FOREACH k IN ARRAY _keys LOOP
        SELECT s.is_open INTO _open FROM _svc_state s WHERE s.service_key = k AND s.city = e.city;
        IF COALESCE(_open, true) THEN _closed := false; END IF;
      END LOOP;

      _busy := EXISTS (
          SELECT 1 FROM public.bookings b
          WHERE b.assigned_expert_id = e.id
            AND b.status IN ('expert_assigned', 'in_progress')
            AND b.deleted_at IS NULL
        ) OR EXISTS (
          SELECT 1 FROM public.courier_orders c
          WHERE c.assigned_expert_id = e.id
            AND c.status IN ('DRIVER_ASSIGNED', 'ARRIVED_PICKUP', 'PICKED_UP', 'IN_TRANSIT')
        );

      IF _closed THEN
        IF _busy THEN
          IF NOT e.offline_after_job THEN
            UPDATE public.experts SET offline_after_job = true WHERE id = e.id;
          END IF;
        ELSE
          UPDATE public.experts SET is_online = false, offline_after_job = false WHERE id = e.id;
          IF e.is_online THEN
            PERFORM public.notify_expert_alert(
              e.id, 'service_closed',
              'Service closed for today',
              'Service hours are over, so you have been set offline. See you tomorrow!',
              jsonb_build_object('route', '/home')
            );
          END IF;
        END IF;
      ELSIF e.offline_after_job THEN
        UPDATE public.experts SET offline_after_job = false WHERE id = e.id;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'service_hours_autooffline failed for expert %: %', e.id, SQLERRM;
    END;
  END LOOP;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'service_hours_autooffline failed: %', SQLERRM;
END $$;

REVOKE ALL ON FUNCTION public.service_hours_autooffline() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.courier_eligible_riders(_order_id uuid, _radius numeric)
 RETURNS TABLE(expert_id uuid, distance_km numeric)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  _o public.courier_orders%rowtype;
  _skill uuid;
  _buffer int;
  _state jsonb;
  _cut int;
begin
  select * into _o from public.courier_orders where id = _order_id;
  if _o.id is null then return; end if;

  if public.courier_setting('service_hours_enforce', 0)::int = 1 then
    _state := public.service_effective_state('courier', coalesce(_o.city, 'Latur'), now());
    if coalesce((_state->>'can_order')::boolean, true) = false then
      return;
    end if;
    _cut := public.courier_setting('courier_last_order_buffer_minutes', 30)::int;
    if (_state->>'close_time') is not null
       and (now() at time zone 'Asia/Kolkata')::time
           >= ((_state->>'close_time')::time - make_interval(mins => greatest(_cut, 0))) then
      return;
    end if;
  end if;

  select required_skill into _skill from public.courier_vehicle_types where id = _o.vehicle_type_id;
  _buffer := public.courier_setting('courier_slot_buffer_minutes', 90)::int;

  return query
  select e.id, public.haversine_km(e.current_lat, e.current_lng, _o.pickup_lat, _o.pickup_lng)
  from public.experts e
  where e.is_online = true
    and coalesce(e.is_busy,false) = false
    and e.status = 'active'
    and e.current_lat is not null and e.current_lng is not null
    and (e.location_updated_at is null or e.location_updated_at > now() - interval '15 minutes')
    and public.haversine_km(e.current_lat, e.current_lng, _o.pickup_lat, _o.pickup_lng) <= _radius
    and (_skill is null or exists (
      select 1 from public.partner_skills ps
      where ps.expert_id = e.id and ps.status = 'approved' and ps.service_category_id = _skill))
    and not exists (
      select 1 from public.courier_orders c
      where c.assigned_expert_id = e.id
        and c.status in ('DRIVER_ASSIGNED','ARRIVED_PICKUP','PICKED_UP','IN_TRANSIT'))
    and not exists (
      select 1 from public.bookings b
      where b.assigned_expert_id = e.id
        and b.status in ('confirmed','accepted','expert_assigned','in_progress')
        and b.deleted_at is null
        and public.courier_booking_start_at(b.scheduled_date, b.scheduled_time_slot)
              <= now() + make_interval(mins => _buffer))
    and not exists (
      select 1 from public.courier_offers o
      where o.order_id = _order_id and o.expert_id = e.id
        and o.status in ('pending','rejected','expired'))
  order by 2 asc;
end $function$;

CREATE TABLE IF NOT EXISTS public.expert_holiday_notices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  holiday_id uuid NOT NULL,
  phase text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (holiday_id, phase)
);
GRANT ALL ON public.expert_holiday_notices TO service_role;
ALTER TABLE public.expert_holiday_notices ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.service_holiday_notify(_phase text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  h record;
  ex record;
  _today date := (now() AT TIME ZONE 'Asia/Kolkata')::date;
  _target date;
  _title text;
BEGIN
  IF _phase = 'eve' THEN
    _target := _today + 1;
    _title := 'Holiday tomorrow';
  ELSE
    _target := _today;
    _title := 'Holiday today';
  END IF;

  FOR h IN
    SELECT sh.id, sh.reason, sh.start_date
    FROM public.service_holidays sh
    WHERE _target BETWEEN sh.start_date AND COALESCE(sh.end_date, sh.start_date)
  LOOP
    BEGIN
      INSERT INTO public.expert_holiday_notices(holiday_id, phase) VALUES (h.id, _phase);
    EXCEPTION WHEN unique_violation THEN
      CONTINUE;
    END;

    FOR ex IN SELECT id FROM public.experts WHERE status = 'active' LOOP
      BEGIN
        PERFORM public.notify_expert_alert(
          ex.id, 'service_holiday', _title,
          COALESCE(h.reason, 'Service will stay closed.'),
          jsonb_build_object('route', '/schedule')
        );
      EXCEPTION WHEN OTHERS THEN
        RAISE WARNING 'holiday notice failed for expert %: %', ex.id, SQLERRM;
      END;
    END LOOP;
  END LOOP;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'service_holiday_notify failed: %', SQLERRM;
END $$;

REVOKE ALL ON FUNCTION public.service_holiday_notify(text) FROM PUBLIC, anon, authenticated;

SELECT cron.schedule('service-hours-autooffline', '*/5 * * * *', $$SELECT public.service_hours_autooffline();$$);
SELECT cron.schedule('service-holiday-notify-eve', '30 13 * * *', $$SELECT public.service_holiday_notify('eve');$$);
SELECT cron.schedule('service-holiday-notify-morning', '30 2 * * *', $$SELECT public.service_holiday_notify('morning');$$);
