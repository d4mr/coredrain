import { useQuery } from "@tanstack/react-query";
import { fetchTransfers, fetchTransferByHash, type TransferFilters } from "@/lib/api";

/**
 * Hook to fetch transfers with auto-refresh
 */
export function useTransfers(filters: TransferFilters = {}, refetchInterval = 5000) {
  return useQuery({
    queryKey: ["transfers", filters],
    queryFn: () => fetchTransfers(filters),
    refetchInterval,
    staleTime: 2000,
  });
}

/**
 * Hook to fetch a single transfer by hash
 */
export function useTransferByHash(hash: string | null) {
  return useQuery({
    queryKey: ["transfer", hash],
    queryFn: () => fetchTransferByHash(hash!),
    enabled: !!hash && hash.length > 10,
    retry: false,
    staleTime: 10000,
  });
}
