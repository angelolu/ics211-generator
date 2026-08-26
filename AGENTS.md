# Agent Guidelines & Repository Instructions

## 1. API Quota & Caching Best Practices

### Always Cache & Persist
- **Strict API Conservation**: Every external API call costs quota or latency. **Always cache responses to `localStorage` or memory wherever possible.**
- **TTL Conventions**:
  - **Static & Baseline Routing / Geocoding**: Default to a **24-hour TTL** (`24 * 60 * 60 * 1000`).
  - **Live Traffic ("Leave Now")**: Use a **15-minute TTL** (`15 * 60 * 1000`).
  - **Member Lists & Qualifications**: **60-minute TTL** (`60 * 60 * 1000`).
  - **Activity Lists**: **15-minute TTL** (`15 * 60 * 1000`).
  - **Negative Caching**: Cache failed geocodes or not-found records with TTL to prevent infinite retry loops.
  - **When in Doubt**: Ask the user for their preferred TTL if adding a new API integration or caching layer.

### Quota Safety & Storage Footprint
- **Compress Payloads Before Storage**: `localStorage` has a ~5 MB browser limit.
  - Round coordinate arrays to 4 decimal places (~11m precision) rather than storing full floating-point GeoJSON geometry.
  - Strip redundant metadata before stringifying to storage.
- **Quota Exceeded Handling**:
  - Always use safe storage helpers where available.
  - Automatically prune expired entries and apply LRU eviction for oldest route entries if quota is reached.

## 2. Zero-Flicker & Performance Guidelines

- **Synchronous Cache Evaluation**:
  - Before toggling loading states or showing skeleton shimmers, verify if data is already present in `localStorage` via helper checks (e.g. `isDrivingRouteCached`).
  - If cached, update state immediately in the current microtask with **zero skeleton flash or layout shifting**.

## 3. Mapbox & Spatial Routing Engine Rules

- **Far Distance Cutoff**:
  - Never map or compute travel routes for members located outside MAX_REASONABLE_DISTANCE_MILES from the activity incident location, or with invalid geocodes.
- **Corridor Detour Clustering**:
  - Drivers are evaluated from furthest direct distance inward.
  - Only pair pickups that are along the forward corridor towards the destination (`otherToIncident <= driverDirectDist * 1.05` and `driverToOther <= 60 miles`).
  - Detour calculation must evaluate the single driver trip and the multi-stop carpool trip at the **exact same departure timestamp** $T_{\text{depart}}$ to guarantee non-negative, accurate net detour metrics.

## 4. Activity and Form Rules

- **Conflict Resolution & Period Locking**:
  - Compare local edits against server timestamp. If upstream data changes, flag visual conflict badges without destroying local edits.
- **Print & PDF Layouts**:
  - All print media styles must apply `@media print` rules, hide action bars (`.no-print`), and format table grids cleanly for standard letter printing (`WebkitPrintColorAdjust: exact`).
  - Activities prefixed with `local_` are client-only offline rosters stored in `fitnessqual_local_rosters`.


## 5. UI, Design & Aesthetic Standards

- **Design System & Components**:
  - Use shadcn UI with Vite and Radix UI (--preset bJMXIFLk). Use shadcn components by default (ex. `npx shadcn@latest add button`). If you find UI items that should be migrated while working, follow up with the user to offer an upgrade path.
  - Use Lucide icons consistently.
  - Match text sizes and styles to existing styles to reduce visual clutter.
  - Avoid clutter: prioritize actionable controls and hide developer/diagnostic text from end users.
  - Design with responsiveness in mind, and default to Material 3 philosophies with shadcn styling

- **Typography & Text Hierarchy Standards (shadcn / Tailwind Conventions)**:
  Always standardize font sizes, line heights, and colors across cards, lists, modals, and forms to eliminate visual inconsistencies:
  - **Card / Section Headings**: `text-base` or `1rem` (16px, `fontWeight: 700`), `line-height: 1.25`–`1.35`, color `var(--slate-12)` / `text-foreground`.
  - **Standard Card Body & Content**: `text-sm` or `0.875rem` (14px), `lineHeight: 1.5` (`leading-normal`), color `var(--slate-11)` / `text-foreground`. Used for descriptions, activity details, data content, and primary list row text. Avoid arbitrary one-off font sizes like `0.9375rem` (15px) or bloated line-heights on card body text.
  - **Subtitles & Secondary Metadata**: `text-xs` to `text-sm` (`0.75rem` – `0.8125rem` / 12–13px), `lineHeight: 1.4`, color `var(--slate-10)` / `var(--slate-9)` / `text-muted-foreground`. Used for addresses, timestamps, attendee counts, and secondary notes.
  - **Badges, Tags & Captions**: `text-xs` or `text-[0.6875rem]` (11–12px), `fontWeight: 600` / `700`, uppercase tracking where applicable (`tracking-wider`).
  - **Preserved Multiline Text (Descriptions/Notes)**: Always pair `text-sm` (`0.875rem`), `lineHeight: 1.5`, and `whiteSpace: 'pre-wrap'` for multiline formatted notes and descriptions.

## 6. Verification of APIs

- Always use the browser and script running tools to check the shape of APIs
- Stop and ask the user to enter tokens and credentials if needed
- DO NOT use APIs to perform write actions without explicit permission from the user