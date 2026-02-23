import {SelectInput} from 'akeneo-design-system'
import { useEffect, useState } from 'react';

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

const AttributeSelection = ({value, onChange, search, placeholder}: AttributeSelectionProps) => {
  const [attributes, setAttributes] = useState<Attribute[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(false);

  const fetchAttributes = async () => {
    setIsLoading(true);
    try {
      const response = await PIM.api.attribute_v1.list({
        search,
        limit: 100
      });
      if (response) {
        setAttributes(response.items);
      }
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

  const handleAttributeChange = (code: string) => {
    const attr = attributes.find(a => a.code === code);
    if (!attr) {
      onChange(null);
      return;
    }

    // Initialize with first available locale/scope if needed
    const newValue: SelectedAttribute = {
      code,
      locale: attr.localizable ? (attr.availableLocales?.[0] || null) : null,
      scope: attr.scopable ? ((attr as any).availableChannels?.[0] || null) : null
    };
    onChange(newValue);
  };

  const handleLocaleChange = (locale: string) => {
    if (value) {
      onChange({ ...value, locale });
    }
  };

  const handleScopeChange = (scope: string) => {
    if (value) {
      onChange({ ...value, scope });
    }
  };

  return (
    <div className="flex flex-col gap-2">
      <SelectInput
        emptyResultLabel={isLoading ? "Loading..." : "No result found"}
        onChange={handleAttributeChange}
        placeholder={placeholder}
        value={value?.code || null}
        openLabel="Open select"
      >
        {attributes.map((attr) => (
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
        {selectedAttribute?.localizable && selectedAttribute.availableLocales && (
          <div className="flex-1">
            <SelectInput
              onChange={handleLocaleChange}
              placeholder="Select Locale"
              value={value?.locale || null}
              openLabel="Open locale select"
            >
              {selectedAttribute.availableLocales.map((localeCode) => (
                <SelectInput.Option
                  key={localeCode}
                  title={localeCode}
                  value={localeCode}
                >
                  {localeCode}
                </SelectInput.Option>
              ))}
            </SelectInput>
          </div>
        )}

        {selectedAttribute?.scopable && (selectedAttribute as any).availableChannels && (
          <div className="flex-1">
            <SelectInput
              onChange={handleScopeChange}
              placeholder="Select Scope"
              value={value?.scope || null}
              openLabel="Open scope select"
            >
              {(selectedAttribute as any).availableChannels.map((channelCode: string) => (
                <SelectInput.Option
                  key={channelCode}
                  title={channelCode}
                  value={channelCode}
                >
                  {channelCode}
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