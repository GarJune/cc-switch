# Skynet DevKit Catalog Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Skynet-backed skill and MCP catalog browsing/install flows to cc-switch.

**Architecture:** Add focused Skynet modules instead of expanding the existing Skills/MCP files with remote-catalog logic. Renderer code fetches catalog data with browser credentials and handles login-required states; Tauri/Rust owns local installation effects by reusing `SkillService::install_from_zip` and `McpService::upsert_server`.

**Tech Stack:** React, TypeScript, TanStack Query, Vitest, Tauri commands, Rust, serde, existing cc-switch Skill/MCP services.

---

## File Structure

- Create `src/lib/api/skynet.ts`: Skynet base URL helpers, credentialed fetch wrapper, skill/MCP list and skill ZIP download APIs.
- Create `src/hooks/useSkynetCatalog.ts`: React Query hooks/mutations for Skynet skills and MCP catalog install flows.
- Create `src/components/skynet/SkynetCatalogDialog.tsx`: Shared dialog shell for Skynet catalog lists, auth-required state, retry, and login action.
- Create `src/components/skynet/SkynetSkillCatalog.tsx`: Skill catalog list content and install buttons.
- Create `src/components/skynet/SkynetMcpCatalog.tsx`: MCP catalog list content and install buttons.
- Create `src-tauri/src/commands/skynet.rs`: Tauri command for installing Skynet skill ZIP bytes and mapping/installing Skynet MCP servers.
- Modify `src-tauri/src/commands/mod.rs`: Export Skynet commands.
- Modify `src-tauri/src/lib.rs`: Register Skynet commands with `generate_handler!`.
- Modify `src/lib/api/skills.ts`: Re-export or compose Skynet skill install command only if needed by hook.
- Modify `src/lib/api/mcp.ts`: Re-export or compose Skynet MCP install command only if needed by hook.
- Modify `src/components/skills/UnifiedSkillsPanel.tsx`: Add Skynet catalog action and dialog state.
- Modify `src/components/mcp/UnifiedMcpPanel.tsx`: Add Skynet catalog action and dialog state.
- Test `tests/lib/skynetApi.test.ts`: Credentialed fetch and auth normalization.
- Test `tests/hooks/useSkynetCatalog.test.tsx`: Query/mutation cache invalidation.
- Test `tests/components/SkynetCatalogDialog.test.tsx`: Auth-required login/retry UI.
- Test `src-tauri/tests/skynet_commands.rs`: MCP mapping and invalid payload validation.

---

### Task 1: Renderer Skynet API Client

**Files:**
- Create: `src/lib/api/skynet.ts`
- Test: `tests/lib/skynetApi.test.ts`

- [ ] **Step 1: Write failing tests for credentialed requests and auth normalization**

Create `tests/lib/skynetApi.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  SkynetAuthRequiredError,
  listSkynetSkills,
  listSkynetMcpServers,
} from "@/lib/api/skynet";

const fetchMock = vi.fn();

describe("skynet api client", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  it("lists skills with browser credentials included", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          skills: [
            {
              id: "64f",
              name: "Log Helper",
              description: "Inspect logs",
              uploader_id: "joy",
              updated_at: "2026-07-08T00:00:00Z",
            },
          ],
        }),
        { status: 200 },
      ),
    );

    const skills = await listSkynetSkills("https://tools-test.inshopline.com");

    expect(fetchMock).toHaveBeenCalledWith(
      "https://tools-test.inshopline.com/skynet-service/devkit/skills",
      expect.objectContaining({ credentials: "include" }),
    );
    expect(skills[0]).toMatchObject({
      id: "64f",
      name: "Log Helper",
      uploaderId: "joy",
    });
  });

  it("normalizes 401 responses to auth-required errors", async () => {
    fetchMock.mockResolvedValueOnce(new Response("{}", { status: 401 }));

    await expect(
      listSkynetMcpServers("https://tools-test.inshopline.com"),
    ).rejects.toBeInstanceOf(SkynetAuthRequiredError);
  });
});
```

- [ ] **Step 2: Run the tests and verify they fail**

Run:

```bash
pnpm vitest run tests/lib/skynetApi.test.ts
```

Expected: FAIL because `@/lib/api/skynet` does not exist.

- [ ] **Step 3: Implement the Skynet API client**

Create `src/lib/api/skynet.ts`:

```ts
import { invoke } from "@tauri-apps/api/core";
import type { AppId } from "@/lib/api/types";
import type { InstalledSkill } from "@/lib/api/skills";
import type { McpServer } from "@/types";

export const DEFAULT_SKYNET_BASE_URL = "https://tools-test.inshopline.com";

export class SkynetAuthRequiredError extends Error {
  constructor(message = "Skynet login required") {
    super(message);
    this.name = "SkynetAuthRequiredError";
  }
}

export interface SkynetSkill {
  id: string;
  name: string;
  description: string;
  uploaderId: string;
  updatedAt?: string;
}

export interface SkynetMcpServer {
  id: string;
  name: string;
  displayName?: string;
  description: string;
  uploaderId?: string;
  updatedAt?: string;
  type: "stdio" | "http" | "sse";
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
  url?: string;
  headers?: Record<string, string>;
}

function joinSkynetUrl(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/+$/, "")}${path}`;
}

function normalizeAuthError(response: Response): never {
  if (response.status === 401 || response.status === 403) {
    throw new SkynetAuthRequiredError();
  }
  throw new Error(`Skynet request failed: HTTP ${response.status}`);
}

async function readJson<T>(response: Response): Promise<T> {
  if (!response.ok) normalizeAuthError(response);
  const json = await response.json();
  if (
    json &&
    typeof json === "object" &&
    "code" in json &&
    String((json as { code?: unknown }).code).toUpperCase() === "UNLOGIN"
  ) {
    throw new SkynetAuthRequiredError();
  }
  return json as T;
}

function mapSkill(raw: Record<string, unknown>): SkynetSkill {
  return {
    id: String(raw.id ?? ""),
    name: String(raw.name ?? ""),
    description: String(raw.description ?? ""),
    uploaderId: String(raw.uploader_id ?? ""),
    updatedAt:
      typeof raw.updated_at === "string" ? raw.updated_at : undefined,
  };
}

function mapMcpServer(raw: Record<string, unknown>): SkynetMcpServer {
  return {
    id: String(raw.id ?? ""),
    name: String(raw.name ?? ""),
    displayName:
      typeof raw.display_name === "string" ? raw.display_name : undefined,
    description: String(raw.description ?? ""),
    uploaderId:
      typeof raw.uploader_id === "string" ? raw.uploader_id : undefined,
    updatedAt:
      typeof raw.updated_at === "string" ? raw.updated_at : undefined,
    type: raw.type === "http" || raw.type === "sse" ? raw.type : "stdio",
    command: typeof raw.command === "string" ? raw.command : undefined,
    args: Array.isArray(raw.args) ? raw.args.map(String) : undefined,
    env:
      raw.env && typeof raw.env === "object"
        ? (raw.env as Record<string, string>)
        : undefined,
    cwd: typeof raw.cwd === "string" ? raw.cwd : undefined,
    url: typeof raw.url === "string" ? raw.url : undefined,
    headers:
      raw.headers && typeof raw.headers === "object"
        ? (raw.headers as Record<string, string>)
        : undefined,
  };
}

export async function listSkynetSkills(
  baseUrl = DEFAULT_SKYNET_BASE_URL,
): Promise<SkynetSkill[]> {
  const response = await fetch(
    joinSkynetUrl(baseUrl, "/skynet-service/devkit/skills"),
    { credentials: "include" },
  );
  const payload = await readJson<{ skills?: Record<string, unknown>[] }>(
    response,
  );
  return (payload.skills ?? []).map(mapSkill).filter((skill) => skill.id);
}

export async function listSkynetMcpServers(
  baseUrl = DEFAULT_SKYNET_BASE_URL,
): Promise<SkynetMcpServer[]> {
  const response = await fetch(
    joinSkynetUrl(baseUrl, "/skynet-service/devkit/mcp-servers"),
    { credentials: "include" },
  );
  const payload = await readJson<{ servers?: Record<string, unknown>[] }>(
    response,
  );
  return (payload.servers ?? []).map(mapMcpServer).filter((server) => server.id);
}

export async function downloadSkynetSkillZip(
  skillId: string,
  baseUrl = DEFAULT_SKYNET_BASE_URL,
): Promise<Uint8Array> {
  const response = await fetch(
    joinSkynetUrl(
      baseUrl,
      `/skynet-service/devkit/skills/${encodeURIComponent(skillId)}/download`,
    ),
    { credentials: "include" },
  );
  if (!response.ok) normalizeAuthError(response);
  return new Uint8Array(await response.arrayBuffer());
}

export async function installSkynetSkillZip(
  bytes: Uint8Array,
  currentApp: AppId,
): Promise<InstalledSkill[]> {
  return await invoke("install_skynet_skill_zip", {
    bytes: Array.from(bytes),
    currentApp,
  });
}

export async function installSkynetMcpServer(
  server: SkynetMcpServer,
  currentApp: AppId,
): Promise<McpServer> {
  return await invoke("install_skynet_mcp_server", { server, currentApp });
}
```

- [ ] **Step 4: Run the tests and verify they pass**

Run:

```bash
pnpm vitest run tests/lib/skynetApi.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/api/skynet.ts tests/lib/skynetApi.test.ts
git commit -m "feat: add skynet catalog api client"
```

---

### Task 2: Rust Skynet Install Commands

**Files:**
- Create: `src-tauri/src/commands/skynet.rs`
- Modify: `src-tauri/src/commands/mod.rs`
- Modify: `src-tauri/src/lib.rs`
- Test: `src-tauri/tests/skynet_commands.rs`

- [ ] **Step 1: Write failing Rust tests for MCP mapping**

Create `src-tauri/tests/skynet_commands.rs` with tests that construct `SkynetMcpServerPayload` and call `map_skynet_mcp_server_for_test`.

```rust
use cc_switch_lib::{map_skynet_mcp_server_for_test, AppType, SkynetMcpServerPayload};

#[test]
fn maps_stdio_skynet_mcp_server() {
    let mapped = map_skynet_mcp_server_for_test(
        SkynetMcpServerPayload {
            id: "abc".into(),
            name: "log-server".into(),
            display_name: Some("Log Server".into()),
            description: "Log tools".into(),
            uploader_id: None,
            updated_at: None,
            server_type: "stdio".into(),
            command: Some("node".into()),
            args: Some(vec!["index.js".into()]),
            env: None,
            cwd: None,
            url: None,
            headers: None,
        },
        &AppType::Codex,
    )
    .expect("mapping succeeds");

    assert_eq!(mapped.id, "skynet:abc");
    assert_eq!(mapped.name, "Log Server");
    assert!(mapped.apps.codex);
    assert_eq!(mapped.server["type"], "stdio");
    assert_eq!(mapped.server["command"], "node");
}

#[test]
fn rejects_remote_skynet_mcp_server_without_url() {
    let err = map_skynet_mcp_server_for_test(
        SkynetMcpServerPayload {
            id: "abc".into(),
            name: "remote".into(),
            display_name: None,
            description: "".into(),
            uploader_id: None,
            updated_at: None,
            server_type: "http".into(),
            command: None,
            args: None,
            env: None,
            cwd: None,
            url: None,
            headers: None,
        },
        &AppType::Claude,
    )
    .expect_err("missing URL should fail");

    assert!(err.contains("url is required"));
}
```

- [ ] **Step 2: Run test and verify it fails**

Run:

```bash
cd src-tauri && cargo test --test skynet_commands
```

Expected: FAIL because the Skynet command module and exported test hook do not exist.

- [ ] **Step 3: Implement the command module and mapping**

Create `src-tauri/src/commands/skynet.rs` with:

```rust
use crate::app_config::{AppType, McpApps, McpServer, InstalledSkill};
use crate::services::{skill::SkillService, McpService};
use crate::store::AppState;
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::collections::HashMap;
use std::str::FromStr;
use tauri::State;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SkynetMcpServerPayload {
    pub id: String,
    pub name: String,
    #[serde(default, rename = "displayName")]
    pub display_name: Option<String>,
    #[serde(default)]
    pub description: String,
    #[serde(default, rename = "uploaderId")]
    pub uploader_id: Option<String>,
    #[serde(default, rename = "updatedAt")]
    pub updated_at: Option<String>,
    #[serde(rename = "type")]
    pub server_type: String,
    #[serde(default)]
    pub command: Option<String>,
    #[serde(default)]
    pub args: Option<Vec<String>>,
    #[serde(default)]
    pub env: Option<HashMap<String, String>>,
    #[serde(default)]
    pub cwd: Option<String>,
    #[serde(default)]
    pub url: Option<String>,
    #[serde(default)]
    pub headers: Option<HashMap<String, String>>,
}

fn clean(value: Option<String>) -> Option<String> {
    value.map(|v| v.trim().to_string()).filter(|v| !v.is_empty())
}

pub fn map_skynet_mcp_server(
    payload: SkynetMcpServerPayload,
    current_app: &AppType,
) -> Result<McpServer, String> {
    let mut apps = McpApps::default();
    apps.set_enabled_for(current_app, true);

    let server_type = payload.server_type.trim();
    let server = match server_type {
        "stdio" => {
            let command = clean(payload.command)
                .ok_or_else(|| "command is required for stdio Skynet MCP server".to_string())?;
            json!({
                "type": "stdio",
                "command": command,
                "args": payload.args.unwrap_or_default(),
                "env": payload.env.unwrap_or_default(),
                "cwd": clean(payload.cwd),
            })
        }
        "http" | "sse" => {
            let url = clean(payload.url)
                .ok_or_else(|| "url is required for remote Skynet MCP server".to_string())?;
            json!({
                "type": server_type,
                "url": url,
                "headers": payload.headers.unwrap_or_default(),
            })
        }
        other => return Err(format!("unsupported Skynet MCP type: {other}")),
    };

    Ok(McpServer {
        id: format!("skynet:{}", payload.id.trim()),
        name: clean(payload.display_name).unwrap_or(payload.name),
        server,
        apps,
        description: Some(payload.description).filter(|v| !v.is_empty()),
        homepage: None,
        docs: None,
        tags: vec!["skynet".to_string()],
    })
}

#[tauri::command]
pub fn install_skynet_skill_zip(
    bytes: Vec<u8>,
    current_app: String,
    app_state: State<'_, AppState>,
) -> Result<Vec<InstalledSkill>, String> {
    let app_type = AppType::from_str(&current_app).map_err(|e| e.to_string())?;
    let temp = tempfile::Builder::new()
        .prefix("skynet-skill-")
        .suffix(".zip")
        .tempfile()
        .map_err(|e| e.to_string())?;
    std::fs::write(temp.path(), bytes).map_err(|e| e.to_string())?;
    SkillService::install_from_zip(&app_state.db, temp.path(), &app_type)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn install_skynet_mcp_server(
    server: SkynetMcpServerPayload,
    current_app: String,
    app_state: State<'_, AppState>,
) -> Result<McpServer, String> {
    let app_type = AppType::from_str(&current_app).map_err(|e| e.to_string())?;
    let mapped = map_skynet_mcp_server(server, &app_type)?;
    McpService::upsert_server(&app_state, mapped.clone()).map_err(|e| e.to_string())?;
    Ok(mapped)
}

pub fn map_skynet_mcp_server_for_test(
    payload: SkynetMcpServerPayload,
    current_app: &AppType,
) -> Result<McpServer, String> {
    map_skynet_mcp_server(payload, current_app)
}
```

Modify `src-tauri/src/commands/mod.rs`:

```rust
mod skynet;
pub use skynet::*;
```

Modify `src-tauri/src/lib.rs` handler list to include:

```rust
commands::install_skynet_skill_zip,
commands::install_skynet_mcp_server,
```

- [ ] **Step 4: Run Rust test and verify it passes**

Run:

```bash
cd src-tauri && cargo test --test skynet_commands
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/commands/skynet.rs src-tauri/src/commands/mod.rs src-tauri/src/lib.rs src-tauri/tests/skynet_commands.rs
git commit -m "feat: add skynet install commands"
```

---

### Task 3: Skynet React Query Hooks

**Files:**
- Create: `src/hooks/useSkynetCatalog.ts`
- Test: `tests/hooks/useSkynetCatalog.test.tsx`

- [ ] **Step 1: Write failing hook tests**

Create tests that mock `@/lib/api/skynet`, call `useInstallSkynetMcpServer`, and verify `["mcp", "all"]` invalidates after success; call `useInstallSkynetSkill` and verify `["skills", "installed"]` invalidates after success.

- [ ] **Step 2: Run hook tests and verify they fail**

```bash
pnpm vitest run tests/hooks/useSkynetCatalog.test.tsx
```

Expected: FAIL because the hook file does not exist.

- [ ] **Step 3: Implement hooks**

Create `src/hooks/useSkynetCatalog.ts` with hooks:

```ts
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { AppId } from "@/lib/api/types";
import {
  DEFAULT_SKYNET_BASE_URL,
  downloadSkynetSkillZip,
  installSkynetMcpServer,
  installSkynetSkillZip,
  listSkynetMcpServers,
  listSkynetSkills,
  type SkynetMcpServer,
  type SkynetSkill,
} from "@/lib/api/skynet";

export function useSkynetSkills(baseUrl = DEFAULT_SKYNET_BASE_URL, enabled = false) {
  return useQuery({
    queryKey: ["skynet", "skills", baseUrl],
    queryFn: () => listSkynetSkills(baseUrl),
    enabled,
  });
}

export function useSkynetMcpServers(baseUrl = DEFAULT_SKYNET_BASE_URL, enabled = false) {
  return useQuery({
    queryKey: ["skynet", "mcp", baseUrl],
    queryFn: () => listSkynetMcpServers(baseUrl),
    enabled,
  });
}

export function useInstallSkynetSkill(baseUrl = DEFAULT_SKYNET_BASE_URL) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ skill, currentApp }: { skill: SkynetSkill; currentApp: AppId }) => {
      const bytes = await downloadSkynetSkillZip(skill.id, baseUrl);
      return installSkynetSkillZip(bytes, currentApp);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["skills", "installed"] });
    },
  });
}

export function useInstallSkynetMcpServer() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ server, currentApp }: { server: SkynetMcpServer; currentApp: AppId }) =>
      installSkynetMcpServer(server, currentApp),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["mcp", "all"] });
    },
  });
}
```

- [ ] **Step 4: Run hook tests and verify they pass**

```bash
pnpm vitest run tests/hooks/useSkynetCatalog.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useSkynetCatalog.ts tests/hooks/useSkynetCatalog.test.tsx
git commit -m "feat: add skynet catalog hooks"
```

---

### Task 4: Catalog UI and Page Entry Points

**Files:**
- Create: `src/components/skynet/SkynetCatalogDialog.tsx`
- Create: `src/components/skynet/SkynetSkillCatalog.tsx`
- Create: `src/components/skynet/SkynetMcpCatalog.tsx`
- Modify: `src/components/skills/UnifiedSkillsPanel.tsx`
- Modify: `src/components/mcp/UnifiedMcpPanel.tsx`
- Test: `tests/components/SkynetCatalogDialog.test.tsx`
- Test: `tests/components/UnifiedSkillsPanel.test.tsx`

- [ ] **Step 1: Write failing UI tests**

Add tests that render the dialog in auth-required state and click login, expecting `settingsApi.openExternal` to receive the Skynet base URL. Extend `UnifiedSkillsPanel.test.tsx` to assert the imperative handle opens a Skynet catalog action if exposed.

- [ ] **Step 2: Run UI tests and verify they fail**

```bash
pnpm vitest run tests/components/SkynetCatalogDialog.test.tsx tests/components/UnifiedSkillsPanel.test.tsx
```

Expected: FAIL because components/handle do not exist yet.

- [ ] **Step 3: Implement shared dialog and catalog lists**

Implement a compact operational dialog using existing `Dialog`, `Button`, `Badge`, `Loader2`, `RefreshCw`, `Download`, and `LogIn` patterns. The dialog must have:

- loading state
- empty state
- auth-required state with login and retry buttons
- item list slot/content

Add a `openSkynetCatalog` method to each panel handle and wire a local `skynetCatalogOpen` state.

- [ ] **Step 4: Run UI tests and verify they pass**

```bash
pnpm vitest run tests/components/SkynetCatalogDialog.test.tsx tests/components/UnifiedSkillsPanel.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/skynet src/components/skills/UnifiedSkillsPanel.tsx src/components/mcp/UnifiedMcpPanel.tsx tests/components/SkynetCatalogDialog.test.tsx tests/components/UnifiedSkillsPanel.test.tsx
git commit -m "feat: add skynet catalog UI"
```

---

### Task 5: Final Verification

**Files:**
- Modify only files needed to fix verification issues discovered here.

- [ ] **Step 1: Run focused tests**

```bash
pnpm vitest run tests/lib/skynetApi.test.ts tests/hooks/useSkynetCatalog.test.tsx tests/components/SkynetCatalogDialog.test.tsx
cd src-tauri && cargo test --test skynet_commands
```

Expected: PASS.

- [ ] **Step 2: Run full frontend checks**

```bash
pnpm run typecheck
pnpm run test:unit
```

Expected: PASS.

- [ ] **Step 3: Confirm no uncommitted verification fixes remain**

Run:

```bash
git status --short
```

Expected: no uncommitted files, except intentionally untracked local runtime directories outside this worktree.

- [ ] **Step 4: Prepare PR handoff**

Run:

```bash
git status --short
git log --oneline --decorate -5
```

Expected: only intentional changes are present and recent commits cover the feature.

---

## Self-Review

- Spec coverage: catalog listing, login-required handling, Skill ZIP install, MCP mapping/install, UI entry points, and tests are covered.
- Placeholder scan: no TBD/TODO placeholders are present.
- Type consistency: `SkynetSkill`, `SkynetMcpServer`, and Rust `SkynetMcpServerPayload` names align with planned API calls.
- Scope check: plugin bundle install and Skynet catalog mutation remain out of scope.
