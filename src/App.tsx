import './App.css';

import { useState } from 'react';
import AttributeSelection, { SelectedAttribute } from './components/ui/attribute_selection';

function App() {
  const [selectedSource, setSelectedSource] = useState<SelectedAttribute | null>(null);
  const [selectedDestination, setSelectedDestination] = useState<SelectedAttribute | null>(null);

  const sourceSearch = {
    type: [
      {
        operator: "IN",
        value: ["pim_catalog_image", "pim_catalog_file"]
      }
    ]
  };

  const destinationSearch = {
    type: [
      {
        operator: "IN",
        value: ["pim_catalog_asset_collection"]
      }
    ]
  };

  return (
    <div className="p-4 space-y-4">
      <h1 className="text-2xl font-bold mb-4">Asset Migration</h1>
      
      <div className="max-w-md space-y-4">
        <div>
          <label className="block text-sm font-medium mb-1 font-semibold">Source Attribute</label>
          <AttributeSelection 
            value={selectedSource}
            search={sourceSearch}
            placeholder="Select source attribute"
            onChange={(value) => {
              console.log('Selected source:', value);
              setSelectedSource(value);
            }} 
          />
        </div>

        <div>
          <label className="block text-sm font-medium mb-1 font-semibold">Destination Attribute</label>
          <AttributeSelection 
            value={selectedDestination}
            search={destinationSearch}
            placeholder="Select destination attribute"
            onChange={(value) => {
              console.log('Selected destination:', value);
              setSelectedDestination(value);
            }} 
          />
        </div>
        
        <div className="mt-8 p-4 bg-gray-50 rounded-lg border border-gray-200">
          <h2 className="text-lg font-bold mb-2">Selection Summary</h2>
          <div className="space-y-1 text-sm">
            <p><span className="font-semibold">Source:</span> {selectedSource?.code || 'None'} 
              {selectedSource?.locale && ` (${selectedSource.locale})`}
              {selectedSource?.scope && ` [${selectedSource.scope}]`}
            </p>
            <p><span className="font-semibold">Destination:</span> {selectedDestination?.code || 'None'}
              {selectedDestination?.locale && ` (${selectedDestination.locale})`}
              {selectedDestination?.scope && ` [${selectedDestination.scope}]`}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

export default App;
