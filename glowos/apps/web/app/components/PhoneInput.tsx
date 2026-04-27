'use client';

import { useEffect, useMemo, useState } from 'react';

// Curated list — covers 95%+ of MY/SG salon inbound traffic. Ordered by
// proximity to the primary markets. Add more countries here when needed.
export interface Country {
  iso: string;
  name: string;
  dial: string;
  flag: string;
}

export const COUNTRIES: Country[] = [
  { iso: 'SG', name: 'Singapore',       dial: '65',  flag: '🇸🇬' },
  { iso: 'MY', name: 'Malaysia',        dial: '60',  flag: '🇲🇾' },
  { iso: 'ID', name: 'Indonesia',       dial: '62',  flag: '🇮🇩' },
  { iso: 'TH', name: 'Thailand',        dial: '66',  flag: '🇹🇭' },
  { iso: 'PH', name: 'Philippines',     dial: '63',  flag: '🇵🇭' },
  { iso: 'VN', name: 'Vietnam',         dial: '84',  flag: '🇻🇳' },
  { iso: 'HK', name: 'Hong Kong',       dial: '852', flag: '🇭🇰' },
  { iso: 'TW', name: 'Taiwan',          dial: '886', flag: '🇹🇼' },
  { iso: 'AU', name: 'Australia',       dial: '61',  flag: '🇦🇺' },
  { iso: 'NZ', name: 'New Zealand',     dial: '64',  flag: '🇳🇿' },
  { iso: 'JP', name: 'Japan',           dial: '81',  flag: '🇯🇵' },
  { iso: 'KR', name: 'South Korea',     dial: '82',  flag: '🇰🇷' },
  { iso: 'CN', name: 'China',           dial: '86',  flag: '🇨🇳' },
  { iso: 'IN', name: 'India',           dial: '91',  flag: '🇮🇳' },
  { iso: 'US', name: 'United States',   dial: '1',   flag: '🇺🇸' },
  { iso: 'CA', name: 'Canada',          dial: '1',   flag: '🇨🇦' },
  { iso: 'GB', name: 'United Kingdom',  dial: '44',  flag: '🇬🇧' },
  { iso: 'DE', name: 'Germany',         dial: '49',  flag: '🇩🇪' },
  { iso: 'FR', name: 'France',          dial: '33',  flag: '🇫🇷' },
  { iso: 'AE', name: 'UAE',             dial: '971', flag: '🇦🇪' },
];

interface Parsed {
  country: string;
  national: string;
}

// Break a raw string into (country, national digits). Longest-dial-code
// match first so "+1xxx" (US/CA) doesn't accidentally eat "+852..." (HK).
function parse(value: string, defaultCountry: string): Parsed {
  const stripped = (value ?? '').replace(/\s/g, '');
  if (stripped.startsWith('+')) {
    const sorted = [...COUNTRIES].sort((a, b) => b.dial.length - a.dial.length);
    for (const c of sorted) {
      if (stripped.startsWith(`+${c.dial}`)) {
        return { country: c.iso, national: stripped.slice(c.dial.length + 1) };
      }
    }
  }
  return { country: defaultCountry, national: stripped.replace(/^\+/, '') };
}

export interface PhoneInputProps {
  value: string; // Full E.164 string, e.g. "+6591234567"
  onChange: (e164: string) => void;
  defaultCountry?: string; // ISO-2
  autoComplete?: string;
  placeholder?: string;
  disabled?: boolean;
}

export function PhoneInput({
  value,
  onChange,
  defaultCountry = 'SG',
  autoComplete = 'tel',
  placeholder,
  disabled,
}: PhoneInputProps) {
  const initial = useMemo(() => parse(value, defaultCountry), [value, defaultCountry]);
  const [country, setCountry] = useState<string>(initial.country);
  const [national, setNational] = useState<string>(initial.national);

  // Sync from external value changes (e.g. populated from returning-customer
  // lookup or Google sign-in). Only fire when the outside value disagrees with
  // what we'd currently emit, to avoid feedback loops.
  useEffect(() => {
    const p = parse(value, defaultCountry);
    const currentEmit = composeE164(country, national);
    if (value !== currentEmit) {
      setCountry(p.country);
      setNational(p.national);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, defaultCountry]);

  const currentCountry =
    COUNTRIES.find((c) => c.iso === country) ?? COUNTRIES[0]!;

  function emit(dial: string, digits: string) {
    onChange(digits ? `+${dial}${digits}` : '');
  }

  function handleCountryChange(iso: string) {
    setCountry(iso);
    const c = COUNTRIES.find((x) => x.iso === iso) ?? COUNTRIES[0]!;
    emit(c.dial, national);
  }

  function handleNationalChange(v: string) {
    // Keep only digits (users often paste with spaces/hyphens).
    const digits = v.replace(/\D/g, '');
    setNational(digits);
    emit(currentCountry.dial, digits);
  }

  return (
    <div className="flex gap-2">
      <select
        value={country}
        onChange={(e) => handleCountryChange(e.target.value)}
        disabled={disabled}
        className="rounded-xl border-2 border-grey-15 px-2 py-3 text-sm outline-none focus:border-tone-sage bg-tone-surface min-w-[88px]"
        aria-label="Country code"
      >
        {COUNTRIES.map((c) => (
          <option key={c.iso} value={c.iso}>
            {c.flag} +{c.dial}
          </option>
        ))}
      </select>
      <input
        type="tel"
        inputMode="numeric"
        value={national}
        onChange={(e) => handleNationalChange(e.target.value)}
        autoComplete={autoComplete}
        disabled={disabled}
        className="flex-1 rounded-xl border-2 border-grey-15 px-4 py-3 text-sm outline-none focus:border-tone-sage focus:ring-2 focus:ring-indigo-100 transition-colors"
        placeholder={placeholder ?? '9123 4567'}
      />
    </div>
  );
}

function composeE164(country: string, national: string): string {
  if (!national) return '';
  const c = COUNTRIES.find((x) => x.iso === country) ?? COUNTRIES[0]!;
  return `+${c.dial}${national}`;
}
