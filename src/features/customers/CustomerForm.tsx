import { type FormEvent, useEffect, useState } from 'react';
import { createCustomer, updateCustomer } from './customerApi';
import { normalizeCustomerInput, validateCustomerInput } from './customerValidation';
import type { Customer, CustomerInput } from './types';
import { toUserMessage } from '../../shared/lib/userError';

type CustomerFormProps = {
  organizationId: string;
  customer?: Customer;
  onSaved: (customer: Customer) => void;
};

const blankCustomer: CustomerInput = {
  name: '', phone: '', mobile_phone: '', postal_code: '', address1: '', address2: '', notes: '',
};

function toInput(customer?: Customer): CustomerInput {
  if (!customer) return blankCustomer;
  return {
    name: customer.name,
    phone: customer.phone || '',
    mobile_phone: customer.mobile_phone || '',
    postal_code: customer.postal_code || '',
    address1: customer.address1 || '',
    address2: customer.address2 || '',
    notes: customer.notes || '',
  };
}

export function CustomerForm({ organizationId, customer, onSaved }: CustomerFormProps) {
  const [input, setInput] = useState<CustomerInput>(() => toInput(customer));
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const isNew = !customer;

  useEffect(() => {
    setInput(toInput(customer));
    setError(null);
  }, [customer]);

  function updateField(field: keyof CustomerInput, value: string) {
    setInput((current) => ({ ...current, [field]: value }));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalized = normalizeCustomerInput(input);
    const validationError = validateCustomerInput(normalized);
    if (validationError) {
      setError(validationError);
      return;
    }

    setSaving(true);
    setError(null);
    try {
      const saved = customer
        ? await updateCustomer(customer.id, normalized)
        : await createCustomer(organizationId, normalized);
      onSaved(saved);
    } catch (caught) {
      setError(toUserMessage(caught, { fallback: '顧客情報を保存できませんでした。', retryAction: isNew ? '顧客を登録' : '変更を保存' }));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="customer-form" onSubmit={handleSubmit}>
      <div className="panel-heading">
        <div>
          <p className="eyebrow">{isNew ? 'NEW CUSTOMER' : customer.customer_code}</p>
          <h2>{isNew ? '顧客登録' : '顧客情報'}</h2>
        </div>
        {!isNew && <span className="code-badge">{customer.customer_code}</span>}
      </div>

      <div className="form-grid">
        <label className="field full">
          <span>顧客名 <b>必須</b></span>
          <input value={input.name} onChange={(event) => updateField('name', event.target.value)} required autoFocus={isNew} />
        </label>
        <label className="field">
          <span>電話番号</span>
          <input inputMode="tel" value={input.phone} onChange={(event) => updateField('phone', event.target.value)} />
        </label>
        <label className="field">
          <span>携帯番号</span>
          <input inputMode="tel" value={input.mobile_phone} onChange={(event) => updateField('mobile_phone', event.target.value)} />
        </label>
        <label className="field">
          <span>郵便番号</span>
          <input inputMode="numeric" placeholder="123-4567" value={input.postal_code} onChange={(event) => updateField('postal_code', event.target.value)} />
        </label>
        <label className="field full">
          <span>住所1</span>
          <input value={input.address1} onChange={(event) => updateField('address1', event.target.value)} />
        </label>
        <label className="field full">
          <span>住所2</span>
          <input value={input.address2} onChange={(event) => updateField('address2', event.target.value)} />
        </label>
        <label className="field full">
          <span>備考</span>
          <textarea rows={3} value={input.notes} onChange={(event) => updateField('notes', event.target.value)} />
        </label>
      </div>
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="form-actions">
        <p>{isNew ? '顧客番号は保存時に自動採番されます。' : '変更内容は保存後すぐに他の端末にも反映されます。'}</p>
        <button className="primary-button" type="submit" disabled={saving}>{saving ? '保存中…' : isNew ? '顧客を登録' : '変更を保存'}</button>
      </div>
    </form>
  );
}
