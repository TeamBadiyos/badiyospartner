CREATE OR REPLACE FUNCTION public.send_daily_go_live_reminder()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','extensions' AS $$
DECLARE _secret text; r record; _n int := 0;
BEGIN
  SELECT value INTO _secret FROM public.edge_runtime_config WHERE key='push_trigger_secret';
  IF coalesce(_secret,'')='' THEN RETURN 0; END IF;
  FOR r IN
    SELECT DISTINCT dt.user_id
      FROM public.experts e
      JOIN public.device_tokens dt ON dt.user_type='expert' AND dt.user_id IN (e.id, e.auth_user_id)
     WHERE e.status='active' AND coalesce(e.is_online,false)=false
  LOOP
    PERFORM net.http_post(
      url := 'https://dkneclwmmjlqswovtqno.supabase.co/functions/v1/send-push-notification',
      headers := jsonb_build_object('content-type','application/json','x-internal-secret',_secret),
      body := jsonb_build_object('user_type','expert','user_id',r.user_id,'data_only',true,
        'alert_type','reminder_30min',
        'data', jsonb_build_object('alert_type','reminder_30min','type','go_live_reminder',
          'title','कामाची वेळ झाली — ऑनलाइन या',
          'body','सुप्रभात! आजच्या ऑर्डर्स मिळवण्यासाठी ॲप उघडा आणि ऑनलाइन व्हा.',
          'timeout_seconds','15','route','/home')));
    _n := _n + 1;
  END LOOP;
  RETURN _n;
END $$;
REVOKE ALL ON FUNCTION public.send_daily_go_live_reminder() FROM PUBLIC, anon, authenticated;
SELECT cron.schedule('daily-go-live-reminder', '30 3 * * *', 'SELECT public.send_daily_go_live_reminder();');