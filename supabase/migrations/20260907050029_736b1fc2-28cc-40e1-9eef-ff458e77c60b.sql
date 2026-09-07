ALTER TABLE public.support_tickets ADD COLUMN IF NOT EXISTS resolution_summary text;

CREATE OR REPLACE FUNCTION public.staff_update_support_ticket(_ticket_id uuid, _status text, _note text DEFAULT NULL::text, _resolution text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _uid uuid := auth.uid(); _staff_id uuid; _before jsonb;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF NOT public.is_active_staff(_uid, ARRAY['super_admin','ops_manager']) THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;
  IF _status NOT IN ('open','in_progress','resolved') THEN RAISE EXCEPTION 'Invalid status'; END IF;
  SELECT id INTO _staff_id FROM public.staff_users WHERE auth_user_id = _uid;

  SELECT to_jsonb(t) INTO _before FROM public.support_tickets t WHERE t.id = _ticket_id;
  IF _before IS NULL THEN RAISE EXCEPTION 'Ticket not found'; END IF;

  UPDATE public.support_tickets
     SET status = _status,
         internal_note = COALESCE(_note, internal_note),
         resolution_summary = CASE WHEN _status = 'resolved' THEN COALESCE(_resolution, resolution_summary) ELSE resolution_summary END,
         resolved_at = CASE WHEN _status = 'resolved' THEN COALESCE(resolved_at, now()) ELSE NULL END,
         resolved_by = CASE WHEN _status = 'resolved' THEN _staff_id ELSE NULL END,
         updated_at = now()
   WHERE id = _ticket_id;

  INSERT INTO public.audit_logs(actor_id, action, target_table, target_id, before_state, after_state)
  VALUES(_uid, 'update_support_ticket', 'support_tickets', _ticket_id, _before,
         jsonb_build_object('status', _status, 'internal_note', _note, 'resolution_summary', _resolution));
END $function$;

CREATE OR REPLACE FUNCTION public.notify_support_ticket_resolved()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  _user_type text;
  _summary text;
BEGIN
  IF NEW.status = 'resolved'
     AND (OLD.status IS DISTINCT FROM 'resolved')
     AND NEW.user_id IS NOT NULL THEN
    SELECT CASE WHEN EXISTS (SELECT 1 FROM public.experts e WHERE e.auth_user_id = NEW.user_id)
                THEN 'expert' ELSE 'customer' END
      INTO _user_type;

    _summary := COALESCE(NULLIF(btrim(NEW.resolution_summary), ''), 'Your support request has been resolved.');

    PERFORM public.notify_push_event(
      _user_type,
      NEW.user_id,
      'support_resolved',
      'Support ticket resolved',
      _summary,
      jsonb_build_object('ticket_id', NEW.id)
    );
  END IF;
  RETURN NEW;
END $function$;

DROP TRIGGER IF EXISTS trg_notify_support_ticket_resolved ON public.support_tickets;
CREATE TRIGGER trg_notify_support_ticket_resolved
AFTER UPDATE ON public.support_tickets
FOR EACH ROW EXECUTE FUNCTION public.notify_support_ticket_resolved();