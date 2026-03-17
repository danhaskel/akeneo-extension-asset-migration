# Akeneo Asset Migration Extension

A UI extension for Akeneo PIM that lets you bulk-migrate product media into asset collections directly from the PIM interface. Built with TypeScript, React, and Vite.

## Overview

> **Important:** Assets migrated using this tool will not display previews and are not accessible by any internal AI functions at this time.

This extension adds a navigation tab inside Akeneo ("Asset Migration") where you can:

1. Select a source `asset_collection` attribute
2. Select a destination `asset_collection` attribute and target asset family
3. Preview the number of affected products
4. Run the migration — the extension handles asset creation and product patching

## Migration Modes

### `asset_collection` → `asset_collection`

Both source and destination use asset media storage. The file code from the source asset can be referenced directly in the destination — no download/re-upload needed. The extension:

1. Reads source asset codes from the product's collection attribute
2. Looks up each source asset to get its media file code
3. Upserts a destination asset referencing that file code
4. Patches the product to link the destination asset (skipped for same-family migrations)

### `image` / `file` → `asset_collection` _(temporarily disabled)_

Cross-type migration is currently disabled. The code is preserved in `src/hooks/useMigration.ts` (commented out) and can be re-enabled when ready. When active, this mode downloads product media files and re-uploads them to asset storage — required because product and asset files live in separate CDN buckets.

## Setup

### Prerequisites

- Node.js and npm
- An Akeneo PIM instance with API access
- A Bearer Token for the PIM REST API

### Configuration

Copy the sample configuration and fill in your credentials:

```bash
cp extension_configuration.sample.json extension_configuration.json
```

Edit `extension_configuration.json`:
- Set `pim_host` to your PIM instance URL (e.g. `https://your-instance.cloud.akeneo.com`)
- Set the Bearer Token `value` to a valid API token

> **Note:** `extension_configuration.json` is gitignored — never commit real credentials.

### Environment Variables

Create a `.env` file at the project root:

```
API_TOKEN=your_bearer_token_here
PIM_HOST=https://your-instance.cloud.akeneo.com
```

These are injected automatically at deploy time.

### Deploy

```bash
make update-dev   # dev build
make update       # production build
```

Re-deploy after token refresh (tokens expire ~every hour).

## Known Issues and Blockers

The following issues apply to the cross-type (`image`/`file` → `asset_collection`) migration path, which is currently disabled:

- **CORS may block `Asset-media-file-code` response header** — the browser may be unable to read the header returned by `asset_media_file_v1.upload()` due to the sandboxed iframe `null` origin, causing uploads to fail with `missing asset-media-file-code header`.
- **No binary upload support via `external.call()`** — `PIM.api.external.call()` only accepts a `string` body, so multipart/form-data uploads must go through `PIM.api.asset_media_file_v1.upload()` instead.
