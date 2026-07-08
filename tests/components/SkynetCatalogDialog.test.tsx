import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { SkynetCatalogDialog } from "@/components/skynet/SkynetCatalogDialog";

const hookMocks = vi.hoisted(() => ({
  useSkynetSkills: vi.fn(),
  useSkynetMcpServers: vi.fn(),
  useInstallSkynetSkill: vi.fn(),
  useInstallSkynetMcpServer: vi.fn(),
  installSkillMutateAsync: vi.fn(),
  installMcpMutateAsync: vi.fn(),
}));

const skynetApiMocks = vi.hoisted(() => ({
  openSkynetLoginWindow: vi.fn(),
}));

vi.mock("@/hooks/useSkynetCatalog", () => ({
  useSkynetSkills: (...args: unknown[]) => hookMocks.useSkynetSkills(...args),
  useSkynetMcpServers: (...args: unknown[]) =>
    hookMocks.useSkynetMcpServers(...args),
  useInstallSkynetSkill: () => hookMocks.useInstallSkynetSkill(),
  useInstallSkynetMcpServer: () => hookMocks.useInstallSkynetMcpServer(),
}));

vi.mock("@/lib/api/skynet", () => {
  class SkynetAuthRequiredError extends Error {
    constructor() {
      super("Skynet login required");
      this.name = "SkynetAuthRequiredError";
    }
  }

  return {
    DEFAULT_SKYNET_BASE_URL: "https://tools-test.inshopline.com",
    SkynetAuthRequiredError,
    openSkynetLoginWindow: (...args: unknown[]) =>
      skynetApiMocks.openSkynetLoginWindow(...args),
  };
});

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

function baseQueryState(overrides: Record<string, unknown> = {}) {
  return {
    data: [],
    error: null,
    isLoading: false,
    isFetching: false,
    refetch: vi.fn(),
    ...overrides,
  };
}

describe("SkynetCatalogDialog", () => {
  beforeEach(() => {
    skynetApiMocks.openSkynetLoginWindow.mockReset().mockResolvedValue(
      undefined,
    );
    hookMocks.installSkillMutateAsync.mockReset().mockResolvedValue({});
    hookMocks.installMcpMutateAsync.mockReset().mockResolvedValue(undefined);
    hookMocks.useInstallSkynetSkill.mockReset().mockReturnValue({
      mutateAsync: hookMocks.installSkillMutateAsync,
    });
    hookMocks.useInstallSkynetMcpServer.mockReset().mockReturnValue({
      mutateAsync: hookMocks.installMcpMutateAsync,
    });
    hookMocks.useSkynetSkills.mockReset().mockReturnValue(baseQueryState());
    hookMocks.useSkynetMcpServers.mockReset().mockReturnValue(baseQueryState());
  });

  it("renders skills and installs the selected skill", async () => {
    hookMocks.useSkynetSkills.mockReturnValue(
      baseQueryState({
        data: [
          {
            id: "skill-1",
            name: "Log Helper",
            description: "Inspect logs",
            uploaderId: "joy",
          },
        ],
      }),
    );

    render(
      <SkynetCatalogDialog
        open
        kind="skills"
        currentApp="codex"
        baseUrl="https://tools-test.inshopline.com"
        onOpenChange={() => {}}
      />,
    );

    expect(screen.getByText("Log Helper")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Install" }));

    await waitFor(() => {
      expect(hookMocks.installSkillMutateAsync).toHaveBeenCalledWith({
        skillId: "skill-1",
        currentApp: "codex",
        baseUrl: "https://tools-test.inshopline.com",
      });
    });
  });

  it("opens skynet login inside the app and refreshes after the window closes", async () => {
    const refetch = vi.fn();
    const { SkynetAuthRequiredError } = await import("@/lib/api/skynet");
    hookMocks.useSkynetSkills.mockReturnValue(
      baseQueryState({
        error: new SkynetAuthRequiredError(),
        refetch,
      }),
    );

    render(
      <SkynetCatalogDialog
        open
        kind="skills"
        currentApp="codex"
        baseUrl="https://tools-test.inshopline.com"
        onOpenChange={() => {}}
      />,
    );

    await userEvent.click(screen.getByRole("button", { name: "Open login" }));

    await waitFor(() => {
      expect(skynetApiMocks.openSkynetLoginWindow).toHaveBeenCalledWith(
        "https://tools-test.inshopline.com",
      );
      expect(refetch).toHaveBeenCalled();
    });
  });

  it("shows a friendly message for browser-level load failures", () => {
    hookMocks.useSkynetSkills.mockReturnValue(
      baseQueryState({
        error: new TypeError("Load failed"),
      }),
    );

    render(
      <SkynetCatalogDialog
        open
        kind="skills"
        currentApp="codex"
        baseUrl="https://tools-test.inshopline.com"
        onOpenChange={() => {}}
      />,
    );

    expect(
      screen.getByText(/Unable to load Skynet catalog/),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("TypeError: Load failed"),
    ).not.toBeInTheDocument();
  });

  it("renders mcp servers and installs the selected server", async () => {
    const server = {
      id: "mcp-1",
      name: "log-mcp",
      displayName: "Log MCP",
      description: "Query logs",
      type: "stdio" as const,
      command: "node",
    };
    hookMocks.useSkynetMcpServers.mockReturnValue(
      baseQueryState({ data: [server] }),
    );

    render(
      <SkynetCatalogDialog
        open
        kind="mcp"
        currentApp="claude"
        baseUrl="https://tools-test.inshopline.com"
        onOpenChange={() => {}}
      />,
    );

    await userEvent.click(screen.getByRole("button", { name: "Install" }));

    await waitFor(() => {
      expect(hookMocks.installMcpMutateAsync).toHaveBeenCalledWith({
        server,
        currentApp: "claude",
      });
    });
  });
});
