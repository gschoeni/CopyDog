// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { Modal } from "./modal";

afterEach(() => document.body.replaceChildren());

describe("Modal", () => {
  it("portals to <body> rather than rendering where it was written", () => {
    // the whole point: a sticky/transformed ancestor must not become the
    // containing block for the overlay, or the scrim ends up behind the
    // chrome next to it (this happened with the pages sidebar's <aside>)
    const { container } = render(
      <div style={{ position: "sticky" }}>
        <Modal label="Delete page About" onClose={() => {}}>
          <button type="button">Delete page</button>
        </Modal>
      </div>,
    );

    expect(container.querySelector("[role=dialog]")).toBeNull();
    const dialog = screen.getByRole("dialog", { name: "Delete page About" });
    expect(dialog.closest("[role=dialog]")).toBe(dialog);
    expect(container.contains(dialog)).toBe(false);
    expect(document.body.contains(dialog)).toBe(true);
  });

  it("closes on Escape and on a backdrop press, but not from inside the card", () => {
    const onClose = vi.fn();
    render(
      <Modal label="Delete page About" onClose={onClose}>
        <button type="button">Delete page</button>
      </Modal>,
    );

    fireEvent.mouseDown(screen.getByRole("button", { name: "Delete page" }));
    expect(onClose).not.toHaveBeenCalled();

    const dialog = screen.getByRole("dialog", { name: "Delete page About" });
    fireEvent.mouseDown(dialog.parentElement!);
    expect(onClose).toHaveBeenCalledTimes(1);

    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it("stops dismissing while work is in flight", () => {
    const onClose = vi.fn();
    render(
      <Modal label="Delete page About" onClose={onClose} dismissible={false}>
        <button type="button">Deleting…</button>
      </Modal>,
    );

    fireEvent.keyDown(window, { key: "Escape" });
    fireEvent.mouseDown(screen.getByRole("dialog").parentElement!);
    expect(onClose).not.toHaveBeenCalled();
  });

  it("takes focus itself so a stray Enter can't fire a destructive default", () => {
    render(
      <Modal label="Delete page About" onClose={() => {}}>
        <button type="button">Delete page</button>
      </Modal>,
    );
    expect(document.activeElement).toBe(screen.getByRole("dialog"));
  });

  it("keeps Tab inside the card", () => {
    render(
      <Modal label="Delete page About" onClose={() => {}}>
        <button type="button">Cancel</button>
        <button type="button">Delete page</button>
      </Modal>,
    );

    const cancel = screen.getByRole("button", { name: "Cancel" });
    const confirm = screen.getByRole("button", { name: "Delete page" });

    // forward off the last control wraps to the first
    confirm.focus();
    fireEvent.keyDown(window, { key: "Tab" });
    expect(document.activeElement).toBe(cancel);

    // and backward off the first wraps to the last
    fireEvent.keyDown(window, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(confirm);
  });
});
