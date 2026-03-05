# Akeneo Asset Migration Extension

A UI extension for Akeneo PIM that lets you bulk-migrate product media into asset collections directly from the PIM interface. Built with TypeScript, React, and Vite.

## Overview

This extension adds a navigation tab inside Akeneo ("Asset Migration") where you can:

1. Select a source attribute (`image`, `file`, or `asset_collection`)
2. Select a destination `asset_collection` attribute and target asset family
3. Preview the number of affected products
4. Run the migration — the extension handles downloading, re-uploading, asset creation, and product patching

## Migration Modes

### `image` / `file` → `asset_collection`

Product media files and asset media files live in **separate CDN buckets**. When the source is an image or file attribute, the extension must:

1. Download the product media file via `PIM.api.external.call()` (proxied server-side to avoid CORS)
2. Re-upload it to asset media storage via `PIM.api.asset_media_file_v1.upload()`
3. Upsert an asset record referencing the new file code
4. Patch the product to add the new asset code to the destination collection

### `asset_collection` → `asset_collection`

Both source and destination use asset media storage. The file code from the source asset can be referenced directly in the destination — no download/re-upload needed. The extension:

1. Reads source asset codes from the product's collection attribute
2. Looks up each source asset to get its media file code
3. Upserts a destination asset referencing that file code
4. Patches the product to link the destination asset (skipped for same-family migrations)

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

### CORS blocks `Asset-media-file-code` response header (image/file migrations)

**Status:** Active bug — affects all `image`/`file` → `asset_collection` migrations.

When uploading a file to `/api/rest/v1/asset-media-files`, the Akeneo SDK method `asset_media_file_v1.upload()` returns the new file code via the `Asset-media-file-code` response header. However, the extension runs inside a sandboxed iframe with a `null` origin. CORS prevents the browser from reading custom response headers from the PIM host, so the SDK throws an error like:

```
missing asset-media-file-code header
```

**Workaround (in place):** The extension computes a SHA-1 hash of the file content client-side and derives the expected file code using the same algorithm Akeneo uses server-side:

```
{sha1[0]}/{sha1[1]}/{sha1[2]}/{sha1[3]}/{sha1}_{filename}
```

This predicted code is used as a fallback when the header is unreadable. If the upload fails for any other reason (not a CORS/header issue), the error is re-thrown and the product is recorded as failed.

**Limitation:** This workaround relies on Akeneo's internal file path convention remaining stable. If Akeneo changes its asset storage path format, the prediction will break and migrations will silently write incorrect file codes.

### `external.call()` cannot be used for file uploads

`PIM.api.external.call()` forces `Content-Type: application/json` on all requests, which causes the asset media file upload endpoint to reject the request with `400 Invalid json message received`. File uploads must go through `PIM.api.asset_media_file_v1.upload()` — which is what triggers the CORS header issue above.

### No upload support via `external.call()` for multipart payloads

There is currently no way to upload binary files through the external gateway proxy. The SDK's upload method is the only available path, and it is subject to the CORS limitation described above.
