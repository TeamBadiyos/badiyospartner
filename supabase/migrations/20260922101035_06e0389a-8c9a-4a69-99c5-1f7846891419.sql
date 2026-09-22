CREATE OR REPLACE FUNCTION public.has_login_pin(p_phone text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _digits text := right(regexp_replace(coalesce(p_phone,''), '\D', '', 'g'), 10);
  _exists boolean := false;
BEGIN
  IF length(_digits) <> 10 THEN RETURN false; END IF;
  SELECT EXISTS(
    SELECT 1 FROM public.experts e
    WHERE e.status = 'active'
      AND e.pin_hash IS NOT NULL
      AND right(regexp_replace(coalesce(e.phone,''), '\D', '', 'g'), 10) = _digits
  ) OR EXISTS(
    SELECT 1 FROM public.users u
    WHERE right(regexp_replace(coalesce(u.phone,''), '\D', '', 'g'), 10) = _digits
      AND u.pin_hash IS NOT NULL
  ) INTO _exists;
  RETURN _exists;
END;
$function$;

CREATE OR REPLACE FUNCTION public.verify_login_pin_internal(p_phone text, p_pin text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_expert  public.experts%ROWTYPE;
  v_lock    public.pin_login_lockouts%ROWTYPE;
  v_now     timestamptz := now();
  v_max     int := 5;
  v_window  interval := interval '15 minutes';
  v_review  boolean := right(regexp_replace(coalesce(p_phone,''), '\D', '', 'g'), 10) = '9999900000';
BEGIN
  SELECT * INTO v_expert FROM public.experts
   WHERE status='active'
     AND (phone=p_phone OR phone='+91'||p_phone OR phone='91'||p_phone)
   LIMIT 1;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'NOT_REGISTERED');
  END IF;
  IF v_expert.pin_hash IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'NO_PIN');
  END IF;

  IF NOT v_review THEN
    SELECT * INTO v_lock FROM public.pin_login_lockouts WHERE phone=p_phone;
    IF FOUND AND v_lock.locked_until IS NOT NULL AND v_lock.locked_until > v_now THEN
      RETURN jsonb_build_object(
        'ok', false, 'error', 'LOCKED',
        'retry_after_seconds', EXTRACT(EPOCH FROM (v_lock.locked_until - v_now))::int
      );
    END IF;
  END IF;

  IF crypt(p_pin, v_expert.pin_hash) = v_expert.pin_hash THEN
    DELETE FROM public.pin_login_lockouts WHERE phone=p_phone;
    RETURN jsonb_build_object(
      'ok', true,
      'expert_id', v_expert.id,
      'auth_user_id', v_expert.auth_user_id
    );
  END IF;

  IF v_review THEN
    RETURN jsonb_build_object('ok', false, 'error', 'BAD_PIN', 'attempts_left', v_max);
  END IF;

  INSERT INTO public.pin_login_lockouts(phone, failed_attempts, locked_until, updated_at)
  VALUES (p_phone, 1, NULL, v_now)
  ON CONFLICT (phone) DO UPDATE
     SET failed_attempts = public.pin_login_lockouts.failed_attempts + 1,
         updated_at = v_now,
         locked_until = CASE
           WHEN public.pin_login_lockouts.failed_attempts + 1 >= v_max
             THEN v_now + v_window
           ELSE NULL
         END
  RETURNING * INTO v_lock;

  IF v_lock.locked_until IS NOT NULL AND v_lock.locked_until > v_now THEN
    RETURN jsonb_build_object('ok', false, 'error', 'LOCKED',
      'retry_after_seconds', EXTRACT(EPOCH FROM (v_lock.locked_until - v_now))::int);
  END IF;
  RETURN jsonb_build_object('ok', false, 'error', 'BAD_PIN',
    'attempts_left', v_max - v_lock.failed_attempts);
END;
$function$;

REVOKE ALL ON FUNCTION public.verify_login_pin_internal(text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.has_login_pin(text) FROM PUBLIC, anon, authenticated;