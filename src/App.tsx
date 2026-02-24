import { useEffect, useState } from 'react';
import { Button, Helper, SectionTitle } from 'akeneo-design-system';

import AttributeSelection, { SelectedAttribute } from './components/ui/attribute_selection';
import AssetAttributeSelector, { SelectedAssetAttribute } from './components/ui/asset_attribute_selector';
import MigrationProgress from './components/ui/migration_progress';
import { useMigration } from './hooks/useMigration';

const sourceSearch = {
  type: [{ operator: 'IN', value: ['pim_catalog_image', 'pim_catalog_file', 'pim_catalog_asset_collection'] }],
};

const destinationSearch = {
  type: [{ operator: 'IN', value: ['pim_catalog_asset_collection'] }],
};

function App() {
  const [selectedSource, setSelectedSource] = useState<SelectedAttribute | null>(null);
  const [selectedDestination, setSelectedDestination] = useState<SelectedAttribute | null>(null);

  // Source asset family state (only relevant when source is pim_catalog_asset_collection)
  const [sourceAttributeType, setSourceAttributeType] = useState<string | null>(null);
  const [sourceAssetFamilyCode, setSourceAssetFamilyCode] = useState<string | null>(null);
  const [isFetchingSourceFamily, setIsFetchingSourceFamily] = useState(false);
  const [selectedSourceMediaAttribute, setSelectedSourceMediaAttribute] = useState<SelectedAssetAttribute | null>(null);

  // Destination asset family state
  const [assetFamilyCode, setAssetFamilyCode] = useState<string | null>(null);
  const [isFetchingFamily, setIsFetchingFamily] = useState(false);
  const [selectedMediaAttribute, setSelectedMediaAttribute] = useState<SelectedAssetAttribute | null>(null);

  const { state: migrationState, preview, run, reset } = useMigration();

  // Resolve source attribute type; for asset_collection also resolve its asset family
  useEffect(() => {
    setSourceAttributeType(null);
    setSourceAssetFamilyCode(null);
    setSelectedSourceMediaAttribute(null);
    if (!selectedSource?.code) return;

    setIsFetchingSourceFamily(true);
    PIM.api.attribute_v1
      .get({ code: selectedSource.code })
      .then(attr => {
        setSourceAttributeType(attr.type ?? null);
        if (attr.type === 'pim_catalog_asset_collection') {
          setSourceAssetFamilyCode(attr.referenceDataName ?? null);
        }
      })
      .catch(() => setSourceAttributeType(null))
      .finally(() => setIsFetchingSourceFamily(false));
  }, [selectedSource?.code]);

  // Resolve the asset family code from the destination attribute's referenceDataName
  useEffect(() => {
    setAssetFamilyCode(null);
    setSelectedMediaAttribute(null);
    if (!selectedDestination?.code) return;

    setIsFetchingFamily(true);
    PIM.api.attribute_v1
      .get({ code: selectedDestination.code })
      .then(attr => setAssetFamilyCode(attr.referenceDataName ?? null))
      .catch(() => setAssetFamilyCode(null))
      .finally(() => setIsFetchingFamily(false));
  }, [selectedDestination?.code]);

  // Reset migration state whenever the configuration changes
  useEffect(() => {
    if (migrationState.status !== 'idle') reset();
  }, [
    selectedSource?.code,
    selectedSource?.locale,
    selectedSource?.scope,
    selectedDestination?.code,
    selectedMediaAttribute?.code,
    selectedMediaAttribute?.locale,
    selectedMediaAttribute?.scope,
    selectedSourceMediaAttribute?.code,
    selectedSourceMediaAttribute?.locale,
    selectedSourceMediaAttribute?.scope,
  ]);

  const isSourceAssetCollection = sourceAttributeType === 'pim_catalog_asset_collection';

  const isSameFamilyMigration =
    isSourceAssetCollection &&
    !!sourceAssetFamilyCode &&
    !!assetFamilyCode &&
    sourceAssetFamilyCode === assetFamilyCode;

  const canPreview =
    !!selectedSource?.code &&
    !!selectedDestination?.code &&
    !!selectedMediaAttribute?.code &&
    (!isSourceAssetCollection || !!selectedSourceMediaAttribute?.code);
  const canMigrate = canPreview && migrationState.status === 'ready';
  const isBusy =
    migrationState.status === 'previewing' || migrationState.status === 'migrating';

  const handlePreview = () => {
    if (!selectedSource || !selectedDestination) return;
    preview(selectedSource, selectedDestination);
  };

  const handleMigrate = () => {
    if (!selectedSource || !selectedDestination || !assetFamilyCode || !selectedMediaAttribute)
      return;
    run(
      selectedSource,
      selectedDestination,
      assetFamilyCode,
      selectedMediaAttribute,
      isSourceAssetCollection && sourceAssetFamilyCode && selectedSourceMediaAttribute
        ? {
            sourceAssetFamilyCode,
            sourceMediaAttrCode: selectedSourceMediaAttribute.code,
            sourceMediaLocale: selectedSourceMediaAttribute.locale,
            sourceMediaScope: selectedSourceMediaAttribute.scope,
            isSameFamily: isSameFamilyMigration,
          }
        : undefined
    );
  };

  return (
    <div className="p-6">
      <SectionTitle sticky={0}>
        <SectionTitle.Title>Asset Migration</SectionTitle.Title>
      </SectionTitle>

      <div className="mt-4">
        <Helper level="info">
          This tool migrates image, file, or asset collection attribute values to assets linked via
          an asset collection attribute. For a product to be migrated, it must belong to a family
          that includes <strong>both</strong> the selected source attribute and the selected
          destination asset collection attribute.
        </Helper>
      </div>

      {/* Source and Destination side by side */}
      <div className="grid grid-cols-2 gap-8 mt-6">
        {/* Source */}
        <div className="space-y-3">
          <SectionTitle>
            <SectionTitle.Title>Source</SectionTitle.Title>
          </SectionTitle>
          <Helper level="info">
            Select the image, file, or asset collection attribute to migrate from. Choose a locale
            and channel if the attribute requires them.
          </Helper>
          <AttributeSelection
            value={selectedSource}
            search={sourceSearch}
            placeholder="Select source attribute"
            onChange={setSelectedSource}
          />
          {selectedSource && isSourceAssetCollection && (
            <AssetAttributeSelector
              assetFamilyCode={sourceAssetFamilyCode}
              value={selectedSourceMediaAttribute}
              onChange={setSelectedSourceMediaAttribute}
            />
          )}
          {selectedSource && isSourceAssetCollection && !isFetchingSourceFamily && sourceAssetFamilyCode === null && (
            <Helper level="warning">
              This attribute has no linked asset family. Please select a valid asset collection
              attribute.
            </Helper>
          )}
          {isSameFamilyMigration && (
            <Helper level="info">
              Source and destination are in the same asset family. Existing assets will be updated
              in place — no files will be downloaded or re-uploaded.
            </Helper>
          )}
        </div>

        {/* Destination */}
        <div className="space-y-3">
          <SectionTitle>
            <SectionTitle.Title>Destination</SectionTitle.Title>
          </SectionTitle>
          <Helper level="info">
            Select the asset collection attribute to migrate into, then choose which media file
            attribute within its asset family will store the file reference.
          </Helper>
          <AttributeSelection
            value={selectedDestination}
            search={destinationSearch}
            placeholder="Select destination asset collection"
            onChange={setSelectedDestination}
          />
          {selectedDestination && (
            <AssetAttributeSelector
              assetFamilyCode={assetFamilyCode}
              value={selectedMediaAttribute}
              onChange={setSelectedMediaAttribute}
            />
          )}
          {selectedDestination && !isFetchingFamily && assetFamilyCode === null && (
            <Helper level="warning">
              This attribute has no linked asset family. Please select a valid asset collection
              attribute.
            </Helper>
          )}
        </div>
      </div>

      {/* Actions */}
      <div className="mt-6 flex flex-wrap items-center gap-4">
        <Button
          level="primary"
          disabled={!canPreview || isBusy}
          onClick={handlePreview}
        >
          {migrationState.status === 'previewing' ? 'Counting...' : 'Preview'}
        </Button>

        {migrationState.status === 'ready' && (
          <>
            <Helper level="info" inline>
              {migrationState.totalProducts === 0
                ? 'No products found with this source attribute set.'
                : `${migrationState.totalProducts} product${migrationState.totalProducts === 1 ? '' : 's'} will be migrated.`}
            </Helper>
            {migrationState.totalProducts > 0 && (
              <Button level="warning" disabled={!canMigrate || isBusy} onClick={handleMigrate}>
                Start Migration
              </Button>
            )}
          </>
        )}
      </div>

      <MigrationProgress state={migrationState} onReset={reset} />
    </div>
  );
}

export default App;
