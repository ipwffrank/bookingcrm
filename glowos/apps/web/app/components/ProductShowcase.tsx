'use client';

import { useEffect, useState } from 'react';

// ─── Animated product mockup that cycles through app screens ──────────────────
// Pure CSS/JS — no video files needed. Shows stylized versions of:
// 1. Analytics dashboard (revenue chart + stats)
// 2. Calendar with bookings
// 3. Campaign send flow

const SCREENS = [
  { id: 'analytics', label: 'Analytics' },
  { id: 'calendar', label: 'Calendar' },
  { id: 'campaigns', label: 'Campaigns' },
] as const;

function AnimatedChart({ active }: { active: boolean }) {
  const bars = [35, 52, 44, 68, 58, 72, 85, 62, 78, 90, 65, 88];
  return (
    <div className="flex items-end gap-1 h-28 px-2">
      {bars.map((h, i) => (
        <div
          key={i}
          className="flex-1 rounded-t transition-all duration-700 ease-out"
          style={{
            height: active ? `${h}%` : '4%',
            backgroundColor: `rgba(196, 167, 120, ${0.4 + (h / 100) * 0.6})`,
            transitionDelay: `${i * 60}ms`,
          }}
        />
      ))}
    </div>
  );
}

function AnalyticsScreen({ active }: { active: boolean }) {
  return (
    <div className={`transition-opacity duration-500 ${active ? 'opacity-100' : 'opacity-0'}`}>
      {/* Stats row */}
      <div className="grid grid-cols-4 gap-2 mb-4">
        {[
          { label: 'Revenue', value: '$12,840', delta: '+18%' },
          { label: 'Bookings', value: '186', delta: '+12%' },
          { label: 'Retention', value: '89%', delta: '+3%' },
          { label: 'Avg Spend', value: '$69', delta: '+8%' },
        ].map((s, i) => (
          <div
            key={s.label}
            className="bg-white/5 rounded-lg p-2.5 transition-all duration-500"
            style={{ transform: active ? 'translateY(0)' : 'translateY(8px)', opacity: active ? 1 : 0, transitionDelay: `${i * 100}ms` }}
          >
            <p className="text-[10px] text-white/40">{s.label}</p>
            <p className="text-sm font-bold text-white mt-0.5">{s.value}</p>
            <p className="text-[10px] text-emerald-400 mt-0.5">{s.delta}</p>
          </div>
        ))}
      </div>
      {/* Chart */}
      <div className="bg-white/5 rounded-lg p-3">
        <p className="text-[10px] text-white/40 mb-2">Monthly Revenue</p>
        <AnimatedChart active={active} />
        <div className="flex justify-between mt-1.5 px-1">
          {['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'].map(m => (
            <span key={m} className="text-[7px] text-white/25">{m}</span>
          ))}
        </div>
      </div>
    </div>
  );
}

function CalendarScreen({ active }: { active: boolean }) {
  const slots = [
    { time: '9:00', client: 'Sarah Chen', service: 'Facial Treatment', col: 0, row: 0, h: 2, color: 'bg-indigo-500/30 border-indigo-400/40' },
    { time: '9:30', client: 'Amy Tan', service: 'Gel Manicure', col: 1, row: 1, h: 1, color: 'bg-sky-500/30 border-sky-400/40' },
    { time: '10:00', client: 'Jessica Lim', service: 'Hair Colour', col: 2, row: 2, h: 3, color: 'bg-emerald-500/30 border-emerald-400/40' },
    { time: '10:30', client: 'Michelle Wong', service: 'Deep Tissue', col: 0, row: 3, h: 2, color: 'bg-amber-500/30 border-amber-400/40' },
    { time: '11:00', client: 'Rachel Goh', service: 'Nail Art', col: 1, row: 4, h: 2, color: 'bg-purple-500/30 border-purple-400/40' },
  ];
  const staffNames = ['Dr. Lim', 'Wei Lin', 'Priya N.'];

  return (
    <div className={`transition-opacity duration-500 ${active ? 'opacity-100' : 'opacity-0'}`}>
      {/* Staff columns header */}
      <div className="grid grid-cols-3 gap-2 mb-2">
        {staffNames.map((name, i) => (
          <div
            key={name}
            className="text-center transition-all duration-500"
            style={{ transform: active ? 'translateY(0)' : 'translateY(-8px)', opacity: active ? 1 : 0, transitionDelay: `${i * 80}ms` }}
          >
            <div className="w-6 h-6 rounded-full bg-white/10 mx-auto mb-1 flex items-center justify-center text-[8px] font-bold text-white/60">
              {name[0]}
            </div>
            <p className="text-[9px] text-white/50">{name}</p>
          </div>
        ))}
      </div>
      {/* Time grid */}
      <div className="relative bg-white/5 rounded-lg p-2" style={{ minHeight: 160 }}>
        {/* Time labels */}
        {['9:00', '10:00', '11:00', '12:00'].map((t, i) => (
          <div key={t} className="absolute left-1 text-[7px] text-white/25" style={{ top: 8 + i * 40 }}>{t}</div>
        ))}
        {/* Grid lines */}
        {[0, 1, 2, 3].map(i => (
          <div key={i} className="absolute left-6 right-2 border-t border-white/5" style={{ top: 8 + i * 40 }} />
        ))}
        {/* Booking blocks */}
        {slots.map((slot, i) => (
          <div
            key={i}
            className={`absolute rounded border ${slot.color} px-1.5 py-1 transition-all duration-600 overflow-hidden`}
            style={{
              left: `${24 + slot.col * 33}%`,
              width: '30%',
              top: active ? 8 + slot.row * 20 : 8 + slot.row * 20 + 20,
              height: slot.h * 20,
              opacity: active ? 1 : 0,
              transitionDelay: `${200 + i * 120}ms`,
            }}
          >
            <p className="text-[7px] font-medium text-white/80 truncate">{slot.client}</p>
            <p className="text-[6px] text-white/40 truncate">{slot.service}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

function CampaignsScreen({ active }: { active: boolean }) {
  const recipients = [
    { name: 'Sarah Chen', status: 'Delivered', emoji: '✓' },
    { name: 'Amy Tan', status: 'Opened', emoji: '✓✓' },
    { name: 'Jessica Lim', status: 'Clicked', emoji: '🔗' },
    { name: 'Michelle Wong', status: 'Booked!', emoji: '🎯' },
  ];

  return (
    <div className={`transition-opacity duration-500 ${active ? 'opacity-100' : 'opacity-0'}`}>
      {/* Campaign card */}
      <div
        className="bg-white/5 rounded-lg p-3 mb-3 transition-all duration-500"
        style={{ transform: active ? 'translateY(0)' : 'translateY(12px)', opacity: active ? 1 : 0 }}
      >
        <div className="flex items-center justify-between mb-2">
          <p className="text-xs font-medium text-white/80">VIP Re-engagement</p>
          <span className="text-[9px] bg-emerald-500/20 text-emerald-400 px-2 py-0.5 rounded-full">Sent</span>
        </div>
        <p className="text-[10px] text-white/40 leading-relaxed">
          &ldquo;We miss you! Book this week and enjoy 20% off your favourite treatment.&rdquo;
        </p>
        <div className="flex gap-3 mt-2.5">
          {[
            { label: 'Sent', value: '142' },
            { label: 'Opened', value: '89%' },
            { label: 'Booked', value: '23' },
          ].map(s => (
            <div key={s.label}>
              <p className="text-sm font-bold text-white">{s.value}</p>
              <p className="text-[8px] text-white/30">{s.label}</p>
            </div>
          ))}
        </div>
      </div>
      {/* Recipients list */}
      <div className="space-y-1">
        {recipients.map((r, i) => (
          <div
            key={r.name}
            className="flex items-center justify-between bg-white/5 rounded-lg px-3 py-2 transition-all duration-500"
            style={{ transform: active ? 'translateX(0)' : 'translateX(16px)', opacity: active ? 1 : 0, transitionDelay: `${300 + i * 100}ms` }}
          >
            <div className="flex items-center gap-2">
              <div className="w-5 h-5 rounded-full bg-white/10 flex items-center justify-center text-[8px] text-white/50 font-medium">{r.name[0]}</div>
              <span className="text-[10px] text-white/70">{r.name}</span>
            </div>
            <span className={`text-[9px] ${r.status === 'Booked!' ? 'text-emerald-400 font-medium' : 'text-white/40'}`}>
              {r.emoji} {r.status}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function ProductShowcase() {
  const [activeIdx, setActiveIdx] = useState(0);
  const [isVisible, setIsVisible] = useState(false);

  // Auto-cycle every 5 seconds
  useEffect(() => {
    const interval = setInterval(() => {
      setActiveIdx(prev => (prev + 1) % SCREENS.length);
    }, 5000);
    return () => clearInterval(interval);
  }, []);

  // IntersectionObserver to trigger animations when scrolled into view
  useEffect(() => {
    const el = document.getElementById('product-showcase');
    if (!el) return;
    const obs = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) setIsVisible(true); },
      { threshold: 0.2 }
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  return (
    <div id="product-showcase" className="w-full max-w-lg mx-auto">
      {/* Mockup frame */}
      <div
        className={`bg-[#0a0a0a] rounded-2xl border border-white/10 shadow-2xl shadow-black/40 overflow-hidden transition-all duration-700 ${
          isVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-8'
        }`}
      >
        {/* Window chrome */}
        <div className="flex items-center gap-1.5 px-4 py-2.5 border-b border-white/5">
          <div className="w-2.5 h-2.5 rounded-full bg-red-500/60" />
          <div className="w-2.5 h-2.5 rounded-full bg-yellow-500/60" />
          <div className="w-2.5 h-2.5 rounded-full bg-green-500/60" />
          <div className="flex-1 mx-8">
            <div className="bg-white/5 rounded-md px-3 py-1 text-center">
              <span className="text-[9px] text-white/30">glowos.app/dashboard</span>
            </div>
          </div>
        </div>

        {/* Sidebar + content */}
        <div className="flex" style={{ minHeight: 280 }}>
          {/* Mini sidebar */}
          <div className="w-12 bg-white/[0.02] border-r border-white/5 py-3 flex flex-col items-center gap-2">
            <div className="w-5 h-5 rounded bg-[#c4a778]/20 flex items-center justify-center mb-2">
              <span className="text-[8px] font-bold text-[#c4a778]">G</span>
            </div>
            {SCREENS.map((s, i) => (
              <button
                key={s.id}
                onClick={() => setActiveIdx(i)}
                className={`w-7 h-7 rounded-md flex items-center justify-center transition-all duration-300 ${
                  activeIdx === i ? 'bg-white/10' : 'hover:bg-white/5'
                }`}
              >
                {s.id === 'analytics' && (
                  <svg className={`w-3.5 h-3.5 ${activeIdx === i ? 'text-[#c4a778]' : 'text-white/30'}`} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z" />
                  </svg>
                )}
                {s.id === 'calendar' && (
                  <svg className={`w-3.5 h-3.5 ${activeIdx === i ? 'text-[#c4a778]' : 'text-white/30'}`} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 11.25v7.5" />
                  </svg>
                )}
                {s.id === 'campaigns' && (
                  <svg className={`w-3.5 h-3.5 ${activeIdx === i ? 'text-[#c4a778]' : 'text-white/30'}`} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M10.34 15.84c-.688-.06-1.386-.09-2.09-.09H7.5a4.5 4.5 0 110-9h.75c.704 0 1.402-.03 2.09-.09m0 9.18c.253.962.584 1.892.985 2.783.247.55.06 1.21-.463 1.511l-.657.38c-.551.318-1.26.117-1.527-.461a20.845 20.845 0 01-1.44-4.282m3.102.069a18.03 18.03 0 01-.59-4.59c0-1.586.205-3.124.59-4.59m0 9.18a23.848 23.848 0 018.835 2.535M10.34 6.66a23.847 23.847 0 018.835-2.535m0 0A23.74 23.74 0 0118.795 3c1.167 0 2.301.068 3.268.2M19.175 4.125c.027.406.044.813.05 1.221M19.175 4.125a23.704 23.704 0 00-.05 14.75m0 0c-.005.408-.022.815-.05 1.221" />
                  </svg>
                )}
              </button>
            ))}
          </div>

          {/* Main content area */}
          <div className="flex-1 p-3 relative">
            {/* Tab label */}
            <div className="flex items-center gap-2 mb-3">
              <p className="text-xs font-semibold text-white/80">{SCREENS[activeIdx].label}</p>
              <div className="flex-1" />
              {/* Tab dots */}
              <div className="flex gap-1">
                {SCREENS.map((_, i) => (
                  <button
                    key={i}
                    onClick={() => setActiveIdx(i)}
                    className={`w-1.5 h-1.5 rounded-full transition-all duration-300 ${
                      activeIdx === i ? 'bg-[#c4a778] w-4' : 'bg-white/20'
                    }`}
                  />
                ))}
              </div>
            </div>

            {/* Screens */}
            <div className="relative" style={{ minHeight: 220 }}>
              <div className="absolute inset-0">
                <AnalyticsScreen active={activeIdx === 0} />
              </div>
              <div className="absolute inset-0">
                <CalendarScreen active={activeIdx === 1} />
              </div>
              <div className="absolute inset-0">
                <CampaignsScreen active={activeIdx === 2} />
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Screen label pills below */}
      <div className="flex justify-center gap-2 mt-4">
        {SCREENS.map((s, i) => (
          <button
            key={s.id}
            onClick={() => setActiveIdx(i)}
            className={`text-[11px] px-3 py-1.5 rounded-full transition-all duration-300 ${
              activeIdx === i
                ? 'bg-[#c4a778]/20 text-[#c4a778] border border-[#c4a778]/30'
                : 'text-gray-400 border border-gray-300 hover:text-gray-600 hover:border-gray-400'
            }`}
          >
            {s.label}
          </button>
        ))}
      </div>
    </div>
  );
}
