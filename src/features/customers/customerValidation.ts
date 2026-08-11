import type { CustomerInput, VehicleInput } from './types';

export function normalizeCustomerInput(input: CustomerInput): CustomerInput {
  return {
    name: input.name.trim(),
    phone: input.phone.trim(),
    mobile_phone: input.mobile_phone.trim(),
    postal_code: input.postal_code.replace(/[^0-9]/g, '').replace(/(\d{3})(\d{4})$/, '$1-$2'),
    address1: input.address1.trim(),
    address2: input.address2.trim(),
    notes: input.notes.trim(),
  };
}

export function validateCustomerInput(input: CustomerInput): string | null {
  if (!input.name) return '顧客名を入力してください。';
  if (input.postal_code && !/^\d{3}-\d{4}$/.test(input.postal_code)) {
    return '郵便番号は「123-4567」形式で入力してください。';
  }
  return null;
}

export function normalizeVehicleInput(input: VehicleInput): VehicleInput {
  return {
    registration_number: input.registration_number.trim(),
    manufacturer: input.manufacturer.trim(),
    model_name: input.model_name.trim(),
    model_code: input.model_code.trim(),
    model_year: input.model_year.trim(),
    mileage: input.mileage.trim(),
    vin: input.vin.trim(),
    notes: input.notes.trim(),
  };
}

export function validateVehicleInput(input: VehicleInput): string | null {
  if (input.model_year && (!/^\d{4}$/.test(input.model_year) || Number(input.model_year) < 1900 || Number(input.model_year) > 2200)) {
    return '年式は1900〜2200の4桁で入力してください。';
  }
  if (input.mileage && (!/^\d+$/.test(input.mileage) || Number(input.mileage) < 0)) {
    return '走行距離は0以上の整数で入力してください。';
  }
  return null;
}
