import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import App from './App.tsx';
import { ThemeProvider } from 'styled-components';
import { connectorTheme } from "akeneo-design-system";

// The root element is now created by the script itself if it doesn't exist.
if (!document.getElementById('root')) {
    document.body.innerHTML = '<div id="root"></div>';
}

const root = ReactDOM.createRoot(
    document.getElementById('root') as HTMLElement
);

root.render(
    <React.StrictMode>
        <ThemeProvider theme={connectorTheme}>
            <App />
        </ThemeProvider>
    </React.StrictMode>
);
