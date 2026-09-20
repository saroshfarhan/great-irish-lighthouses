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
  </StrictMode>,
);
