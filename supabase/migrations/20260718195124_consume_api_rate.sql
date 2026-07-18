-- Atomic fixed-window rate accounting for MCP API keys.
--
-- One row per (key, minute); each call adds p_cost to the current window
-- and returns the new total, so the caller decides whether the budget is
-- blown. Old windows are pruned opportunistically — the table never holds
-- more than a few rows per active key.
--
-- Service-role only: browser roles could otherwise inflate a key's count
-- (denial of service against a teammate's agent), so execute is revoked
-- from everything but service_role.

create function public.consume_api_rate(p_key_id uuid, p_cost integer)
returns integer
language plpgsql
as $$
declare
  v_window timestamptz := date_trunc('minute', now());
  v_count integer;
begin
  insert into public.api_key_rate (api_key_id, window_start, count)
  values (p_key_id, v_window, p_cost)
  on conflict (api_key_id, window_start)
  do update set count = public.api_key_rate.count + excluded.count
  returning count into v_count;

  delete from public.api_key_rate where window_start < now() - interval '10 minutes';

  return v_count;
end;
$$;

revoke execute on function public.consume_api_rate(uuid, integer) from public;
revoke execute on function public.consume_api_rate(uuid, integer) from anon;
revoke execute on function public.consume_api_rate(uuid, integer) from authenticated;
grant execute on function public.consume_api_rate(uuid, integer) to service_role;
