import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/App';
import { registerServiceWorker } from './shared/lib/serviceWorker';
import { AppErrorBoundary } from './shared/ui/AppErrorBoundary';
import './shared/styles/global.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppErrorBoundary>
      <App />
    </AppErrorBoundary>
  </StrictMode>,
);

registerServiceWorker();
