CREATE OR REPLACE FUNCTION public.expert_rewards_overview()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _expert_id uuid;
  _ledger jsonb;
  _total numeric := 0;
  _programs jsonb;
BEGIN
  SELECT e.id INTO _expert_id FROM public.experts e WHERE e.auth_user_id = auth.uid();
  IF _expert_id IS NULL THEN
    RETURN jsonb_build_object('ledger', '[]'::jsonb, 'total_earned', 0, 'programs', '[]'::jsonb);
  END IF;

  SELECT COALESCE(jsonb_agg(x ORDER BY x->>'credited_at' DESC), '[]'::jsonb)
    INTO _ledger
  FROM (
    SELECT jsonb_build_object(
             'id', l.id,
             'program_name', p.name,
             'trigger_type', p.trigger_type,
             'reward_type', l.reward_type,
             'reward_value', l.reward_value,
             'status', l.status,
             'notes', l.notes,
             'credited_at', l.credited_at,
             'reversed_at', l.reversed_at,
             'reversal_reason', l.reversal_reason
           ) AS x
      FROM public.reward_ledger l
      LEFT JOIN public.reward_programs p ON p.id = l.program_id
     WHERE l.actor_type = 'partner' AND l.actor_id = _expert_id
     ORDER BY l.credited_at DESC
     LIMIT 100
  ) s;

  SELECT COALESCE(SUM(l.reward_value), 0) INTO _total
    FROM public.reward_ledger l
   WHERE l.actor_type = 'partner' AND l.actor_id = _expert_id
     AND l.status = 'credited' AND l.reward_type IN ('cash', 'coins', 'bonus');

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'id', p.id,
           'name', p.name,
           'trigger_type', p.trigger_type,
           'trigger_label', tt.label,
           'reward_type', p.reward_type,
           'reward_value', p.reward_value,
           'is_time_based', tt.is_time_based,
           'period', COALESCE(p.condition->>'period', 'weekly'),
           'target', CASE
                       WHEN p.trigger_type = 'hours_threshold' THEN (p.condition->>'hours')::numeric
                       WHEN p.trigger_type = 'count_threshold' THEN (p.condition->>'count')::numeric
                       ELSE NULL END,
           'progress', CASE
                         WHEN p.trigger_type IN ('hours_threshold','count_threshold') THEN (
                           SELECT CASE WHEN p.trigger_type = 'hours_threshold'
                                       THEN COALESCE(SUM(COALESCE(b.service_duration_minutes,0)),0)::numeric / 60.0
                                       ELSE COUNT(*)::numeric END
                             FROM public.bookings b
                            WHERE b.status = 'completed'
                              AND b.assigned_expert_id = _expert_id
                              AND b.service_end_at >= (CASE WHEN COALESCE(p.condition->>'period','weekly') = 'monthly'
                                                            THEN date_trunc('month', now()) ELSE date_trunc('week', now()) END)
                              AND b.service_end_at < (CASE WHEN COALESCE(p.condition->>'period','weekly') = 'monthly'
                                                           THEN date_trunc('month', now()) + interval '1 month'
                                                           ELSE date_trunc('week', now()) + interval '7 days' END)
                         )
                         ELSE NULL END,
           'valid_until', p.valid_until
         ) ORDER BY tt.is_time_based DESC, p.created_at DESC), '[]'::jsonb)
    INTO _programs
    FROM public.reward_programs p
    JOIN public.reward_trigger_types tt ON tt.key = p.trigger_type
   WHERE p.is_active = true
     AND p.actor_type = 'partner'
     AND (p.valid_from IS NULL OR p.valid_from <= now())
     AND (p.valid_until IS NULL OR p.valid_until >= now());

  RETURN jsonb_build_object('ledger', _ledger, 'total_earned', _total, 'programs', _programs);
END;
$$;

REVOKE ALL ON FUNCTION public.expert_rewards_overview() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.expert_rewards_overview() TO authenticated;