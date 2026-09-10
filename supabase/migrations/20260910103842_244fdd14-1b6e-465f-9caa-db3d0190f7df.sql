REVOKE ALL ON FUNCTION public.notify_expert_wallet_credit() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.notify_expert_tip_received() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.notify_expert_reward_credited() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.notify_expert_skill_decision() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.notify_expert_status_change() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.notify_support_ticket_resolved() FROM PUBLIC, anon, authenticated;