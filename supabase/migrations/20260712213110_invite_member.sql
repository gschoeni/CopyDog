-- Invite a collaborator by email.
--
-- SECURITY DEFINER so it can look the user up in auth.users without ever
-- exposing emails through a selectable table. Any member can invite in v1
-- (everyone is an editor); the invitee must already have a CopyDog account.

create function public.invite_member(p_project_id uuid, p_email text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid := (select auth.uid());
  v_invitee uuid;
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
    raise exception 'no CopyDog account with that email yet';
  end if;

  insert into public.project_members (project_id, user_id, role)
  values (p_project_id, v_invitee, 'editor')
  on conflict (project_id, user_id) do nothing;
end;
$$;

revoke execute on function public.invite_member(uuid, text) from public, anon;
grant execute on function public.invite_member(uuid, text) to authenticated;
