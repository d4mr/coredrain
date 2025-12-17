import { useQuery } from "@tanstack/react-query";
import { fetchSpotMeta } from "@/lib/api";
import type { SpotToken } from "@/types";

// Add HYPE as a native token (not in spotMeta)
const HYPE_TOKEN: SpotToken = {
  name: "HYPE",
  szDecimals: 8,
  weiDecimals: 18,
  index: -1, // Special index for native token
  tokenId: "native",
  isCanonical: true,
  evmContract: null,
  fullName: "Hyperliquid",
};

/**
 * Hook to fetch and cache spot token metadata
 */
export function useAssets() {
  return useQuery({
    queryKey: ["spotMeta"],
    queryFn: async () => {
      const data = await fetchSpotMeta();
      // Add HYPE at the beginning
      return [HYPE_TOKEN, ...data.tokens];
    },
    staleTime: 5 * 60 * 1000, // Cache for 5 minutes
    gcTime: 30 * 60 * 1000, // Keep in cache for 30 minutes
  });
}

/**
 * Hook to get a specific token by name
 */
export function useAsset(name: string | undefined) {
  const { data: assets } = useAssets();
  
  if (!name || !assets) return undefined;
  return assets.find((t) => t.name.toLowerCase() === name.toLowerCase());
}
