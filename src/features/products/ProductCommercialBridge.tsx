import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { ProductCommercialCenter } from './ProductCommercialCenter';
import './productCommercialBridge.css';

type User = { role: string; scope: 'platform' | 'tenant' };
type Product = { id: string; code: string; name: string; status: string; version: string | null; last_health: string; last_heartbeat_at: string | null; last_latency_ms?: number | null; last_error?: string | null; tenants: number };

async function api<T>(path: string): Promise<T> {
  const response = await fetch(path, { credentials: 'same-origin' });
  if (!response.ok) throw new Error(`${response.status} ${await response.text()}`);
  return response.json() as Promise<T>;
}

export function ProductCommercialBridge() {
  const [active, setActive] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [host, setHost] = useState<HTMLElement | null>(null);

  useEffect(() => {
    let stopped = false;
    const sync = () => {
      if (stopped) return;
      const content = document.querySelector<HTMLElement>('.vps-content');
      const title = content?.querySelector('header h1')?.textContent?.trim();
      const shouldActivate = title === 'Продукты';
      setActive(shouldActivate);
      if (!content) return;
      let portalHost = content.querySelector<HTMLElement>('.product-commercial-bridge-host');
      if (!portalHost) {
        portalHost = document.createElement('div');
        portalHost.className = 'product-commercial-bridge-host';
        content.appendChild(portalHost);
      }
      setHost(portalHost);
      content.classList.toggle('product-commercial-bridge-active', shouldActivate);
    };
    sync();
    const observer = new MutationObserver(sync);
    observer.observe(document.body, { subtree: true, childList: true, characterData: true });
    document.addEventListener('click', sync, true);
    return () => {
      stopped = true;
      observer.disconnect();
      document.removeEventListener('click', sync, true);
      document.querySelector<HTMLElement>('.vps-content')?.classList.remove('product-commercial-bridge-active');
      document.querySelector<HTMLElement>('.product-commercial-bridge-host')?.remove();
    };
  }, []);

  useEffect(() => {
    if (!active) return;
    void api<{ user: User }>('/api/auth/me').then(async ({ user: current }) => {
      setUser(current);
      if (current.scope !== 'platform') return;
      const result = await api<{ items: Product[] }>('/api/v1/products');
      setProducts(result.items);
    }).catch(() => {
      setUser(null);
      setProducts([]);
    });
  }, [active]);

  const canManage = useMemo(() => Boolean(user?.scope === 'platform' && ['platform_owner', 'platform_admin'].includes(user.role)), [user]);
  if (!active || !host || user?.scope !== 'platform') return null;
  return createPortal(<ProductCommercialCenter products={products} canManage={canManage} />, host);
}
