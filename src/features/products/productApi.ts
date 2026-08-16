import { requireSupabase } from '../../shared/lib/supabase';
import type { CategoryInput, PaymentMethod, Product, ProductCategory, ProductInput, TaxRate } from './types';

const categoryFields = 'id, organization_id, parent_id, name, depth, sort_order, active, deleted_at, created_at, updated_at';
const productFields = 'id, organization_id, product_code, name, category_id, tax_rate_id, price_yen, active, sort_order, deleted_at, created_at, updated_at';
const taxRateFields = 'id, name, rate_basis_points, active, sort_order';
const paymentMethodFields = 'id, code, name, active, sort_order';

const emptyToNull = (value: string): string | null => value || null;

export async function listCategories(organizationId: string): Promise<ProductCategory[]> {
  const { data, error } = await requireSupabase()
    .from('product_categories')
    .select(categoryFields)
    .eq('organization_id', organizationId)
    .is('deleted_at', null)
    .order('sort_order', { ascending: true })
    .returns<ProductCategory[]>();
  if (error) throw error;
  return data;
}

export async function listTaxRates(organizationId: string): Promise<TaxRate[]> {
  const { data, error } = await requireSupabase()
    .from('tax_rates')
    .select(taxRateFields)
    .eq('organization_id', organizationId)
    .eq('active', true)
    .order('sort_order', { ascending: true })
    .returns<TaxRate[]>();
  if (error) throw error;
  return data;
}

export async function listPaymentMethods(organizationId: string): Promise<PaymentMethod[]> {
  const { data, error } = await requireSupabase()
    .from('payment_methods')
    .select(paymentMethodFields)
    .eq('organization_id', organizationId)
    .eq('active', true)
    .order('sort_order', { ascending: true })
    .returns<PaymentMethod[]>();
  if (error) throw error;
  return data;
}

export async function getTaxRoundingMode(organizationId: string): Promise<'floor' | 'round' | 'ceil'> {
  const { data, error } = await requireSupabase()
    .from('organization_settings')
    .select('tax_rounding_mode')
    .eq('organization_id', organizationId)
    .single<{ tax_rounding_mode: 'floor' | 'round' | 'ceil' }>();
  if (error) throw error;
  return data.tax_rounding_mode;
}

export async function listProducts(organizationId: string): Promise<Product[]> {
  const { data, error } = await requireSupabase()
    .from('products')
    .select(productFields)
    .eq('organization_id', organizationId)
    .is('deleted_at', null)
    .order('sort_order', { ascending: true })
    .order('product_code', { ascending: true })
    .returns<Product[]>();
  if (error) throw error;
  return data;
}

export async function listActiveCategories(organizationId: string): Promise<ProductCategory[]> {
  const { data, error } = await requireSupabase()
    .from('product_categories')
    .select(categoryFields)
    .eq('organization_id', organizationId)
    .eq('active', true)
    .is('deleted_at', null)
    .order('sort_order', { ascending: true })
    .returns<ProductCategory[]>();
  if (error) throw error;
  return data;
}

export async function listActiveProducts(organizationId: string): Promise<Product[]> {
  const { data, error } = await requireSupabase()
    .from('products')
    .select(productFields)
    .eq('organization_id', organizationId)
    .eq('active', true)
    .is('deleted_at', null)
    .order('sort_order', { ascending: true })
    .order('name', { ascending: true })
    .returns<Product[]>();
  if (error) throw error;
  return data;
}

export async function createCategory(organizationId: string, input: CategoryInput): Promise<ProductCategory> {
  const { data, error } = await requireSupabase()
    .from('product_categories')
    .insert({
      organization_id: organizationId,
      parent_id: emptyToNull(input.parent_id),
      name: input.name,
      sort_order: input.sort_order ? Number(input.sort_order) : 0,
      active: input.active,
    })
    .select(categoryFields)
    .single<ProductCategory>();
  if (error) throw error;
  return data;
}

export async function updateCategory(categoryId: string, input: CategoryInput): Promise<ProductCategory> {
  const { data, error } = await requireSupabase()
    .from('product_categories')
    .update({
      parent_id: emptyToNull(input.parent_id),
      name: input.name,
      sort_order: input.sort_order ? Number(input.sort_order) : 0,
      active: input.active,
    })
    .eq('id', categoryId)
    .is('deleted_at', null)
    .select(categoryFields)
    .single<ProductCategory>();
  if (error) throw error;
  return data;
}

export async function createProduct(organizationId: string, input: ProductInput): Promise<Product> {
  const { data, error } = await requireSupabase()
    .from('products')
    .insert({
      organization_id: organizationId,
      product_code: input.product_code || undefined,
      name: input.name,
      category_id: input.category_id,
      tax_rate_id: input.tax_rate_id,
      price_yen: Number(input.price_yen),
      sort_order: input.sort_order ? Number(input.sort_order) : 0,
      active: input.active,
    })
    .select(productFields)
    .single<Product>();
  if (error) throw error;
  return data;
}

export async function updateProduct(productId: string, input: ProductInput): Promise<Product> {
  const { data, error } = await requireSupabase()
    .from('products')
    .update({
      product_code: input.product_code || undefined,
      name: input.name,
      category_id: input.category_id,
      tax_rate_id: input.tax_rate_id,
      price_yen: Number(input.price_yen),
      sort_order: input.sort_order ? Number(input.sort_order) : 0,
      active: input.active,
    })
    .eq('id', productId)
    .is('deleted_at', null)
    .select(productFields)
    .single<Product>();
  if (error) throw error;
  return data;
}

export async function archiveProduct(productId: string): Promise<{ product_id: string; product_name: string; status: 'archived' }> {
  const { data, error } = await requireSupabase().rpc('archive_product', { p_product_id: productId });
  if (error) throw error;
  return data as { product_id: string; product_name: string; status: 'archived' };
}

export async function archiveCategoryTree(categoryId: string): Promise<{
  category_id: string;
  category_name: string;
  archived_category_count: number;
  archived_product_count: number;
  status: 'archived';
}> {
  const { data, error } = await requireSupabase().rpc('archive_product_category_tree', { p_category_id: categoryId });
  if (error) throw error;
  return data as {
    category_id: string;
    category_name: string;
    archived_category_count: number;
    archived_product_count: number;
    status: 'archived';
  };
}
