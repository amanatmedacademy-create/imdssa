import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { App } from './App';
import { AuthGate } from './core/AuthGate';
import { AuthProvider } from './core/auth';
import './styles.css';
import './productRegistry.css';
import './controlPlane.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <AuthGate>
          <App />
        </AuthGate>
      </AuthProvider>
    </BrowserRouter>
  </React.StrictMode>,
);
