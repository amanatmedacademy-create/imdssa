import ReactDOM from 'react-dom/client';
import { VpsApp } from './vps/VpsApp';
import './styles.css';
import './productRegistry.css';
import './controlPlane.css';
import './productCatalog.css';
import './billing.css';
import './billingOperations.css';
import './identity.css';
import './operations.css';
import './security.css';
import './observability.css';
import './productAnalytics.css';
import './support.css';
import './governance.css';
import './moduleRuntime.css';
import './frontendFixes.css';
import './moduleUiFixes.css';

const rootElement = document.getElementById('root');
if (!rootElement) throw new Error('Root element is missing');
const root = ReactDOM.createRoot(rootElement);

if (import.meta.env.VITE_RUNTIME === 'vps') {
  root.render(<VpsApp />);
} else {
  void import('./LegacyApp').then(({ LegacyApp }) => {
    root.render(<LegacyApp />);
  }).catch((error: unknown) => {
    console.error('Failed to load legacy runtime', error);
    rootElement.textContent = 'IMDS Super Admin failed to initialize.';
  });
}
