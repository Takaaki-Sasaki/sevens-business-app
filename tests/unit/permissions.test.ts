import { describe, expect, it } from 'vitest';
import { hasPermission } from '../../src/features/auth/permissions';

describe('権限マトリクス', () => {
  it('adminは価格・設定・売上取消を操作できる', () => {
    expect(hasPermission('admin', 'products.write')).toBe(true);
    expect(hasPermission('admin', 'pos.price_override')).toBe(true);
    expect(hasPermission('admin', 'settings.write')).toBe(true);
    expect(hasPermission('admin', 'sales.cancel')).toBe(true);
  });

  it('staffは会計と顧客登録はできるが、価格変更や売上取消はできない', () => {
    expect(hasPermission('staff', 'pos.use')).toBe(true);
    expect(hasPermission('staff', 'customers.write')).toBe(true);
    expect(hasPermission('staff', 'products.write')).toBe(false);
    expect(hasPermission('staff', 'pos.price_override')).toBe(false);
    expect(hasPermission('staff', 'sales.cancel')).toBe(false);
    expect(hasPermission('staff', 'settings.write')).toBe(false);
  });
});
