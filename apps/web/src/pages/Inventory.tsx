import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { Badge, Button, Card, Field, Input, Spinner } from '../components/ui';

const inr = (paise: number) => `₹${(paise / 100).toLocaleString('en-IN')}`;

export default function Inventory() {
  const qc = useQueryClient();
  const invalidate = () => qc.invalidateQueries({ queryKey: ['products'] });
  const [cart, setCart] = useState(false);
  const { data, isLoading } = useQuery({
    queryKey: ['products'],
    queryFn: async () => (await api.get('/api/inventory/products')).data,
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Inventory</h1>
          <p className="text-sm text-slate-500">Mats, t-shirts, nutrition drinks and their variants.</p>
        </div>
        <Button onClick={() => setCart(true)}>🛒 Sell</Button>
      </div>

      <NewProduct onSaved={invalidate} />

      {isLoading ? (
        <div className="flex justify-center py-10"><Spinner /></div>
      ) : (
        data?.products?.map((p: any) => <ProductCard key={p.id} product={p} onChanged={invalidate} />)
      )}

      {cart && <SellDrawer products={data?.products ?? []} onClose={() => setCart(false)} />}
    </div>
  );
}

function NewProduct({ onSaved }: { onSaved: () => void }) {
  const [name, setName] = useState('');
  const [type, setType] = useState('MAT');
  const save = useMutation({
    mutationFn: async () => (await api.post('/api/inventory/products', { name, type })).data,
    onSuccess: () => {
      setName('');
      onSaved();
    },
  });
  return (
    <Card>
      <h3 className="mb-3 font-semibold">Add product</h3>
      <div className="flex flex-wrap items-end gap-3">
        <Field label="Name">
          <Input value={name} onChange={(e) => setName(e.target.value)} className="w-56" />
        </Field>
        <Field label="Type">
          <select className="rounded-xl border border-slate-200 px-3 py-2 text-sm" value={type} onChange={(e) => setType(e.target.value)}>
            <option value="MAT">Mat</option>
            <option value="TSHIRT">T-Shirt</option>
            <option value="NUTRITION_DRINK">Nutrition Drink</option>
            <option value="OTHER">Other</option>
          </select>
        </Field>
        <Button onClick={() => name && save.mutate()}>Add</Button>
      </div>
    </Card>
  );
}

function ProductCard({ product, onChanged }: { product: any; onChanged: () => void }) {
  return (
    <Card>
      <h3 className="mb-3 font-semibold">
        {product.name} <span className="text-xs text-slate-400">{product.type}</span>
      </h3>
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-slate-100 text-left text-slate-400">
            <th className="py-2 font-medium">Variant</th>
            <th className="py-2 font-medium">SKU</th>
            <th className="py-2 font-medium">Price</th>
            <th className="py-2 font-medium">Stock</th>
            <th className="py-2 font-medium">Restock</th>
          </tr>
        </thead>
        <tbody>
          {product.variants.map((v: any) => (
            <VariantRow key={v.id} variant={v} onChanged={onChanged} />
          ))}
        </tbody>
      </table>
      <AddVariant productId={product.id} onSaved={onChanged} />
    </Card>
  );
}

function VariantRow({ variant, onChanged }: { variant: any; onChanged: () => void }) {
  const [qty, setQty] = useState('');
  const low = variant.stockQty <= variant.reorderLevel;
  const restock = useMutation({
    mutationFn: async () => (await api.post(`/api/inventory/variants/${variant.id}/restock`, { qty: Number(qty) })).data,
    onSuccess: () => {
      setQty('');
      onChanged();
    },
  });
  return (
    <tr className="border-b border-slate-50">
      <td className="py-2">{variant.variantLabel}</td>
      <td className="py-2 text-slate-500">{variant.sku}</td>
      <td className="py-2">{inr(Number(variant.pricePaise))}</td>
      <td className="py-2">
        <Badge tone={low ? 'red' : 'green'}>{variant.stockQty}</Badge>
      </td>
      <td className="py-2">
        <div className="flex items-center gap-1">
          <Input value={qty} onChange={(e) => setQty(e.target.value)} className="w-16" placeholder="qty" />
          <button
            onClick={() => Number(qty) > 0 && restock.mutate()}
            className="rounded-lg bg-slate-100 px-2 py-1 text-xs hover:bg-slate-200"
          >
            +
          </button>
        </div>
      </td>
    </tr>
  );
}

function AddVariant({ productId, onSaved }: { productId: string; onSaved: () => void }) {
  const [label, setLabel] = useState('');
  const [sku, setSku] = useState('');
  const [price, setPrice] = useState('');
  const [reorder, setReorder] = useState('5');
  const save = useMutation({
    mutationFn: async () =>
      (
        await api.post(`/api/inventory/products/${productId}/variants`, {
          variantLabel: label,
          sku,
          priceRupees: Number(price),
          reorderLevel: Number(reorder) || 0,
        })
      ).data,
    onSuccess: () => {
      setLabel('');
      setSku('');
      setPrice('');
      onSaved();
    },
  });
  return (
    <div className="mt-3 flex flex-wrap items-center gap-2">
      <Input placeholder="Variant (M / 6mm / Chocolate)" value={label} onChange={(e) => setLabel(e.target.value)} className="w-48" />
      <Input placeholder="SKU" value={sku} onChange={(e) => setSku(e.target.value)} className="w-28" />
      <Input placeholder="₹ price" value={price} onChange={(e) => setPrice(e.target.value)} className="w-20" />
      <Input placeholder="reorder" value={reorder} onChange={(e) => setReorder(e.target.value)} className="w-20" />
      <Button variant="ghost" onClick={() => label && sku && price && save.mutate()}>+ Variant</Button>
    </div>
  );
}

function SellDrawer({ products, onClose }: { products: any[]; onClose: () => void }) {
  const navigate = useNavigate();
  const [lines, setLines] = useState<Record<string, number>>({});
  const [error, setError] = useState('');
  const variants = products.flatMap((p) => p.variants.map((v: any) => ({ ...v, productName: p.name })));

  const items = Object.entries(lines)
    .filter(([, q]) => q > 0)
    .map(([variantId, qty]) => ({ variantId, qty }));
  const total = items.reduce((s, it) => {
    const v = variants.find((x) => x.id === it.variantId);
    return s + (v ? Number(v.pricePaise) * it.qty : 0);
  }, 0);

  const sell = useMutation({
    mutationFn: async () => (await api.post('/api/inventory/sell', { items })).data,
    onSuccess: (res) => navigate(`/invoices/${res.invoice.id}`),
    onError: (e: any) => setError(e.response?.data?.error ?? 'Sale failed'),
  });

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/30" onClick={onClose}>
      <div className="h-full w-full max-w-md overflow-auto bg-white p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <h2 className="mb-4 text-lg font-bold">Sell products (walk-in)</h2>
        <div className="space-y-2">
          {variants.map((v) => (
            <div key={v.id} className="flex items-center justify-between text-sm">
              <span>
                {v.productName} — {v.variantLabel}{' '}
                <span className="text-slate-400">({inr(Number(v.pricePaise))}, stock {v.stockQty})</span>
              </span>
              <Input
                type="number"
                min={0}
                max={v.stockQty}
                value={lines[v.id] ?? 0}
                onChange={(e) => setLines((l) => ({ ...l, [v.id]: Math.max(0, Number(e.target.value)) }))}
                className="w-16"
              />
            </div>
          ))}
        </div>
        <div className="mt-4 text-right font-semibold">Total: {inr(total)}</div>
        {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
        <div className="mt-4 flex gap-2">
          <Button className="flex-1" disabled={!items.length || sell.isPending} onClick={() => sell.mutate()}>
            {sell.isPending ? 'Creating invoice…' : 'Create sale invoice'}
          </Button>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
        </div>
      </div>
    </div>
  );
}
