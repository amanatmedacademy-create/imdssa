import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { App } from './App';
import { AuthGate } from './core/AuthGate';
import { AuthProvider } from './core/auth';
import { BillingProvider } from './features/billing/BillingContext';
import { ProductCatalogProvider } from './features/products/ProductCatalogContext';
import './styles.css';
import './productRegistry.css';
import './controlPlane.css';
import './productCatalog.css';
import './billing.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <AuthGate>
          <ProductCatalogProvider>
            <BillingProvider>
              <App />
            </BillingProvider>
          </ProductCatalogProvider>
        </AuthGate>
      </AuthProvider>
    </BrowserRouter>
  </React.StrictMode>,
);
