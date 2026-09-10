-- 1. Support ticket resolution: map auth user -> expert record before pushing
CREATE OR REPLACE FUNCTION public.notify_support_ticket_resolved()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  _summary text;
  _expert_id uuid;
BEGIN
  IF NEW.status = 'resolved'
     AND (OLD.status IS DISTINCT FROM 'resolved')
     AND NEW.user_id IS NOT NULL THEN

    _summary := COALESCE(NULLIF(btrim(NEW.resolution_summary), ''), 'Your support request has been resolved.');

    SELECT e.id INTO _expert_id FROM public.experts e WHERE e.auth_user_id = NEW.user_id LIMIT 1;

    IF _expert_id IS NOT NULL THEN
      PERFORM public.notify_push_event(
        'expert', _expert_id, 'support_resolved',
        'Support ticket resolved', _summary,
        jsonb_build_object('ticket_id', NEW.id, 'route', 'support')
      );
    ELSE
      PERFORM public.notify_push_event(
        'customer', NEW.user_id, 'support_resolved',
        'Support ticket resolved', _summary,
        jsonb_build_object('ticket_id', NEW.id)
      );
    END IF;
  END IF;
  RETURN NEW;
END $function$;

-- 2. Wallet credit -> payout notification (tips handled separately)
CREATE OR REPLACE FUNCTION public.notify_expert_wallet_credit()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
BEGIN
  IF NEW.owner_type = 'expert'
     AND NEW.type = 'credit'
     AND COALESCE(NEW.amount,0) > 0
     AND COALESCE(NEW.reason,'') <> 'Customer tip' THEN
    BEGIN
      PERFORM public.notify_expert_alert(
        NEW.owner_id, 'payout_credited',
        'Payment credited',
        '₹' || trim(to_char(NEW.amount, 'FM999999990.00')) || ' has been added to your wallet.',
        jsonb_build_object('route', 'wallet')
      );
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING '[notify_expert_wallet_credit] %', SQLERRM;
    END;
  END IF;
  RETURN NEW;
END $function$;

DROP TRIGGER IF EXISTS trg_notify_expert_wallet_credit ON public.wallet_ledger;
CREATE TRIGGER trg_notify_expert_wallet_credit
AFTER INSERT ON public.wallet_ledger
FOR EACH ROW EXECUTE FUNCTION public.notify_expert_wallet_credit();

-- 3. Tip received
CREATE OR REPLACE FUNCTION public.notify_expert_tip_received()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
BEGIN
  IF NEW.expert_id IS NOT NULL AND COALESCE(NEW.status,'') = 'paid' THEN
    BEGIN
      PERFORM public.notify_expert_alert(
        NEW.expert_id, 'tip_received',
        'You received a tip',
        'A customer tipped you ₹' || trim(to_char(NEW.amount, 'FM999999990.00')) || '. Thank you!',
        jsonb_build_object('route', 'wallet')
      );
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING '[notify_expert_tip_received] %', SQLERRM;
    END;
  END IF;
  RETURN NEW;
END $function$;

DROP TRIGGER IF EXISTS trg_notify_expert_tip_received ON public.booking_tips;
CREATE TRIGGER trg_notify_expert_tip_received
AFTER INSERT ON public.booking_tips
FOR EACH ROW EXECUTE FUNCTION public.notify_expert_tip_received();

-- 4. Reward credited
CREATE OR REPLACE FUNCTION public.notify_expert_reward_credited()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE _name text; _body text;
BEGIN
  IF NEW.actor_type = 'expert' AND COALESCE(NEW.status,'') = 'credited' THEN
    SELECT name INTO _name FROM public.reward_programs WHERE id = NEW.program_id;
    IF NEW.reward_type IN ('cash','coins') AND COALESCE(NEW.reward_value,0) > 0 THEN
      _body := '₹' || trim(to_char(NEW.reward_value, 'FM999999990.00')) || ' bonus credited'
               || COALESCE(' for ' || _name, '') || '.';
    ELSE
      _body := COALESCE(_name, 'A reward') || ' has been credited to your account.';
    END IF;
    BEGIN
      PERFORM public.notify_expert_alert(
        NEW.actor_id, 'reward_credited', 'Reward earned', _body,
        jsonb_build_object('route', 'rewards')
      );
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING '[notify_expert_reward_credited] %', SQLERRM;
    END;
  END IF;
  RETURN NEW;
END $function$;

DROP TRIGGER IF EXISTS trg_notify_expert_reward_credited ON public.reward_ledger;
CREATE TRIGGER trg_notify_expert_reward_credited
AFTER INSERT ON public.reward_ledger
FOR EACH ROW EXECUTE FUNCTION public.notify_expert_reward_credited();

-- 5. Skill request decision
CREATE OR REPLACE FUNCTION public.notify_expert_skill_decision()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE _cat text; _title text; _body text;
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status AND NEW.status IN ('approved','rejected') THEN
    SELECT name INTO _cat FROM public.service_categories WHERE id = NEW.service_category_id;
    IF NEW.status = 'approved' THEN
      _title := 'Skill approved';
      _body  := COALESCE(_cat, 'Your requested skill') || ' is now active. You can receive these jobs.';
    ELSE
      _title := 'Skill request declined';
      _body  := 'Your request for ' || COALESCE(_cat, 'a new skill') || ' was not approved.';
    END IF;
    BEGIN
      PERFORM public.notify_expert_alert(
        NEW.expert_id, 'skill_decision', _title, _body,
        jsonb_build_object('route', 'skills')
      );
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING '[notify_expert_skill_decision] %', SQLERRM;
    END;
  END IF;
  RETURN NEW;
END $function$;

DROP TRIGGER IF EXISTS trg_notify_expert_skill_decision ON public.partner_skills;
CREATE TRIGGER trg_notify_expert_skill_decision
AFTER UPDATE ON public.partner_skills
FOR EACH ROW EXECUTE FUNCTION public.notify_expert_skill_decision();

-- 6. Account status decision (onboarding / suspension)
CREATE OR REPLACE FUNCTION public.notify_expert_status_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE _title text; _body text;
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF NEW.status = 'active' THEN
      _title := 'Account approved';
      _body  := 'Your partner account is active. Go online to start receiving jobs.';
    ELSIF NEW.status = 'rejected' THEN
      _title := 'Account not approved';
      _body  := 'Your partner application was not approved. Contact support for details.';
    ELSIF NEW.status = 'suspended' THEN
      _title := 'Account suspended';
      _body  := 'Your account has been suspended. Contact support for details.';
    ELSE
      RETURN NEW;
    END IF;
    BEGIN
      PERFORM public.notify_expert_alert(
        NEW.id, 'account_status', _title, _body,
        jsonb_build_object('route', 'home', 'status', NEW.status)
      );
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING '[notify_expert_status_change] %', SQLERRM;
    END;
  END IF;
  RETURN NEW;
END $function$;

DROP TRIGGER IF EXISTS trg_notify_expert_status_change ON public.experts;
CREATE TRIGGER trg_notify_expert_status_change
AFTER UPDATE ON public.experts
FOR EACH ROW EXECUTE FUNCTION public.notify_expert_status_change();

-- 7. Forced offline (staff override + stale-online safety net)
CREATE OR REPLACE FUNCTION public.staff_force_expert_offline(_expert_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _uid uuid := auth.uid();
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF NOT public.is_active_staff(_uid, ARRAY['super_admin','ops_manager']) THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;
  UPDATE public.experts SET is_online = false WHERE id = _expert_id;
  INSERT INTO public.audit_logs(actor_id, action, target_table, target_id, before_state, after_state)
  VALUES(_uid, 'force_expert_offline', 'experts', _expert_id, NULL,
         jsonb_build_object('is_online', false));

  BEGIN
    PERFORM public.notify_expert_alert(
      _expert_id, 'forced_offline',
      'You have been set offline',
      'The office has set you offline. Tap to go online again when you are available.',
      jsonb_build_object('route', 'home')
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING '[staff_force_expert_offline notify] %', SQLERRM;
  END;
END $function$;

CREATE OR REPLACE FUNCTION public.expire_stale_online_experts()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE _minutes int; _count int := 0; r record;
BEGIN
  SELECT COALESCE(NULLIF(value,'')::int, 1440) INTO _minutes
    FROM public.ops_settings WHERE key = 'expert_stale_online_minutes';
  _minutes := COALESCE(_minutes, 1440);

  FOR r IN
    UPDATE public.experts
       SET is_online = false
     WHERE is_online = true
       AND COALESCE(location_updated_at, to_timestamp(0)) < now() - make_interval(mins => _minutes)
    RETURNING id
  LOOP
    _count := _count + 1;
    BEGIN
      PERFORM public.notify_expert_alert(
        r.id, 'forced_offline',
        'You have been set offline',
        'We could not get your location for a while, so you were set offline. Tap to go online again.',
        jsonb_build_object('route', 'home')
      );
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING '[expire_stale_online_experts notify] %', SQLERRM;
    END;
  END LOOP;

  RETURN _count;
END $function$;