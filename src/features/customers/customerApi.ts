import { requireSupabase } from '../../shared/lib/supabase';
import type { Customer, CustomerInput, Vehicle, VehicleInput } from './types';

const customerFields = 'id, organization_id, customer_code, name, phone, mobile_phone, postal_code, address1, address2, notes, deleted_at, created_at, updated_at';
const vehicleFields = 'id, organization_id, customer_id, registration_number, manufacturer, model_name, model_code, model_year, mileage, vin, notes, deleted_at, created_at, updated_at';

function emptyToNull(value: string): string | null {
  return value || null;
}

function safeSearchTerm(value: string): string {
  return value.replace(/[,%()]/g, ' ').trim();
}

export async function listCustomers(organizationId: string, search: string): Promise<Customer[]> {
  const term = safeSearchTerm(search);
  let query = requireSupabase()
    .from('customers')
    .select(customerFields)
    .eq('organization_id', organizationId)
    .is('deleted_at', null)
    .order('customer_code', { ascending: true });

  if (term) {
    query = query.or([
      `customer_code.ilike.%${term}%`,
      `name.ilike.%${term}%`,
      `phone.ilike.%${term}%`,
      `mobile_phone.ilike.%${term}%`,
    ].join(','));
  }

  const { data, error } = await query.returns<Customer[]>();
  if (error) throw error;
  return data;
}

export async function countCustomers(organizationId: string): Promise<number> {
  const { count, error } = await requireSupabase()
    .from('customers')
    .select('id', { count: 'exact', head: true })
    .eq('organization_id', organizationId)
    .is('deleted_at', null);
  if (error) throw error;
  return count || 0;
}

export async function createCustomer(organizationId: string, input: CustomerInput): Promise<Customer> {
  const { data, error } = await requireSupabase()
    .from('customers')
    .insert({
      organization_id: organizationId,
      name: input.name,
      phone: emptyToNull(input.phone),
      mobile_phone: emptyToNull(input.mobile_phone),
      postal_code: emptyToNull(input.postal_code),
      address1: emptyToNull(input.address1),
      address2: emptyToNull(input.address2),
      notes: emptyToNull(input.notes),
    })
    .select(customerFields)
    .single<Customer>();
  if (error) throw error;
  return data;
}

export async function updateCustomer(customerId: string, input: CustomerInput): Promise<Customer> {
  const { data, error } = await requireSupabase()
    .from('customers')
    .update({
      name: input.name,
      phone: emptyToNull(input.phone),
      mobile_phone: emptyToNull(input.mobile_phone),
      postal_code: emptyToNull(input.postal_code),
      address1: emptyToNull(input.address1),
      address2: emptyToNull(input.address2),
      notes: emptyToNull(input.notes),
    })
    .eq('id', customerId)
    .is('deleted_at', null)
    .select(customerFields)
    .single<Customer>();
  if (error) throw error;
  return data;
}

export async function archiveCustomer(customerId: string): Promise<void> {
  const { error } = await requireSupabase()
    .from('customers')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', customerId)
    .is('deleted_at', null);
  if (error) throw error;
}

export async function listVehicles(organizationId: string, customerId: string): Promise<Vehicle[]> {
  const { data, error } = await requireSupabase()
    .from('vehicles')
    .select(vehicleFields)
    .eq('organization_id', organizationId)
    .eq('customer_id', customerId)
    .is('deleted_at', null)
    .order('created_at', { ascending: true })
    .returns<Vehicle[]>();
  if (error) throw error;
  return data;
}

export async function createVehicle(organizationId: string, customerId: string, input: VehicleInput): Promise<Vehicle> {
  const { data, error } = await requireSupabase()
    .from('vehicles')
    .insert({
      organization_id: organizationId,
      customer_id: customerId,
      registration_number: emptyToNull(input.registration_number),
      manufacturer: emptyToNull(input.manufacturer),
      model_name: emptyToNull(input.model_name),
      model_code: emptyToNull(input.model_code),
      model_year: input.model_year ? Number(input.model_year) : null,
      mileage: input.mileage ? Number(input.mileage) : null,
      vin: emptyToNull(input.vin),
      notes: emptyToNull(input.notes),
    })
    .select(vehicleFields)
    .single<Vehicle>();
  if (error) throw error;
  return data;
}

export async function updateVehicle(vehicleId: string, input: VehicleInput): Promise<Vehicle> {
  const { data, error } = await requireSupabase()
    .from('vehicles')
    .update({
      registration_number: emptyToNull(input.registration_number),
      manufacturer: emptyToNull(input.manufacturer),
      model_name: emptyToNull(input.model_name),
      model_code: emptyToNull(input.model_code),
      model_year: input.model_year ? Number(input.model_year) : null,
      mileage: input.mileage ? Number(input.mileage) : null,
      vin: emptyToNull(input.vin),
      notes: emptyToNull(input.notes),
    })
    .eq('id', vehicleId)
    .is('deleted_at', null)
    .select(vehicleFields)
    .single<Vehicle>();
  if (error) throw error;
  return data;
}

export async function archiveVehicle(vehicleId: string): Promise<void> {
  const { error } = await requireSupabase()
    .from('vehicles')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', vehicleId)
    .is('deleted_at', null);
  if (error) throw error;
}
