REVOKE EXECUTE ON FUNCTION public.has_login_pin(text) FROM anon, authenticated, public;
GRANT EXECUTE ON FUNCTION public.has_login_pin(text) TO service_role;