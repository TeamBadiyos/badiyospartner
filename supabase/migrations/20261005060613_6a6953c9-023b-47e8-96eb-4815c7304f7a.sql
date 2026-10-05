-- 1. Backfill the two missing extension payouts (₹80 each, 60 min × ₹80/hr)
INSERT INTO public.wallet_ledger(owner_type, owner_id, amount, type, reason, created_by)
VALUES
  ('expert', '66d0e60f-6130-4d2a-8a6c-376d04918af4', 80, 'credit', 'Extension payout (60 min): 7dca05cb-4b66-4e05-a866-bb9e4e089639', NULL),
  ('expert', '54bf4713-f769-4b10-9dcc-0b13f0ce6aba', 80, 'credit', 'Extension payout (60 min): cac8590d-2a03-4e91-b450-d6391b241dd6', NULL);

UPDATE public.experts
   SET wallet_balance = COALESCE(wallet_balance, 0) + 80
 WHERE id IN ('66d0e60f-6130-4d2a-8a6c-376d04918af4', '54bf4713-f769-4b10-9dcc-0b13f0ce6aba');

-- 2. Fix resolve_booking_payouts so paid extensions are included in the expert payout
CREATE OR REPLACE FUNCTION public.resolve_booking_payouts(_booking_id uuid)
 RETURNS TABLE(expert_payout numeric, area_partner_payout numeric)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _b record; _ep numeric; _ap numeric; _ext numeric;
BEGIN
  SELECT id, service_label, service_duration_minutes, service_category_id, price_option_id,
         snapshot_expert_payout, snapshot_partner_payout, snapshot_hourly_rate
    INTO _b FROM public.bookings WHERE id = _booking_id;
  IF _b.id IS NULL THEN
    RETURN QUERY SELECT 0::numeric, 0::numeric; RETURN;
  END IF;

  IF _b.price_option_id IS NOT NULL THEN
    SELECT NULLIF(COALESCE(spo.expert_payout,0),0), COALESCE(spo.partner_commission,0)
      INTO _ep, _ap
      FROM public.service_price_options spo
     WHERE spo.id = _b.price_option_id;
  END IF;

  IF _ep IS NULL THEN
    SELECT NULLIF(COALESCE(spo.expert_payout,0),0), COALESCE(spo.partner_commission,0)
      INTO _ep, _ap
      FROM public.service_price_options spo
      JOIN public.services s ON s.id = spo.service_id
     WHERE lower(spo.label) = lower(COALESCE(_b.service_label,''))
       AND (_b.service_category_id IS NULL OR s.category_id = _b.service_category_id)
       AND spo.is_active
     ORDER BY (s.category_id = _b.service_category_id) DESC, spo.display_order
     LIMIT 1;
  END IF;

  IF COALESCE(_ep,0) = 0 THEN
    _ep := NULLIF(COALESCE(_b.snapshot_expert_payout,0),0);
    _ap := COALESCE(NULLIF(COALESCE(_ap,0),0), _b.snapshot_partner_payout, 0);
  END IF;

  -- Add the expert's share of every paid (accepted) extension: extra minutes × hourly rate.
  SELECT COALESCE(SUM(round(be.extra_minutes / 60.0 * COALESCE(_b.snapshot_hourly_rate, 0))), 0)
    INTO _ext
    FROM public.booking_extensions be
   WHERE be.booking_id = _booking_id
     AND be.approval_status = 'accepted'
     AND be.razorpay_payment_id IS NOT NULL;
  _ep := COALESCE(_ep, 0) + _ext;

  RETURN QUERY SELECT COALESCE(_ep,0), COALESCE(_ap,0);
END
$function$;