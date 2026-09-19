export type VehicleDisplaySource = {
  registration_number: string | null;
  model_name: string | null;
};

/** レジの「車両（任意）」選択肢と帳票で共通利用する表示名。 */
export function formatVehicleSelectionLabel(vehicle: VehicleDisplaySource | null | undefined): string {
  if (!vehicle) return '';
  const registrationNumber = vehicle.registration_number?.trim() || 'ナンバー未登録';
  const modelName = vehicle.model_name?.trim();
  return modelName ? `${registrationNumber} / ${modelName}` : registrationNumber;
}
