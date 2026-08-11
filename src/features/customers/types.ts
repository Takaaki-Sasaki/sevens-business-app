export type Customer = {
  id: string;
  organization_id: string;
  customer_code: string;
  name: string;
  phone: string | null;
  mobile_phone: string | null;
  postal_code: string | null;
  address1: string | null;
  address2: string | null;
  notes: string | null;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
};

export type Vehicle = {
  id: string;
  organization_id: string;
  customer_id: string;
  registration_number: string | null;
  manufacturer: string | null;
  model_name: string | null;
  model_code: string | null;
  model_year: number | null;
  mileage: number | null;
  vin: string | null;
  notes: string | null;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
};

export type CustomerInput = {
  name: string;
  phone: string;
  mobile_phone: string;
  postal_code: string;
  address1: string;
  address2: string;
  notes: string;
};

export type VehicleInput = {
  registration_number: string;
  manufacturer: string;
  model_name: string;
  model_code: string;
  model_year: string;
  mileage: string;
  vin: string;
  notes: string;
};
