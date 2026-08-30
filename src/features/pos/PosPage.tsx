import { useEffect, useMemo, useState } from 'react';
import type { Profile } from '../auth/types';
import { hasPermission } from '../auth/permissions';
import { CustomerForm } from '../customers/CustomerForm';
import type { Customer } from '../customers/types';
import { categoryPath } from '../products/categoryTree';
import { getTaxRoundingMode, listActiveCategories, listActiveProducts, listPaymentMethods, listTaxRates } from '../products/productApi';
import type { PaymentMethod, Product, ProductCategory, TaxRate } from '../products/types';
import { CartPanel } from './CartPanel';
import { addProductToCart, calculateCart, calculateCashSettlement, createCustomCartLine, formatQuantity, parseYen, type CartLine, type TaxRoundingMode, updateCartLine } from './cart';
import { CustomerSelector } from './CustomerSelector';
import { PaymentPanel } from './PaymentPanel';
import { PosCategoryPanel } from './PosCategoryPanel';
import { childrenOf, productsForCategory, rootCategories, searchProducts } from './posCatalog';
import { ProductBrowser } from './ProductBrowser';
import { VehicleSelector } from './VehicleSelector';
import { checkoutSale } from '../sales/saleApi';
import type { SaleCheckoutResult } from '../sales/types';
import { toUserMessage } from '../../shared/lib/userError';
import { OtherItemForm } from './OtherItemForm';

export function PosPage({ profile }: { profile: Profile }) {
  const [categories, setCategories] = useState<ProductCategory[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [taxRates, setTaxRates] = useState<TaxRate[]>([]);
  const [paymentMethods, setPaymentMethods] = useState<PaymentMethod[]>([]);
  const [roundingMode, setRoundingMode] = useState<TaxRoundingMode>('round');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [currentCategoryId, setCurrentCategoryId] = useState<string>();
  const [search, setSearch] = useState('');
  const [selectedCustomer, setSelectedCustomer] = useState<Customer>();
  const [selectedVehicleId, setSelectedVehicleId] = useState<string>();
  const [cartLines, setCartLines] = useState<CartLine[]>([]);
  const [paymentMethodId, setPaymentMethodId] = useState('');
  const [amountReceivedInput, setAmountReceivedInput] = useState('');
  const [isCustomerFormOpen, setCustomerFormOpen] = useState(false);
  const [isOtherItemFormOpen, setOtherItemFormOpen] = useState(false);
  const [checkoutKey, setCheckoutKey] = useState(() => crypto.randomUUID());
  const [isCheckingOut, setCheckingOut] = useState(false);
  const [completedSale, setCompletedSale] = useState<SaleCheckoutResult>();
  const [mobileCartOpen, setMobileCartOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    void Promise.all([
      listActiveCategories(profile.organization_id),
      listActiveProducts(profile.organization_id),
      listTaxRates(profile.organization_id),
      listPaymentMethods(profile.organization_id),
      getTaxRoundingMode(profile.organization_id),
    ])
      .then(([nextCategories, nextProducts, nextTaxRates, nextPaymentMethods, nextRoundingMode]) => {
        if (cancelled) return;
        setCategories(nextCategories);
        setProducts(nextProducts);
        setTaxRates(nextTaxRates);
        setPaymentMethods(nextPaymentMethods);
        setRoundingMode(nextRoundingMode);
        setPaymentMethodId((current) => nextPaymentMethods.some((method) => method.id === current) ? current : (nextPaymentMethods[0]?.id || ''));
      })
      .catch((caught: unknown) => {
        if (!cancelled) setError(toUserMessage(caught, { fallback: '商品カタログを取得できませんでした。' }));
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [profile.organization_id]);

  const currentCategory = categories.find((category) => category.id === currentCategoryId);
  const roots = useMemo(() => rootCategories(categories), [categories]);
  const childCategories = useMemo(() => childrenOf(currentCategoryId, categories), [currentCategoryId, categories]);
  const displayedProducts = useMemo(
    () => search.trim() ? searchProducts(search, products, categories) : productsForCategory(currentCategoryId, products, categories),
    [search, products, categories, currentCategoryId],
  );
  const cartTotals = useMemo(() => calculateCart(cartLines, roundingMode), [cartLines, roundingMode]);
  const selectedQuantity = formatQuantity(cartLines.reduce((total, line) => total + line.quantity_milli, 0));
  const allowPriceOverride = hasPermission(profile.role, 'pos.price_override');
  const selectedPaymentMethod = paymentMethods.find((method) => method.id === paymentMethodId);
  const amountReceivedYen = parseYen(amountReceivedInput);
  const cashSettlement = calculateCashSettlement(cartTotals.total_amount_yen, amountReceivedYen || 0);
  const checkoutDisabled = cartLines.length === 0
    || !selectedPaymentMethod
    || (selectedPaymentMethod.code === 'cash' && (amountReceivedYen === null || cashSettlement.shortfall_yen > 0));

  function invalidateCheckout() {
    setCheckoutKey(crypto.randomUUID());
  }

  function selectCategory(categoryId: string) {
    setCurrentCategoryId(categoryId);
    setSearch('');
  }

  function goBack() {
    setCurrentCategoryId(currentCategory?.parent_id || undefined);
  }

  function addProduct(product: Product) {
    if (isCheckingOut) return;
    const taxRate = taxRates.find((rate) => rate.id === product.tax_rate_id);
    if (!taxRate) {
      setError(`「${product.name}」の税率が無効または未設定です。商品マスタを確認してください。`);
      return;
    }
    setError(null);
    setCartLines((lines) => addProductToCart(lines, product, taxRate));
    invalidateCheckout();
  }

  function updateLine(lineId: string, patch: Partial<Pick<CartLine, 'quantity_milli' | 'unit_price_yen' | 'discount_yen'>>) {
    if (isCheckingOut) return;
    try {
      setCartLines((lines) => updateCartLine(lines, lineId, patch));
      setError(null);
      invalidateCheckout();
    } catch (caught) {
      setError(toUserMessage(caught, { fallback: '会計内容を更新できませんでした。' }));
    }
  }

  async function handleCheckout() {
    if (checkoutDisabled || isCheckingOut || !selectedPaymentMethod) return;
    setCheckingOut(true);
    setError(null);
    try {
      const result = await checkoutSale({
        idempotencyKey: checkoutKey,
        customerId: selectedCustomer?.id,
        vehicleId: selectedVehicleId,
        paymentMethodId: selectedPaymentMethod.id,
        amountReceivedYen: selectedPaymentMethod.code === 'cash' ? amountReceivedYen || undefined : undefined,
        lines: cartLines,
      });
      setCompletedSale(result);
      setCartLines([]);
      setAmountReceivedInput('');
      setMobileCartOpen(false);
      invalidateCheckout();
    } catch (caught) {
      setError(toUserMessage(caught, { fallback: '会計を確定できませんでした。', retryAction: '会計を確定' }));
    } finally {
      setCheckingOut(false);
    }
  }

  return (
    <section className="page-view pos-page" aria-labelledby="pos-page-title">
      <header className="page-header pos-page-header">
        <div>
          <p className="eyebrow">POINT OF SALE</p>
          <h1 id="pos-page-title">レジ</h1>
          <p className="page-description">顧客を選び、カテゴリをたどって商品・作業を追加します。</p>
        </div>
        {currentCategory && <span className="pos-current-path">{categoryPath(currentCategory.id, categories)}</span>}
      </header>
      {error && <p className="form-error page-error" role="alert">{error}</p>}

      <div className="pos-workspace">
        <PosCategoryPanel
          roots={roots}
          selectedId={currentCategoryId}
          onSelect={selectCategory}
          onChooseOther={() => {
            if (!isCheckingOut) setOtherItemFormOpen(true);
          }}
        />
        {loading ? <section className="panel pos-loading"><p>商品カタログを読み込んでいます…</p></section> : (
          <ProductBrowser
            categories={categories}
            currentCategory={currentCategory}
            childCategories={childCategories}
            products={displayedProducts}
            search={search}
            onSearchChange={setSearch}
            onChooseCategory={selectCategory}
            onGoBack={goBack}
            onChooseProduct={addProduct}
          />
        )}
        {mobileCartOpen && <button type="button" className="mobile-cart-backdrop" aria-label="会計内容を閉じる" onClick={() => setMobileCartOpen(false)} />}
        <aside className={mobileCartOpen ? 'panel pos-summary-panel mobile-open' : 'panel pos-summary-panel'} aria-label="会計内容">
          <div className="mobile-cart-drawer-heading"><span>会計内容</span><button type="button" className="text-button" onClick={() => setMobileCartOpen(false)}>閉じる</button></div>
          <CustomerSelector
            organizationId={profile.organization_id}
            selectedCustomer={selectedCustomer}
            onSelect={(customer) => {
              if (isCheckingOut) return;
              setSelectedCustomer(customer);
              setSelectedVehicleId(undefined);
              invalidateCheckout();
            }}
            onClear={() => {
              if (isCheckingOut) return;
              setSelectedCustomer(undefined);
              setSelectedVehicleId(undefined);
              invalidateCheckout();
            }}
            onCreateCustomer={() => setCustomerFormOpen(true)}
          />
          <VehicleSelector
            organizationId={profile.organization_id}
            customer={selectedCustomer}
            selectedVehicleId={selectedVehicleId}
            onChange={(vehicleId) => {
              if (isCheckingOut) return;
              setSelectedVehicleId(vehicleId);
              invalidateCheckout();
            }}
          />
          <CartPanel
            totals={cartTotals}
            allowPriceOverride={allowPriceOverride}
            onUpdate={updateLine}
            onRemove={(lineId) => {
              if (isCheckingOut) return;
              setCartLines((lines) => lines.filter((line) => line.id !== lineId));
              invalidateCheckout();
            }}
            onClear={() => {
              if (isCheckingOut) return;
              setCartLines([]);
              invalidateCheckout();
            }}
          />
          <PaymentPanel
            methods={paymentMethods}
            selectedMethodId={paymentMethodId}
            onMethodChange={(methodId) => {
              if (isCheckingOut) return;
              setPaymentMethodId(methodId);
              setAmountReceivedInput('');
              invalidateCheckout();
            }}
            amountReceivedInput={amountReceivedInput}
            onAmountReceivedChange={(value) => {
              if (isCheckingOut) return;
              setAmountReceivedInput(value);
              invalidateCheckout();
            }}
            totals={cartTotals}
            onCheckout={() => void handleCheckout()}
            checkoutPending={isCheckingOut}
            checkoutDisabled={checkoutDisabled}
          />
        </aside>
      </div>

      <button
        type="button"
        className={mobileCartOpen ? 'mobile-selected-bar drawer-open' : 'mobile-selected-bar'}
        aria-expanded={mobileCartOpen}
        aria-controls="selected-items"
        onClick={() => setMobileCartOpen(true)}
      >
        <span>カート {selectedQuantity} 点</span>
        <strong>¥{cartTotals.total_amount_yen.toLocaleString()}　確認 →</strong>
      </button>

      {isCustomerFormOpen && (
        <div className="modal-backdrop" role="presentation">
          <section className="modal-panel customer-create-modal" role="dialog" aria-modal="true" aria-labelledby="quick-customer-title">
            <button type="button" className="modal-close" onClick={() => setCustomerFormOpen(false)} aria-label="顧客登録を閉じる">×</button>
            <h2 className="visually-hidden" id="quick-customer-title">新規顧客登録</h2>
            <CustomerForm
              organizationId={profile.organization_id}
              onSaved={(customer) => {
                setSelectedCustomer(customer);
                setSelectedVehicleId(undefined);
                setCustomerFormOpen(false);
                invalidateCheckout();
              }}
            />
          </section>
        </div>
      )}
      {isOtherItemFormOpen && (
        <div className="modal-backdrop" role="presentation">
          <section className="modal-panel other-item-modal" role="dialog" aria-modal="true" aria-labelledby="other-item-title">
            <OtherItemForm
              taxRates={taxRates}
              onClose={() => setOtherItemFormOpen(false)}
              onAdd={({ name, unitPriceYen, taxRate }) => {
                setCartLines((lines) => [...lines, createCustomCartLine({ id: crypto.randomUUID(), name, unit_price_yen: unitPriceYen, taxRate })]);
                setError(null);
                setOtherItemFormOpen(false);
                invalidateCheckout();
              }}
            />
          </section>
        </div>
      )}
      {completedSale && (
        <div className="modal-backdrop" role="presentation">
          <section className="modal-panel sale-complete-modal" role="dialog" aria-modal="true" aria-labelledby="sale-complete-title">
            <button type="button" className="modal-close" onClick={() => setCompletedSale(undefined)} aria-label="会計完了を閉じる">×</button>
            <div className="sale-complete-content">
              <p className="eyebrow">SALE COMPLETED</p>
              <h2 id="sale-complete-title">会計を確定しました</h2>
              <strong>¥{completedSale.total_amount_yen.toLocaleString()}</strong>
              <p>売上番号：{completedSale.sale_number}</p>
              <p>請求番号：{completedSale.invoice.invoice_number}</p>
              {completedSale.change_amount_yen > 0 && <p>お釣り：¥{completedSale.change_amount_yen.toLocaleString()}</p>}
              <button type="button" className="primary-button" onClick={() => setCompletedSale(undefined)}>次の会計へ</button>
            </div>
          </section>
        </div>
      )}
    </section>
  );
}
