import ReactDOM from 'react-dom/client';
import { InfrastructurePage } from './vps/pages/infrastructure/InfrastructurePage';
import { RootApp } from './vps/pages/RootApp';
import { installControlCenterBranding } from './vps/branding';
import './vps/pages/friendly.css';

const rootElement = document.getElementById('root');
if (!rootElement) throw new Error('Root element is missing');

installControlCenterBranding(rootElement);
const root = ReactDOM.createRoot(rootElement);

if (window.location.pathname === '/infrastructure') {
  root.render(<InfrastructurePage />);
} else {
  root.render(<RootApp />);
}
