import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("Tauri default capability", () => {
  it("allows the app to open and manage the Skynet login webview", () => {
    const capability = JSON.parse(
      readFileSync(
        resolve(process.cwd(), "src-tauri/capabilities/default.json"),
        "utf8",
      ),
    ) as { permissions: string[] };

    expect(capability.permissions).toEqual(
      expect.arrayContaining([
        "core:webview:allow-create-webview-window",
        "core:window:allow-set-focus",
      ]),
    );
  });
});
