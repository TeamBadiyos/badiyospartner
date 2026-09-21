DROP POLICY IF EXISTS "Online experts can view nearby broadcast bookings" ON public.bookings;

CREATE POLICY "Online experts can view nearby broadcast bookings"
ON public.bookings
FOR SELECT
USING (
  assigned_expert_id IS NULL
  AND status = 'accepted'
  AND EXISTS (
    SELECT 1
    FROM public.experts e
    WHERE e.auth_user_id = auth.uid()
      AND e.is_online = true
      AND e.status = 'active'
      AND (
        (
          e.current_lat IS NOT NULL AND e.current_lng IS NOT NULL
          AND bookings.booking_lat IS NOT NULL AND bookings.booking_lng IS NOT NULL
          AND e.location_updated_at > (now() - interval '30 minutes')
          AND public.haversine_km(e.current_lat, e.current_lng, bookings.booking_lat, bookings.booking_lng)
              <= COALESCE(public.get_broadcast_radius_km(), 10::numeric)
        )
        OR (e.zone_id IS NOT NULL AND bookings.zone_id IS NOT NULL AND e.zone_id = bookings.zone_id)
      )
      AND (
        bookings.service_category_id IS NULL
        OR EXISTS (
          SELECT 1 FROM public.partner_skills ps
          WHERE ps.expert_id = e.id
            AND ps.status = 'approved'
            AND ps.service_category_id = bookings.service_category_id
        )
      )
  )
);