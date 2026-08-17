import ReactDOM from 'react-dom/client';
import { NotificationBell } from './features/notifications/NotificationBell';
import './notifications.css';
import { VpsApp } from './vps/VpsApp';

const rootElement = document.getElementById('root');
if (!rootElement) throw new Error('Root element is missing');
const root = ReactDOM.createRoot(rootElement);

if (import.meta.env.VITE_RUNTIME === 'vps') {
  root.render(<><VpsApp /><NotificationBell /></>);
} else {
  void import('./LegacyApp').then(({ LegacyApp }) => {
    root.render(<LegacyApp />);
  }).catch((error: unknown) => {
    console.error('Failed to load legacy runtime', error);
    rootElement.textContent = 'IMDS Super Admin failed to initialize.';
  });
}
