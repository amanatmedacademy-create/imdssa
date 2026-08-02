import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { App } from './App';
import { AuthGate } from './core/AuthGate';
import { AuthProvider } from './core/auth';
import { BillingProvider } from './features/billing/BillingContext';
import { BillingOperationsProvider } from './features/billingOperations/BillingOperationsContext';
import { IdentityProvider } from './features/identity/IdentityContext';
import { ObservabilityProvider } from './features/observability/ObservabilityContext';
import { OperationsProvider } from './features/operations/OperationsContext';
import { ProductCatalogProvider } from './features/products/ProductCatalogContext';
import { SecurityProvider } from './features/security/SecurityContext';
import { SupportProvider } from './features/support/SupportContext';
import './styles.css';
import './productRegistry.css';
import './controlPlane.css';
import './productCatalog.css';
import './billing.css';
import './billingOperations.css';
import './operations.css';
import './security.css';
import './observability.css';
import './support.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <AuthGate>
          <ProductCatalogProvider>
            <BillingProvider>
              <BillingOperationsProvider>
                <IdentityProvider>
                  <OperationsProvider>
                    <SecurityProvider>
                      <ObservabilityProvider>
                        <SupportProvider>
                          <App />
                        </SupportProvider>
                      </ObservabilityProvider>
                    </SecurityProvider>
                  </OperationsProvider>
                </IdentityProvider>
              </BillingOperationsProvider>
            </BillingProvider>
          </ProductCatalogProvider>
        </AuthGate>
      </AuthProvider>
    </BrowserRouter>
  </React.StrictMode>,
);
