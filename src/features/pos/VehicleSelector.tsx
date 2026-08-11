import { useEffect, useState } from 'react';
import { listVehicles } from '../customers/customerApi';
import type { Customer, Vehicle } from '../customers/types';

type VehicleSelectorProps = {
  organizationId: string;
  customer?: Customer;
  selectedVehicleId?: string;
  onChange: (vehicleId?: string) => void;
};

export function VehicleSelector({ organizationId, customer, selectedVehicleId, onChange }: VehicleSelectorProps) {
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);

  useEffect(() => {
    let cancelled = false;
    if (!customer) {
      setVehicles([]);
      onChange(undefined);
      return undefined;
    }
    void listVehicles(organizationId, customer.id)
      .then((data) => {
        if (cancelled) return;
        setVehicles(data);
        if (selectedVehicleId && !data.some((vehicle) => vehicle.id === selectedVehicleId)) onChange(undefined);
      })
      .catch(() => { if (!cancelled) setVehicles([]); });
    return () => { cancelled = true; };
  }, [organizationId, customer?.id, selectedVehicleId]);

  if (!customer) return null;
  return (
    <label className="pos-vehicle-selector">
      <span>車両（任意）</span>
      <select value={selectedVehicleId || ''} onChange={(event) => onChange(event.target.value || undefined)}>
        <option value="">車両を選択しない</option>
        {vehicles.map((vehicle) => (
          <option key={vehicle.id} value={vehicle.id}>{vehicle.registration_number || 'ナンバー未登録'}{vehicle.model_name ? ` / ${vehicle.model_name}` : ''}</option>
        ))}
      </select>
    </label>
  );
}
