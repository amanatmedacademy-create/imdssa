import ReactDOM from 'react-dom/client';
import { UserAccessOverlay } from './features/access/UserAccessOverlay';
import { VpsBillingBridge } from './features/billing/VpsBillingBridge';
import { NotificationBell } from './features/notifications/NotificationBell';
import { ProductCommercialBridge } from './features/products/ProductCommercialBridge';
import { SessionManagementBridge } from './features/security/SessionManagementBridge';
import { OrganizationSubscriptionBridge } from './features/subscriptions/OrganizationSubscriptionBridge';
import './notifications.css';
import { installControlCenterBranding } from './vps/branding';
import { InfrastructureCenter } from './vps/InfrastructureCenter';
import { ControlCenterV2 } from './vps/pages/ControlCenterV2';
import { OverviewPreviewApp } from './vps/pages/overview/OverviewPreviewApp';
import { VpsApp } from './vps/VpsApp';

const rootElement = document.getElementById('root');
if (!rootElement) throw new Error('Root element is missing');

installControlCenterBranding(rootElement);
const root = ReactDOM.createRoot(rootElement);

if (window.location.pathname === '/control-center-v2') {
  root.render(<ControlCenterV2 />);
} else if (window.location.pathname === '/overview-v2') {
  root.render(<OverviewPreviewApp />);
} else {
  root.render(
    <>
      <VpsApp />
      <InfrastructureCenter />
      <NotificationBell />
      <UserAccessOverlay />
      <ProductCommercialBridge />
      <OrganizationSubscriptionBridge />
      <VpsBillingBridge />
      <SessionManagementBridge />
    </>,
  );
}
