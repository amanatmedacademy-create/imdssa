import ReactDOM from 'react-dom/client';
import { UserAccessOverlay } from './features/access/UserAccessOverlay';
import { VpsBillingBridge } from './features/billing/VpsBillingBridge';
import { NotificationBell } from './features/notifications/NotificationBell';
import { ProductCommercialBridge } from './features/products/ProductCommercialBridge';
import { SessionManagementBridge } from './features/security/SessionManagementBridge';
import { OrganizationSubscriptionBridge } from './features/subscriptions/OrganizationSubscriptionBridge';
import './notifications.css';
import { installControlCenterBranding } from './vps/branding';
import { VpsApp } from './vps/VpsApp';

const rootElement = document.getElementById('root');
if (!rootElement) throw new Error('Root element is missing');

installControlCenterBranding(rootElement);
ReactDOM.createRoot(rootElement).render(
  <>
    <VpsApp />
    <NotificationBell />
    <UserAccessOverlay />
    <ProductCommercialBridge />
    <OrganizationSubscriptionBridge />
    <VpsBillingBridge />
    <SessionManagementBridge />
  </>,
);
