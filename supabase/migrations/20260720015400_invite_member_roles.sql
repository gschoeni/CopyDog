-- invite_member learns roles, and viewers can't use it.
--
-- With the read-only viewer seat, "any member can invite" becomes "any
-- writer can invite": the caller must be an owner or editor. The invitee's
-- role is a parameter (editor by default; viewer for read-only clients) —
-- inviting straight to owner stays off the table, promotion is a deliberate
-- second step on the settings roster. Same SECURITY DEFINER rationale: the
-- auth.users email lookup must never be exposed through a selectable table.

drop function public.invite_member(uuid, text);

create function public.invite_member(p_project_id uuid, p_email text, p_role text default 'editor')
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
  if not public.is_project_editor(p_project_id) then
    raise exception 'not allowed to invite on this project';
  end if;
  if p_role not in ('editor', 'viewer') then
    raise exception 'invitations can only grant editor or viewer';
  end if;

  select id into v_invitee
  from auth.users
  where lower(email) = lower(trim(p_email))
  limit 1;

  if v_invitee is null then
    raise exception 'no CopyDog account with that email yet' using errcode = 'CD001';
  end if;

  insert into public.project_members (project_id, user_id, role)
  values (p_project_id, v_invitee, p_role::public.project_role)
  on conflict (project_id, user_id) do nothing;
  get diagnostics v_inserted = row_count;

  return v_inserted > 0;
end;
$$;

revoke execute on function public.invite_member(uuid, text, text) from public, anon;
grant execute on function public.invite_member(uuid, text, text) to authenticated;
