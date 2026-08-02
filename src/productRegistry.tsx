import { AppWindow, Archive, Edit3, Plus, RotateCcw, Trash2, X } from 'lucide-react';
import { FormEvent, useMemo, useState } from 'react';

export type ProductStatus = 'Работает' | 'Деградация' | 'Настройка' | 'Отключён';

export type Product = {
  id: string;
  key: string;
  name: string;
  description: string;
  status: ProductStatus;
  tenants: number;
  version: string;
  apiBaseUrl: string;
  archivedAt: string | null;
  isSystem: boolean;
};

export const defaultProducts: Product[] = [
  { id: 'mis', key: 'imds-mis', name: 'IMDS MIS', description: 'Медицинская информационная система.', status: 'Работает', tenants: 42, version: '3.8.4', apiBaseUrl: '', archivedAt: null, isSystem: true },
  { id: 'crm', key: 'imds-crm', name: 'IMDS CRM', description: 'Управление клиентами, продажами и коммуникациями.', status: 'Работает', tenants: 56, version: '2.4.1', apiBaseUrl: '', archivedAt: null, isSystem: true },
  { id: 'marketing', key: 'imds-marketing', name: 'IMDS Marketing', description: 'Рекламные кабинеты, каналы и маркетинговая аналитика.', status: 'Деградация', tenants: 31, version: '1.9.6', apiBaseUrl: '', archivedAt: null, isSystem: true },
  { id: 'finance', key: 'imds-finance', name: 'IMDS Finance', description: 'Финансовый учёт, платежи, ДДС и отчётность.', status: 'Работает', tenants: 19, version: '1.3.0', apiBaseUrl: '', archivedAt: null, isSystem: true },
  { id: 'contract', key: 'imds-contract', name: 'IMDS Contract', description: 'Договоры, шаблоны, согласования и документы.', status: 'Работает', tenants: 24, version: '1.6.2', apiBaseUrl: '', archivedAt: null, isSystem: true },
  { id: 'dashboard', key: 'imds-dashboard', name: 'IMDS Dashboard', description: 'Управленческие отчёты, KPI и аналитические панели.', status: 'Работает', tenants: 47, version: '2.2.8', apiBaseUrl: '', archivedAt: null, isSystem: true },
  { id: 'product-7', key: 'imds-product-7', name: 'IMDS Product 7', description: 'Официальное название ещё не зафиксировано.', status: 'Настройка', tenants: 0, version: '0.1.0', apiBaseUrl: '', archivedAt: null, isSystem: true },
  { id: 'product-8', key: 'imds-product-8', name: 'IMDS Product 8', description: 'Официальное название ещё не зафиксировано.', status: 'Настройка', tenants: 0, version: '0.1.0', apiBaseUrl: '', archivedAt: null, isSystem: true },
  { id: 'product-9', key: 'imds-product-9', name: 'IMDS Product 9', description: 'Официальное название ещё не зафиксировано.', status: 'Настройка', tenants: 0, version: '0.1.0', apiBaseUrl: '', archivedAt: null, isSystem: true },
  { id: 'product-10', key: 'imds-product-10', name: 'IMDS Product 10', description: 'Официальное название ещё не зафиксировано.', status: 'Настройка', tenants: 0, version: '0.1.0', apiBaseUrl: '', archivedAt: null, isSystem: true },
  { id: 'product-11', key: 'imds-product-11', name: 'IMDS Product 11', description: 'Официальное название ещё не зафиксировано.', status: 'Настройка', tenants: 0, version: '0.1.0', apiBaseUrl: '', archivedAt: null, isSystem: true },
];

const STORAGE_KEY = 'imds-super-admin:products:v1';

function readProducts(): Product[] {
  if (typeof window === 'undefined') return defaultProducts;

  try {
    const value = window.localStorage.getItem(STORAGE_KEY);
    if (!value) return defaultProducts;
    const parsed = JSON.parse(value) as Product[];
    return Array.isArray(parsed) && parsed.length > 0 ? parsed : defaultProducts;
  } catch {
    return defaultProducts;
  }
}

export function useProductRegistry() {
  const [products, setProductsState] = useState<Product[]>(readProducts);

  const setProducts = (next: Product[] | ((current: Product[]) => Product[])) => {
    setProductsState((current) => {
      const resolved = typeof next === 'function' ? next(current) : next;
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(resolved));
      return resolved;
    });
  };

  return { products, setProducts };
}

function createId() {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `product-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function slugify(value: string) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9а-яё]+/gi, '-')
    .replace(/^-+|-+$/g, '');
}

type ProductForm = Pick<Product, 'name' | 'key' | 'description' | 'status' | 'version' | 'apiBaseUrl'>;

const emptyForm: ProductForm = {
  name: '',
  key: '',
  description: '',
  status: 'Настройка',
  version: '0.1.0',
  apiBaseUrl: '',
};

function StatusBadge({ value }: { value: ProductStatus }) {
  const className = value === 'Работает' ? 'ok' : value === 'Деградация' ? 'warn' : 'muted';
  return <span className={`status ${className}`}>{value}</span>;
}

export function ProductRegistryPage({ products, onChange }: { products: Product[]; onChange: (next: Product[]) => void }) {
  const [showArchived, setShowArchived] = useState(false);
  const [editing, setEditing] = useState<Product | null>(null);
  const [form, setForm] = useState<ProductForm>(emptyForm);
  const [message, setMessage] = useState('');

  const visibleProducts = useMemo(
    () => products.filter((product) => showArchived || !product.archivedAt),
    [products, showArchived],
  );

  const openCreate = () => {
    setEditing(null);
    setForm(emptyForm);
    setMessage('');
  };

  const openEdit = (product: Product) => {
    setEditing(product);
    setForm({
      name: product.name,
      key: product.key,
      description: product.description,
      status: product.status,
      version: product.version,
      apiBaseUrl: product.apiBaseUrl,
    });
    setMessage('');
  };

  const closeModal = () => {
    setEditing(null);
    setForm(emptyForm);
    setMessage('');
    const dialog = document.getElementById('product-dialog') as HTMLDialogElement | null;
    dialog?.close();
  };

  const showDialog = (product?: Product) => {
    if (product) openEdit(product);
    else openCreate();
    const dialog = document.getElementById('product-dialog') as HTMLDialogElement | null;
    dialog?.showModal();
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const name = form.name.trim();
    const key = (form.key.trim() || slugify(name)).toLowerCase();

    if (!name || !key) {
      setMessage('Название и системный ключ обязательны.');
      return;
    }

    const duplicate = products.some(
      (product) => product.id !== editing?.id && (product.name.toLowerCase() === name.toLowerCase() || product.key.toLowerCase() === key),
    );

    if (duplicate) {
      setMessage('Продукт с таким названием или системным ключом уже существует.');
      return;
    }

    if (editing) {
      onChange(products.map((product) => product.id === editing.id ? { ...product, ...form, name, key } : product));
    } else {
      onChange([
        ...products,
        {
          id: createId(),
          ...form,
          name,
          key,
          tenants: 0,
          archivedAt: null,
          isSystem: false,
        },
      ]);
    }

    closeModal();
  };

  const archive = (product: Product) => {
    if (product.tenants > 0) {
      window.alert(`Нельзя убрать ${product.name}: продукт подключён у ${product.tenants} компаний. Сначала отключите лицензии.`);
      return;
    }
    if (!window.confirm(`Убрать ${product.name} из активного реестра? Его можно будет восстановить.`)) return;
    onChange(products.map((item) => item.id === product.id ? { ...item, archivedAt: new Date().toISOString(), status: 'Отключён' } : item));
  };

  const restore = (product: Product) => {
    onChange(products.map((item) => item.id === product.id ? { ...item, archivedAt: null, status: 'Настройка' } : item));
  };

  const removePermanently = (product: Product) => {
    if (product.isSystem || product.tenants > 0 || !product.archivedAt) return;
    if (!window.confirm(`Удалить ${product.name} навсегда? Это действие нельзя отменить.`)) return;
    onChange(products.filter((item) => item.id !== product.id));
  };

  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">Product Registry</span>
          <h1>Продукты IMDS</h1>
          <p>Добавление, настройка, архивирование, восстановление и безопасное удаление продуктов.</p>
        </div>
        <div className="heading-actions">
          <label className="toggle-control">
            <input type="checkbox" checked={showArchived} onChange={(event) => setShowArchived(event.target.checked)} />
            <span>Показывать архив</span>
          </label>
          <button className="primary-button" onClick={() => showDialog()}><Plus size={17} /> Добавить продукт</button>
        </div>
      </div>

      <div className="registry-grid">
        {visibleProducts.map((product) => (
          <article className={`registry-card ${product.archivedAt ? 'archived' : ''}`} key={product.id}>
            <div className="registry-top">
              <div className="product-symbol large"><AppWindow size={22} /></div>
              <StatusBadge value={product.status} />
            </div>
            <div className="registry-title-row">
              <div>
                <h3>{product.name}</h3>
                <code>{product.key}</code>
              </div>
              {product.archivedAt && <span className="archive-label">Архив</span>}
            </div>
            <p>{product.description || 'Описание продукта не заполнено.'}</p>
            <dl>
              <div><dt>Tenants</dt><dd>{product.tenants}</dd></div>
              <div><dt>Версия</dt><dd>{product.version}</dd></div>
              <div><dt>Health</dt><dd>{product.status === 'Работает' ? '99.98%' : product.status === 'Деградация' ? '96.12%' : '—'}</dd></div>
            </dl>
            <div className="registry-actions">
              <button className="secondary-button" onClick={() => showDialog(product)}><Edit3 size={15} /> Изменить</button>
              {!product.archivedAt ? (
                <button className="danger-button" onClick={() => archive(product)} disabled={product.tenants > 0} title={product.tenants > 0 ? 'Сначала отключите активные лицензии' : 'Убрать в архив'}><Archive size={15} /> Убрать</button>
              ) : (
                <button className="secondary-button" onClick={() => restore(product)}><RotateCcw size={15} /> Восстановить</button>
              )}
              {product.archivedAt && !product.isSystem && product.tenants === 0 && (
                <button className="icon-danger-button" onClick={() => removePermanently(product)} title="Удалить навсегда"><Trash2 size={16} /></button>
              )}
            </div>
          </article>
        ))}
      </div>

      <dialog id="product-dialog" className="modal" onCancel={closeModal}>
        <form onSubmit={submit}>
          <div className="modal-header">
            <div><span className="eyebrow">Product Registry</span><h2>{editing ? 'Изменить продукт' : 'Добавить продукт'}</h2></div>
            <button type="button" className="icon-button" onClick={closeModal} aria-label="Закрыть"><X size={18} /></button>
          </div>
          <div className="form-grid">
            <label><span>Название *</span><input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value, key: editing ? form.key : slugify(event.target.value) })} placeholder="IMDS Новый продукт" /></label>
            <label><span>Системный ключ *</span><input value={form.key} onChange={(event) => setForm({ ...form, key: slugify(event.target.value) })} placeholder="imds-new-product" /></label>
            <label><span>Версия</span><input value={form.version} onChange={(event) => setForm({ ...form, version: event.target.value })} placeholder="0.1.0" /></label>
            <label><span>Статус</span><select value={form.status} onChange={(event) => setForm({ ...form, status: event.target.value as ProductStatus })}><option>Настройка</option><option>Работает</option><option>Деградация</option><option>Отключён</option></select></label>
            <label className="span-2"><span>API base URL</span><input value={form.apiBaseUrl} onChange={(event) => setForm({ ...form, apiBaseUrl: event.target.value })} placeholder="https://api.example.com" /></label>
            <label className="span-2"><span>Описание</span><textarea rows={4} value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} placeholder="Назначение продукта и его основные функции" /></label>
          </div>
          {message && <div className="form-message">{message}</div>}
          <div className="modal-actions"><button type="button" className="secondary-button compact" onClick={closeModal}>Отмена</button><button type="submit" className="primary-button">{editing ? 'Сохранить изменения' : 'Добавить продукт'}</button></div>
        </form>
      </dialog>
    </>
  );
}
