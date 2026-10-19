CREATE OR REPLACE FUNCTION public.booking_travel_payout(_booking_id uuid)
 RETURNS numeric LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT COALESCE((SELECT round(b.travel_fee * COALESCE(z.expert_share_pct, 100) / 100.0, 2)
    FROM public.bookings b LEFT JOIN public.zones z ON z.id = b.zone_id
   WHERE b.id=_booking_id AND b.status='completed' AND COALESCE(b.travel_fee,0) > 0),0) $function$;

CREATE OR REPLACE FUNCTION public.resolve_booking_payouts(_booking_id uuid)
 RETURNS TABLE(expert_payout numeric, area_partner_payout numeric)
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE _b record; _ep numeric; _ext numeric; _adj numeric;
BEGIN
  SELECT id, service_label, service_duration_minutes, service_category_id, price_option_id,
         snapshot_expert_payout, snapshot_hourly_rate
    INTO _b FROM public.bookings WHERE id = _booking_id;
  IF _b.id IS NULL THEN RETURN QUERY SELECT 0::numeric, 0::numeric; RETURN; END IF;
  IF _b.price_option_id IS NOT NULL THEN
    SELECT NULLIF(COALESCE((public.city_opt(spo.id,(SELECT bk.city_id FROM public.bookings bk WHERE bk.id=_booking_id))).expert_payout,0),0) INTO _ep FROM public.service_price_options spo WHERE spo.id = _b.price_option_id;
  END IF;
  IF _ep IS NULL THEN
    SELECT NULLIF(COALESCE((public.city_opt(spo.id,(SELECT bk.city_id FROM public.bookings bk WHERE bk.id=_booking_id))).expert_payout,0),0) INTO _ep
      FROM public.service_price_options spo JOIN public.services s ON s.id = spo.service_id
     WHERE lower(spo.label) = lower(COALESCE(_b.service_label,''))
       AND (_b.service_category_id IS NULL OR s.category_id = _b.service_category_id)
       AND spo.is_active
     ORDER BY (s.category_id = _b.service_category_id) DESC, spo.display_order LIMIT 1;
  END IF;
  IF COALESCE(_ep,0) = 0 THEN _ep := NULLIF(COALESCE(_b.snapshot_expert_payout,0),0); END IF;
  SELECT COALESCE(SUM(round(be.extra_minutes / 60.0 * COALESCE(_b.snapshot_hourly_rate, 0))), 0) INTO _ext
    FROM public.booking_extensions be
   WHERE be.booking_id = _booking_id AND be.approval_status = 'accepted' AND be.razorpay_payment_id IS NOT NULL;
  SELECT COALESCE(SUM(a.expert_pay_delta),0) INTO _adj FROM public.booking_time_adjustments a WHERE a.booking_id = _booking_id;
  -- Travel is credited as its own ledger entry ('Travel fee: <id>'), never inside the service payout.
  _ep := GREATEST(COALESCE(_ep, 0) + _ext + _adj, 0);
  RETURN QUERY SELECT COALESCE(_ep,0), 0::numeric;
END $function$;

CREATE UNIQUE INDEX IF NOT EXISTS wallet_ledger_travel_credit_uidx
  ON public.wallet_ledger (reason) WHERE owner_type='expert' AND type='credit' AND reason LIKE 'Travel fee: %';
CREATE UNIQUE INDEX IF NOT EXISTS wallet_ledger_travel_reversal_uidx
  ON public.wallet_ledger (reason) WHERE owner_type='expert' AND type='debit' AND reason LIKE 'Travel fee refund: %';

CREATE OR REPLACE FUNCTION public.credit_booking_completion(_booking_id uuid)
 RETURNS numeric LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE _b record; _payout numeric; _travel numeric; _reason text; _handover numeric; _ins int;
BEGIN
  SELECT id, assigned_expert_id, status, user_id, price, service_duration_minutes, snapshot_expert_payout
    INTO _b FROM public.bookings WHERE id = _booking_id;
  IF _b.id IS NULL OR _b.status <> 'completed' THEN RETURN 0; END IF;
  IF _b.assigned_expert_id IS NULL THEN RETURN 0; END IF;
  IF EXISTS (SELECT 1 FROM public.bookings WHERE id = _booking_id AND is_training) THEN
    UPDATE public.experts SET is_busy = false, training_orders_completed = COALESCE(training_orders_completed, 0) + 1
     WHERE id = _b.assigned_expert_id;
    BEGIN
      PERFORM public.notify_expert_alert(_b.assigned_expert_id, 'order_completed', 'Training job completed',
        'Well done! Your training job is complete.',
        jsonb_build_object('booking_id', _booking_id, 'route', 'booking/' || _booking_id::text, 'is_training', true));
    EXCEPTION WHEN OTHERS THEN NULL; END;
    RETURN 0;
  END IF;

  _payout := public.booking_total_expert_payout(_booking_id);
  SELECT COALESCE(SUM(previous_expert_payout),0) INTO _handover FROM public.booking_expert_handovers WHERE booking_id=_booking_id;
  _payout := GREATEST(_payout - _handover, 0);
  _travel := public.booking_travel_payout(_booking_id);

  UPDATE public.experts SET is_busy = false WHERE id = _b.assigned_expert_id;

  -- Travel: exactly one credit per booking (unique key = 'Travel fee: <booking_id>')
  IF _travel > 0 THEN
    INSERT INTO public.wallet_ledger(owner_type, owner_id, amount, type, reason, created_by)
    VALUES('expert', _b.assigned_expert_id, _travel, 'credit', 'Travel fee: ' || _booking_id::text, NULL)
    ON CONFLICT DO NOTHING;
    GET DIAGNOSTICS _ins = ROW_COUNT;
    IF _ins > 0 THEN
      UPDATE public.experts SET wallet_balance = COALESCE(wallet_balance,0) + _travel WHERE id = _b.assigned_expert_id;
    END IF;
  END IF;

  _reason := 'Booking payout: ' || _booking_id::text;
  IF _payout > 0 AND NOT EXISTS (
      SELECT 1 FROM public.wallet_ledger WHERE owner_type = 'expert' AND reason = _reason) THEN
    INSERT INTO public.wallet_ledger(owner_type, owner_id, amount, type, reason, created_by)
    VALUES('expert', _b.assigned_expert_id, _payout, 'credit', _reason, NULL);
    UPDATE public.experts SET wallet_balance = COALESCE(wallet_balance,0) + _payout WHERE id = _b.assigned_expert_id;
    BEGIN
      PERFORM public.evaluate_reward_triggers('partner', _b.assigned_expert_id, 'booking_completed', _booking_id::text,
        jsonb_build_object('booking_id', _booking_id, 'amount', COALESCE(_b.price,0), 'minutes', COALESCE(_b.service_duration_minutes,0)));
    EXCEPTION WHEN OTHERS THEN NULL; END;
    IF _b.user_id IS NOT NULL THEN
      BEGIN
        PERFORM public.evaluate_reward_triggers('customer', _b.user_id, 'booking_completed', _booking_id::text,
          jsonb_build_object('booking_id', _booking_id, 'amount', COALESCE(_b.price,0)));
      EXCEPTION WHEN OTHERS THEN NULL; END;
    END IF;
    BEGIN
      PERFORM public.notify_expert_alert(_b.assigned_expert_id, 'order_completed', 'Job completed',
        'You completed the job. Rs ' || (_payout + _travel)::text || ' has been credited to your wallet.',
        jsonb_build_object('booking_id', _booking_id, 'route', 'booking/' || _booking_id::text));
    EXCEPTION WHEN OTHERS THEN NULL; END;
  END IF;
  RETURN _payout + _travel;
END;
$function$;

CREATE OR REPLACE FUNCTION public.expert_verify_end_otp(_booking_id uuid, _otp text)
 RETURNS numeric LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE _expert_id uuid; _b record;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  _expert_id := public.get_expert_id_for_auth(auth.uid());
  IF _expert_id IS NULL THEN RAISE EXCEPTION 'Not an expert'; END IF;
  IF _otp IS NULL OR btrim(_otp) = '' THEN RAISE EXCEPTION 'OTP required'; END IF;

  SELECT id, assigned_expert_id, status, end_otp INTO _b FROM public.bookings WHERE id = _booking_id FOR UPDATE;
  IF _b.id IS NULL THEN RAISE EXCEPTION 'Booking not found'; END IF;
  IF _b.assigned_expert_id <> _expert_id THEN RAISE EXCEPTION 'Not your booking'; END IF;

  IF _b.status <> 'completed' THEN
    IF _b.status <> 'in_progress' THEN RAISE EXCEPTION 'Booking not in progress'; END IF;
    IF _b.end_otp IS NULL OR btrim(_otp) <> _b.end_otp THEN RAISE EXCEPTION 'Invalid end OTP'; END IF;
    -- 1) Mark completed first ...
    PERFORM set_config('app.booking_bypass','on', true);
    UPDATE public.bookings
       SET status = 'completed', service_end_at = COALESCE(service_end_at, now()), updated_at = now()
     WHERE id = _booking_id;
    PERFORM set_config('app.booking_bypass','off', true);
  END IF;
  -- 2) ... then, in the same transaction, compute + credit (service + travel). Idempotent.
  RETURN public.credit_booking_completion(_booking_id);
END $function$;

CREATE OR REPLACE FUNCTION public.staff_payout_batch_travel(_batch_id uuid)
 RETURNS TABLE(owner_id uuid, travel numeric)
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE _b payout_batches; _has_ids boolean;
BEGIN
  IF NOT public.is_active_staff(auth.uid(), ARRAY['super_admin','ops_manager']) THEN RAISE EXCEPTION 'Forbidden'; END IF;
  SELECT * INTO _b FROM payout_batches WHERE id=_batch_id;
  SELECT EXISTS (SELECT 1 FROM payout_batch_items i WHERE i.batch_id=_batch_id AND cardinality(i.booking_ids)>0) INTO _has_ids;
  IF _has_ids THEN
    RETURN QUERY SELECT i.owner_id, SUM(CASE WHEN l.type='credit' THEN l.amount ELSE -l.amount END)
      FROM payout_batch_items i
      JOIN LATERAL unnest(i.booking_ids) AS bid ON true
      JOIN wallet_ledger l ON l.owner_type='expert' AND l.owner_id=i.owner_id
       AND l.reason IN ('Travel fee: ' || bid::text, 'Travel fee refund: ' || bid::text)
     WHERE i.batch_id=_batch_id GROUP BY i.owner_id;
  ELSE
    RETURN QUERY SELECT l.owner_id, SUM(CASE WHEN l.type='credit' THEN l.amount ELSE -l.amount END)
      FROM wallet_ledger l
     WHERE l.owner_type='expert' AND (l.reason LIKE 'Travel fee: %' OR l.reason LIKE 'Travel fee refund: %')
       AND l.created_at >= (_b.week_start::timestamp AT TIME ZONE 'Asia/Kolkata')
       AND l.created_at <  ((_b.week_end+1)::timestamp AT TIME ZONE 'Asia/Kolkata')
     GROUP BY l.owner_id;
  END IF;
END $function$;

-- Generate Payout (booking mode): add travel from the ledger entry, never from bookings.travel_fee
CREATE OR REPLACE FUNCTION public.staff_generate_payout_batch()
 RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  _uid uuid := auth.uid();
  _batch_id uuid; _ws date; _we date; _total numeric := 0;
  _wallet_mode boolean := public.get_ops_flag('payout_batch_wallet_mode');
  _new_engine boolean := public.get_ops_flag('use_new_commission_engine');
  _it record; _t record;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF NOT public.is_active_staff(_uid, ARRAY['super_admin','ops_manager','finance']) THEN RAISE EXCEPTION 'Forbidden'; END IF;
  _ws := date_trunc('week', now() AT TIME ZONE 'Asia/Kolkata')::date;
  _we := (_ws + INTERVAL '6 days')::date;
  IF EXISTS (SELECT 1 FROM public.payout_batches WHERE week_start=_ws AND batch_type='expert' AND status <> 'discarded') THEN
    RAISE EXCEPTION 'Batch already exists for this week';
  END IF;
  INSERT INTO public.payout_batches(week_start, week_end, status, total_amount, batch_type)
    VALUES(_ws, _we, 'pending', 0, 'expert') RETURNING id INTO _batch_id;
  IF _wallet_mode THEN
    INSERT INTO public.payout_batch_items(batch_id, owner_type, owner_id, amount, gross_amount, booking_ids)
      SELECT _batch_id, 'expert', e.id, e.wallet_balance, e.wallet_balance, ARRAY[]::uuid[]
        FROM public.experts e WHERE COALESCE(e.wallet_balance,0) > 0;
  ELSE
    WITH cand AS (
      SELECT b.id AS booking_id, b.assigned_expert_id AS owner_id,
             CASE WHEN _new_engine THEN COALESCE(b.snapshot_expert_payout,0)
                  ELSE (SELECT r.expert_payout FROM public.resolve_booking_payouts(b.id) r) END
             + COALESCE((SELECT SUM(CASE WHEN l.type='credit' THEN l.amount ELSE -l.amount END)
                  FROM public.wallet_ledger l
                 WHERE l.owner_type='expert' AND l.owner_id=b.assigned_expert_id
                   AND l.reason IN ('Travel fee: ' || b.id::text, 'Travel fee refund: ' || b.id::text)),0) AS payout
        FROM public.bookings b
       WHERE NOT b.is_training AND b.status='completed' AND b.assigned_expert_id IS NOT NULL
         AND b.expert_payout_batch_id IS NULL
         AND (b.updated_at AT TIME ZONE 'Asia/Kolkata')::date BETWEEN _ws AND _we
    ), agg AS (
      SELECT owner_id, SUM(payout) AS amount, array_agg(booking_id) AS booking_ids
        FROM cand WHERE payout > 0 GROUP BY owner_id
    )
    INSERT INTO public.payout_batch_items(batch_id, owner_type, owner_id, amount, gross_amount, booking_ids)
      SELECT _batch_id, 'expert', owner_id, amount, amount, booking_ids FROM agg;
    UPDATE public.bookings b SET expert_payout_batch_id = _batch_id
      FROM public.payout_batch_items i
     WHERE i.batch_id=_batch_id AND i.owner_type='expert' AND b.id = ANY(i.booking_ids);
  END IF;
  FOR _it IN SELECT * FROM public.payout_batch_items WHERE batch_id=_batch_id LOOP
    SELECT * INTO _t FROM public.compute_tds(_it.owner_type, _it.owner_id, _it.gross_amount);
    UPDATE public.payout_batch_items
       SET tds_rate = COALESCE(_t.rate,0), tds_amount = COALESCE(_t.amount,0),
           net_amount = round(_it.gross_amount) - COALESCE(_t.amount,0),
           tds_status = CASE WHEN COALESCE(_t.amount,0) > 0 THEN 'accrued' ELSE 'none' END,
           pan_last4 = _t.pan_last4
     WHERE id = _it.id;
  END LOOP;
  SELECT COALESCE(SUM(amount),0) INTO _total FROM public.payout_batch_items WHERE batch_id=_batch_id;
  UPDATE public.payout_batches SET total_amount=_total WHERE id=_batch_id;
  INSERT INTO public.audit_logs(actor_id, action, target_table, target_id, before_state, after_state)
  VALUES(_uid,'generate_payout_batch','payout_batches',_batch_id,NULL,
         jsonb_build_object('week_start',_ws,'week_end',_we,'total_amount',_total,
                            'batch_type','expert','wallet_mode',_wallet_mode,'new_engine',_new_engine));
  RETURN _batch_id;
END $function$;

-- Refund after completion: reverse travel credit once
CREATE OR REPLACE FUNCTION public.bookings_travel_refund_reversal()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE _c record; _ins int;
BEGIN
  IF NEW.refund_status IN ('refunded','done')
     AND COALESCE(OLD.refund_status,'') NOT IN ('refunded','done')
     AND (OLD.status = 'completed' OR NEW.status = 'completed') THEN
    SELECT owner_id, amount INTO _c FROM public.wallet_ledger
     WHERE owner_type='expert' AND type='credit' AND reason = 'Travel fee: ' || NEW.id::text LIMIT 1;
    IF _c.owner_id IS NOT NULL AND _c.amount > 0 THEN
      INSERT INTO public.wallet_ledger(owner_type, owner_id, amount, type, reason, created_by)
      VALUES('expert', _c.owner_id, _c.amount, 'debit', 'Travel fee refund: ' || NEW.id::text, NULL)
      ON CONFLICT DO NOTHING;
      GET DIAGNOSTICS _ins = ROW_COUNT;
      IF _ins > 0 THEN
        UPDATE public.experts SET wallet_balance = COALESCE(wallet_balance,0) - _c.amount WHERE id = _c.owner_id;
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END $function$;

REVOKE ALL ON FUNCTION public.bookings_travel_refund_reversal() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_bookings_travel_refund_reversal ON public.bookings;
CREATE TRIGGER trg_bookings_travel_refund_reversal AFTER UPDATE OF refund_status ON public.bookings
  FOR EACH ROW EXECUTE FUNCTION public.bookings_travel_refund_reversal();