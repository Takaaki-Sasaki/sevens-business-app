import { describe, expect, it } from 'vitest';
import { normalizeCustomerInput, validateCustomerInput, validateVehicleInput } from '../../src/features/customers/customerValidation';

describe('顧客入力の正規化と検証', () => {
  it('郵便番号を正規化し、前後の空白を除去する', () => {
    const result = normalizeCustomerInput({
      name: '  山田 太郎 ', phone: ' 03-1234-5678 ', mobile_phone: '', postal_code: '1234567',
      address1: ' 横浜市 ', address2: '', notes: '  備考 ',
    });
    expect(result).toMatchObject({ name: '山田 太郎', postal_code: '123-4567', address1: '横浜市', notes: '備考' });
  });

  it('顧客名と郵便番号形式を検証する', () => {
    expect(validateCustomerInput({ name: '', phone: '', mobile_phone: '', postal_code: '', address1: '', address2: '', notes: '' })).toContain('顧客名');
    expect(validateCustomerInput({ name: '山田', phone: '', mobile_phone: '', postal_code: '1234', address1: '', address2: '', notes: '' })).toContain('郵便番号');
  });

  it('車両の年式と走行距離を検証する', () => {
    expect(validateVehicleInput({ registration_number: '', manufacturer: '', model_name: '', model_code: '', model_year: '1899', mileage: '', vin: '', notes: '' })).toContain('年式');
    expect(validateVehicleInput({ registration_number: '', manufacturer: '', model_name: '', model_code: '', model_year: '2024', mileage: '-1', vin: '', notes: '' })).toContain('走行距離');
  });
});
