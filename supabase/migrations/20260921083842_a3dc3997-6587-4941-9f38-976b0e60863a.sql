CREATE OR REPLACE FUNCTION public.resolve_booking_payouts(_booking_id uuid)
 RETURNS TABLE(expert_payout numeric, area_partner_payout numeric)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _b record; _ep numeric; _ap numeric;
BEGIN
  SELECT id, service_label, service_duration_minutes, service_category_id,
         snapshot_expert_payout, snapshot_partner_payout
    INTO _b FROM public.bookings WHERE id = _booking_id;
  IF _b.id IS NULL THEN
    RETURN QUERY SELECT 0::numeric, 0::numeric; RETURN;
  END IF;

  SELECT NULLIF(COALESCE(spo.expert_payout,0),0), COALESCE(spo.partner_commission,0)
    INTO _ep, _ap
    FROM public.service_price_options spo
    JOIN public.services s ON s.id = spo.service_id
   WHERE lower(spo.label) = lower(COALESCE(_b.service_label,''))
     AND (_b.service_category_id IS NULL OR s.category_id = _b.service_category_id)
     AND spo.is_active
   ORDER BY (s.category_id = _b.service_category_id) DESC, spo.display_order
   LIMIT 1;

  IF _ep IS NULL THEN
    SELECT NULLIF(COALESCE(spo.expert_payout,0),0), COALESCE(spo.partner_commission,0)
      INTO _ep, _ap
      FROM public.service_price_options spo
     WHERE spo.duration_minutes = _b.service_duration_minutes
       AND spo.is_active
     ORDER BY spo.display_order
     LIMIT 1;
  END IF;

  IF _ep IS NULL THEN
    SELECT NULLIF(COALESCE(sc.expert_payout,0),0), COALESCE(sc.area_partner_payout,0)
      INTO _ep, _ap
      FROM public.service_catalogue_config sc
     WHERE sc.duration_minutes = _b.service_duration_minutes AND sc.is_active
     ORDER BY sc.created_at DESC
     LIMIT 1;
  END IF;

  IF COALESCE(_ep,0) = 0 THEN
    _ep := NULLIF(COALESCE(_b.snapshot_expert_payout,0),0);
    _ap := COALESCE(NULLIF(COALESCE(_ap,0),0), _b.snapshot_partner_payout, 0);
  END IF;

  RETURN QUERY SELECT COALESCE(_ep,0), COALESCE(_ap,0);
END $function$;

CREATE OR REPLACE FUNCTION public.credit_booking_completion(_booking_id uuid)
 RETURNS numeric
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _b record; _payout numeric; _reason text;
BEGIN
  SELECT id, assigned_expert_id, status, user_id, price, service_duration_minutes,
         snapshot_expert_payout
    INTO _b
    FROM public.bookings WHERE id = _booking_id;
  IF _b.id IS NULL OR _b.status <> 'completed' THEN RETURN 0; END IF;
  IF _b.assigned_expert_id IS NULL THEN RETURN 0; END IF;

  BEGIN
    SELECT r.expert_payout INTO _payout FROM public.resolve_booking_payouts(_booking_id) r;
  EXCEPTION WHEN OTHERS THEN
    _payout := NULL;
  END;
  _payout := COALESCE(NULLIF(COALESCE(_payout,0),0), _b.snapshot_expert_payout, 0);

  UPDATE public.experts SET is_busy = false WHERE id = _b.assigned_expert_id;

  _reason := 'Booking payout: ' || _booking_id::text;

  IF _payout > 0 AND NOT EXISTS (
      SELECT 1 FROM public.wallet_ledger
       WHERE owner_type = 'expert' AND owner_id = _b.assigned_expert_id AND reason = _reason) THEN
    INSERT INTO public.wallet_ledger(owner_type, owner_id, amount, type, reason, created_by)
    VALUES('expert', _b.assigned_expert_id, _payout, 'credit', _reason, NULL);
    UPDATE public.experts
       SET wallet_balance = COALESCE(wallet_balance,0) + _payout
     WHERE id = _b.assigned_expert_id;

    BEGIN
      PERFORM public.evaluate_reward_triggers('partner', _b.assigned_expert_id, 'booking_completed',
        _booking_id::text,
        jsonb_build_object('booking_id', _booking_id, 'amount', COALESCE(_b.price,0),
                           'minutes', COALESCE(_b.service_duration_minutes,0)));
    EXCEPTION WHEN OTHERS THEN NULL; END;
    IF _b.user_id IS NOT NULL THEN
      BEGIN
        PERFORM public.evaluate_reward_triggers('customer', _b.user_id, 'booking_completed',
          _booking_id::text,
          jsonb_build_object('booking_id', _booking_id, 'amount', COALESCE(_b.price,0)));
      EXCEPTION WHEN OTHERS THEN NULL; END;
    END IF;

    BEGIN
      PERFORM public.notify_expert_alert(
        _b.assigned_expert_id, 'order_completed', 'Job completed',
        'You completed the job. Rs ' || _payout::text || ' has been credited to your wallet.',
        jsonb_build_object('booking_id', _booking_id, 'route', 'booking/' || _booking_id::text));
    EXCEPTION WHEN OTHERS THEN NULL; END;
  END IF;

  RETURN _payout;
END;
$function$;

CREATE OR REPLACE FUNCTION public.expert_verify_end_otp(_booking_id uuid, _otp text)
 RETURNS numeric
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _expert_id uuid; _b record; _payout numeric;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  _expert_id := public.get_expert_id_for_auth(auth.uid());
  IF _expert_id IS NULL THEN RAISE EXCEPTION 'Not an expert'; END IF;
  IF _otp IS NULL OR btrim(_otp) = '' THEN RAISE EXCEPTION 'OTP required'; END IF;

  SELECT id, assigned_expert_id, status, end_otp, service_duration_minutes, user_id, price,
         snapshot_expert_payout
    INTO _b FROM public.bookings WHERE id = _booking_id FOR UPDATE;
  IF _b.id IS NULL THEN RAISE EXCEPTION 'Booking not found'; END IF;
  IF _b.assigned_expert_id <> _expert_id THEN RAISE EXCEPTION 'Not your booking'; END IF;

  BEGIN
    SELECT r.expert_payout INTO _payout FROM public.resolve_booking_payouts(_booking_id) r;
  EXCEPTION WHEN OTHERS THEN
    _payout := NULL;
  END;
  _payout := COALESCE(NULLIF(COALESCE(_payout,0),0), _b.snapshot_expert_payout, 0);

  IF _b.status = 'completed' THEN RETURN _payout; END IF;
  IF _b.status <> 'in_progress' THEN RAISE EXCEPTION 'Booking not in progress'; END IF;
  IF _b.end_otp IS NULL OR btrim(_otp) <> _b.end_otp THEN RAISE EXCEPTION 'Invalid end OTP'; END IF;

  PERFORM set_config('app.booking_bypass','on', true);
  UPDATE public.bookings
     SET status = 'completed', service_end_at = COALESCE(service_end_at, now()), updated_at = now()
   WHERE id = _booking_id;
  PERFORM set_config('app.booking_bypass','off', true);

  UPDATE public.experts SET is_busy = false WHERE id = _expert_id;

  IF _payout > 0 AND NOT EXISTS (
       SELECT 1 FROM public.wallet_ledger
        WHERE owner_type='expert' AND owner_id=_expert_id
          AND reason = 'Booking payout: ' || _booking_id::text) THEN
    INSERT INTO public.wallet_ledger(owner_type, owner_id, amount, type, reason, created_by)
    VALUES('expert', _expert_id, _payout, 'credit', 'Booking payout: ' || _booking_id::text, NULL);
    UPDATE public.experts SET wallet_balance = COALESCE(wallet_balance,0) + _payout WHERE id = _expert_id;
  END IF;

  PERFORM public.evaluate_reward_triggers('partner', _expert_id, 'booking_completed', _booking_id::text,
    jsonb_build_object('booking_id', _booking_id, 'amount', COALESCE(_b.price,0),
                       'minutes', COALESCE(_b.service_duration_minutes,0)));
  IF _b.user_id IS NOT NULL THEN
    PERFORM public.evaluate_reward_triggers('customer', _b.user_id, 'booking_completed', _booking_id::text,
      jsonb_build_object('booking_id', _booking_id, 'amount', COALESCE(_b.price,0)));
  END IF;

  PERFORM public.notify_expert_alert(
    _expert_id, 'order_completed', 'Job completed',
    'You completed the job. ₹' || _payout::text || ' has been credited to your wallet.',
    jsonb_build_object('booking_id', _booking_id, 'route', 'booking/' || _booking_id::text)
  );

  RETURN _payout;
END $function$;

CREATE OR REPLACE FUNCTION public.staff_verify_end_otp(_booking_id uuid, _otp text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _uid uuid := auth.uid();
  _role text;
  _staff_id uuid;
  _b record;
  _now timestamptz := now();
  _payout numeric;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  SELECT id, role INTO _staff_id, _role FROM public.staff_users
    WHERE auth_user_id = _uid AND status = 'active';
  IF _role IS NULL OR _role NOT IN ('super_admin','ops_manager') THEN RAISE EXCEPTION 'Forbidden'; END IF;
  IF _otp IS NULL OR btrim(_otp) = '' THEN RAISE EXCEPTION 'OTP required'; END IF;

  SELECT id, status, end_otp, deleted_at, assigned_expert_id, service_duration_minutes,
         snapshot_expert_payout
    INTO _b FROM public.bookings WHERE id = _booking_id FOR UPDATE;
  IF _b.id IS NULL THEN RAISE EXCEPTION 'Booking not found'; END IF;
  IF _b.deleted_at IS NOT NULL THEN RAISE EXCEPTION 'Booking has been deleted'; END IF;
  IF _b.status <> 'in_progress' THEN RAISE EXCEPTION 'Booking is not in progress'; END IF;
  IF _b.end_otp IS NULL OR btrim(_b.end_otp) = '' THEN RAISE EXCEPTION 'No end OTP set'; END IF;
  IF btrim(_otp) <> _b.end_otp THEN RAISE EXCEPTION 'Invalid end OTP'; END IF;

  PERFORM set_config('app.booking_bypass','on', true);
  UPDATE public.bookings
     SET status = 'completed', service_end_at = COALESCE(service_end_at, _now), updated_at = _now
   WHERE id = _booking_id;
  PERFORM set_config('app.booking_bypass','off', true);

  IF _b.assigned_expert_id IS NOT NULL THEN
    UPDATE public.experts SET is_busy = false WHERE id = _b.assigned_expert_id;

    BEGIN
      SELECT r.expert_payout INTO _payout FROM public.resolve_booking_payouts(_booking_id) r;
    EXCEPTION WHEN OTHERS THEN
      _payout := NULL;
    END;
    _payout := COALESCE(NULLIF(COALESCE(_payout,0),0), _b.snapshot_expert_payout, 0);

    IF _payout > 0 AND NOT EXISTS (
         SELECT 1 FROM public.wallet_ledger
          WHERE owner_type='expert' AND owner_id=_b.assigned_expert_id
            AND reason IN ('Booking payout: ' || _booking_id::text,
                           'Booking payout (staff-relayed): ' || _booking_id::text)) THEN
      INSERT INTO public.wallet_ledger(owner_type, owner_id, amount, type, reason, created_by)
      VALUES('expert', _b.assigned_expert_id, _payout, 'credit',
             'Booking payout (staff-relayed): ' || _booking_id::text, _staff_id);
      UPDATE public.experts SET wallet_balance = COALESCE(wallet_balance,0) + _payout
        WHERE id = _b.assigned_expert_id;
    END IF;
  END IF;

  INSERT INTO public.audit_logs (actor_id, action, target_table, target_id, before_state, after_state)
  VALUES (_uid, 'staff_relayed_end_otp', 'bookings', _booking_id,
    jsonb_build_object('status', _b.status),
    jsonb_build_object('status', 'completed', 'completed_at', _now,
      'note', 'OTP relayed by expert via phone/WhatsApp; verified by staff (interim flow).'));

  PERFORM public.notify_customer_push(
    _booking_id,
    'Service completed',
    'Your booking is complete! Please rate your experience.',
    'booking/' || _booking_id::text
  );
END;
$function$;