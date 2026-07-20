-- invite_member reports its outcome instead of swallowing it.
--
-- The original returned void and `on conflict do nothing`, so re-inviting
-- someone already on the project looked identical to adding them and the UI
-- showed a false "Added". Now: true = a membership was created, false = they
-- were already a member. The no-account failure also gains a stable errcode
-- (CD001) so callers can stop string-matching the human-readable message.
-- Same SECURITY DEFINER rationale as before: the auth.users email lookup
-- must never be exposed through a selectable table.

drop function public.invite_member(uuid, text);

create function public.invite_member(p_project_id uuid, p_email text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid := (select auth.uid());
  v_invitee uuid;
  v_inserted integer;
begin
  if v_caller is null then
    raise exception 'authentication required';
  end if;
  if not public.is_project_member(p_project_id) then
    raise exception 'not a member of this project';
  end if;

  select id into v_invitee
  from auth.users
  where lower(email) = lower(trim(p_email))
  limit 1;

  if v_invitee is null then
    raise exception 'no CopyDog account with that email yet' using errcode = 'CD001';
  end if;

  insert into public.project_members (project_id, user_id, role)
  values (p_project_id, v_invitee, 'editor')
  on conflict (project_id, user_id) do nothing;
  get diagnostics v_inserted = row_count;

  return v_inserted > 0;
end;
$$;

revoke execute on function public.invite_member(uuid, text) from public, anon;
grant execute on function public.invite_member(uuid, text) to authenticated;
