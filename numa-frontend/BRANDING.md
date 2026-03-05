# Branding System Overview

This document explains how client-specific branding is loaded and applied in the `numa-frontend` application. It covers the runtime provider, configuration sources, CSS variables, caching behaviour, and how other parts of the app consume branding values.

## Components

| Layer              | Responsibility                                                                                  | Key File                             |
| ------------------ | ----------------------------------------------------------------------------------------------- | ------------------------------------ |
| `BrandingService`  | Loads and caches the branding payload, resolves assets, injects CSS variables, exposes helpers. | `src/Services/BrandingService.tsx`   |
| `BrandingProvider` | React context provider that initialises the service and exposes values to the component tree.   | `src/Providers/BrandingProvider.tsx` |
| `BrandingContext`  | Type definitions plus defaults for the branding theme and helpers.                              | `src/Providers/BrandingContext.tsx`  |

The app bootstraps branding by wrapping the route tree in `<BrandingProvider>` inside `src/App.tsx`.

## Runtime Flow

1. **Provider mounts** – `BrandingProvider` calls `brandingService.initialize()` on first render. While initialisation runs, it renders a full-screen loading placeholder so that unbranded UI never flashes.
2. **Service initialises** – `BrandingService` decides whether branding is enabled by reading the `BRANDING_PROVIDER_ENABLED` flag from `sessionStorage`. If branding is disabled, the default Numa theme is applied and initialisation stops.
3. **Cache hydrate** – The service attempts to restore the most recent branding config from `sessionStorage` (keys `BRANDING_CONFIG_CACHE` and `BRANDING_CONFIG_CACHE_TS`). Cached configs expire after 15 minutes.
4. **Remote fetch** – If no cache is available (or `forceRemote` was requested), the service tries to fetch the config from:
   - `GET {API_ENDPOINT}/branding/{clientName}` (authenticated, requires `accessToken` in `localStorage`), then
   - `GET {API_ENDPOINT}/public/branding/{clientName}` (unauthenticated fallback).
5. **Apply config** – When a config is found, `_applyConfig` merges it with the default theme, injects CSS variables, resolves assets (S3 URLs, etc.), persists the cache, and notifies listeners.
6. **Notify React tree** – `BrandingProvider` listens via `brandingService.subscribe(...)` and updates context state (`clientName`, `branding`, `initialized`). Once initialised, the provider renders its children and the rest of the app sees consistent branding.

## Configuration Inputs

At runtime the service reads several `sessionStorage` keys that are written during initial config bootstrap:

- `CLIENT_NAME` – tenant mnemonic (slug) used for API requests and token replacements.
- `API_ENDPOINT` – base URL for back-end APIs (no trailing slash). Used to construct the branding endpoints.
- `BRANDING_PROVIDER_ENABLED` – string `'true'` enables responsive branding; anything else keeps defaults.
- `BRANDING_THEME_ENABLED` – optional toggle to disable tenant branding while keeping provider on.
- `BRANDING_ASSETS_BUCKET` – optional S3 bucket name for hosting branding assets.
- `REGION` – AWS region, used when converting S3 keys to HTTPS URLs.

Branding API responses can contain:

```ts
{
  enabled: boolean,
  branding: BrandingTheme,
  features: Record<string, boolean>
}
```

`BrandingTheme` extends the default theme and supports:

- `colors` – primary palette values used to generate CSS variables.
- `assets` – optional S3 / HTTP paths for logos, favicons, etc.
- `resolvedAssets` – hydrated absolute URLs written by the service.
- `splashScreen` and `loginPage` content, which accept `{clientName}` and `Numa` tokens that the service replaces with real values.

## CSS Variables & Token Injection

During `_applyConfig` the service calls two helpers:

- `_applyBrandingTokens` – replaces `{clientName}` and `Numa` placeholders within login/splash text so copy matches the tenant name.
- `_applyCssVariables` – writes a `<style id="branding-vars">` block into the document head. Every entry in `branding.colors` becomes a CSS custom property: `colors.primary` → `--brand-primary`, `colors.buttonPrimary` → `--brand-buttonPrimary`, etc.

Components reference these variables with fallbacks, e.g.

```scss
color: var(--brand-primary, var(--color-primary));
background: color-mix(in srgb, var(--brand-primary, var(--color-primary)) 12%, transparent);
```

If the service cannot determine a value, the code falls back to existing global theme tokens (`--color-primary`, etc.) ensuring the UI still renders.

## Consuming Branding in React

Use `BrandingContext` or helper hooks to access branding state:

```tsx
import { useContext } from 'react';
import { BrandingContext } from '../Providers/BrandingContext';

const { branding, clientName, isFeatureEnabled, replaceClientName } = useContext(BrandingContext);
```

- `branding.colors` exposes all colour tokens.
- `branding.resolvedAssets` has absolute URLs for navigation/login logos and favicons.
- `isFeatureEnabled('agents')` returns feature flags supplied by the branding payload.
- `replaceClientName('Welcome to Numa!')` swaps the name when a tenant override is active.

For simple asset lookups (logos, splash backgrounds), prefer the utility hook:

```tsx
import { useBrandingAsset } from '../hooks/useBrandingAsset';

const navLogo = useBrandingAsset('logoNav');
```

## Updating / Forcing Branding

- `brandingService.reload({ forceRemote: true })` clears cache and re-fetches remote config.
- `brandingService.applyExternalBranding(theme, features, { tenantEnabled })` lets admin workflows preview or save branding instantly.
- Tests can stub branding by mocking the service (see `src/__tests__/Providers/BrandingProvider.test.tsx`).

## Troubleshooting

| Symptom                 | Likely Cause                                                                  | Next Steps                                                                                  |
| ----------------------- | ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| App stuck on "Loading…" | Branding API unreachable and caching disabled.                                | Check `API_ENDPOINT`, browser console, and CORS.                                            |
| Colours not updating    | Buttons use legacy `--color-*` tokens.                                        | Swap to `var(--brand-*, var(--color-*)))` as part of branding refresh.                      |
| Logos missing           | `BRANDING_ASSETS_BUCKET` or `REGION` incorrect, or asset path lacks protocol. | Verify S3 bucket and ensure `assets` entries are absolute, `s3://bucket/key`, or `/prefix`. |

## Related Files

- `src/Components/Branding/BrandingAdminPanel.tsx` – UI for admins to edit branding.
- `src/Services/BrandingAdminService.ts` – API client used by the admin panel.
- `src/__tests__/Services/BrandingService.test.ts` – unit tests covering caching and API flows.
- `src/assets/styles/**/*.scss` – Use the new `--brand-*` variables instead of hard-coded colours.

Keeping this document up to date makes it easier for future contributors to reason about the branding system, apply colour updates, or extend tenant-specific features.
