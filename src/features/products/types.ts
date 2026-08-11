export type ProductCategory = {
  id: string;
  organization_id: string;
  parent_id: string | null;
  name: string;
  depth: number;
  sort_order: number;
  active: boolean;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
};

export type Product = {
  id: string;
  organization_id: string;
  product_code: string;
  name: string;
  category_id: string;
  tax_rate_id: string | null;
  price_yen: number;
  active: boolean;
  sort_order: number;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
};

export type TaxRate = {
  id: string;
  name: string;
  rate_basis_points: number;
  active: boolean;
  sort_order: number;
};

export type PaymentMethod = {
  id: string;
  code: string;
  name: string;
  active: boolean;
  sort_order: number;
};

export type CategoryInput = {
  name: string;
  parent_id: string;
  sort_order: string;
  active: boolean;
};

export type ProductInput = {
  product_code: string;
  name: string;
  category_id: string;
  tax_rate_id: string;
  price_yen: string;
  sort_order: string;
  active: boolean;
};

export type CategoryNode = ProductCategory & {
  children: CategoryNode[];
};
