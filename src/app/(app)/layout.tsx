import Link from "next/link";
import { redirect } from "next/navigation";

import { ThemeToggle } from "@/components/theme/theme-toggle";
import { Button, buttonClasses } from "@/components/ui/button";
import { KeyIcon } from "@/components/ui/icons";
import { createClient } from "@/lib/supabase/server";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase.from("profiles").select("display_name").eq("id", user.id).single();

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="sticky top-0 z-10 border-b border-border bg-bg/80 backdrop-blur">
        <div className="flex h-14 items-center justify-between px-6">
          <Link href="/projects" className="flex items-baseline gap-2 text-[15px] font-semibold tracking-tight">
            CopyDog
            <span aria-hidden className="text-ink-tertiary">
              🐕
            </span>
          </Link>
          <div className="flex items-center gap-1">
            <Link
              href="/account/api-keys"
              aria-label="API keys"
              title="API keys"
              className={buttonClasses({ variant: "ghost", size: "icon" })}
            >
              <KeyIcon />
            </Link>
            <ThemeToggle />
            <div className="mx-2 h-5 w-px bg-border" aria-hidden />
            <span className="mr-1 hidden text-sm text-ink-secondary sm:block">
              {profile?.display_name ?? user.email}
            </span>
            <form action="/auth/signout" method="post">
              <Button variant="ghost" size="sm" type="submit">
                Sign out
              </Button>
            </form>
          </div>
        </div>
      </header>
      <main className="flex min-h-0 flex-1 flex-col">{children}</main>
    </div>
  );
}
