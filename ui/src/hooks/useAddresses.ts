import { useQuery } from "@tanstack/react-query";
import { fetchAddresses } from "@/lib/api";

/**
 * Hook to fetch watched addresses
 */
export function useAddresses(refetchInterval = 30000) {
  return useQuery({
    queryKey: ["addresses"],
    queryFn: fetchAddresses,
    refetchInterval,
    staleTime: 10000,
  });
}
