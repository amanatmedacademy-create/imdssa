import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { App } from './App';
import { AuthGate } from './core/AuthGate';
import { AuthProvider } from './core/auth';
import { ProductAnalyticsProvider } from './features/analytics/ProductAnalyticsContext';
import { BillingProvider } from './features/billing/BillingContext';
import { IdentityProvider } from './features/identity/IdentityContext';
import { ObservabilityProvider } from './features/observability/ObservabilityContext';
import { OperationsProvider } from './features/operations/OperationsContext';
import { ProductCatalogProvider } from './features/products/ProductCatalogContext';
import { SecurityProvider } from './features/security/SecurityContext';
import './styles.css';
import './productRegistry.css';
import './controlPlane.css';
import './productCatalog.css';
import './billing.css';
import './operations.css';
import './security.css';
import './observability.css';
import './productAnalytics.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <AuthGate>
          <ProductCatalogProvider>
            <BillingProvider>
              <IdentityProvider>
                <OperationsProvider>
                  <SecurityProvider>
                    <ObservabilityProvider>
                      <ProductAnalyticsProvider>
                        <App />
                      </ProductAnalyticsProvider>
                    </ObservabilityProvider>
                  </SecurityProvider>
                </OperationsProvider>
              </IdentityProvider>
            </BillingProvider>
          </ProductCatalogProvider>
        </AuthGate>
      </AuthProvider>
    </BrowserRouter>
  </React.StrictMode>,
);
