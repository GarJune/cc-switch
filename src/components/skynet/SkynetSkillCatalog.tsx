import { Download, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import type { SkynetSkill } from "@/lib/api/skynet";

interface SkynetSkillCatalogProps {
  skills: SkynetSkill[];
  installingId?: string | null;
  onInstall: (skill: SkynetSkill) => void;
}

export function SkynetSkillCatalog({
  skills,
  installingId,
  onInstall,
}: SkynetSkillCatalogProps) {
  if (skills.length === 0) {
    return (
      <div className="py-12 text-center text-sm text-muted-foreground">
        No matching Skynet skills.
      </div>
    );
  }

  return (
    <div className="divide-y divide-border-default overflow-hidden rounded-lg border border-border-default">
      {skills.map((skill) => (
        <div
          key={skill.id}
          className="flex min-h-[68px] items-center gap-3 px-3 py-2.5"
        >
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="truncate text-sm font-medium text-foreground">
                {skill.name}
              </span>
              {skill.uploaderId && (
                <span className="shrink-0 text-xs text-muted-foreground/70">
                  {skill.uploaderId}
                </span>
              )}
            </div>
            {skill.description && (
              <p className="truncate text-xs text-muted-foreground">
                {skill.description}
              </p>
            )}
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-8 shrink-0 gap-1.5"
            disabled={installingId === skill.id}
            onClick={() => onInstall(skill)}
          >
            {installingId === skill.id ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Download className="h-3.5 w-3.5" />
            )}
            Install
          </Button>
        </div>
      ))}
    </div>
  );
}
