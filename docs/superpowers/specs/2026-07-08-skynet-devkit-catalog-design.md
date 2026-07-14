# Skynet DevKit Catalog Integration Design

## Goal

Add a Skynet-backed catalog source to cc-switch so users can browse and install:

- Skills from `GET /skynet-service/devkit/skills`
- MCP servers from `GET /skynet-service/devkit/mcp-servers`

The first version should make Skynet a remote source for the existing Skills and MCP management flows. It should not introduce a separate plugin model, rewrite current installed-item management, or replace existing repo/local import behavior.

## Approved Approach

Use a front-end Skynet catalog flow with browser login state, while keeping installation writes in the existing Tauri/Rust services.

Skynet list requests should be made from the renderer with `fetch(..., { credentials: "include" })`, because the Skynet service already allows credentialed CORS and its auth middleware checks Portal cookies. When an auth request fails, cc-switch should open the Skynet base URL through the existing `open_external` command and let the user complete Portal login in the browser.

The Rust backend should continue owning local installation effects:

- Skill install should reuse the existing ZIP installation path.
- MCP install should reuse `McpService::upsert_server`.

This keeps Skynet as a catalog/source, not a second local state store.

## Scope

In scope:

- A Skynet base URL setting with a sensible default.
- Renderer API functions for listing Skynet skills and MCP servers with credentials included.
- A backend command that installs a Skynet skill from downloaded ZIP bytes or a temporary ZIP path, reusing `SkillService::install_from_zip`.
- A backend command that installs a mapped Skynet MCP server into the existing unified `McpServer` store.
- A Skynet catalog entry point in the existing Skills page.
- A Skynet catalog entry point in the existing MCP page.
- Auth-required handling for 401, 403, and Skynet `UNLOGIN`-style responses.
- Tests for mapping, install command behavior, and cache invalidation boundaries.

Out of scope for the first version:

- Skynet plugin bundle install.
- Uploading, editing, or deleting Skynet catalog items.
- A full embedded Portal login window or native cookie jar bridge.
- Multi-tenant permissions beyond what Skynet already enforces.

## Existing Project Fit

Current cc-switch surfaces already provide the right local installation primitives:

- Skills frontend API: `src/lib/api/skills.ts`
- Skills hooks/cache: `src/hooks/useSkills.ts`
- Skills UI: `src/components/skills/UnifiedSkillsPanel.tsx`
- Skill ZIP install command: `install_skills_from_zip`
- Skill install implementation: `SkillService::install_from_zip`
- MCP frontend API: `src/lib/api/mcp.ts`
- MCP hooks/cache: `src/hooks/useMcp.ts`
- MCP UI: `src/components/mcp/UnifiedMcpPanel.tsx`
- MCP upsert implementation: `McpService::upsert_server`

The Skynet integration should add small, focused modules beside those surfaces instead of expanding existing files with unrelated network and mapping logic.

## Skynet API Contract

Skills:

- `GET /skynet-service/devkit/skills`
- Response shape: `{ "skills": [ { "id", "name", "description", "uploader_id", "updated_at" } ] }`
- Download: `GET /skynet-service/devkit/skills/:id/download`
- Download response is `application/zip`.

MCP servers:

- `GET /skynet-service/devkit/mcp-servers`
- Response shape: `{ "servers": [ ... ] }`
- Each server includes:
  - `id`
  - `name`
  - `display_name`
  - `description`
  - `type`: `stdio`, `http`, or `sse`
  - for `stdio`: `command`, `args`, `env`, `cwd`
  - for remote types: `url`, `headers`

Current user/auth probe:

- `GET /skynet-service/devkit/user`
- Used only as a lightweight validation path if needed by UI state.

## Auth Behavior

The renderer should call Skynet with credentialed browser requests:

```ts
fetch(url, { credentials: "include" })
```

When Skynet returns 401, 403, or a response body indicating unauthenticated access:

1. Show a login-required state in the catalog dialog.
2. Provide a login action that calls `settingsApi.openExternal(skynetBaseUrl)`.
3. Let users retry the catalog request after browser login completes.

The first version should not try to read external browser cookies from Rust. External browser login is an entry point; credentialed renderer requests are what reuse browser state.

## Data Mapping

### Skills

Skynet skill list items should be represented in the renderer as a new `SkynetSkill` type:

- `id`
- `name`
- `description`
- `uploaderId`
- `updatedAt`

Install behavior:

1. The renderer requests the ZIP from Skynet with credentials.
2. The ZIP is passed to a Tauri command in a form that avoids base64 inflation for large files where practical.
3. The command writes the ZIP to a temp file.
4. The command calls `SkillService::install_from_zip(&db, temp_path, current_app)`.
5. On success, invalidate or update `["skills", "installed"]`.

The installed skill remains a local `InstalledSkill` with the existing `local:<directory>` identity produced by `install_from_zip`.

### MCP

Skynet MCP server list items should be represented in the renderer as a new `SkynetMcpServer` type mirroring the Skynet API.

Install maps to the existing unified `McpServer` shape:

- `id`: `skynet:<skynet-id>` to avoid collisions with manual/local presets.
- `name`: `display_name || name`
- `description`: Skynet description
- `server`:
  - `stdio`: `{ type: "stdio", command, args, env, cwd }`
  - `http`: `{ type: "http", url, headers }`
  - `sse`: `{ type: "sse", url, headers }`
- `apps`: enabled for the current app when supported.
- `tags`: include `skynet`

Install calls the existing `upsert_mcp_server` command or a small Skynet-specific command that performs mapping in Rust. Mapping should be centralized and tested, not duplicated across UI components.

## UI Design

Skills page:

- Add a Skynet catalog action near existing import/discovery actions.
- Open a dialog or side panel listing Skynet skills.
- Each item shows name, description, uploader, update time, and install status when it can be inferred.
- Each item has an install button with loading and success/error states.
- Auth failure switches the dialog to a login-required state with a login button and retry button.

MCP page:

- Add a Skynet catalog action near existing add/import actions.
- Open a dialog or side panel listing Skynet MCP servers.
- Each item shows display name, type, description, and the command or URL summary.
- Each item has an install button.
- Auth failure behavior matches the Skills catalog.

The UI should reuse existing list, dialog, button, badge, toast, and React Query patterns. It should remain a utility surface, not a marketing-style page.

## Error Handling

Catalog list failures:

- Auth failure: show login-required state.
- Network failure: toast an actionable error and keep retry available.
- Malformed response: toast "invalid Skynet response" and log the parsing detail.

Skill install failures:

- Empty or invalid ZIP: surface the existing ZIP install error.
- Duplicate local skill directory: rely on existing install behavior, then show a skipped/no-op message if no skills were installed.
- Auth failure during ZIP download: show login-required state and do not call the install command.

MCP install failures:

- Invalid `stdio` item without command: block install and show invalid catalog item.
- Invalid remote item without URL: block install and show invalid catalog item.
- Existing `skynet:<id>`: upsert should update the local entry.

## Testing Plan

Rust tests:

- Map Skynet `stdio` MCP to `McpServer`.
- Map Skynet `http` and `sse` MCP to `McpServer`.
- Reject Skynet MCP items missing required fields.
- Install Skynet skill command writes a temp ZIP and delegates to existing ZIP install behavior.

TypeScript tests:

- Skynet list client uses `credentials: "include"`.
- Auth errors normalize to a login-required error.
- Skills install mutation invalidates or updates `["skills", "installed"]`.
- MCP install mutation invalidates `["mcp", "all"]`.

Manual verification:

- Open Skynet skill catalog while logged out, click login, retry after Portal login, install a skill.
- Open Skynet MCP catalog, install a stdio server, confirm it appears in the unified MCP list and syncs to the selected app.
- Install a remote MCP server and confirm the stored JSON preserves `type`, `url`, and `headers`.

## Rollout Notes

The first implementation should prefer local-only changes and no Skynet service changes. If browser credential reuse is blocked by actual runtime origin/cookie behavior, the fallback is the embedded login/window-cookie bridge from the earlier brainstorm, not debug headers.

No issue status change is required as part of the spec. Code implementation should follow a TDD plan after this spec is reviewed.

## Self-Review

- Placeholder scan: no placeholders remain.
- Consistency check: the approved front-end credential flow is used for catalog reads, while local install effects stay in existing Tauri services.
- Scope check: the first version excludes plugin bundles and Skynet catalog mutation APIs.
- Ambiguity check: MCP IDs, app enablement, auth failure behavior, and install ownership are explicit.
