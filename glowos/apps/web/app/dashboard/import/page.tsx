'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiFetch, ApiError } from '../../lib/api';

interface ParsedClient {
  name: string;
  phone: string;
  email: string;
  notes: string;
}

interface ImportResults {
  created: number;
  skipped: number;
  errors: { phone: string; reason: string }[];
}

function parseCSV(text: string): ParsedClient[] {
  const lines = text.trim().split('\n');
  if (lines.length < 2) return [];

  const headers = lines[0].toLowerCase().split(',').map((h) => h.trim().replace(/"/g, ''));
  const nameIdx = headers.findIndex((h) => h.includes('name'));
  const phoneIdx = headers.findIndex((h) => h.includes('phone') || h.includes('mobile'));
  const emailIdx = headers.findIndex((h) => h.includes('email'));
  const notesIdx = headers.findIndex((h) => h.includes('notes') || h.includes('remark'));

  if (phoneIdx === -1) {
    throw new Error('CSV must have a "phone" or "mobile" column');
  }

  return lines
    .slice(1)
    .map((line) => {
      const cols = line.split(',').map((c) => c.trim().replace(/^"|"$/g, ''));
      return {
        name: nameIdx >= 0 ? cols[nameIdx] ?? '' : '',
        phone: cols[phoneIdx] ?? '',
        email: emailIdx >= 0 ? cols[emailIdx] ?? '' : '',
        notes: notesIdx >= 0 ? cols[notesIdx] ?? '' : '',
      };
    })
    .filter((r) => r.phone.length > 0);
}

export default function ImportPage() {
  const router = useRouter();
  const [preview, setPreview] = useState<ParsedClient[]>([]);
  const [parseError, setParseError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<ImportResults | null>(null);

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    setParseError(null);
    setResults(null);
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const text = ev.target?.result as string;
        const parsed = parseCSV(text);
        setPreview(parsed);
      } catch (err) {
        setParseError(String(err));
      }
    };
    reader.readAsText(file);
  }

  async function handleImport() {
    if (preview.length === 0) return;
    setLoading(true);
    try {
      const res = await apiFetch('/merchant/clients/import', {
        method: 'POST',
        body: JSON.stringify({ clients: preview }),
      }) as { results: ImportResults };
      setResults(res.results);
      setPreview([]);
    } catch (err) {
      if (err instanceof ApiError) {
        setParseError(err.message);
        if (err.status === 401) router.push('/login');
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="max-w-2xl mx-auto p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-white">Import Clients</h1>
        <p className="text-gray-400 text-sm mt-1">
          Upload a CSV file to import your existing client list. Required column: <code className="text-amber-400">phone</code>.
          Optional columns: <code className="text-amber-400">name</code>, <code className="text-amber-400">email</code>, <code className="text-amber-400">notes</code>.
        </p>
      </div>

      {/* CSV Format hint */}
      <div className="bg-gray-800 rounded-lg p-4 text-sm text-gray-400">
        <p className="font-medium text-gray-300 mb-1">CSV Format</p>
        <code className="text-xs text-amber-300">name,phone,email,notes</code>
        <br />
        <code className="text-xs text-amber-300">Jane Tan,+6591234567,jane@email.com,Sensitive skin</code>
      </div>

      <input
        type="file"
        accept=".csv"
        onChange={handleFile}
        className="block w-full text-sm text-gray-400 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-medium file:bg-amber-600 file:text-white hover:file:bg-amber-500"
      />

      {parseError && (
        <div className="bg-red-900/30 border border-red-700 rounded-lg px-4 py-3 text-red-300 text-sm">
          {parseError}
        </div>
      )}

      {preview.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-sm text-gray-400">{preview.length} clients ready to import</p>
            <button
              onClick={handleImport}
              disabled={loading}
              className="px-4 py-2 bg-amber-600 hover:bg-amber-500 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors"
            >
              {loading ? 'Importing...' : `Import ${preview.length} clients`}
            </button>
          </div>
          <div className="max-h-64 overflow-auto rounded-lg border border-gray-700">
            <table className="w-full text-xs text-gray-300">
              <thead className="bg-gray-800 sticky top-0">
                <tr>
                  {['Name', 'Phone', 'Email', 'Notes'].map((h) => (
                    <th key={h} className="px-3 py-2 text-left font-medium text-gray-400">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {preview.slice(0, 50).map((r, i) => (
                  <tr key={i} className="border-t border-gray-700">
                    <td className="px-3 py-2">{r.name || '—'}</td>
                    <td className="px-3 py-2">{r.phone}</td>
                    <td className="px-3 py-2">{r.email || '—'}</td>
                    <td className="px-3 py-2">{r.notes || '—'}</td>
                  </tr>
                ))}
                {preview.length > 50 && (
                  <tr className="border-t border-gray-700">
                    <td colSpan={4} className="px-3 py-2 text-gray-500 italic">
                      ... and {preview.length - 50} more
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {results && (
        <div className="bg-gray-800 rounded-lg p-4 space-y-1 text-sm">
          <p className="font-medium text-white">Import Complete</p>
          <p className="text-green-400">&#10003; {results.created} clients created</p>
          {results.skipped > 0 && (
            <p className="text-gray-400">&#8635; {results.skipped} already existed (skipped)</p>
          )}
          {results.errors.length > 0 && (
            <div>
              <p className="text-red-400">&#10007; {results.errors.length} errors:</p>
              {results.errors.map((e, i) => (
                <p key={i} className="text-xs text-red-300 ml-4">{e.phone}: {e.reason}</p>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
