-- Third membership helper, ahead of the viewer role: "may this user write?"
-- Owners and editors write; viewers (added in the following migration) only
-- read. Same SECURITY DEFINER shape as is_project_member/is_project_owner
-- (20260712202416) to avoid recursive RLS evaluation on project_members.

create function public.is_project_editor(p_project_id uuid)
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
      and m.role in ('owner', 'editor')
  );
end;
$$;
