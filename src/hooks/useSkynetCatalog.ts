import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";

import {
  DEFAULT_SKYNET_BASE_URL,
  downloadSkynetSkillZip,
  installSkynetMcpServer,
  installSkynetSkillZip,
  listSkynetMcpServers,
  listSkynetSkills,
  type SkynetMcpServer,
} from "@/lib/api/skynet";
import type { AppId } from "@/lib/api/types";

interface SkynetQueryOptions {
  baseUrl?: string;
  enabled?: boolean;
}

function skynetBaseKey(baseUrl?: string): string {
  return baseUrl ?? DEFAULT_SKYNET_BASE_URL;
}

export function useSkynetSkills(options?: SkynetQueryOptions) {
  const baseUrl = skynetBaseKey(options?.baseUrl);

  return useQuery({
    queryKey: ["skynet", "skills", baseUrl],
    queryFn: () => listSkynetSkills(baseUrl),
    enabled: options?.enabled ?? true,
    staleTime: 5 * 60 * 1000,
    placeholderData: keepPreviousData,
  });
}

export function useSkynetMcpServers(options?: SkynetQueryOptions) {
  const baseUrl = skynetBaseKey(options?.baseUrl);

  return useQuery({
    queryKey: ["skynet", "mcpServers", baseUrl],
    queryFn: () => listSkynetMcpServers(baseUrl),
    enabled: options?.enabled ?? true,
    staleTime: 5 * 60 * 1000,
    placeholderData: keepPreviousData,
  });
}

export function useInstallSkynetSkill() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      skillId,
      currentApp,
      baseUrl,
    }: {
      skillId: string;
      currentApp: AppId;
      baseUrl?: string;
    }) => {
      const bytes = await downloadSkynetSkillZip(
        skillId,
        skynetBaseKey(baseUrl),
      );
      return await installSkynetSkillZip(bytes, currentApp);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["skills", "installed"] });
    },
  });
}

export function useInstallSkynetMcpServer() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      server,
      currentApp,
    }: {
      server: SkynetMcpServer;
      currentApp: AppId;
    }) => installSkynetMcpServer(server, currentApp),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["mcp", "all"] });
    },
  });
}
