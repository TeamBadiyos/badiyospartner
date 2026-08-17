ALTER PUBLICATION supabase_realtime DROP TABLE public.experts;
ALTER TABLE public.experts REPLICA IDENTITY FULL;
ALTER PUBLICATION supabase_realtime ADD TABLE public.experts;