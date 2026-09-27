import type { AppRole } from './types';

export type Permission =
  | 'dashboard.read'
  | 'pos.use'
  | 'pos.price_override'
  | 'sales.read'
  | 'sales.notes.update'
  | 'sales.cancel'
  | 'sales.delete'
  | 'customers.read'
  | 'customers.write'
  | 'products.read'
  | 'products.write'
  | 'invoices.read'
  | 'invoices.notes.update'
  | 'invoices.write'
  | 'invoices.delete'
  | 'documents.create'
  | 'settings.write'
  | 'users.manage';

const permissionsByRole: Record<AppRole, ReadonlySet<Permission>> = {
  admin: new Set([
    'dashboard.read', 'pos.use', 'pos.price_override', 'sales.read', 'sales.notes.update', 'sales.cancel', 'sales.delete',
    'customers.read', 'customers.write', 'products.read', 'products.write',
    'invoices.read', 'invoices.notes.update', 'invoices.write', 'invoices.delete', 'documents.create',
    'settings.write', 'users.manage',
  ]),
  staff: new Set([
    'dashboard.read', 'pos.use', 'sales.read', 'sales.notes.update',
    'customers.read', 'customers.write',
    'invoices.read', 'invoices.notes.update', 'documents.create',
  ]),
};

export function hasPermission(role: AppRole, permission: Permission): boolean {
  return permissionsByRole[role].has(permission);
}
