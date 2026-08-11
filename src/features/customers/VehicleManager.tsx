import { type FormEvent, useEffect, useState } from 'react';
import { archiveVehicle, createVehicle, listVehicles, updateVehicle } from './customerApi';
import { normalizeVehicleInput, validateVehicleInput } from './customerValidation';
import type { Vehicle, VehicleInput } from './types';
import { toUserMessage } from '../../shared/lib/userError';

type VehicleManagerProps = {
  organizationId: string;
  customerId: string;
};

const blankVehicle: VehicleInput = {
  registration_number: '', manufacturer: '', model_name: '', model_code: '', model_year: '', mileage: '', vin: '', notes: '',
};

function toInput(vehicle?: Vehicle): VehicleInput {
  if (!vehicle) return blankVehicle;
  return {
    registration_number: vehicle.registration_number || '',
    manufacturer: vehicle.manufacturer || '',
    model_name: vehicle.model_name || '',
    model_code: vehicle.model_code || '',
    model_year: vehicle.model_year?.toString() || '',
    mileage: vehicle.mileage?.toString() || '',
    vin: vehicle.vin || '',
    notes: vehicle.notes || '',
  };
}

export function VehicleManager({ organizationId, customerId }: VehicleManagerProps) {
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [editing, setEditing] = useState<Vehicle | null>(null);
  const [input, setInput] = useState<VehicleInput>(blankVehicle);
  const [isFormOpen, setFormOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function reload() {
    setLoading(true);
    try {
      setVehicles(await listVehicles(organizationId, customerId));
    } catch (caught) {
      setError(toUserMessage(caught, { fallback: '車両情報を取得できませんでした。' }));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    setEditing(null);
    setInput(blankVehicle);
    setFormOpen(false);
    setError(null);
    void reload();
  }, [organizationId, customerId]);

  function beginCreate() {
    setEditing(null);
    setInput(blankVehicle);
    setError(null);
    setFormOpen(true);
  }

  function beginEdit(vehicle: Vehicle) {
    setEditing(vehicle);
    setInput(toInput(vehicle));
    setError(null);
    setFormOpen(true);
  }

  function updateField(field: keyof VehicleInput, value: string) {
    setInput((current) => ({ ...current, [field]: value }));
  }

  async function handleSave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalized = normalizeVehicleInput(input);
    const validationError = validateVehicleInput(normalized);
    if (validationError) {
      setError(validationError);
      return;
    }

    setSaving(true);
    setError(null);
    try {
      if (editing) await updateVehicle(editing.id, normalized);
      else await createVehicle(organizationId, customerId, normalized);
      await reload();
      setFormOpen(false);
      setEditing(null);
      setInput(blankVehicle);
    } catch (caught) {
      setError(toUserMessage(caught, { fallback: '車両情報を保存できませんでした。', retryAction: '車両情報を保存' }));
    } finally {
      setSaving(false);
    }
  }

  async function handleArchive(vehicle: Vehicle) {
    if (!window.confirm(`「${vehicle.registration_number || vehicle.model_name || 'この車両'}」を車両一覧から停止しますか？`)) return;
    try {
      await archiveVehicle(vehicle.id);
      await reload();
    } catch (caught) {
      setError(toUserMessage(caught, { fallback: '車両を停止できませんでした。', retryAction: '車両を停止' }));
    }
  }

  return (
    <section className="vehicle-manager" aria-labelledby="vehicles-title">
      <div className="subsection-heading">
        <div>
          <p className="eyebrow">VEHICLES</p>
          <h3 id="vehicles-title">登録車両</h3>
        </div>
        <button type="button" className="text-button" onClick={beginCreate}>＋ 車両を追加</button>
      </div>
      {error && <p className="form-error" role="alert">{error}</p>}
      {loading ? <p className="list-message">車両を読み込んでいます…</p> : (
        <div className="vehicle-list">
          {vehicles.length === 0 && <p className="list-message">登録車両はありません。</p>}
          {vehicles.map((vehicle) => (
            <article className="vehicle-card" key={vehicle.id}>
              <div>
                <strong>{vehicle.registration_number || 'ナンバー未登録'}</strong>
                <p>{[vehicle.manufacturer, vehicle.model_name, vehicle.model_year ? `${vehicle.model_year}年` : null].filter(Boolean).join(' / ') || '車両情報未登録'}</p>
                {vehicle.mileage !== null && <small>{vehicle.mileage.toLocaleString()} km</small>}
              </div>
              <div className="card-actions">
                <button type="button" className="text-button" onClick={() => beginEdit(vehicle)}>編集</button>
                <button type="button" className="danger-button" onClick={() => void handleArchive(vehicle)}>停止</button>
              </div>
            </article>
          ))}
        </div>
      )}

      {isFormOpen && (
        <form className="vehicle-form" onSubmit={handleSave}>
          <h4>{editing ? '車両情報を編集' : '車両を追加'}</h4>
          <div className="form-grid">
            <label className="field"><span>登録番号</span><input value={input.registration_number} onChange={(event) => updateField('registration_number', event.target.value)} /></label>
            <label className="field"><span>メーカー</span><input value={input.manufacturer} onChange={(event) => updateField('manufacturer', event.target.value)} /></label>
            <label className="field"><span>車種名</span><input value={input.model_name} onChange={(event) => updateField('model_name', event.target.value)} /></label>
            <label className="field"><span>型式</span><input value={input.model_code} onChange={(event) => updateField('model_code', event.target.value)} /></label>
            <label className="field"><span>年式</span><input inputMode="numeric" placeholder="2024" value={input.model_year} onChange={(event) => updateField('model_year', event.target.value)} /></label>
            <label className="field"><span>走行距離（km）</span><input inputMode="numeric" value={input.mileage} onChange={(event) => updateField('mileage', event.target.value)} /></label>
            <label className="field full"><span>車台番号</span><input value={input.vin} onChange={(event) => updateField('vin', event.target.value)} /></label>
            <label className="field full"><span>備考</span><textarea rows={2} value={input.notes} onChange={(event) => updateField('notes', event.target.value)} /></label>
          </div>
          <div className="form-actions">
            <button type="button" className="text-button" onClick={() => setFormOpen(false)}>キャンセル</button>
            <button type="submit" className="primary-button" disabled={saving}>{saving ? '保存中…' : '車両を保存'}</button>
          </div>
        </form>
      )}
    </section>
  );
}
