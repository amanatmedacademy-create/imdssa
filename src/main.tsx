import ReactDOM from 'react-dom/client';
import { InfrastructureCenter } from './vps/InfrastructureCenter';
import { ControlCenterV2 } from './vps/pages/ControlCenterV2';
import { OverviewPreviewApp } from './vps/pages/overview/OverviewPreviewApp';
import { RootApp } from './vps/pages/RootApp';
import { installControlCenterBranding } from './vps/branding';

const rootElement = document.getElementById('root');
if (!rootElement) throw new Error('Root element is missing');

installControlCenterBranding(rootElement);
const root = ReactDOM.createRoot(rootElement);

if (window.location.pathname === '/control-center-v2') {
  root.render(<ControlCenterV2 />);
} else if (window.location.pathname === '/overview-v2') {
  root.render(<OverviewPreviewApp />);
} else if (window.location.pathname === '/infrastructure') {
  root.render(<InfrastructureCenter />);
} else {
  root.render(<RootApp />);
}
