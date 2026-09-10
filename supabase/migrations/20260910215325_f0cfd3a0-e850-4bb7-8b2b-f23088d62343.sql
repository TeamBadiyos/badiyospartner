DO $$
DECLARE
  _zone uuid := '04dc9065-bb7a-4881-9d3e-38eb6576182e';
  _cust uuid := 'ac774e78-685d-490d-a904-9ff36c4b367c';
  _addr uuid;
  _exp uuid;
  _bk uuid;
  _cat uuid;
BEGIN
  -- Test partner
  SELECT id INTO _exp FROM public.experts WHERE phone IN ('9999900000','+919999900000','919999900000') LIMIT 1;
  IF _exp IS NULL THEN
    INSERT INTO public.experts (name, phone, zone_id, status, kyc_status, level, security_deposit_status, current_lat, current_lng, location_updated_at, preferred_language)
    VALUES ('App Review Expert', '9999900000', _zone, 'active', 'approved', 'bronze', 'collected', 18.4048169, 76.5834958, now(), 'en')
    RETURNING id INTO _exp;
  ELSE
    UPDATE public.experts SET status='active', kyc_status='approved', zone_id=_zone WHERE id=_exp;
  END IF;

  -- Approved skills for all active categories
  FOR _cat IN SELECT id FROM public.service_categories WHERE is_active LOOP
    INSERT INTO public.partner_skills (expert_id, service_category_id, status, approved_at)
    SELECT _exp, _cat, 'approved', now()
    WHERE NOT EXISTS (
      SELECT 1 FROM public.partner_skills WHERE expert_id=_exp AND service_category_id=_cat
    );
  END LOOP;

  -- Test customer address
  SELECT id INTO _addr FROM public.addresses WHERE user_id=_cust LIMIT 1;
  IF _addr IS NULL THEN
    INSERT INTO public.addresses (user_id, label, full_address, area, city, latitude, longitude, is_default)
    VALUES (_cust, 'Home', 'Test Flat 101, Review Apartments, Main Road', 'Ausa Road', 'Latur', 18.4048169, 76.5834958, true)
    RETURNING id INTO _addr;
  END IF;

  -- Sample job assigned to the test partner
  SELECT id INTO _bk FROM public.bookings
   WHERE assigned_expert_id=_exp AND status IN ('expert_assigned','in_progress') AND deleted_at IS NULL LIMIT 1;
  IF _bk IS NULL THEN
    PERFORM set_config('app.booking_bypass', 'on', true);
    INSERT INTO public.bookings (user_id, address_id, service_duration_minutes, service_label, price, slot_type,
                                 scheduled_date, scheduled_time_slot, zone_id, booking_lat, booking_lng, assigned_expert_id)
    VALUES (_cust, _addr, 60, '1 Hour', 0, 'scheduled',
            (now() AT TIME ZONE 'Asia/Kolkata')::date + 1, '10:00 AM - 11:00 AM', _zone, 18.4048169, 76.5834958, _exp)
    RETURNING id INTO _bk;
    UPDATE public.bookings SET status='expert_assigned', assigned_expert_id=_exp WHERE id=_bk;
    PERFORM set_config('app.booking_bypass', 'off', true);
  END IF;
END $$;