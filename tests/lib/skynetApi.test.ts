import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  SkynetAuthRequiredError,
  downloadSkynetSkillZip,
  installSkynetMcpServer,
  installSkynetSkillZip,
  listSkynetMcpServers,
  listSkynetSkills,
} from "@/lib/api/skynet";

const fetchMock = vi.fn();
const invokeMock = vi.fn();

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

describe("skynet api client", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    invokeMock.mockReset();
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
      updatedAt: "2026-07-08T00:00:00Z",
    });
  });

  it("lists mcp servers with snake_case fields normalized", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          servers: [
            {
              id: "mcp-1",
              name: "log-mcp",
              display_name: "Log MCP",
              description: "Query logs",
              uploader_id: "joy",
              updated_at: "2026-07-08T00:00:00Z",
              type: "stdio",
              command: "node",
              args: ["server.js"],
              env: { LOG_LEVEL: "info" },
            },
          ],
        }),
        { status: 200 },
      ),
    );

    const servers = await listSkynetMcpServers(
      "https://tools-test.inshopline.com/",
    );

    expect(fetchMock).toHaveBeenCalledWith(
      "https://tools-test.inshopline.com/skynet-service/devkit/mcp-servers",
      expect.objectContaining({ credentials: "include" }),
    );
    expect(servers[0]).toMatchObject({
      id: "mcp-1",
      name: "log-mcp",
      displayName: "Log MCP",
      uploaderId: "joy",
      type: "stdio",
      command: "node",
      args: ["server.js"],
      env: { LOG_LEVEL: "info" },
    });
  });

  it("normalizes 401 responses to auth-required errors", async () => {
    fetchMock.mockResolvedValueOnce(new Response("{}", { status: 401 }));

    await expect(
      listSkynetMcpServers("https://tools-test.inshopline.com"),
    ).rejects.toBeInstanceOf(SkynetAuthRequiredError);
  });

  it("normalizes skynet unlogin envelopes to auth-required errors", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ code: "UNLOGIN" }), { status: 200 }),
    );

    await expect(
      listSkynetSkills("https://tools-test.inshopline.com"),
    ).rejects.toBeInstanceOf(SkynetAuthRequiredError);
  });

  it("downloads skill zip bytes with browser credentials", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(new Uint8Array([1, 2, 3]), { status: 200 }),
    );

    const bytes = await downloadSkynetSkillZip(
      "skill-1",
      "https://tools-test.inshopline.com",
    );

    expect(fetchMock).toHaveBeenCalledWith(
      "https://tools-test.inshopline.com/skynet-service/devkit/skills/skill-1/download",
      expect.objectContaining({ credentials: "include" }),
    );
    expect([...bytes]).toEqual([1, 2, 3]);
  });

  it("passes downloaded zip bytes to the tauri installer", async () => {
    invokeMock.mockResolvedValueOnce({
      id: "skill-1",
      name: "Log Helper",
      directory: "log-helper",
      apps: {
        claude: false,
        codex: true,
        gemini: false,
        opencode: false,
        openclaw: false,
        hermes: false,
      },
      installedAt: 1,
      updatedAt: 1,
    });

    await installSkynetSkillZip(new Uint8Array([1, 2, 3]), "codex");

    expect(invokeMock).toHaveBeenCalledWith("install_skynet_skill_zip", {
      bytes: [1, 2, 3],
      currentApp: "codex",
    });
  });

  it("passes mcp catalog payloads to the tauri installer", async () => {
    invokeMock.mockResolvedValueOnce(undefined);

    await installSkynetMcpServer(
      {
        id: "mcp-1",
        name: "log-mcp",
        displayName: "Log MCP",
        description: "Query logs",
        type: "stdio",
        command: "node",
        args: ["server.js"],
      },
      "claude",
    );

    expect(invokeMock).toHaveBeenCalledWith("install_skynet_mcp_server", {
      server: expect.objectContaining({ id: "mcp-1", displayName: "Log MCP" }),
      currentApp: "claude",
    });
  });
});
