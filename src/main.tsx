import { Analytics } from '@vercel/analytics/react';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

// Order matters: theme.css defines the custom properties that the Sass partials
// reference at runtime.
import './styles/theme.css';
import './styles/main.scss';

import { App } from './App';

const container = document.getElementById('root');
if (!container) throw new Error('#root is missing from index.html');

createRoot(container).render(
  <StrictMode>
    <App />
    {/*
      Vercel Analytics. This is a Vite SPA with no layout file, so the root
      render is the equivalent place.

      Imported from `@vercel/analytics/react`, not `/next` — the Next entry
      pulls in Next-only APIs and will not build here.

      Renders nothing, and is inert off Vercel (it logs in development rather
      than sending anything).
    */}
    <Analytics />
  </StrictMode>,
);
