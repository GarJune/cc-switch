import { invoke } from "@tauri-apps/api/core";

import type { InstalledSkill } from "@/lib/api/skills";
import type { AppId } from "@/lib/api/types";

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

export async function openSkynetLoginWindow(
  baseUrl = DEFAULT_SKYNET_BASE_URL,
): Promise<void> {
  const loginUrl = joinSkynetUrl(baseUrl, "/skynet-service/devkit/user");
  await invoke("open_skynet_login_window", { loginUrl });
}

function normalizeAuthError(response: Response): never {
  if (response.status === 401 || response.status === 403) {
    throw new SkynetAuthRequiredError();
  }
  throw new Error(`Skynet request failed: HTTP ${response.status}`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function mapStringRecord(value: unknown): Record<string, string> | undefined {
  if (!isRecord(value)) return undefined;

  return Object.fromEntries(
    Object.entries(value)
      .filter(([, entryValue]) => entryValue != null)
      .map(([key, entryValue]) => [key, String(entryValue)]),
  );
}

async function readJson<T>(response: Response): Promise<T> {
  if (!response.ok) normalizeAuthError(response);

  const json = (await response.json()) as unknown;
  if (
    isRecord(json) &&
    "code" in json &&
    String(json.code).toUpperCase() === "UNLOGIN"
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
  const rawType = raw.type;
  const type =
    rawType === "http" || rawType === "sse" || rawType === "stdio"
      ? rawType
      : "stdio";

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
    type,
    command: typeof raw.command === "string" ? raw.command : undefined,
    args: Array.isArray(raw.args) ? raw.args.map(String) : undefined,
    env: mapStringRecord(raw.env),
    cwd: typeof raw.cwd === "string" ? raw.cwd : undefined,
    url: typeof raw.url === "string" ? raw.url : undefined,
    headers: mapStringRecord(raw.headers),
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

  return (payload.servers ?? [])
    .map(mapMcpServer)
    .filter((server) => server.id);
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
): Promise<InstalledSkill> {
  return await invoke("install_skynet_skill_zip", {
    bytes: Array.from(bytes),
    currentApp,
  });
}

export async function installSkynetMcpServer(
  server: SkynetMcpServer,
  currentApp: AppId,
): Promise<void> {
  return await invoke("install_skynet_mcp_server", { server, currentApp });
}
