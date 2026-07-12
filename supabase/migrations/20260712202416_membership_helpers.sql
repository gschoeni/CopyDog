-- Membership helpers used by RLS policies.
--
-- SECURITY DEFINER (owned by postgres, the table owner) so they read
-- project_members without re-triggering RLS on it — the standard fix for
-- recursive policy evaluation. plpgsql bodies are not resolved at creation
-- time, so these can be defined before the tables exist.

create function public.is_project_member(p_project_id uuid)
returns boolean
language plpgsql
security definer
stable
set search_path = ''
as $$
begin
  return exists (
    select 1
    from public.project_members m
    where m.project_id = p_project_id
      and m.user_id = (select auth.uid())
  );
end;
$$;

create function public.is_project_owner(p_project_id uuid)
returns boolean
language plpgsql
security definer
stable
set search_path = ''
as $$
begin
  return exists (
    select 1
    from public.project_members m
    where m.project_id = p_project_id
      and m.user_id = (select auth.uid())
      and m.role = 'owner'
  );
end;
$$;
