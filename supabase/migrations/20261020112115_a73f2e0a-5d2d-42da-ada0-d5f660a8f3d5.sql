ALTER TABLE public.device_tokens
  ADD COLUMN IF NOT EXISTS app_version text,
  ADD COLUMN IF NOT EXISTS version_code integer;

ALTER TABLE public.experts
  ADD COLUMN IF NOT EXISTS app_version text,
  ADD COLUMN IF NOT EXISTS app_version_code integer,
  ADD COLUMN IF NOT EXISTS app_version_updated_at timestamptz;

DROP FUNCTION IF EXISTS public.register_device_token(text, text);

CREATE OR REPLACE FUNCTION public.register_device_token(
  p_fcm_token text, p_platform text,
  p_app_version text DEFAULT NULL, p_version_code integer DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  _uid uuid := auth.uid();
  _type text; _id uuid; _row_id uuid;
  _ver text := NULLIF(left(btrim(COALESCE(p_app_version,'')), 40), '');
  _code integer := CASE WHEN p_version_code BETWEEN 1 AND 100000000 THEN p_version_code END;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF p_fcm_token IS NULL OR btrim(p_fcm_token) = '' THEN RAISE EXCEPTION 'Token required'; END IF;
  IF p_platform NOT IN ('android','web','ios') THEN RAISE EXCEPTION 'Invalid platform'; END IF;

  SELECT r.user_type, r.user_id INTO _type, _id FROM public.resolve_caller_identity(_uid) r LIMIT 1;
  IF _type IS NULL THEN RAISE EXCEPTION 'No profile found for user'; END IF;

  INSERT INTO public.device_tokens (user_type, user_id, fcm_token, platform, app_version, version_code, last_used_at, updated_at)
  VALUES (_type, _id, btrim(p_fcm_token), p_platform, _ver, _code, now(), now())
  ON CONFLICT (fcm_token) DO UPDATE
    SET user_type = EXCLUDED.user_type, user_id = EXCLUDED.user_id, platform = EXCLUDED.platform,
        app_version = COALESCE(EXCLUDED.app_version, device_tokens.app_version),
        version_code = COALESCE(EXCLUDED.version_code, device_tokens.version_code),
        last_used_at = now(), updated_at = now()
  RETURNING id INTO _row_id;

  IF _type = 'expert' AND _code IS NOT NULL THEN
    UPDATE public.experts
       SET app_version = _ver, app_version_code = _code, app_version_updated_at = now()
     WHERE id = _id OR auth_user_id = _uid;
  END IF;

  RETURN _row_id;
END $function$;

REVOKE ALL ON FUNCTION public.register_device_token(text, text, text, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.register_device_token(text, text, text, integer) TO authenticated;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='cc_reader') THEN
    GRANT EXECUTE ON FUNCTION public.register_device_token(text, text, text, integer) TO cc_reader;
  END IF;
END $$;

-- Command Center: count experts on an old app (no build number yet, or below the native-ring build).
CREATE OR REPLACE FUNCTION public.staff_expert_app_version_summary(_min_code integer DEFAULT 6)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.staff_users s WHERE s.auth_user_id = auth.uid() OR s.id = auth.uid()) THEN
    RAISE EXCEPTION 'Not allowed';
  END IF;
  RETURN (SELECT jsonb_build_object(
    'min_version_code', _min_code,
    'total', count(*),
    'on_new_app', count(*) FILTER (WHERE app_version_code >= _min_code),
    'on_old_app', count(*) FILTER (WHERE app_version_code IS NULL OR app_version_code < _min_code))
    FROM public.experts WHERE status = 'active');
END $$;
REVOKE ALL ON FUNCTION public.staff_expert_app_version_summary(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.staff_expert_app_version_summary(integer) TO authenticated;