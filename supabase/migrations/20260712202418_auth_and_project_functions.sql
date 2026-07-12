-- Auth glue, table grants, and atomic project creation.

-- Base-table grants: RLS filters rows, but roles still need table
-- privileges. Local supabase does not apply default grants to
-- migration-created tables, so we set them explicitly — and register
-- default privileges so future migrations inherit them.
grant select, insert, update, delete
  on table public.profiles, public.projects, public.project_members
  to authenticated, service_role;

alter default privileges for role postgres in schema public
  grant select, insert, update, delete on tables to authenticated, service_role;

-- Every new auth user gets a profile row. Display name falls back from
-- OAuth metadata to the email local part.
create function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name, avatar_url)
  values (
    new.id,
    coalesce(
      new.raw_user_meta_data ->> 'full_name',
      new.raw_user_meta_data ->> 'name',
      split_part(new.email, '@', 1)
    ),
    new.raw_user_meta_data ->> 'avatar_url'
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Creates the project row and its owner membership atomically, as the
-- calling user. SECURITY DEFINER because projects has no insert policy —
-- this function is the only write path, which keeps the invariant
-- "every project has exactly one owner membership" in one place.
create function public.create_project(p_name text, p_slug text, p_oxen_repo text)
returns public.projects
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_project public.projects;
begin
  if v_user_id is null then
    raise exception 'create_project requires an authenticated user';
  end if;

  insert into public.projects (name, slug, oxen_repo, owner_id)
  values (p_name, p_slug, p_oxen_repo, v_user_id)
  returning * into v_project;

  insert into public.project_members (project_id, user_id, role)
  values (v_project.id, v_user_id, 'owner');

  return v_project;
end;
$$;

revoke execute on function public.create_project(text, text, text) from public, anon;
grant execute on function public.create_project(text, text, text) to authenticated;
