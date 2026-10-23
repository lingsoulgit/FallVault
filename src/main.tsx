import React from 'react';
import ReactDOM from 'react-dom/client';
import { HashRouter } from 'react-router-dom';
import { getCurrentWindow } from '@tauri-apps/api/window';
import App from './App';
import { ScreenCaptureOverlay } from './components/ScreenCaptureOverlay';
import './index.css';

const isScreenCaptureWindow = getCurrentWindow().label === 'screen-capture';

ReactDOM.createRoot(document.getElementById('root')!).render(isScreenCaptureWindow ? (
  <ScreenCaptureOverlay />
) : (
  <React.StrictMode>
    <HashRouter>
      <App />
    </HashRouter>
  </React.StrictMode>
));
