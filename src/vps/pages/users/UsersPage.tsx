import { ShieldCheck, UserCog, Users } from 'lucide-react';
import { UserAccessManagement } from '../../../features/access/UserAccessManagement';
import type { Module, Organization, Product, User } from '../../controlCenter';
import './usersPage.css';

type Props = {
  user: User;
  organizations: Organization[];
  products: Product[];
  modules: Module[];
};

export function UsersPage({ user, organizations, products, modules }: Props) {
  const canManage = (user.scope === 'platform' && ['platform_owner', 'platform_admin'].includes(user.role)) || (user.scope === 'tenant' && ['owner', 'admin'].includes(user.role));

  return <section className="users-page">
    <div className="users-kpis">
      <article><Users size={18}/><div><span>Организации</span><strong>{organizations.length}</strong><small>доступные текущему пользователю</small></div></article>
      <article><UserCog size={18}/><div><span>Управление доступом</span><strong>{canManage ? 'Доступно' : 'Только просмотр'}</strong><small>RBAC на уровне организации</small></div></article>
      <article><ShieldCheck size={18}/><div><span>Scope</span><strong>{user.scope}</strong><small>{user.role}</small></div></article>
    </div>

    <div className="users-intro">
      <div><span>ACCESS CONTROL</span><h2>Пользователи и доступ</h2><p>Пользователи организаций, роли, продукты, модули и принудительное завершение tenant-доступа управляются из одного VPS-контура.</p></div>
    </div>

    <UserAccessManagement user={user} organizations={organizations} products={products} modules={modules} />
  </section>;
}
