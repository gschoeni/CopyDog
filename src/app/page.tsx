import { ThemeToggle } from "@/components/theme/theme-toggle";

export default function Home() {
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="flex items-center justify-between px-6 py-4">
        <span className="flex items-baseline gap-2 text-[15px] font-semibold tracking-tight">
          CopyDog
          <span aria-hidden className="text-ink-tertiary">
            🐕
          </span>
        </span>
        <ThemeToggle />
      </header>

      <main className="flex flex-1 flex-col items-center justify-center px-6 pb-24 text-center">
        <p className="mb-4 text-xs font-medium uppercase tracking-[0.2em] text-ink-tertiary">
          Copy &amp; wireframes, together
        </p>
        <h1 className="max-w-2xl text-balance text-5xl font-semibold tracking-tight sm:text-6xl">
          Write the words.
          <br />
          Shape the layout.
        </h1>
        <p className="mt-6 max-w-md text-balance text-lg leading-relaxed text-ink-secondary">
          A shared home for website copy and greyscale wireframes — so the dance between them never loses a step.
        </p>
      </main>
    </div>
  );
}
