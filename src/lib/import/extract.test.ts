import { describe, expect, it } from "vitest";

import { extractSectionsFromHtml } from "./extract";

const LANDING_PAGE = `<!DOCTYPE html>
<html><head><title>Acme</title><style>.x{}</style><script>evil()</script></head>
<body>
  <nav><a href="/pricing">Pricing</a><a href="/about">About</a></nav>
  <main>
    <section class="hero">
      <p class="eyebrow">NEW FOR 2026</p>
      <h1>Ship <strong>copy</strong> faster</h1>
      <p>Stop pasting between docs and design tools.</p>
      <a class="btn btn-primary" href="/signup">Start free</a>
    </section>
    <section id="features">
      <h2>Why teams love it</h2>
      <ul>
        <li>Versioned copy</li>
        <li>Live <em>wireframes</em></li>
      </ul>
    </section>
    <section class="cta">
      <h2>Ready to write?</h2>
      <a href="/signup">Get started</a>
    </section>
  </main>
  <footer><p>© 2026 Acme</p></footer>
</body></html>`;

describe("extractSectionsFromHtml", () => {
  it("extracts sections with typed elements from semantic HTML", () => {
    const sections = extractSectionsFromHtml(LANDING_PAGE);
    expect(sections).toHaveLength(3);

    const [hero, features, cta] = sections;
    expect(hero!.title).toBe("Ship copy faster");
    expect(hero!.elements).toEqual([
      { type: "eyebrow", text: "NEW FOR 2026" },
      { type: "h1", text: "Ship **copy** faster" },
      { type: "p", text: "Stop pasting between docs and design tools." },
      { type: "button", label: "Start free", url: "/signup" },
    ]);

    expect(features!.elements).toContainEqual({ type: "bullets", items: ["Versioned copy", "Live *wireframes*"] });
    expect(cta!.elements).toContainEqual({ type: "button", label: "Get started", url: "/signup" });
  });

  it("groups by headings when the page has no section elements", () => {
    const html = `<body>
      <h1>Title one</h1><p>First body.</p>
      <h2>Title two</h2><p>Second body.</p><p>More body.</p>
    </body>`;
    const sections = extractSectionsFromHtml(html);
    expect(sections).toHaveLength(2);
    expect(sections[0]!.elements[0]).toEqual({ type: "h1", text: "Title one" });
    expect(sections[1]!.elements).toHaveLength(3);
  });

  it("ignores script/style/nav content and empty pages", () => {
    expect(extractSectionsFromHtml(`<body><script>x()</script></body>`)).toEqual([]);
  });

  it("escapes markdown special characters in source text", () => {
    const sections = extractSectionsFromHtml(`<body><h1>Prices from *only* $5</h1><p>Really long enough body text.</p></body>`);
    expect(sections[0]!.elements[0]).toEqual({ type: "h1", text: "Prices from \\*only\\* $5" });
  });
});
