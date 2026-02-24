import { useCallback, useState } from 'react';
import { SelectedAttribute } from '../components/ui/attribute_selection';
import { SelectedAssetAttribute } from '../components/ui/asset_attribute_selector';

interface PimProductValue { locale?: string; scope?: string; data: any; }
interface PimProduct {
  uuid: string;
  values?: { [attrCode: string]: PimProductValue[] };
}

export interface AssetSourceContext {
  sourceAssetFamilyCode: string;
  sourceMediaAttrCode: string;
  sourceMediaLocale?: string | null;
  sourceMediaScope?: string | null;
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
 * Pure-JS SHA-1 for sandboxed iframes where crypto.subtle is unavailable (null origin).
 * Implements FIPS 180-4 SHA-1.
 */
function sha1Sync(buffer: ArrayBuffer): string {
  const data = new Uint8Array(buffer);
  const len = data.length;
  const padded = new Uint8Array(Math.ceil((len + 9) / 64) * 64);
  padded.set(data);
  padded[len] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(padded.length - 4, (len * 8) >>> 0, false);

  let h0 = 0x67452301, h1 = 0xEFCDAB89, h2 = 0x98BADCFE,
      h3 = 0x10325476, h4 = 0xC3D2E1F0;
  const w = new Uint32Array(80);

  for (let off = 0; off < padded.length; off += 64) {
    const blk = new DataView(padded.buffer, off, 64);
    for (let i = 0; i < 16; i++) w[i] = blk.getUint32(i * 4, false);
    for (let i = 16; i < 80; i++) {
      const x = w[i - 3] ^ w[i - 8] ^ w[i - 14] ^ w[i - 16];
      w[i] = (x << 1) | (x >>> 31);
    }
    let a = h0, b = h1, c = h2, d = h3, e = h4;
    for (let i = 0; i < 80; i++) {
      let f: number, k: number;
      if      (i < 20) { f = (b & c) | (~b & d);           k = 0x5A827999; }
      else if (i < 40) { f = b ^ c ^ d;                    k = 0x6ED9EBA1; }
      else if (i < 60) { f = (b & c) | (b & d) | (c & d); k = 0x8F1BBCDC; }
      else             { f = b ^ c ^ d;                    k = 0xCA62C1D6; }
      const t = (((a << 5) | (a >>> 27)) + f + e + k + w[i]) >>> 0;
      e = d; d = c; c = (b << 30) | (b >>> 2); b = a; a = t;
    }
    h0 = (h0 + a) >>> 0; h1 = (h1 + b) >>> 0; h2 = (h2 + c) >>> 0;
    h3 = (h3 + d) >>> 0; h4 = (h4 + e) >>> 0;
  }
  return [h0, h1, h2, h3, h4].map(n => n.toString(16).padStart(8, '0')).join('');
}

async function computeSha1(buffer: ArrayBuffer): Promise<string> {
  if (typeof crypto !== 'undefined' && crypto.subtle) {
    const h = await crypto.subtle.digest('SHA-1', buffer);
    return Array.from(new Uint8Array(h)).map(b => b.toString(16).padStart(2, '0')).join('');
  }
  return sha1Sync(buffer);
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
  assetFamilyCode: string,
  mediaAttr: SelectedAssetAttribute
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
  // Must use external.call — product_media_file_v1.download() goes through the
  // SDK's /sdk/api/ proxy which has CORS issues from the extension iframe.
  const pimHost = String(PIM.custom_variables['pim_host'] ?? '');
  const downloadUrl = `${pimHost}/api/rest/v1/media-files/${filePath}/download`;
  console.log('[2] Calling external.call — GET', downloadUrl);

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

  const blob: Blob = raw instanceof Blob
    ? raw
    : new Blob([raw instanceof ArrayBuffer ? raw : JSON.stringify(raw)]);
  console.log('[2] Blob:', describeValue(blob));

  // ── Step 3: upload to asset media file storage ────────────────────────────
  // external.call cannot be used for uploads — the gateway forces Content-Type:
  // application/json, which makes POST /api/rest/v1/asset-media-files reject with
  // 400 "Invalid json message received". We use the SDK's upload() instead.
  //
  // CORS workaround for the response header: Akeneo generates storage paths via
  // sha1_file() of the file content: {sha1[0]}/{sha1[1]}/{sha1[2]}/{sha1[3]}/{sha1}_{name}
  // We compute the same SHA-1 client-side so we can derive the code even when
  // CORS prevents reading the "Asset-media-file-code" response header.
  const blobBuffer = await blob.arrayBuffer();
  const sha1 = await computeSha1(blobBuffer);
  const predictedCode = `${sha1[0]}/${sha1[1]}/${sha1[2]}/${sha1[3]}/${sha1}_${filename}`;
  console.log('[3] SHA-1 predicted file code:', predictedCode);

  console.log('[3] Calling asset_media_file_v1.upload — filename:', filename, '| blob:', describeValue(blob));

  let assetFileCode: string = predictedCode;
  try {
    const uploadResult = await PIM.api.asset_media_file_v1.upload({ file: blob, filename });
    assetFileCode = uploadResult.code;
    console.log('[3] Upload success — SDK returned code:', assetFileCode);
    if (assetFileCode !== predictedCode) {
      console.warn('[3] Returned code differs from SHA-1 prediction — using returned code.',
        'predicted:', predictedCode, '| actual:', assetFileCode);
    } else {
      console.log('[3] SHA-1 prediction matched returned code ✓');
    }
  } catch (uploadErr: any) {
    if (/missing asset-media-file-code header/i.test(uploadErr?.message ?? '')) {
      // Upload succeeded (HTTP 201) but CORS blocks reading the response header.
      // Fall back to the SHA-1 derived code — Akeneo computes the same hash server-side.
      console.warn('[3] CORS: Asset-media-file-code header unreadable. Using SHA-1 derived code:', assetFileCode);
    } else {
      console.error('[3] asset_media_file_v1.upload FAILED:', uploadErr?.message ?? uploadErr);
      console.groupEnd();
      throw uploadErr;
    }
  }

  // ── Step 4: upsert the asset record ───────────────────────────────────────
  const assetCode = generateAssetCode(filePath);
  const assetPayload = {
    assetFamilyCode,
    asset: {
      code: assetCode,
      values: {
        [mediaAttr.code]: [{
          locale: mediaAttr.locale ?? null,
          channel: mediaAttr.scope ?? null,
          data: assetFileCode,
        }],
      },
    },
  };
  console.log('[4] Calling asset_v1.upsert — family:', assetFamilyCode, '| assetCode:', assetCode,
    '| mediaAttr:', mediaAttr.code, '| fileCode:', assetFileCode,
    '| locale:', mediaAttr.locale ?? null, '| channel:', mediaAttr.scope ?? null);

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
 *
 * For same-family migrations the source and destination are in the same asset family,
 * so we update the asset in place. No product patching is needed afterward.
 */
async function upsertAssetsFromCollection(
  product: PimProduct,
  source: SelectedAttribute,
  destFamilyCode: string,
  destMediaAttr: SelectedAssetAttribute,
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

    // Find the value matching the source media attribute's locale/channel
    const mediaMatch = mediaValues.find((v: any) => {
      const localeOk = sourceContext.sourceMediaLocale
        ? v.locale === sourceContext.sourceMediaLocale : v.locale == null;
      const scopeOk = sourceContext.sourceMediaScope
        ? v.channel === sourceContext.sourceMediaScope : v.channel == null;
      return localeOk && scopeOk;
    });
    const assetFileCode: string | null = mediaMatch?.data ?? null;
    console.log('[2] Extracted assetFileCode:', assetFileCode);

    if (!assetFileCode) {
      const err = new Error(
        `Source asset "${sourceAssetCode}" has no media file value for attribute "${sourceContext.sourceMediaAttrCode}"`
        + (sourceContext.sourceMediaLocale ? ` locale="${sourceContext.sourceMediaLocale}"` : '')
        + (sourceContext.sourceMediaScope ? ` channel="${sourceContext.sourceMediaScope}"` : '')
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
          [destMediaAttr.code]: [{
            locale: destMediaAttr.locale ?? null,
            channel: destMediaAttr.scope ?? null,
            data: assetFileCode,
          }],
        },
      },
    };
    console.log(`[3] Calling asset_v1.upsert — destFamily: ${destFamilyCode} | destCode: ${destAssetCode}`,
      `| mediaAttr: ${destMediaAttr.code} | fileCode: ${assetFileCode}`,
      `| locale: ${destMediaAttr.locale ?? null} | channel: ${destMediaAttr.scope ?? null}`);

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
        attributes: source.code,
      } as any);
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
    mediaAttr: SelectedAssetAttribute,
    sourceContext?: AssetSourceContext
  ) => {
    console.group('[Migration:run] Starting migration');
    console.log('Source:', source.code, '| locale:', source.locale ?? null, '| scope:', source.scope ?? null);
    console.log('Destination:', destination.code, '| locale:', destination.locale ?? null, '| scope:', destination.scope ?? null);
    console.log('Dest family:', assetFamilyCode, '| mediaAttr:', mediaAttr.code,
      '| mediaLocale:', mediaAttr.locale ?? null, '| mediaScope:', mediaAttr.scope ?? null);
    console.log('Mode:', sourceContext
      ? `asset-collection (srcFamily=${sourceContext.sourceAssetFamilyCode}, srcMediaAttr=${sourceContext.sourceMediaAttrCode}, sameFamily=${sourceContext.isSameFamily ?? false})`
      : 'file/image');

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
        attributes: `${source.code},${destination.code}`,
      } as any);

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
            ? upsertAssetsFromCollection(product, source, assetFamilyCode, mediaAttr, sourceContext)
            : upsertAsset(product, source, assetFamilyCode, mediaAttr)
        )
      );

      const phase1Success = assetResults.filter(r => r.status === 'fulfilled').length;
      const phase1Fail = assetResults.filter(r => r.status === 'rejected').length;
      console.log(`[Migration:run] Phase 1 done — ${phase1Success} ok, ${phase1Fail} failed`);

      // Phase 2 — patch products to link asset codes to the destination attribute.
      // Skipped for same-family migrations: the assets are updated in place and
      // the product's collection already references them.
      if (sourceContext?.isSameFamily) {
        console.log('[Migration:run] Same-family migration — skipping Phase 2 (no product patching needed)');
        assetResults.forEach((outcome, idx) => {
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
      } else {
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
      }

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
