import ReactDOM from 'react-dom/client';
import { InfrastructurePage } from './vps/pages/infrastructure/InfrastructurePage';
import { ReleaseManagerPage } from './vps/pages/infrastructure/ReleaseManagerPage';
import { RootApp } from './vps/pages/RootApp';
import { installControlCenterBranding } from './vps/branding';
import './vps/pages/friendly.css';
import './vps/pages/infrastructure/releaseShortcut.css';

const rootElement = document.getElementById('root');
if (!rootElement) throw new Error('Root element is missing');

installControlCenterBranding(rootElement);
const root = ReactDOM.createRoot(rootElement);

if (window.location.pathname === '/infrastructure/releases') {
  root.render(<ReleaseManagerPage />);
} else if (window.location.pathname === '/infrastructure') {
  root.render(<><InfrastructurePage /><a className="release-manager-shortcut" href="/infrastructure/releases">Релизы и восстановление</a></>);
} else {
  root.render(<RootApp />);
}
