import { useMemo, useState } from "react";
import { Loader2, LogIn, RefreshCw, Search } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  DEFAULT_SKYNET_BASE_URL,
  SkynetAuthRequiredError,
  openSkynetLoginWindow,
  type SkynetMcpServer,
  type SkynetSkill,
} from "@/lib/api/skynet";
import type { AppId } from "@/lib/api/types";
import {
  useInstallSkynetMcpServer,
  useInstallSkynetSkill,
  useSkynetMcpServers,
  useSkynetSkills,
} from "@/hooks/useSkynetCatalog";
import { SkynetMcpCatalog } from "./SkynetMcpCatalog";
import { SkynetSkillCatalog } from "./SkynetSkillCatalog";

type SkynetCatalogKind = "skills" | "mcp";

interface SkynetCatalogDialogProps {
  open: boolean;
  kind: SkynetCatalogKind;
  currentApp: AppId;
  baseUrl?: string;
  onOpenChange: (open: boolean) => void;
}

function isAuthRequired(error: unknown): boolean {
  return (
    error instanceof SkynetAuthRequiredError ||
    (error instanceof Error && error.name === "SkynetAuthRequiredError")
  );
}

function matchesQuery(
  item: Pick<SkynetSkill, "name" | "description"> | SkynetMcpServer,
  query: string,
): boolean {
  if (!query) return true;

  const haystack = [
    item.name,
    item.description,
    "displayName" in item ? item.displayName : undefined,
    "type" in item ? item.type : undefined,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  return haystack.includes(query.toLowerCase());
}

function formatSkynetError(error: unknown): string {
  if (error instanceof TypeError) {
    return "Unable to load Skynet catalog. Please log in inside this app, then retry.";
  }
  return String(error);
}

export function SkynetCatalogDialog({
  open,
  kind,
  currentApp,
  baseUrl = DEFAULT_SKYNET_BASE_URL,
  onOpenChange,
}: SkynetCatalogDialogProps) {
  const [query, setQuery] = useState("");
  const [installingId, setInstallingId] = useState<string | null>(null);
  const skillsQuery = useSkynetSkills({
    baseUrl,
    enabled: open && kind === "skills",
  });
  const mcpQuery = useSkynetMcpServers({
    baseUrl,
    enabled: open && kind === "mcp",
  });
  const installSkill = useInstallSkynetSkill();
  const installMcp = useInstallSkynetMcpServer();

  const activeQuery = kind === "skills" ? skillsQuery : mcpQuery;
  const title = kind === "skills" ? "Skynet Skills" : "Skynet MCP";
  const description =
    kind === "skills"
      ? "Browse internal Skynet skills and install them into the selected app."
      : "Browse internal Skynet MCP servers and add them to the selected app.";

  const filteredSkills = useMemo(
    () => (skillsQuery.data ?? []).filter((skill) => matchesQuery(skill, query)),
    [skillsQuery.data, query],
  );
  const filteredServers = useMemo(
    () =>
      (mcpQuery.data ?? []).filter((server) => matchesQuery(server, query)),
    [mcpQuery.data, query],
  );

  const openLogin = async () => {
    try {
      await openSkynetLoginWindow(baseUrl);
    } catch (error) {
      toast.error("Failed to open Skynet login", {
        description: String(error),
      });
    }
  };

  const handleInstallSkill = async (skill: SkynetSkill) => {
    setInstallingId(skill.id);
    try {
      await installSkill.mutateAsync({
        skillId: skill.id,
        currentApp,
        baseUrl,
      });
      toast.success(`Installed ${skill.name}`, { closeButton: true });
    } catch (error) {
      toast.error("Skynet skill install failed", {
        description: String(error),
      });
    } finally {
      setInstallingId(null);
    }
  };

  const handleInstallMcp = async (server: SkynetMcpServer) => {
    setInstallingId(server.id);
    try {
      await installMcp.mutateAsync({ server, currentApp });
      toast.success(`Installed ${server.displayName || server.name}`, {
        closeButton: true,
      });
    } catch (error) {
      toast.error("Skynet MCP install failed", {
        description: String(error),
      });
    } finally {
      setInstallingId(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl" zIndex="top">
        <DialogHeader>
          <div className="flex items-start justify-between gap-3">
            <div>
              <DialogTitle>{title}</DialogTitle>
              <DialogDescription>{description}</DialogDescription>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                onClick={() => activeQuery.refetch()}
                disabled={activeQuery.isFetching}
                title="Refresh"
              >
                {activeQuery.isFetching ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <RefreshCw className="h-4 w-4" />
                )}
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-8 gap-1.5"
                onClick={openLogin}
              >
                <LogIn className="h-3.5 w-3.5" />
                Login
              </Button>
            </div>
          </div>
        </DialogHeader>

        <div className="flex min-h-0 flex-1 flex-col gap-3 px-6 py-4">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search Skynet catalog"
              className="pl-8"
            />
          </div>

          <div className="max-h-[52vh] min-h-[220px] overflow-y-auto">
            {activeQuery.isLoading || activeQuery.isFetching ? (
              <div className="flex h-[220px] items-center justify-center text-sm text-muted-foreground">
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Loading Skynet catalog
              </div>
            ) : isAuthRequired(activeQuery.error) ? (
              <div className="flex h-[220px] flex-col items-center justify-center gap-3 text-center">
                <div className="text-sm font-medium text-foreground">
                  Skynet login required
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="gap-1.5"
                  onClick={openLogin}
                >
                  <LogIn className="h-3.5 w-3.5" />
                  Open login
                </Button>
              </div>
            ) : activeQuery.error ? (
              <div className="flex h-[220px] flex-col items-center justify-center gap-3 text-center">
                <div className="max-w-md text-sm text-muted-foreground">
                  {formatSkynetError(activeQuery.error)}
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => activeQuery.refetch()}
                >
                  Retry
                </Button>
              </div>
            ) : kind === "skills" ? (
              <SkynetSkillCatalog
                skills={filteredSkills}
                installingId={installingId}
                onInstall={handleInstallSkill}
              />
            ) : (
              <SkynetMcpCatalog
                servers={filteredServers}
                installingId={installingId}
                onInstall={handleInstallMcp}
              />
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
