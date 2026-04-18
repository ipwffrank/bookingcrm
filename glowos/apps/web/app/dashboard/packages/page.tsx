'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { apiFetch, ApiError } from '../../lib/api';

// ─── Types ─────────────────────────────────────────────────────────────────────

interface IncludedService {
  serviceId: string;
  serviceName: string;
  quantity: number;
}

interface PackageTemplate {
  id: string;
  name: string;
  description: string | null;
  totalSessions: number;
  priceSgd: string;
  includedServices: IncludedService[];
  validityDays: number;
  isActive: boolean;
  createdAt: string;
}

interface Service {
  id: string;
  name: string;
  priceSgd: string;
  isActive: boolean;
}

interface Client {
  id: string;
  clientId: string;
  client?: { id: string; name: string | null; phone: string; email: string | null };
}

interface PackageForm {
  name: string;
  description: string;
  priceSgd: string;
  validityDays: string;
  includedServices: IncludedService[];
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

function Spinner() {
  return (
    <div className="flex items-center justify-center py-16">
      <div className="w-8 h-8 border-4 border-gray-200 border-t-[#1a2313] rounded-full animate-spin" />
    </div>
  );
}

function blankForm(): PackageForm {
  return { name: '', description: '', priceSgd: '', validityDays: '180', includedServices: [] };
}

// ─── Page ──────────────────────────────────────────────────────────────────────

export default function PackagesPage() {
  const router = useRouter();
  const [packages, setPackages] = useState<PackageTemplate[]>([]);
  const [services, setServices] = useState<Service[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<PackageForm>(blankForm());
  const [saving, setSaving] = useState(false);

  // Assign modal
  const [showAssign, setShowAssign] = useState(false);
  const [assignPkgId, setAssignPkgId] = useState('');
  const [assignClientId, setAssignClientId] = useState('');
  const [assignPrice, setAssignPrice] = useState('');
  const [assignNotes, setAssignNotes] = useState('');
  const [assigning, setAssigning] = useState(false);
  const [clientSearch, setClientSearch] = useState('');

  // Service picker state
  const [pickerServiceId, setPickerServiceId] = useState('');
  const [pickerQuantity, setPickerQuantity] = useState('1');

  const fetchPackages = useCallback(async () => {
    try {
      const data = await apiFetch('/merchant/packages') as { packages: PackageTemplate[] };
      setPackages(data.packages);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) router.push('/login');
    }
  }, [router]);

  useEffect(() => {
    const token = localStorage.getItem('access_token');
    if (!token) { router.push('/login'); return; }

    Promise.all([
      apiFetch('/merchant/packages').then((d: any) => setPackages(d.packages ?? [])),
      apiFetch('/merchant/services').then((d: any) => setServices((d.services ?? []).filter((s: Service) => s.isActive))),
      apiFetch('/merchant/clients').then((d: any) => setClients(d.profiles ?? d.clients ?? [])),
    ])
      .catch(err => {
        if (err instanceof ApiError && err.status === 401) router.push('/login');
      })
      .finally(() => setLoading(false));
  }, [router]);

  function openCreate() {
    setForm(blankForm());
    setEditingId(null);
    setShowModal(true);
  }

  function openEdit(pkg: PackageTemplate) {
    setForm({
      name: pkg.name,
      description: pkg.description ?? '',
      priceSgd: pkg.priceSgd,
      validityDays: String(pkg.validityDays),
      includedServices: [...pkg.includedServices],
    });
    setEditingId(pkg.id);
    setShowModal(true);
  }

  function addServiceToPicker() {
    const svc = services.find(s => s.id === pickerServiceId);
    if (!svc) return;
    const qty = parseInt(pickerQuantity) || 1;
    // Check if already added
    const existing = form.includedServices.find(s => s.serviceId === svc.id);
    if (existing) {
      setForm(prev => ({
        ...prev,
        includedServices: prev.includedServices.map(s =>
          s.serviceId === svc.id ? { ...s, quantity: s.quantity + qty } : s
        ),
      }));
    } else {
      setForm(prev => ({
        ...prev,
        includedServices: [...prev.includedServices, { serviceId: svc.id, serviceName: svc.name, quantity: qty }],
      }));
    }
    setPickerServiceId('');
    setPickerQuantity('1');
  }

  function removeServiceFromPicker(serviceId: string) {
    setForm(prev => ({
      ...prev,
      includedServices: prev.includedServices.filter(s => s.serviceId !== serviceId),
    }));
  }

  async function handleSave() {
    if (!form.name || !form.priceSgd || form.includedServices.length === 0) {
      alert('Please fill in name, price, and add at least one service.');
      return;
    }
    setSaving(true);
    try {
      const totalSessions = form.includedServices.reduce((sum, s) => sum + s.quantity, 0);
      const payload = {
        name: form.name,
        description: form.description || undefined,
        totalSessions,
        priceSgd: parseFloat(form.priceSgd),
        includedServices: form.includedServices,
        validityDays: parseInt(form.validityDays) || 180,
      };

      if (editingId) {
        await apiFetch(`/merchant/packages/${editingId}`, {
          method: 'PUT',
          body: JSON.stringify(payload),
        });
      } else {
        await apiFetch('/merchant/packages', {
          method: 'POST',
          body: JSON.stringify(payload),
        });
      }
      setShowModal(false);
      setForm(blankForm());
      setEditingId(null);
      await fetchPackages();
    } catch {
      alert('Failed to save package');
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    if (!confirm('Archive this package template? It will no longer appear for new assignments.')) return;
    try {
      await apiFetch(`/merchant/packages/${id}`, { method: 'DELETE' });
      await fetchPackages();
    } catch {
      alert('Failed to archive package');
    }
  }

  function openAssign(pkg: PackageTemplate) {
    setAssignPkgId(pkg.id);
    setAssignPrice(pkg.priceSgd);
    setAssignClientId('');
    setAssignNotes('');
    setClientSearch('');
    setShowAssign(true);
  }

  async function handleAssign() {
    if (!assignClientId || !assignPkgId) {
      alert('Please select a client.');
      return;
    }
    setAssigning(true);
    try {
      await apiFetch('/merchant/packages/assign', {
        method: 'POST',
        body: JSON.stringify({
          clientId: assignClientId,
          packageId: assignPkgId,
          pricePaidSgd: parseFloat(assignPrice) || 0,
          notes: assignNotes || undefined,
        }),
      });
      setShowAssign(false);
      alert('Package assigned successfully!');
    } catch {
      alert('Failed to assign package');
    } finally {
      setAssigning(false);
    }
  }

  const filteredClients = clients.filter(c => {
    if (!clientSearch) return true;
    const term = clientSearch.toLowerCase();
    const name = (c.client?.name ?? '').toLowerCase();
    const phone = (c.client?.phone ?? '').toLowerCase();
    const email = (c.client?.email ?? '').toLowerCase();
    return name.includes(term) || phone.includes(term) || email.includes(term);
  });

  if (loading) return <Spinner />;

  return (
    <div className="max-w-4xl mx-auto space-y-6 font-manrope">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Packages</h1>
          <p className="text-sm text-gray-500 mt-0.5">Multi-session packages for your clients</p>
        </div>
        <button
          onClick={openCreate}
          className="flex items-center gap-2 px-4 py-2 bg-[#1a2313] text-white text-sm font-medium rounded-lg hover:bg-[#2f3827] transition-colors"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" /></svg>
          Create Package
        </button>
      </div>

      {/* Package list */}
      {packages.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 p-12 text-center">
          <div className="w-12 h-12 mx-auto mb-3 rounded-xl bg-gray-100 flex items-center justify-center">
            <svg className="w-6 h-6 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 11.25v8.25a1.5 1.5 0 0 1-1.5 1.5H5.25a1.5 1.5 0 0 1-1.5-1.5v-8.25M12 4.875A2.625 2.625 0 1 0 9.375 7.5H12m0-2.625V7.5m0-2.625A2.625 2.625 0 1 1 14.625 7.5H12m0 0V21m-8.625-9.75h18c.621 0 1.125-.504 1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125h-18c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125Z" />
            </svg>
          </div>
          <p className="text-sm font-medium text-gray-700">No packages yet</p>
          <p className="text-xs text-gray-400 mt-1">Create your first multi-session package to get started.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {packages.map(pkg => (
            <div key={pkg.id} className="bg-white rounded-xl border border-gray-200 p-5 hover:border-gray-300 transition-colors">
              <div className="flex items-start justify-between">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-3">
                    <h3 className="text-sm font-semibold text-gray-900">{pkg.name}</h3>
                    <span className="text-xs font-medium text-gray-500 bg-gray-100 px-2 py-0.5 rounded-full">
                      {pkg.totalSessions} sessions
                    </span>
                  </div>
                  {pkg.description && (
                    <p className="text-xs text-gray-500 mt-1">{pkg.description}</p>
                  )}
                  <div className="flex flex-wrap gap-1.5 mt-2">
                    {pkg.includedServices.map(svc => (
                      <span key={svc.serviceId} className="text-[11px] bg-indigo-50 text-indigo-700 px-2 py-0.5 rounded-full">
                        {svc.serviceName} x{svc.quantity}
                      </span>
                    ))}
                  </div>
                  <p className="text-[11px] text-gray-400 mt-2">
                    Valid for {pkg.validityDays} days
                  </p>
                </div>
                <div className="text-right flex flex-col items-end gap-2 ml-4">
                  <p className="text-lg font-bold text-gray-900">${parseFloat(pkg.priceSgd).toFixed(0)}</p>
                  <div className="flex gap-1.5">
                    <button
                      onClick={() => openAssign(pkg)}
                      className="text-[11px] font-medium text-indigo-600 hover:text-indigo-800 bg-indigo-50 hover:bg-indigo-100 px-2.5 py-1 rounded-md transition-colors"
                    >
                      Assign
                    </button>
                    <button
                      onClick={() => openEdit(pkg)}
                      className="text-[11px] font-medium text-gray-500 hover:text-gray-700 bg-gray-50 hover:bg-gray-100 px-2.5 py-1 rounded-md transition-colors"
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => handleDelete(pkg.id)}
                      className="text-[11px] font-medium text-red-500 hover:text-red-700 bg-red-50 hover:bg-red-100 px-2.5 py-1 rounded-md transition-colors"
                    >
                      Archive
                    </button>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Create/Edit Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-lg mx-4 max-h-[90vh] overflow-y-auto">
            <div className="p-6 border-b border-gray-100">
              <h2 className="text-lg font-semibold text-gray-900">
                {editingId ? 'Edit Package' : 'Create Package'}
              </h2>
            </div>
            <div className="p-6 space-y-4">
              {/* Name */}
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Package Name</label>
                <input
                  type="text"
                  value={form.name}
                  onChange={e => setForm(prev => ({ ...prev, name: e.target.value }))}
                  placeholder="e.g. Facial Rejuvenation - 5 Sessions"
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-800 focus:outline-none focus:ring-1 focus:ring-indigo-500/30"
                />
              </div>

              {/* Description */}
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Description</label>
                <textarea
                  value={form.description}
                  onChange={e => setForm(prev => ({ ...prev, description: e.target.value }))}
                  rows={2}
                  placeholder="Optional description..."
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-800 focus:outline-none focus:ring-1 focus:ring-indigo-500/30 resize-none"
                />
              </div>

              {/* Price + Validity */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">Price (SGD)</label>
                  <input
                    type="number"
                    value={form.priceSgd}
                    onChange={e => setForm(prev => ({ ...prev, priceSgd: e.target.value }))}
                    placeholder="0.00"
                    min="0"
                    step="0.01"
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-800 focus:outline-none focus:ring-1 focus:ring-indigo-500/30"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">Validity (days)</label>
                  <input
                    type="number"
                    value={form.validityDays}
                    onChange={e => setForm(prev => ({ ...prev, validityDays: e.target.value }))}
                    placeholder="180"
                    min="1"
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-800 focus:outline-none focus:ring-1 focus:ring-indigo-500/30"
                  />
                </div>
              </div>

              {/* Included Services Picker */}
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Included Services</label>
                <div className="flex gap-2">
                  <select
                    value={pickerServiceId}
                    onChange={e => setPickerServiceId(e.target.value)}
                    className="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-800 focus:outline-none focus:ring-1 focus:ring-indigo-500/30"
                  >
                    <option value="">Select a service...</option>
                    {services.map(svc => (
                      <option key={svc.id} value={svc.id}>{svc.name} — ${parseFloat(svc.priceSgd).toFixed(0)}</option>
                    ))}
                  </select>
                  <input
                    type="number"
                    value={pickerQuantity}
                    onChange={e => setPickerQuantity(e.target.value)}
                    min="1"
                    className="w-16 border border-gray-200 rounded-lg px-2 py-2 text-sm text-center text-gray-800 focus:outline-none focus:ring-1 focus:ring-indigo-500/30"
                    placeholder="Qty"
                  />
                  <button
                    type="button"
                    onClick={addServiceToPicker}
                    disabled={!pickerServiceId}
                    className="px-3 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 disabled:opacity-40 transition-colors"
                  >
                    Add
                  </button>
                </div>
                {form.includedServices.length > 0 && (
                  <div className="mt-2 space-y-1">
                    {form.includedServices.map(svc => (
                      <div key={svc.serviceId} className="flex items-center justify-between bg-gray-50 rounded-lg px-3 py-2">
                        <span className="text-xs text-gray-700">{svc.serviceName} x{svc.quantity}</span>
                        <button
                          onClick={() => removeServiceFromPicker(svc.serviceId)}
                          className="text-xs text-red-500 hover:text-red-700"
                        >
                          Remove
                        </button>
                      </div>
                    ))}
                    <p className="text-xs text-gray-400 mt-1">
                      Total sessions: {form.includedServices.reduce((sum, s) => sum + s.quantity, 0)}
                    </p>
                  </div>
                )}
              </div>
            </div>
            <div className="p-6 border-t border-gray-100 flex justify-end gap-2">
              <button
                onClick={() => { setShowModal(false); setForm(blankForm()); setEditingId(null); }}
                className="px-4 py-2 bg-gray-100 text-gray-600 text-sm font-medium rounded-lg hover:bg-gray-200 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleSave}
                disabled={saving}
                className="px-4 py-2 bg-[#1a2313] text-white text-sm font-medium rounded-lg hover:bg-[#2f3827] disabled:opacity-50 transition-colors"
              >
                {saving ? 'Saving...' : editingId ? 'Update Package' : 'Create Package'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Assign Modal */}
      {showAssign && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md mx-4">
            <div className="p-6 border-b border-gray-100">
              <h2 className="text-lg font-semibold text-gray-900">Assign Package to Client</h2>
              <p className="text-xs text-gray-500 mt-0.5">
                {packages.find(p => p.id === assignPkgId)?.name}
              </p>
            </div>
            <div className="p-6 space-y-4">
              {/* Client search */}
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Client</label>
                <input
                  type="text"
                  value={clientSearch}
                  onChange={e => setClientSearch(e.target.value)}
                  placeholder="Search by name, phone, or email..."
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-800 focus:outline-none focus:ring-1 focus:ring-indigo-500/30 mb-2"
                />
                <select
                  value={assignClientId}
                  onChange={e => setAssignClientId(e.target.value)}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-800 focus:outline-none focus:ring-1 focus:ring-indigo-500/30"
                  size={Math.min(filteredClients.length + 1, 6)}
                >
                  <option value="">Select a client...</option>
                  {filteredClients.slice(0, 50).map(c => (
                    <option key={c.id} value={c.client?.id ?? c.clientId}>
                      {c.client?.name ?? 'Unknown'} — {c.client?.phone ?? ''}
                    </option>
                  ))}
                </select>
              </div>

              {/* Price paid */}
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Price Paid (SGD)</label>
                <input
                  type="number"
                  value={assignPrice}
                  onChange={e => setAssignPrice(e.target.value)}
                  min="0"
                  step="0.01"
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-800 focus:outline-none focus:ring-1 focus:ring-indigo-500/30"
                />
              </div>

              {/* Notes */}
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Notes (optional)</label>
                <textarea
                  value={assignNotes}
                  onChange={e => setAssignNotes(e.target.value)}
                  rows={2}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-800 focus:outline-none focus:ring-1 focus:ring-indigo-500/30 resize-none"
                />
              </div>
            </div>
            <div className="p-6 border-t border-gray-100 flex justify-end gap-2">
              <button
                onClick={() => setShowAssign(false)}
                className="px-4 py-2 bg-gray-100 text-gray-600 text-sm font-medium rounded-lg hover:bg-gray-200 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleAssign}
                disabled={assigning || !assignClientId}
                className="px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 disabled:opacity-50 transition-colors"
              >
                {assigning ? 'Assigning...' : 'Assign Package'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
