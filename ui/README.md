# Coredrain Explorer UI

> [!WARNING]
> **AI GENERATED** The entire UI is completely AI generated. Only for demonstration purposes.

A Hyperliquid-styled dashboard for exploring HyperCore to HyperEVM transfer correlations.

## Features

- Real-time transfer list with auto-refresh (5 second intervals)
- Search by any hash (HyperCore, HyperEVM internal, or explorer hash)
- System statistics overview
- Status filtering (pending, matched, failed)
- Click-to-expand transfer details
- External links to block explorer

## Tech Stack

- **React 19** - UI framework
- **Vite** - Build tool with HMR
- **TanStack Query** - Server state management with auto-refresh
- **Tailwind CSS v4** - Styling with custom Hyperliquid theme

## Design System

The UI follows the Hyperliquid design language:

- **Dark theme** with `#0A0A0A` background
- **HL Mint Green** (`#82E6B1`) as primary accent
- **Geist** font family for typography
- **Geist Mono** for all numerical/hash data
- Subtle glow effects on interactive elements
- High-density information display

## Development

```bash
# Install dependencies
bun install

# Start dev server (proxies /api to backend on port 9465)
bun run dev

# Type check
bun run tsc --noEmit

# Build for production
bun run build

# Preview production build
bun run preview
```

## Project Structure

```
ui/
├── src/
│   ├── components/     # React components
│   │   ├── Card.tsx
│   │   ├── Button.tsx
│   │   ├── Input.tsx
│   │   ├── Badge.tsx
│   │   ├── Icons.tsx
│   │   ├── Header.tsx
│   │   ├── StatsGrid.tsx
│   │   ├── TransferList.tsx
│   │   ├── TransferDetail.tsx
│   │   └── SearchBar.tsx
│   ├── hooks/          # TanStack Query hooks
│   │   ├── useTransfers.ts
│   │   ├── useStats.ts
│   │   └── useAddresses.ts
│   ├── lib/            # Utilities
│   │   ├── api.ts      # API client
│   │   └── utils.ts    # Helpers
│   ├── types/          # TypeScript types
│   │   └── index.ts
│   ├── App.tsx
│   ├── main.tsx
│   └── index.css       # Tailwind + custom styles
├── index.html
├── package.json
├── tsconfig.json
└── vite.config.ts
```

## API Proxy

In development, requests to `/api/*` are proxied to `http://localhost:9465/*` (the Coredrain backend). Make sure the backend is running:

```bash
# In project root
bun run src/main.ts
```

## Configuration

The UI expects these API endpoints from the backend:

- `GET /transfers` - List transfers with pagination/filtering
- `GET /transfers/:hash` - Get transfer by any hash
- `GET /addresses` - List watched addresses
- `GET /stats` - System statistics
- `GET /health` - Health check

## Building for Production

```bash
bun run build
```

Output goes to `dist/`. Serve with any static file server, ensuring API requests are proxied to the backend.
