# Features of CopyDog

These are the core features of the app, and how they need to function.

## Text Document Copy Editor

A Google doc/notion style word document editor.

* Ability to label things as H1-H6, paragraph, button/link/CTA, bulleted list, numbered list, eyebrow, etc
* Ability to organize blocks of elements into a section (ie. highlight multiple headlines, paragraphs, buttons etc into a section)
* Make alternate versions of sections for different copy ideas
* Ability to add notes/comments to your sections, copy, etc to keep random thoughts or feedback that are not copy themselves
  
## Wireframe Builder

Go from a prompt or reference to a unified wireframe design system linked to the copy

1) Upload the raw HTML of a website or wireframe
2) Paste a URL (maybe an existing website)
3) Upload a JPG/PDF/PNG of a wireframe or designed website
4) Use a figma MCP to import from a figma design
5) Use AI to directly "vibe code" the wireframe layout

### Design assistant

The chat assistant is a wireframe designer over Oxen.ai inference (streaming +
tool calling). It sees the page's copy *and* current wireframe HTML, and works
at two grains:

- **design_section** — redesign one section ("make the hero a split, image on
  the left", "3-up card grid for these features"); every other section keeps
  its layout. Designing an unlinked section links it back in.
- **redesign_page** — whole-page passes ("more rhythm, alternate tinted
  bands") that start from the current wireframe, not a blank slate.
- On an empty page, "design me a landing page for X" builds a first draft:
  sections with starter copy (add_section), then a full layout.

Turns stream live: tokens render as they arrive, tool activity shows as status
lines ("Designing hero…"), and the wireframe pane refreshes after every
mutating tool so you watch the design evolve. All agent edits land in the
caller's private draft as new versions — same rules as typing.

The greyscale design system the agent composes with: heroes, split layouts
(both directions), 2/3/4-column card grids, tinted bands, testimonials with
avatar bylines, logo strips, stats, FAQ rows, pricing cards, and email-capture
forms — all `wf-*` classes, sanitizer-enforced, swappable as a module.

## Dual Panel

The user should be able to toggle between the copy editor and the wireframe builder OR see both at the same time in a dual panel mode.

## Export

You should be able to export the final wireframes as raw html, or into figma, claude code, or other tools via MCP or other connectors.

