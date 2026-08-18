import ReactDOM from 'react-dom/client';
import { UserAccessOverlay } from './features/access/UserAccessOverlay';
import { NotificationBell } from './features/notifications/NotificationBell';
import { ProductCommercialBridge } from './features/products/ProductCommercialBridge';
import { SessionManagementBridge } from './features/security/SessionManagementBridge';
import './notifications.css';
import { installControlCenterBranding } from './vps/branding';
import { VpsApp } from './vps/VpsApp';

const rootElement = document.getElementById('root');
if (!rootElement) throw new Error('Root element is missing');
const root = ReactDOM.createRoot(rootElement);

if (import.meta.env.VITE_RUNTIME === 'vps') {
  installControlCenterBranding(rootElement);
  root.render(<><VpsApp /><NotificationBell /><UserAccessOverlay /><ProductCommercialBridge /><SessionManagementBridge /></>);
} else {
  void import('./LegacyApp').then(({ LegacyApp }) => {
    root.render(<LegacyApp />);
  }).catch((error: unknown) => {
    console.error('Failed to load legacy runtime', error);
    rootElement.textContent = 'IMDS Control Center failed to initialize.';
  });
}
