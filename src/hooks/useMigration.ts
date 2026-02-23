import { useCallback, useState } from 'react';
import { SelectedAttribute } from '../components/ui/attribute_selection';

interface PimProductValue { locale?: string; scope?: string; data: any; }
interface PimProduct {
  uuid: string;
  values?: { [attrCode: string]: PimProductValue[] };
}

export type MigrationStatus = 'idle' | 'previewing' | 'ready' | 'migrating' | 'complete';

export interface MigrationError {
  productUuid: string;
  error: string;
}

export interface MigrationState {
  status: MigrationStatus;
  totalProducts: number;
  processedProducts: number;
  successCount: number;
  errorCount: number;
  errors: MigrationError[];
}

const INITIAL_STATE: MigrationState = {
  status: 'idle',
  totalProducts: 0,
  processedProducts: 0,
  successCount: 0,
  errorCount: 0,
  errors: [],
};

const BATCH_SIZE = 100;

/**
 * Derive a human-readable asset code from the source file path.
 * Akeneo stores files as "{40-char-hex-hash}_{originalName}.ext" inside
 * path segments, e.g. "4/e/1/f/4e1fe7b7..._banana.jfif".
 * We extract the original filename, strip the extension, then sanitize to
 * the characters allowed in asset codes: [a-z0-9_].
 */
function generateAssetCode(filePath: string): string {
  const segment = filePath.split('/').pop() ?? filePath;
  // Remove Akeneo storage hash prefix (40 lowercase hex chars + underscore)
  const withoutHash = segment.replace(/^[0-9a-f]{40}_/, '');
  // Remove file extension
  const withoutExt = withoutHash.replace(/\.[^.]+$/, '');
  // Sanitize to lowercase alphanumeric + underscore
  const sanitized = withoutExt
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');
  return sanitized || 'asset';
}

function extractFilePath(
  product: PimProduct,
  attrCode: string,
  locale: string | null | undefined,
  scope: string | null | undefined
): string | null {
  const valueArray = product.values?.[attrCode];
  if (!valueArray?.length) return null;

  const match = valueArray.find((v: PimProductValue) => {
    const localeOk = locale ? v.locale === locale : v.locale == null;
    const scopeOk = scope ? v.scope === scope : v.scope == null;
    return localeOk && scopeOk;
  });

  if (!match?.data) return null;
  return typeof match.data === 'string' ? match.data : null;
}

function buildSearch(
  attrCode: string,
  locale: string | null | undefined,
  scope: string | null | undefined
): Record<string, unknown[]> {
  return {
    [attrCode]: [
      {
        operator: 'NOT EMPTY',
        ...(locale ? { locale } : {}),
        ...(scope ? { scope } : {}),
      },
    ],
  };
}

/**
 * Phase 1: download the product media file, re-upload it to asset media storage
 * (separate storage system), then upsert the asset record.
 * Returns the asset code so Phase 2 can link it to the product.
 * Treats "already exists" errors as success — the asset is already there.
 */
async function upsertAsset(
  product: PimProduct,
  source: SelectedAttribute,
  destination: SelectedAttribute,
  assetFamilyCode: string,
  mediaAttrCode: string
): Promise<string> {
  const filePath = extractFilePath(product, source.code, source.locale, source.scope);
  if (!filePath) throw new Error('Source attribute value is empty or not a file path');

  // Extract the original filename (strip the 40-char Akeneo hash prefix)
  const segment = filePath.split('/').pop() ?? filePath;
  const filename = segment.replace(/^[0-9a-f]{40}_/, '');

  // Download via the external gateway so the request is proxied through the PIM
  // server. The built-in product_media_file_v1.download follows a redirect to
  // Akeneo's CDN which causes a CORS error in the browser. The external gateway
  // resolves the redirect server-to-server, then returns the binary to the extension.
  // filePath is an Akeneo storage code like "4/e/1/f/hash_file.jpg" — the slashes
  // are URL path separators, not values, so no encoding is applied.
  const pimHost = String(PIM.custom_variables['pim_host'] ?? '');
  const raw = await PIM.api.external.call({
    method: 'GET',
    url: `${pimHost}/api/rest/v1/media-files/${filePath}/download`,
    credentials_code: 'pim_api',
  });
  // external.call returns Promise<any>; normalise to Blob for the upload step
  const blob: Blob = raw instanceof Blob
    ? raw
    : new Blob([raw instanceof ArrayBuffer ? raw : JSON.stringify(raw)]);

  // Re-upload to asset media file storage (different bucket — cannot cross-reference)
  const { code: assetFileCode } = await PIM.api.asset_media_file_v1.upload({
    file: blob,
    filename,
  });

  const assetCode = generateAssetCode(filePath);

  try {
    await PIM.api.asset_v1.upsert({
      assetFamilyCode,
      asset: {
        code: assetCode,
        values: {
          [mediaAttrCode]: [{
            locale: destination.locale ?? null,
            channel: destination.scope ?? null,
            data: assetFileCode, // code from the asset media upload, not the original path
          }],
        },
      },
    });
  } catch (err: any) {
    const msg: string = err?.message ?? String(err);
    // If the asset already exists (idempotent re-run or filename collision),
    // continue — we still want to link the product to it.
    if (/already exists/i.test(msg) || err?.status === 409) {
      return assetCode;
    }
    throw err;
  }

  return assetCode;
}

/**
 * Phase 2: append the asset code to the product's asset collection attribute.
 */
async function patchProduct(
  product: PimProduct,
  destination: SelectedAttribute,
  assetCode: string
): Promise<void> {
  const existingValues = product.values?.[destination.code] ?? [];
  const existingEntry = existingValues.find((v: PimProductValue) => {
    const localeOk = destination.locale ? v.locale === destination.locale : v.locale == null;
    const scopeOk = destination.scope ? v.scope === destination.scope : v.scope == null;
    return localeOk && scopeOk;
  });
  const existingCodes: string[] = existingEntry?.data ?? [];
  const newCodes = existingCodes.includes(assetCode)
    ? existingCodes
    : [...existingCodes, assetCode];

  await PIM.api.product_uuid_v1.patch({
    uuid: product.uuid,
    data: {
      values: {
        [destination.code]: [
          {
            locale: destination.locale ?? undefined,
            scope: destination.scope ?? undefined,
            data: newCodes,
          },
        ],
      },
    },
  });
}

export function useMigration() {
  const [state, setState] = useState<MigrationState>(INITIAL_STATE);

  const preview = useCallback(async (
    source: SelectedAttribute,
    _destination: SelectedAttribute
  ) => {
    setState(s => ({ ...s, status: 'previewing', errors: [] }));
    try {
      const result = await PIM.api.product_uuid_v1.list({
        search: buildSearch(source.code, source.locale, source.scope),
        page: 1,
        limit: 1,
        withCount: true,
      });
      setState(s => ({ ...s, status: 'ready', totalProducts: result.count ?? 0 }));
    } catch (err) {
      console.error('Preview failed:', err);
      setState(s => ({ ...s, status: 'idle' }));
    }
  }, []);

  const run = useCallback(async (
    source: SelectedAttribute,
    destination: SelectedAttribute,
    assetFamilyCode: string,
    mediaAttrCode: string
  ) => {
    setState({
      status: 'migrating',
      totalProducts: 0,
      processedProducts: 0,
      successCount: 0,
      errorCount: 0,
      errors: [],
    });

    const search = buildSearch(source.code, source.locale, source.scope);
    let page = 1;
    let processedProducts = 0;
    let successCount = 0;
    let errorCount = 0;
    const errors: MigrationError[] = [];

    while (true) {
      const result = await PIM.api.product_uuid_v1.list({
        search,
        page,
        limit: BATCH_SIZE,
        withCount: page === 1,
      });

      const items = result.items ?? [];

      if (page === 1 && result.count != null) {
        setState(s => ({ ...s, totalProducts: result.count! }));
      }

      if (items.length === 0) break;

      // Phase 1 — upsert all assets in parallel
      const assetResults = await Promise.allSettled(
        items.map(product =>
          upsertAsset(product, source, destination, assetFamilyCode, mediaAttrCode)
        )
      );

      // Phase 2 — patch all products whose asset was created successfully
      const patchResults = await Promise.allSettled(
        items.map((product, i) => {
          const assetResult = assetResults[i];
          if (assetResult.status === 'rejected') {
            return Promise.reject(assetResult.reason);
          }
          return patchProduct(product, destination, assetResult.value);
        })
      );

      patchResults.forEach((outcome, idx) => {
        processedProducts++;
        if (outcome.status === 'fulfilled') {
          successCount++;
        } else {
          errorCount++;
          errors.push({
            productUuid: items[idx].uuid,
            error: outcome.reason instanceof Error
              ? outcome.reason.message
              : String(outcome.reason),
          });
        }
      });

      setState(s => ({
        ...s,
        processedProducts,
        successCount,
        errorCount,
        errors: [...errors],
      }));

      if (items.length < BATCH_SIZE) break;
      page++;
    }

    setState(s => ({ ...s, status: 'complete' }));
  }, []);

  const reset = useCallback(() => {
    setState(INITIAL_STATE);
  }, []);

  return { state, preview, run, reset };
}
