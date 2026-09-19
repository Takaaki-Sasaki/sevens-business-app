import { describe, expect, it } from 'vitest';
import { formatVehicleSelectionLabel } from '../../src/features/customers/vehicleDisplay';

describe('車両表示名', () => {
  it('レジと帳票でナンバーと車名を同じ形式にする', () => {
    expect(formatVehicleSelectionLabel({ registration_number: '横浜 300 あ 12-34', model_name: 'セブンズカー' }))
      .toBe('横浜 300 あ 12-34 / セブンズカー');
  });

  it('車両未選択は空欄として扱う', () => {
    expect(formatVehicleSelectionLabel(null)).toBe('');
  });

  it('ナンバー未登録でも車名を表示する', () => {
    expect(formatVehicleSelectionLabel({ registration_number: null, model_name: 'セブンズカー' }))
      .toBe('ナンバー未登録 / セブンズカー');
  });
});
