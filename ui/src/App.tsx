import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Header } from "./components/Header";
import { StatsGrid } from "./components/StatsGrid";
import { TransferList } from "./components/TransferList";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
});

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <div className="min-h-screen flex flex-col">
        <Header />

        <main className="flex-1 max-w-7xl mx-auto w-full px-4 sm:px-6 lg:px-8 py-8">
          <div className="space-y-8">
            {/* Stats Section */}
            <section>
              <StatsGrid />
            </section>

            {/* Transfers Section */}
            <section>
              <TransferList />
            </section>
          </div>
        </main>

        {/* Footer */}
        <footer className="border-t border-border-default py-6 mt-auto">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="flex flex-col sm:flex-row items-center justify-between gap-4 text-sm text-text-tertiary">
              <div className="flex items-center gap-4">
                <span>Coredrain Explorer</span>
                <span className="text-border-accent">|</span>
                <span>HyperCore to HyperEVM Correlator</span>
              </div>
              <div className="flex items-center gap-4">
                <a
                  href="https://hyperliquid.xyz"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="hover:text-hl-green transition-colors"
                >
                  Hyperliquid
                </a>
                <a
                  href="https://purrsec.com"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="hover:text-hl-green transition-colors"
                >
                  Explorer
                </a>
              </div>
            </div>
          </div>
        </footer>
      </div>
    </QueryClientProvider>
  );
}
