ALTER TABLE public.courier_offers REPLICA IDENTITY FULL;
ALTER TABLE public.courier_orders REPLICA IDENTITY FULL;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='courier_offers') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.courier_offers;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='courier_orders') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.courier_orders;
  END IF;
END $$;