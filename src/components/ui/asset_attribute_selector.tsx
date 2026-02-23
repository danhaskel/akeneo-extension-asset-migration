import { SelectInput } from 'akeneo-design-system';
import { useEffect, useState } from 'react';

interface AssetAttributeSelectorProps {
  assetFamilyCode: string | null;
  value: string | null;
  onChange: (code: string | null) => void;
}

const AssetAttributeSelector = ({ assetFamilyCode, value, onChange }: AssetAttributeSelectorProps) => {
  const [mediaAttributes, setMediaAttributes] = useState<AssetAttribute[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    setMediaAttributes([]);
    onChange(null);

    if (!assetFamilyCode) return;

    setIsLoading(true);
    PIM.api.asset_attribute_v1
      .list({ assetFamilyCode })
      .then(attrs => {
        const filtered = attrs.filter(a => a.type === 'media_file');
        setMediaAttributes(filtered);
        if (filtered.length === 1) {
          onChange(filtered[0].code);
        }
      })
      .catch(err => console.error('Failed to load asset attributes:', err))
      .finally(() => setIsLoading(false));
  }, [assetFamilyCode]);

  if (!assetFamilyCode) return null;

  return (
    <SelectInput
      emptyResultLabel={isLoading ? 'Loading...' : 'No media_file attribute found'}
      onChange={(code: string) => onChange(code)}
      placeholder="Select media attribute"
      value={value}
      openLabel="Open media attribute select"
      clearable
      clearLabel="Clear"
      onClear={() => onChange(null)}
    >
      {mediaAttributes.map(attr => (
        <SelectInput.Option
          key={attr.code}
          title={attr.labels?.en_US ?? attr.code}
          value={attr.code}
        >
          {attr.labels?.en_US ?? attr.code}
        </SelectInput.Option>
      ))}
    </SelectInput>
  );
};

export default AssetAttributeSelector;
