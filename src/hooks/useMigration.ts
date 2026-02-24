import { useCallback, useState } from 'react';
import { SelectedAttribute } from '../components/ui/attribute_selection';

interface PimProductValue { locale?: string; scope?: string; data: any; }
interface PimProduct {
  uuid: string;
  values?: { [attrCode: string]: PimProductValue[] };
}

export interface AssetSourceContext {
  sourceAssetFamilyCode: string;
  sourceMediaAttrCode: string;
  isSameFamily?: boolean;
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

/** Describe an unknown value concisely for logging. */
function describeValue(v: unknown): string {
  if (v instanceof Blob) return `Blob(size=${v.size}, type="${v.type || 'none'}")`;
  if (v instanceof ArrayBuffer) return `ArrayBuffer(byteLength=${v.byteLength})`;
  if (v === null) return 'null';
  if (v === undefined) return 'undefined';
  if (typeof v === 'string') return `string(len=${v.length}): ${JSON.stringify(v.substring(0, 80))}`;
  try { return typeof v + ': ' + JSON.stringify(v).substring(0, 200); } catch { return String(v); }
}

/**
 * Derive a human-readable asset code from the source file path.
 * Akeneo stores files as "{40-char-hex-hash}_{originalName}.ext" inside
 * path segments, e.g. "4/e/1/f/4e1fe7b7..._banana.jfif".
 */
function generateAssetCode(filePath: string): string {
  const segment = filePath.split('/').pop() ?? filePath;
  const withoutHash = segment.replace(/^[0-9a-f]{40}_/, '');
  const withoutExt = withoutHash.replace(/\.[^.]+$/, '');
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
 * Phase 1 (image/file → asset_collection): download the product media file via the
 * external gateway proxy (avoids CORS on CDN redirect), re-upload it to asset media
 * storage (separate bucket), then upsert the asset record.
 * Returns [assetCode] so Phase 2 can link it to the product.
 */
async function upsertAsset(
  product: PimProduct,
  source: SelectedAttribute,
  destination: SelectedAttribute,
  assetFamilyCode: string,
  mediaAttrCode: string
): Promise<string[]> {
  console.group(`[Migration:file] Product ${product.uuid}`);

  // ── Step 1: extract file path ──────────────────────────────────────────────
  const filePath = extractFilePath(product, source.code, source.locale, source.scope);
  console.log('[1] Source attr:', source.code, '| locale:', source.locale ?? null, '| scope:', source.scope ?? null);
  console.log('[1] Extracted file path:', filePath);
  if (!filePath) {
    console.error('[1] No file path found — skipping');
    console.groupEnd();
    throw new Error('Source attribute value is empty or not a file path');
  }

  const segment = filePath.split('/').pop() ?? filePath;
  const filename = segment.replace(/^[0-9a-f]{40}_/, '');
  console.log('[1] Derived filename:', filename);

  // ── Step 2: download via external gateway proxy ────────────────────────────
  const pimHost = String(PIM.custom_variables['pim_host'] ?? '');
  const downloadUrl = `${pimHost}/api/rest/v1/media-files/${filePath}/download`;
  console.log('[2] Calling external.call — method: GET, url:', downloadUrl, '| credentials_code: pim_api');

  let raw: unknown;
  try {
    raw = await PIM.api.external.call({
      method: 'GET',
      url: downloadUrl,
      credentials_code: 'pim_api',
    });
    console.log('[2] external.call response:', describeValue(raw));
    console.log('[2] Raw value (expand to inspect):', raw);
  } catch (downloadErr: any) {
    console.error('[2] external.call FAILED:', downloadErr?.message ?? downloadErr);
    console.groupEnd();
    throw downloadErr;
  }

  // external.call returns Promise<any>; normalise to Blob for the upload step.
  // Log what we received so we can diagnose unexpected formats.
  const blob: Blob = raw instanceof Blob
    ? raw
    : new Blob([raw instanceof ArrayBuffer ? raw : JSON.stringify(raw)]);
  console.log('[2] Blob created:', describeValue(blob));

  // ── Step 3: upload to asset media file storage via external gateway ──────────
  // We use external.call (server-side proxy) instead of asset_media_file_v1.upload
  // to avoid the CORS Access-Control-Expose-Headers issue that prevents reading
  // the Asset-media-file-code response header from JavaScript.
  // Binary data is base64-encoded so it survives intact through a JS string body.
  const arrayBuffer = await blob.arrayBuffer();
  const bytes = new Uint8Array(arrayBuffer);
  let binaryStr = '';
  const CHUNK = 32768; // avoid spread stack overflow on large files
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binaryStr += String.fromCharCode(...(bytes.subarray(i, Math.min(i + CHUNK, bytes.length)) as any));
  }
  const base64Data = btoa(binaryStr);
  const mimeType = blob.type || 'application/octet-stream';
  const boundary = `----AkeneoMigration${Date.now()}`;
  const multipartBody =
    `--${boundary}\r\n` +
    `Content-Disposition: form-data; name="file"; filename="${filename}"\r\n` +
    `Content-Type: ${mimeType}\r\n` +
    `Content-Transfer-Encoding: base64\r\n` +
    `\r\n` +
    base64Data +
    `\r\n--${boundary}--`;

  const uploadUrl = `${pimHost}/api/rest/v1/asset-media-files`;
  console.log('[3] Calling external.call for upload — url:', uploadUrl,
    '| blob size:', blob.size, '| base64 length:', base64Data.length, '| mimeType:', mimeType);

  let uploadRaw: any;
  try {
    uploadRaw = await PIM.api.external.call({
      method: 'POST',
      url: uploadUrl,
      headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}` },
      body: multipartBody,
      credentials_code: 'pim_api',
    });
    console.log('[3] Upload external.call response:', describeValue(uploadRaw));
    console.log('[3] Upload raw response (expand):', uploadRaw);
  } catch (uploadErr: any) {
    console.error('[3] Upload external.call FAILED:', uploadErr?.message ?? uploadErr);
    console.groupEnd();
    throw uploadErr;
  }

  // Extract the file code — try all plausible paths since response shape is unknown
  const assetFileCode: string | null =
    (uploadRaw && typeof uploadRaw === 'object')
      ? (uploadRaw['asset-media-file-code']
          ?? uploadRaw['Asset-media-file-code']
          ?? uploadRaw?.headers?.['asset-media-file-code']
          ?? uploadRaw?.headers?.['Asset-media-file-code']
          ?? uploadRaw?.code
          ?? null)
      : null;

  if (!assetFileCode) {
    console.error('[3] Could not extract Asset-media-file-code from upload response.',
      'Full response:', JSON.stringify(uploadRaw));
    console.groupEnd();
    throw new Error(
      `Upload succeeded but Asset-media-file-code not found in external.call response. ` +
      `Response: ${JSON.stringify(uploadRaw)}`
    );
  }
  console.log('[3] Upload success — assetFileCode:', assetFileCode);

  // ── Step 4: upsert the asset record ───────────────────────────────────────
  const assetCode = generateAssetCode(filePath);
  const assetPayload = {
    assetFamilyCode,
    asset: {
      code: assetCode,
      values: {
        [mediaAttrCode]: [{
          locale: destination.locale ?? null,
          channel: destination.scope ?? null,
          data: assetFileCode,
        }],
      },
    },
  };
  console.log('[4] Calling asset_v1.upsert — family:', assetFamilyCode, '| assetCode:', assetCode,
    '| mediaAttr:', mediaAttrCode, '| fileCode:', assetFileCode,
    '| locale:', destination.locale ?? null, '| channel:', destination.scope ?? null);

  try {
    await PIM.api.asset_v1.upsert(assetPayload);
    console.log('[4] Asset upserted successfully');
  } catch (err: any) {
    const msg: string = err?.message ?? String(err);
    if (/already exists/i.test(msg) || err?.status === 409) {
      console.warn('[4] Asset already exists — treating as success');
      console.groupEnd();
      return [assetCode];
    }
    console.error('[4] asset_v1.upsert FAILED:', msg);
    console.groupEnd();
    throw err;
  }

  console.groupEnd();
  return [assetCode];
}

/**
 * Phase 1 (asset_collection → asset_collection): look up each source asset to get
 * its media file code (already in asset storage — no download/re-upload needed),
 * then upsert a destination asset referencing that same file code.
 */
async function upsertAssetsFromCollection(
  product: PimProduct,
  source: SelectedAttribute,
  destination: SelectedAttribute,
  destFamilyCode: string,
  destMediaAttrCode: string,
  sourceContext: AssetSourceContext
): Promise<string[]> {
  console.group(`[Migration:asset-collection] Product ${product.uuid}`);
  if (sourceContext.isSameFamily) {
    console.log('[Info] Same-family migration — updating assets in place, no new assets created');
  }

  // ── Step 1: extract source asset codes ────────────────────────────────────
  const valueArray = product.values?.[source.code] ?? [];
  const match = valueArray.find((v: PimProductValue) => {
    const localeOk = source.locale ? v.locale === source.locale : v.locale == null;
    const scopeOk = source.scope ? v.scope === source.scope : v.scope == null;
    return localeOk && scopeOk;
  });
  const sourceAssetCodes: string[] = Array.isArray(match?.data) ? match.data : [];
  console.log('[1] Source attr:', source.code, '| locale:', source.locale ?? null, '| scope:', source.scope ?? null);
  console.log('[1] Source asset codes:', sourceAssetCodes);
  if (!sourceAssetCodes.length) {
    console.error('[1] No source asset codes found — skipping');
    console.groupEnd();
    throw new Error('Source asset collection value is empty');
  }

  const destAssetCodes: string[] = [];

  for (const sourceAssetCode of sourceAssetCodes) {
    // ── Step 2: look up source asset ────────────────────────────────────────
    console.log(`[2] Calling asset_v1.get — family: ${sourceContext.sourceAssetFamilyCode} | code: ${sourceAssetCode}`);
    let sourceAsset: any;
    try {
      sourceAsset = await PIM.api.asset_v1.get({
        assetFamilyCode: sourceContext.sourceAssetFamilyCode,
        code: sourceAssetCode,
      });
      console.log(`[2] Got source asset "${sourceAssetCode}" — values keys:`, Object.keys(sourceAsset.values ?? {}));
    } catch (getErr: any) {
      console.error(`[2] asset_v1.get FAILED for "${sourceAssetCode}":`, getErr?.message ?? getErr);
      console.groupEnd();
      throw getErr;
    }

    const mediaValues: any[] = sourceAsset.values?.[sourceContext.sourceMediaAttrCode] ?? [];
    console.log(`[2] Media attr "${sourceContext.sourceMediaAttrCode}" values:`, JSON.stringify(mediaValues));
    const assetFileCode: string | null = mediaValues[0]?.data ?? null;
    console.log('[2] Extracted assetFileCode:', assetFileCode);

    if (!assetFileCode) {
      const err = new Error(
        `Source asset "${sourceAssetCode}" has no media file value for attribute "${sourceContext.sourceMediaAttrCode}"`
      );
      console.error('[2]', err.message);
      console.groupEnd();
      throw err;
    }

    // ── Step 3: upsert destination asset ────────────────────────────────────
    const destAssetCode = sourceAssetCode;
    const assetPayload = {
      assetFamilyCode: destFamilyCode,
      asset: {
        code: destAssetCode,
        values: {
          [destMediaAttrCode]: [{
            locale: destination.locale ?? null,
            channel: destination.scope ?? null,
            data: assetFileCode,
          }],
        },
      },
    };
    console.log(`[3] Calling asset_v1.upsert — destFamily: ${destFamilyCode} | destCode: ${destAssetCode}`,
      `| mediaAttr: ${destMediaAttrCode} | fileCode: ${assetFileCode}`,
      `| locale: ${destination.locale ?? null} | channel: ${destination.scope ?? null}`);

    try {
      await PIM.api.asset_v1.upsert(assetPayload);
      console.log(`[3] Asset "${destAssetCode}" upserted successfully`);
    } catch (err: any) {
      const msg: string = err?.message ?? String(err);
      if (/already exists/i.test(msg) || err?.status === 409) {
        console.warn(`[3] Asset "${destAssetCode}" already exists — treating as success`);
        destAssetCodes.push(destAssetCode);
        continue;
      }
      console.error(`[3] asset_v1.upsert FAILED for "${destAssetCode}":`, msg);
      console.groupEnd();
      throw err;
    }
    destAssetCodes.push(destAssetCode);
  }

  console.log('[Done] Destination asset codes:', destAssetCodes);
  console.groupEnd();
  return destAssetCodes;
}

/**
 * Phase 2: append the asset code(s) to the product's asset collection attribute.
 */
async function patchProduct(
  product: PimProduct,
  destination: SelectedAttribute,
  newAssetCodes: string[]
): Promise<void> {
  const existingValues = product.values?.[destination.code] ?? [];
  const existingEntry = existingValues.find((v: PimProductValue) => {
    const localeOk = destination.locale ? v.locale === destination.locale : v.locale == null;
    const scopeOk = destination.scope ? v.scope === destination.scope : v.scope == null;
    return localeOk && scopeOk;
  });
  const existingCodes: string[] = existingEntry?.data ?? [];
  const merged = [...existingCodes];
  for (const code of newAssetCodes) {
    if (!merged.includes(code)) merged.push(code);
  }

  console.log(`[PatchProduct] ${product.uuid} | attr: ${destination.code}`,
    `| existing: [${existingCodes.join(', ')}]`,
    `| adding: [${newAssetCodes.join(', ')}]`,
    `| merged: [${merged.join(', ')}]`);

  try {
    await PIM.api.product_uuid_v1.patch({
      uuid: product.uuid,
      data: {
        values: {
          [destination.code]: [
            {
              locale: destination.locale ?? undefined,
              scope: destination.scope ?? undefined,
              data: merged,
            },
          ],
        },
      },
    });
    console.log(`[PatchProduct] ${product.uuid} — patched successfully`);
  } catch (patchErr: any) {
    console.error(`[PatchProduct] ${product.uuid} — FAILED:`, patchErr?.message ?? patchErr);
    throw patchErr;
  }
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
    mediaAttrCode: string,
    sourceContext?: AssetSourceContext
  ) => {
    console.group('[Migration:run] Starting migration');
    console.log('Source:', source.code, '| locale:', source.locale ?? null, '| scope:', source.scope ?? null);
    console.log('Destination:', destination.code, '| locale:', destination.locale ?? null, '| scope:', destination.scope ?? null);
    console.log('Dest family:', assetFamilyCode, '| mediaAttr:', mediaAttrCode);
    console.log('Mode:', sourceContext ? `asset-collection (srcFamily=${sourceContext.sourceAssetFamilyCode}, srcMediaAttr=${sourceContext.sourceMediaAttrCode})` : 'file/image');

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
      console.log(`[Migration:run] Fetching page ${page}...`);
      const result = await PIM.api.product_uuid_v1.list({
        search,
        page,
        limit: BATCH_SIZE,
        withCount: page === 1,
      });

      const items = result.items ?? [];
      console.log(`[Migration:run] Page ${page}: ${items.length} products${page === 1 ? ` (total count: ${result.count ?? 'unknown'})` : ''}`);

      if (page === 1 && result.count != null) {
        setState(s => ({ ...s, totalProducts: result.count! }));
      }

      if (items.length === 0) break;

      // Phase 1 — upsert all assets in parallel
      console.log(`[Migration:run] Phase 1 — upserting ${items.length} assets...`);
      const assetResults = await Promise.allSettled(
        items.map(product =>
          sourceContext
            ? upsertAssetsFromCollection(product, source, destination, assetFamilyCode, mediaAttrCode, sourceContext)
            : upsertAsset(product, source, destination, assetFamilyCode, mediaAttrCode)
        )
      );

      const phase1Success = assetResults.filter(r => r.status === 'fulfilled').length;
      const phase1Fail = assetResults.filter(r => r.status === 'rejected').length;
      console.log(`[Migration:run] Phase 1 done — ${phase1Success} ok, ${phase1Fail} failed`);

      // Phase 2 — patch all products whose assets were created successfully
      console.log(`[Migration:run] Phase 2 — patching products...`);
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
          const errMsg = outcome.reason instanceof Error
            ? outcome.reason.message
            : String(outcome.reason);
          console.error(`[Migration:run] Product ${items[idx].uuid} FAILED:`, errMsg);
          errors.push({ productUuid: items[idx].uuid, error: errMsg });
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

    console.log(`[Migration:run] Complete — success: ${successCount}, errors: ${errorCount}`);
    console.groupEnd();
    setState(s => ({ ...s, status: 'complete' }));
  }, []);

  const reset = useCallback(() => {
    setState(INITIAL_STATE);
  }, []);

  return { state, preview, run, reset };
}
