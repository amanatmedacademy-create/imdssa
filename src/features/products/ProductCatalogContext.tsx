import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import {
  productRepository,
  type ManagedProduct,
  type ProductAdapterInput,
  type ProductDefinitionInput,
} from './productRepository';

type ProductCatalogContextValue = {
  products: ManagedProduct[];
  loading: boolean;
  saving: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  saveProduct: (input: ProductDefinitionInput) => Promise<boolean>;
  configureAdapter: (input: ProductAdapterInput) => Promise<boolean>;
  archiveProduct: (id: string) => Promise<boolean>;
  restoreProduct: (id: string) => Promise<boolean>;
  deleteProduct: (id: string) => Promise<boolean>;
};

const ProductCatalogContext = createContext<ProductCatalogContextValue | null>(null);

export function ProductCatalogProvider({ children }: { children: ReactNode }) {
  const [products, setProducts] = useState<ManagedProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setProducts(await productRepository.list());
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Не удалось загрузить Product Registry.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const execute = useCallback(async (command: () => Promise<ManagedProduct[]>) => {
    setSaving(true);
    setError(null);
    try {
      setProducts(await command());
      return true;
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Операция с продуктом не выполнена.');
      return false;
    } finally {
      setSaving(false);
    }
  }, []);

  const value = useMemo<ProductCatalogContextValue>(() => ({
    products,
    loading,
    saving,
    error,
    refresh,
    saveProduct: (input) => execute(() => productRepository.saveDefinition(input)),
    configureAdapter: (input) => execute(() => productRepository.configureAdapter(input)),
    archiveProduct: (id) => execute(() => productRepository.archive(id)),
    restoreProduct: (id) => execute(() => productRepository.restore(id)),
    deleteProduct: (id) => execute(() => productRepository.deleteCustom(id)),
  }), [error, execute, loading, products, refresh, saving]);

  return <ProductCatalogContext.Provider value={value}>{children}</ProductCatalogContext.Provider>;
}

export function useProductCatalog(): ProductCatalogContextValue {
  const context = useContext(ProductCatalogContext);
  if (!context) throw new Error('useProductCatalog must be used inside ProductCatalogProvider.');
  return context;
}
