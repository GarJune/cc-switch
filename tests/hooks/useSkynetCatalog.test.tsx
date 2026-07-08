import type { ReactNode } from "react";
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  useInstallSkynetMcpServer,
  useInstallSkynetSkill,
  useSkynetMcpServers,
  useSkynetSkills,
} from "@/hooks/useSkynetCatalog";

const skynetApiMocks = vi.hoisted(() => ({
  listSkynetSkills: vi.fn(),
  listSkynetMcpServers: vi.fn(),
  downloadSkynetSkillZip: vi.fn(),
  installSkynetSkillZip: vi.fn(),
  installSkynetMcpServer: vi.fn(),
}));

vi.mock("@/lib/api/skynet", () => ({
  listSkynetSkills: (...args: unknown[]) =>
    skynetApiMocks.listSkynetSkills(...args),
  listSkynetMcpServers: (...args: unknown[]) =>
    skynetApiMocks.listSkynetMcpServers(...args),
  downloadSkynetSkillZip: (...args: unknown[]) =>
    skynetApiMocks.downloadSkynetSkillZip(...args),
  installSkynetSkillZip: (...args: unknown[]) =>
    skynetApiMocks.installSkynetSkillZip(...args),
  installSkynetMcpServer: (...args: unknown[]) =>
    skynetApiMocks.installSkynetMcpServer(...args),
}));

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );

  return { wrapper, queryClient, invalidateSpy };
}

describe("useSkynetCatalog", () => {
  beforeEach(() => {
    skynetApiMocks.listSkynetSkills.mockReset().mockResolvedValue([]);
    skynetApiMocks.listSkynetMcpServers.mockReset().mockResolvedValue([]);
    skynetApiMocks.downloadSkynetSkillZip
      .mockReset()
      .mockResolvedValue(new Uint8Array([1, 2, 3]));
    skynetApiMocks.installSkynetSkillZip.mockReset().mockResolvedValue({
      id: "skill-1",
      name: "Log Helper",
    });
    skynetApiMocks.installSkynetMcpServer.mockReset().mockResolvedValue(
      undefined,
    );
  });

  it("queries skynet skills with a stable catalog key", async () => {
    skynetApiMocks.listSkynetSkills.mockResolvedValueOnce([
      { id: "skill-1", name: "Log Helper", description: "", uploaderId: "joy" },
    ]);
    const { wrapper, queryClient } = createWrapper();

    const { result } = renderHook(
      () => useSkynetSkills({ baseUrl: "https://tools-test.inshopline.com" }),
      { wrapper },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(skynetApiMocks.listSkynetSkills).toHaveBeenCalledWith(
      "https://tools-test.inshopline.com",
    );
    expect(
      queryClient.getQueryData([
        "skynet",
        "skills",
        "https://tools-test.inshopline.com",
      ]),
    ).toEqual([
      { id: "skill-1", name: "Log Helper", description: "", uploaderId: "joy" },
    ]);
  });

  it("can keep mcp server queries disabled until a dialog opens", () => {
    const { wrapper } = createWrapper();

    renderHook(
      () =>
        useSkynetMcpServers({
          baseUrl: "https://tools-test.inshopline.com",
          enabled: false,
        }),
      { wrapper },
    );

    expect(skynetApiMocks.listSkynetMcpServers).not.toHaveBeenCalled();
  });

  it("downloads and installs a skynet skill, then invalidates installed skills", async () => {
    const { wrapper, invalidateSpy } = createWrapper();
    const { result } = renderHook(() => useInstallSkynetSkill(), { wrapper });

    await act(async () => {
      await result.current.mutateAsync({
        skillId: "skill-1",
        currentApp: "codex",
        baseUrl: "https://tools-test.inshopline.com",
      });
    });

    expect(skynetApiMocks.downloadSkynetSkillZip).toHaveBeenCalledWith(
      "skill-1",
      "https://tools-test.inshopline.com",
    );
    expect(skynetApiMocks.installSkynetSkillZip).toHaveBeenCalledWith(
      new Uint8Array([1, 2, 3]),
      "codex",
    );
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: ["skills", "installed"],
    });
  });

  it("installs a skynet mcp server, then invalidates local mcp servers", async () => {
    const { wrapper, invalidateSpy } = createWrapper();
    const { result } = renderHook(() => useInstallSkynetMcpServer(), {
      wrapper,
    });

    const server = {
      id: "mcp-1",
      name: "log-mcp",
      description: "Query logs",
      type: "stdio" as const,
      command: "node",
    };

    await act(async () => {
      await result.current.mutateAsync({ server, currentApp: "claude" });
    });

    expect(skynetApiMocks.installSkynetMcpServer).toHaveBeenCalledWith(
      server,
      "claude",
    );
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["mcp", "all"] });
  });
});
