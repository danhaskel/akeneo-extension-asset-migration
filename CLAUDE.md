# Project Context for Claude

This repository is an Akeneo UI extension front-end implemented with TypeScript, React and Vite. This document is a compact, actionable reference for frontend architecture, coding standards, API interaction patterns, testing, common pitfalls, and project terminology tailored for UI extension work.

---

## Akeneo Extension — Project-Specific Notes

**Always consult the online Akeneo API documentation** before using or assuming any API behavior:
- REST API reference: https://api.akeneo.com/api-reference.html
- SDK method signatures: `common/global.d.ts` (source of truth for the `PIM.*` globals)

### Deployment
- Run `make update-dev` (dev build) or `make update` (prod build) to deploy.
- Credentials and `custom_variables` are always included in the deploy payload — no flags needed.
- The `pim_api` Bearer Token credential value and `pim_host` custom variable are injected automatically from `.env` (`API_TOKEN`, `PIM_HOST`) at deploy time by `common/create-extension.mjs` / `common/update-extension.mjs`. Re-deploy after token refresh (~1 hour) to keep the credential current.

### Storage systems — critical distinction
- **Product media files** (`/api/rest/v1/media-files/`) and **asset media files** (`/api/rest/v1/asset-media-files/`) are in **separate CDN buckets**. File codes/paths are NOT interchangeable across storage systems.
- `image/file` → `asset_collection`: must download the product file and re-upload to asset storage.
- `asset_collection` → `asset_collection`: both use asset media storage; the source asset's media file code can be referenced directly in the destination family — no download/re-upload needed.

### CORS workaround
- `PIM.api.external.call()` proxies all requests through the PIM server (server-to-server), eliminating CDN CORS issues that arise from browser-side redirects.
- Requires a `credentials_code` referencing a stored Bearer Token credential (`pim_api`).
- The `pim_host` base URL is available at runtime via `PIM.custom_variables['pim_host']` (set in `extension_configuration.json` and injected from `.env`).
- `window.location.origin` is `null` in the extension iframe context — always use `PIM.custom_variables['pim_host']`.

### Migration modes
- **file/image → asset_collection**: download via `PIM.api.external.call()` + re-upload via `PIM.api.asset_media_file_v1.upload()`. See `upsertAsset()` in `src/hooks/useMigration.ts`.
- **asset_collection → asset_collection**: look up source asset via `PIM.api.asset_v1.get()`, read its media file code, reference it directly in the destination asset upsert. See `upsertAssetsFromCollection()` in `src/hooks/useMigration.ts`.

---

## Architecture (frontend focus)

- Frontend: TypeScript, React (TSX), Vite, Tailwind CSS, PostCSS
- Build: Vite for fast dev/hot-reload and production bundles
- Styling: Tailwind utility-first with a small global stylesheet
- Integration: the frontend talks to the Akeneo backend over stable REST endpoints; treat the backend as a contract and keep UI concerns isolated
- Asset pipeline: this extension uses Vite; the Akeneo host may use Webpack Encore — keep boundaries clear and avoid coupling build artifacts

## Coding Standards and Conventions (frontend)

- TypeScript and React
  - Enable TypeScript strict mode where practical; prefer explicit typing for public interfaces and hook APIs.
  - Use functional components and hooks; prefer small, focused components and composition over monoliths.
  - Keep props minimal, explicit, and well-typed. Use discriminated unions for varying shapes.
  - Use clear, self-documenting names: `fetchAssets`, `useMigration`, `MigrationProgress`.
  - File layout: colocate components under `src/components`, hooks under `src/hooks`, utilities under `src/lib`.
  - Styling: prefer Tailwind utilities for component layout; reserve `App.css`/`index.css` for global tokens or critical overrides.

- Tests and tooling
  - Write unit tests alongside code using Jest + React Testing Library.
  - Run linting, type checks, and tests in CI. Prefer automated checks over manual gating.

## API Interaction Patterns (frontend responsibilities)

- Treat the backend as a contract
  - The frontend should depend only on documented REST endpoints and DTO shapes; avoid assumptions about server internals.
  - Use a thin API client layer (`src/lib/api` or similar) to centralize request/response shaping, retries, and error mapping.

- Request/Response patterns
  - Send concise payloads and model responses with TypeScript DTO types.
  - Handle pagination, filtering, and sorting in the client using the API's agreed patterns.

- Errors and resilience
  - Surface structured error messages to the UI. Map server validation errors into field-level errors when possible.
  - Implement sensible timeouts, retries (idempotent requests), and user-facing feedback for network failures.

## Testing Requirements (frontend-focused)

- Unit tests
  - Jest + React Testing Library for components, hooks, and utilities.
  - Keep tests deterministic and fast; mock network requests at the API client boundary.

- Integration / E2E
  - Use Cypress or Playwright for critical user journeys that exercise the full UI and API integration.

- Coverage
  - Aim for meaningful coverage on core logic and migration workflows; use 80% as a minimum target for critical modules.

- Run commands
  - Use the helper commands exposed in `common/Makefile` to run local checks, tests, linters, and build steps. Example usage:

```bash
make -C common <target>
```

Replace `<target>` with the specific task (e.g., `test`, `lint`, `dev`) as defined in `common/Makefile`.

## Common Pitfalls to Avoid (frontend)

- Over-engineering
  - Prefer simple, testable solutions over clever or complex abstractions.

- Tight coupling to backend internals
  - Don't embed server implementation details in UI logic; rely on the API contract instead.

- Mixing build tools
  - Keep Vite configuration separate from any backend Encore/host build steps. Don't assume host build behavior during local development.

- Poor naming and unclear component boundaries
  - Use explicit names and keep components focused. Split responsibilities into hooks, presentational, and container UI layers.

- Incomplete error handling and UX
  - Gracefully handle network errors, long-running operations, and partial failures in migration flows.

## Project-Specific Terminology (examples)

- Asset: any binary or media entity managed by Akeneo and surfaced in the UI extension.
- Migration: the UI-driven process for selecting, transforming, and dispatching assets to be migrated.
- Job: a unit of work within a migration (for example, a batch upload or metadata transform).

## Style & Design Principles (Guiding Principles)

- Keep it simple: prefer clear, maintainable solutions over clever optimizations.
- Readability and maintainability are primary concerns.
- Self-documenting names and code; prefer explicit identifiers and small functions.
- Favor composition over inheritance; prefer hooks and small utilities to giant components.

## How to Use This File

- Use this as a quick reference for frontend code reviews, scaffolding new components/services, and writing tests.
- Run local checks and test/CI tasks via the `common/Makefile` targets (see `make -C common <target>`).
- When in doubt, follow these principles and raise architectural changes as PRs for team alignment.

---
If you want, I can also generate a lightweight PR checklist that enforces these expectations (tests, linting, API contract checks, accessibility smoke tests).
