import { Locale, SelectInput } from 'akeneo-design-system';
import { useEffect, useState } from 'react';

interface PimAttribute {
  code: string;
  type?: string;
  labels?: { [locale: string]: string };
  localizable?: boolean;
  scopable?: boolean;
}
interface PimLocale { code: string; enabled: boolean; }
interface PimChannel { code: string; labels?: { [locale: string]: string }; }

export interface SelectedAttribute {
  code: string;
  locale?: string | null;
  scope?: string | null;
}

interface AttributeSelectionProps {
  value: SelectedAttribute | null;
  onChange: (value: SelectedAttribute | null) => void;
  search: any;
  placeholder: string;
}

const AttributeSelection = ({ value, onChange, search, placeholder }: AttributeSelectionProps) => {
  const [attributes, setAttributes] = useState<PimAttribute[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [locales, setLocales] = useState<PimLocale[]>([]);
  const [channels, setChannels] = useState<PimChannel[]>([]);
  const [isFetchingSubSelects, setIsFetchingSubSelects] = useState(false);

  const fetchAttributes = async () => {
    setIsLoading(true);
    try {
      const response = await PIM.api.attribute_v1.list({ search, limit: 100 });
      if (response) setAttributes(response.items);
    } catch (err) {
      console.error('Failed loading attributes:', err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchAttributes();
  }, [JSON.stringify(search)]);

  const selectedAttribute = attributes.find(a => a.code === value?.code);

  // Fetch locales and channels when the selected attribute changes
  useEffect(() => {
    setLocales([]);
    setChannels([]);
    if (!selectedAttribute) return;

    const fetches: Promise<void>[] = [];
    setIsFetchingSubSelects(true);

    if (selectedAttribute.localizable) {
      fetches.push(
        PIM.api.locale_v1
          .list({ limit: 100 })
          .then(result => setLocales(result.items.filter(l => l.enabled)))
          .catch(err => console.error('Failed loading locales:', err))
      );
    }

    if (selectedAttribute.scopable) {
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

  const handleAttributeChange = (code: string) => {
    const attr = attributes.find(a => a.code === code);
    if (!attr) { onChange(null); return; }
    onChange({ code, locale: null, scope: null });
  };

  const handleLocaleChange = (locale: string) => {
    if (value) onChange({ ...value, locale });
  };

  const handleScopeChange = (scope: string) => {
    if (value) onChange({ ...value, scope });
  };

  return (
    <div className="flex flex-col gap-2">
      <SelectInput
        emptyResultLabel={isLoading ? 'Loading...' : 'No result found'}
        onChange={handleAttributeChange}
        placeholder={placeholder}
        value={value?.code || null}
        openLabel="Open select"
      >
        {attributes.map(attr => (
          <SelectInput.Option
            key={attr.code}
            title={attr.labels?.en_US || attr.code}
            value={attr.code}
          >
            {attr.labels?.en_US || attr.code}
          </SelectInput.Option>
        ))}
      </SelectInput>

      <div className="flex gap-2">
        {selectedAttribute?.localizable && (
          <div className="flex-1">
            <SelectInput
              emptyResultLabel={isFetchingSubSelects ? 'Loading...' : 'No locales found'}
              onChange={handleLocaleChange}
              placeholder="Select locale"
              value={value?.locale || null}
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

        {selectedAttribute?.scopable && (
          <div className="flex-1">
            <SelectInput
              emptyResultLabel={isFetchingSubSelects ? 'Loading...' : 'No channels found'}
              onChange={handleScopeChange}
              placeholder="Select channel"
              value={value?.scope || null}
              openLabel="Open channel select"
            >
              {channels.map(channel => (
                <SelectInput.Option
                  key={channel.code}
                  title={channel.labels?.en_US || channel.code}
                  value={channel.code}
                >
                  {channel.labels?.en_US || channel.code}
                </SelectInput.Option>
              ))}
            </SelectInput>
          </div>
        )}
      </div>
    </div>
  );
};

export default AttributeSelection;
