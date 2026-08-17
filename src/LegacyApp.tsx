import React from 'react';
import { BrowserRouter } from 'react-router-dom';
import { App } from './App';
import { AppErrorBoundary } from './core/AppErrorBoundary';
import { AuthGate } from './core/AuthGate';
import { AuthProvider } from './core/auth';
import { ProductAnalyticsProvider } from './features/analytics/ProductAnalyticsContext';
import { BillingProvider } from './features/billing/BillingContext';
import { BillingOperationsProvider } from './features/billingOperations/BillingOperationsContext';
import { GovernanceProvider } from './features/governance/GovernanceContext';
import { IdentityProvider } from './features/identity/IdentityContext';
import { ModuleRuntimeProvider } from './features/modules/ModuleRuntimeContext';
import { ObservabilityProvider } from './features/observability/ObservabilityContext';
import { OperationsProvider } from './features/operations/OperationsContext';
import { ProductCatalogProvider } from './features/products/ProductCatalogContext';
import { SecurityProvider } from './features/security/SecurityContext';
import { SupportProvider } from './features/support/SupportContext';

export function LegacyApp() {
  return (
    <React.StrictMode>
      <AppErrorBoundary>
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
                            <ProductAnalyticsProvider>
                              <SupportProvider>
                                <GovernanceProvider>
                                  <ModuleRuntimeProvider>
                                    <App />
                                  </ModuleRuntimeProvider>
                                </GovernanceProvider>
                              </SupportProvider>
                            </ProductAnalyticsProvider>
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
      </AppErrorBoundary>
    </React.StrictMode>
  );
}
