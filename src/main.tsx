import { createRoot } from 'react-dom/client';
import { attachSriStore } from '@/lib/api';
import App from '@/app/App';
import '@/styles/global.css';

attachSriStore();

// StrictMode off: legacy boot() runs at import time and assumes a single mount.
createRoot(document.getElementById('root')!).render(<App />);