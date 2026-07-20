import { describe, expect, it } from "vitest";

import { mapMemberRows } from "./members";

describe("mapMemberRows", () => {
  it("maps rows and falls back when the profile is missing", () => {
    const rows = [
      { user_id: "u1", role: "owner", profile: { display_name: "Alice", avatar_url: "https://x/a.png" } },
      { user_id: "u2", role: "editor", profile: null },
    ];
    expect(mapMemberRows(rows)).toEqual([
      { userId: "u1", role: "owner", displayName: "Alice", avatarUrl: "https://x/a.png" },
      { userId: "u2", role: "editor", displayName: "Member", avatarUrl: null },
    ]);
  });

  it("treats a null result set as empty", () => {
    expect(mapMemberRows(null)).toEqual([]);
  });
});
