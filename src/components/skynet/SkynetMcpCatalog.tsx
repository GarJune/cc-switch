import { Download, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import type { SkynetMcpServer } from "@/lib/api/skynet";

interface SkynetMcpCatalogProps {
  servers: SkynetMcpServer[];
  installingId?: string | null;
  onInstall: (server: SkynetMcpServer) => void;
}

export function SkynetMcpCatalog({
  servers,
  installingId,
  onInstall,
}: SkynetMcpCatalogProps) {
  if (servers.length === 0) {
    return (
      <div className="py-12 text-center text-sm text-muted-foreground">
        No matching Skynet MCP servers.
      </div>
    );
  }

  return (
    <div className="divide-y divide-border-default overflow-hidden rounded-lg border border-border-default">
      {servers.map((server) => {
        const title = server.displayName || server.name;
        return (
          <div
            key={server.id}
            className="flex min-h-[68px] items-center gap-3 px-3 py-2.5"
          >
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="truncate text-sm font-medium text-foreground">
                  {title}
                </span>
                <span className="shrink-0 rounded border border-border-default px-1.5 py-0.5 text-[10px] uppercase text-muted-foreground">
                  {server.type}
                </span>
              </div>
              {server.description && (
                <p className="truncate text-xs text-muted-foreground">
                  {server.description}
                </p>
              )}
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8 shrink-0 gap-1.5"
              disabled={installingId === server.id}
              onClick={() => onInstall(server)}
            >
              {installingId === server.id ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Download className="h-3.5 w-3.5" />
              )}
              Install
            </Button>
          </div>
        );
      })}
    </div>
  );
}
