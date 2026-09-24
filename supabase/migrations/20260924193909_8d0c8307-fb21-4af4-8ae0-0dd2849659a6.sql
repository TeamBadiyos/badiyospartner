CREATE OR REPLACE FUNCTION public.expert_get_booking_customer(_booking_id uuid)
RETURNS TABLE(full_name text, phone text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT u.full_name::text, u.phone::text
  FROM public.bookings b
  JOIN public.experts e ON e.id = b.assigned_expert_id
  JOIN public.users u ON u.id = b.user_id
  WHERE b.id = _booking_id
    AND (e.auth_user_id = auth.uid() OR e.id = auth.uid())
$$;
REVOKE ALL ON FUNCTION public.expert_get_booking_customer(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.expert_get_booking_customer(uuid) TO authenticated;