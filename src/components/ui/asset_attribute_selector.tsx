import { Locale, SelectInput } from 'akeneo-design-system';
import { useEffect, useState } from 'react';

interface PimLocale { code: string; enabled: boolean; }
interface PimChannel { code: string; labels?: { [locale: string]: string }; }

export interface SelectedAssetAttribute {
  code: string;
  locale: string | null;
  scope: string | null;
}

interface AssetAttributeSelectorProps {
  assetFamilyCode: string | null;
  value: SelectedAssetAttribute | null;
  onChange: (attr: SelectedAssetAttribute | null) => void;
}

const AssetAttributeSelector = ({ assetFamilyCode, value, onChange }: AssetAttributeSelectorProps) => {
  const [mediaAttributes, setMediaAttributes] = useState<AssetAttribute[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [locales, setLocales] = useState<PimLocale[]>([]);
  const [channels, setChannels] = useState<PimChannel[]>([]);
  const [isFetchingSubSelects, setIsFetchingSubSelects] = useState(false);

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
          onChange({ code: filtered[0].code, locale: null, scope: null });
        }
      })
      .catch(err => console.error('Failed to load asset attributes:', err))
      .finally(() => setIsLoading(false));
  }, [assetFamilyCode]);

  const selectedAttribute = mediaAttributes.find(a => a.code === value?.code);

  // Fetch locales and channels when the selected attribute changes
  useEffect(() => {
    setLocales([]);
    setChannels([]);
    if (!selectedAttribute) return;

    const fetches: Promise<void>[] = [];
    setIsFetchingSubSelects(true);

    if (selectedAttribute.valuePerLocale) {
      fetches.push(
        PIM.api.locale_v1
          .list({ limit: 100 })
          .then(result => setLocales(result.items.filter(l => l.enabled)))
          .catch(err => console.error('Failed loading locales:', err))
      );
    }

    if (selectedAttribute.valuePerChannel) {
      fetches.push(
        PIM.api.channel_v1
          .list()
          .then(result => setChannels(result.items))
          .catch(err => console.error('Failed loading channels:', err))
      );
    }

    if (fetches.length > 0) {
      Promise.all(fetches).finally(() => setIsFetchingSubSelects(false));
    } else {
      setIsFetchingSubSelects(false);
    }
  }, [selectedAttribute?.code]);

  const handleAttributeChange = (code: string | null) => {
    if (!code) { onChange(null); return; }
    onChange({ code, locale: null, scope: null });
  };

  const handleLocaleChange = (locale: string) => {
    if (value) onChange({ ...value, locale });
  };

  const handleScopeChange = (scope: string) => {
    if (value) onChange({ ...value, scope });
  };

  if (!assetFamilyCode) return null;

  return (
    <div className="flex flex-col gap-2">
      <SelectInput
        emptyResultLabel={isLoading ? 'Loading...' : 'No media_file attribute found'}
        onChange={handleAttributeChange}
        placeholder="Select media attribute"
        value={value?.code ?? null}
        openLabel="Open media attribute select"
        clearable
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

      <div className="flex gap-2">
        {selectedAttribute?.valuePerLocale && (
          <div className="flex-1">
            <SelectInput
              emptyResultLabel={isFetchingSubSelects ? 'Loading...' : 'No locales found'}
              onChange={handleLocaleChange}
              placeholder="Select locale"
              value={value?.locale ?? null}
              openLabel="Open locale select"
            >
              {locales.map(locale => (
                <SelectInput.Option
                  key={locale.code}
                  title={locale.code}
                  value={locale.code}
                >
                  <Locale code={locale.code} />
                </SelectInput.Option>
              ))}
            </SelectInput>
          </div>
        )}

        {selectedAttribute?.valuePerChannel && (
          <div className="flex-1">
            <SelectInput
              emptyResultLabel={isFetchingSubSelects ? 'Loading...' : 'No channels found'}
              onChange={handleScopeChange}
              placeholder="Select channel"
              value={value?.scope ?? null}
              openLabel="Open channel select"
            >
              {channels.map(channel => (
                <SelectInput.Option
                  key={channel.code}
                  title={channel.labels?.en_US ?? channel.code}
                  value={channel.code}
                >
                  {channel.labels?.en_US ?? channel.code}
                </SelectInput.Option>
              ))}
            </SelectInput>
          </div>
        )}
      </div>
    </div>
  );
};

export default AssetAttributeSelector;
