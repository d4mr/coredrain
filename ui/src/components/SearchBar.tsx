import { useState, useEffect, useRef } from "react";
import { Input } from "./Input";
import { SearchIcon } from "./Icons";
import { useTransferByHash } from "@/hooks/useTransfers";
import { TransferModal } from "./TransferModal";

export function SearchBar() {
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [isModalOpen, setIsModalOpen] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const { data: transfer, isLoading, error } = useTransferByHash(debouncedQuery);

  // Debounce search
  useEffect(() => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }
    debounceRef.current = setTimeout(() => {
      setDebouncedQuery(query);
    }, 300);
    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
    };
  }, [query]);

  // Open modal when we have a result
  useEffect(() => {
    if (transfer && debouncedQuery) {
      setIsModalOpen(true);
    }
  }, [transfer, debouncedQuery]);

  const handleClose = () => {
    setIsModalOpen(false);
    setQuery("");
    setDebouncedQuery("");
  };

  return (
    <div className="relative">
      <Input
        icon={<SearchIcon />}
        placeholder="Search by transaction hash..."
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        className="w-full lg:w-96 font-mono text-sm"
        suffix={
          isLoading ? (
            <div className="w-4 h-4 border-2 border-text-tertiary border-t-hl-green rounded-full animate-spin" />
          ) : error && debouncedQuery ? (
            <span className="text-xs text-red-400">Not found</span>
          ) : null
        }
      />

      <TransferModal
        transfer={isModalOpen ? transfer ?? null : null}
        onClose={handleClose}
      />
    </div>
  );
}
