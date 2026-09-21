INSERT INTO public.ops_settings (key, value, label)
VALUES ('courier_offer_timeout_seconds', '180', 'Courier offer timeout (seconds)')
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;