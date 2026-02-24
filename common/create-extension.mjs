/**
 * This script creates a new UI extension in the Akeneo PIM.
 *
 * It performs the following steps:
 * 1. Loads environment variables (PIM_HOST, API_TOKEN) from the .env file.
 * 2. Reads the project's `package.json` to get the extension name.
 * 3. Builds a multipart/form-data payload containing the extension's metadata and the compiled JavaScript file (`dist/demo.js`).
 * 4. Sends a POST request to the Akeneo PIM API to create the extension.
 * 5. Upon successful creation, it retrieves the new extension's UUID and saves it to the .env file as `EXTENSION_UUID`.
 *
 * Usage:
 * `node create-extension.mjs`
 * `node create-extension.mjs --with-credentials` (to include dummy credentials)
 */

import axios from 'axios';
import dotenv from 'dotenv';
import {updateEnvVar, createExtensionPayload} from './utils.mjs';
import fs from 'fs';
import path from 'path';

dotenv.config({override: true});

const {
    PIM_HOST,
    API_TOKEN,
    PROJECT_PATH = process.cwd(),
} = process.env;


if (!PIM_HOST || !API_TOKEN) {
    console.error('Error: PIM_HOST and API_TOKEN must be set in your .env file.');
    process.exit(1);
}

const configPath = path.join(PROJECT_PATH, 'extension_configuration.json');
const configuration = JSON.parse(fs.readFileSync(configPath, 'utf8'));

// Inject live token and host from .env into the configuration before uploading
if (API_TOKEN && configuration.credentials) {
  configuration.credentials = configuration.credentials.map(c =>
    c.code === 'pim_api' ? { ...c, value: API_TOKEN } : c
  );
}
if (PIM_HOST && configuration.configuration?.custom_variables) {
  configuration.configuration.custom_variables.pim_host = PIM_HOST;
}

const payload = createExtensionPayload(PROJECT_PATH, configuration);
(async () => {
  try {
    console.log("checking if extension already exists...");
    const currentExtensions = await axios.get(
      `${PIM_HOST}/api/rest/v1/ui-extensions`,
      {
        headers: {
          ...payload.getHeaders(),
          Authorization: `Bearer ${API_TOKEN}`,
        },
      }
    );

    var myExtention = currentExtensions.data.find(ext => ext.name === configuration.name) ?? null;

    if(myExtention == null)
    {
      console.log(`Creating extension on ${PIM_HOST}...`);
      myExtention = await axios.post(
        `${PIM_HOST}/api/rest/v1/ui-extensions`,
        payload,
        {
          headers: {
            ...payload.getHeaders(),
            Authorization: `Bearer ${API_TOKEN}`,
          },
        }
      );
      myExtention = myExtention.data;
      console.log(`Extension created successfully!`);
    }
    else {
      console.log(`Extension already exists!`);
    }

    const uuid = myExtention.uuid;
    if (uuid) {
      updateEnvVar('EXTENSION_UUID', uuid);
      console.log('EXTENSION_UUID has been saved to your .env file.');
    }

  } catch (error) {
    console.error('Error creating extension:', error.response ? error.response.data : error.message);
    process.exit(1);
  }
})();
