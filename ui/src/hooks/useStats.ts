import { useQuery } from "@tanstack/react-query";
import { fetchStats, fetchHealth } from "@/lib/api";

/**
 * Hook to fetch system stats with auto-refresh
 */
export function useStats(refetchInterval = 5000) {
  return useQuery({
    queryKey: ["stats"],
    queryFn: fetchStats,
    refetchInterval,
    staleTime: 2000,
  });
}

/**
 * Hook to check API health
 */
export function useHealth() {
  return useQuery({
    queryKey: ["health"],
    queryFn: fetchHealth,
    refetchInterval: 10000,
    retry: 2,
  });
}
