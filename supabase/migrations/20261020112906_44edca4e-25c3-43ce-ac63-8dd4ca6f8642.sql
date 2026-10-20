ALTER TABLE public.app_config
  ADD COLUMN IF NOT EXISTS expert_min_version_code integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS expert_latest_version text,
  ADD COLUMN IF NOT EXISTS expert_play_store_url text NOT NULL DEFAULT 'https://play.google.com/store/apps/details?id=com.badiyos.expert';