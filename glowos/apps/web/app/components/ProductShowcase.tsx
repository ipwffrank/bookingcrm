'use client';

import { useEffect, useState } from 'react';

const SAGE = '#456466';
const SAGE_RGB = '69, 100, 102';

const SCREENS = [
  { id: 'analytics', label: 'Analytics' },
  { id: 'calendar', label: 'Calendar' },
  { id: 'campaigns', label: 'Campaigns' },
  { id: 'booking', label: 'Booking' },
  { id: 'whatsapp', label: 'WhatsApp' },
  { id: 'staff', label: 'Staff' },
] as const;

function AnimatedChart({ active }: { active: boolean }) {
  const bars = [35, 52, 44, 68, 58, 72, 85, 62, 78, 90, 65, 88];
  return (
    <div className="flex items-end gap-1 h-[129px] px-2">
      {bars.map((h, i) => (
        <div
          key={i}
          className="flex-1 rounded-t transition-all duration-700 ease-out"
          style={{
            height: active ? `${h}%` : '4%',
            backgroundColor: `rgba(${SAGE_RGB}, ${0.4 + (h / 100) * 0.6})`,
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
            <p className="text-[10px] mt-0.5" style={{ color: SAGE }}>{s.delta}</p>
          </div>
        ))}
      </div>
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
    { time: '9:00', client: 'Sarah Chen', service: 'Facial Treatment', col: 0, row: 0, h: 2 },
    { time: '9:30', client: 'Amy Tan', service: 'Gel Manicure', col: 1, row: 1, h: 1 },
    { time: '10:00', client: 'Jessica Lim', service: 'Hair Colour', col: 2, row: 2, h: 3 },
    { time: '10:30', client: 'Michelle Wong', service: 'Deep Tissue', col: 0, row: 3, h: 2 },
    { time: '11:00', client: 'Rachel Goh', service: 'Nail Art', col: 1, row: 4, h: 2 },
  ];
  const staffNames = ['Dr. Lim', 'Wei Lin', 'Priya N.'];

  return (
    <div className={`transition-opacity duration-500 ${active ? 'opacity-100' : 'opacity-0'}`}>
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
      <div className="relative bg-white/5 rounded-lg p-2" style={{ minHeight: 184 }}>
        {['9:00', '10:00', '11:00', '12:00'].map((t, i) => (
          <div key={t} className="absolute left-1 text-[7px] text-white/25" style={{ top: 8 + i * 46 }}>{t}</div>
        ))}
        {[0, 1, 2, 3].map(i => (
          <div key={i} className="absolute left-6 right-2 border-t border-white/5" style={{ top: 8 + i * 46 }} />
        ))}
        {slots.map((slot, i) => (
          <div
            key={i}
            className="absolute rounded border px-1.5 py-1 transition-all duration-600 overflow-hidden"
            style={{
              left: `${24 + slot.col * 33}%`,
              width: '30%',
              top: active ? 8 + slot.row * 23 : 8 + slot.row * 23 + 20,
              height: slot.h * 23,
              opacity: active ? 1 : 0,
              transitionDelay: `${200 + i * 120}ms`,
              backgroundColor: `rgba(${SAGE_RGB}, ${0.18 + (i % 3) * 0.08})`,
              borderColor: `rgba(${SAGE_RGB}, 0.45)`,
            }}
          >
            <p className="text-[7px] font-medium text-white/85 truncate">{slot.client}</p>
            <p className="text-[6px] text-white/45 truncate">{slot.service}</p>
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
      <div
        className="bg-white/5 rounded-lg p-3 mb-3 transition-all duration-500"
        style={{ transform: active ? 'translateY(0)' : 'translateY(12px)', opacity: active ? 1 : 0 }}
      >
        <div className="flex items-center justify-between mb-2">
          <p className="text-xs font-medium text-white/80">VIP Re-engagement</p>
          <span
            className="text-[9px] px-2 py-0.5 rounded-full"
            style={{ backgroundColor: `rgba(${SAGE_RGB}, 0.22)`, color: SAGE }}
          >
            Sent
          </span>
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
            <span
              className="text-[9px]"
              style={{ color: r.status === 'Booked!' ? SAGE : 'rgba(255,255,255,0.4)', fontWeight: r.status === 'Booked!' ? 500 : 400 }}
            >
              {r.emoji} {r.status}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function BookingScreen({ active }: { active: boolean }) {
  const services = [
    { name: 'Hydra Facial', dur: '60 min', price: '$180', selected: true },
    { name: 'Laser Hair Removal', dur: '45 min', price: '$220', selected: false },
    { name: 'Botox Touch-Up', dur: '30 min', price: '$320', selected: false },
  ];
  const dates = [
    { day: 'Mon', num: '21' },
    { day: 'Tue', num: '22', selected: true },
    { day: 'Wed', num: '23' },
    { day: 'Thu', num: '24' },
    { day: 'Fri', num: '25' },
  ];
  const slots = [
    { time: '10:00', taken: false },
    { time: '11:30', taken: true },
    { time: '14:00', selected: true },
    { time: '15:30', taken: false },
    { time: '17:00', taken: false },
    { time: '18:30', taken: true },
  ];

  return (
    <div className={`transition-opacity duration-500 ${active ? 'opacity-100' : 'opacity-0'}`}>
      <div
        className="bg-white/5 rounded-lg px-3 py-2 mb-2 flex items-center justify-between transition-all duration-500"
        style={{ transform: active ? 'translateY(0)' : 'translateY(-8px)', opacity: active ? 1 : 0 }}
      >
        <div>
          <p className="text-[10px] font-semibold text-white/85">Glow Aesthetics</p>
          <p className="text-[8px] text-white/40">Marina Bay · Singapore</p>
        </div>
        <span className="text-[8px]" style={{ color: SAGE }}>Book online</span>
      </div>

      <div className="space-y-1.5 mb-2.5">
        {services.map((s, i) => (
          <div
            key={s.name}
            className="rounded-lg px-2.5 py-1.5 flex items-center justify-between transition-all duration-500"
            style={{
              backgroundColor: s.selected ? `rgba(${SAGE_RGB}, 0.18)` : 'rgba(255,255,255,0.04)',
              border: s.selected ? `1px solid rgba(${SAGE_RGB}, 0.5)` : '1px solid rgba(255,255,255,0.05)',
              transform: active ? 'translateX(0)' : 'translateX(-12px)',
              opacity: active ? 1 : 0,
              transitionDelay: `${100 + i * 80}ms`,
            }}
          >
            <div>
              <p className="text-[10px] font-medium text-white/85">{s.name}</p>
              <p className="text-[8px] text-white/40">{s.dur}</p>
            </div>
            <p className="text-[10px] font-semibold" style={{ color: s.selected ? SAGE : 'rgba(255,255,255,0.6)' }}>
              {s.price}
            </p>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-5 gap-1 mb-2">
        {dates.map((d, i) => (
          <div
            key={d.num}
            className="rounded-md py-1 text-center transition-all duration-500"
            style={{
              backgroundColor: d.selected ? SAGE : 'rgba(255,255,255,0.05)',
              transform: active ? 'translateY(0)' : 'translateY(8px)',
              opacity: active ? 1 : 0,
              transitionDelay: `${360 + i * 50}ms`,
            }}
          >
            <p className="text-[7px]" style={{ color: d.selected ? 'rgba(255,255,255,0.7)' : 'rgba(255,255,255,0.35)' }}>{d.day}</p>
            <p className="text-[10px] font-semibold" style={{ color: d.selected ? '#fff' : 'rgba(255,255,255,0.85)' }}>{d.num}</p>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-3 gap-1">
        {slots.map((s, i) => (
          <div
            key={s.time}
            className="rounded-md py-1.5 text-center text-[9px] transition-all duration-500"
            style={{
              backgroundColor: s.selected
                ? SAGE
                : s.taken
                  ? 'rgba(255,255,255,0.02)'
                  : 'rgba(255,255,255,0.06)',
              color: s.selected ? '#fff' : s.taken ? 'rgba(255,255,255,0.2)' : 'rgba(255,255,255,0.7)',
              textDecoration: s.taken ? 'line-through' : undefined,
              border: s.selected ? `1px solid ${SAGE}` : '1px solid rgba(255,255,255,0.05)',
              transform: active ? 'scale(1)' : 'scale(0.92)',
              opacity: active ? 1 : 0,
              transitionDelay: `${600 + i * 40}ms`,
            }}
          >
            {s.time}
          </div>
        ))}
      </div>
    </div>
  );
}

function WhatsAppScreen({ active }: { active: boolean }) {
  const messages = [
    { dir: 'out', text: 'Hi Sarah! Your Hydra Facial is confirmed for Tue 22 Apr at 2:00pm 💆', time: '10:32', tick: '✓✓' },
    { dir: 'out', text: "Reminder: we'll see you tomorrow at 2:00pm. Reply 'C' to cancel.", time: '14:08', tick: '✓✓' },
    { dir: 'in', text: "Looking forward to it 🌷 see you then!", time: '14:11' },
    { dir: 'out', text: "Hope you loved your visit! Tap to rebook or leave a review ⭐", time: '17:45', tick: '✓' },
  ];

  return (
    <div className={`transition-opacity duration-500 ${active ? 'opacity-100' : 'opacity-0'}`}>
      <div
        className="rounded-t-lg px-3 py-2 flex items-center gap-2 transition-all duration-500"
        style={{
          backgroundColor: SAGE,
          transform: active ? 'translateY(0)' : 'translateY(-8px)',
          opacity: active ? 1 : 0,
        }}
      >
        <div className="w-6 h-6 rounded-full bg-white/20 flex items-center justify-center text-[8px] font-bold text-white">SC</div>
        <div className="flex-1">
          <p className="text-[10px] font-semibold text-white">Sarah Chen</p>
          <p className="text-[8px] text-white/70">via Glow Aesthetics</p>
        </div>
        <span className="material-symbols-outlined text-white/80 text-base">chat</span>
      </div>

      <div
        className="rounded-b-lg p-2.5 space-y-1.5"
        style={{
          backgroundColor: 'rgba(255,255,255,0.03)',
          backgroundImage:
            'radial-gradient(rgba(255,255,255,0.04) 1px, transparent 1px)',
          backgroundSize: '14px 14px',
          minHeight: 200,
        }}
      >
        {messages.map((m, i) => (
          <div
            key={i}
            className={`flex transition-all duration-500 ${m.dir === 'out' ? 'justify-end' : 'justify-start'}`}
            style={{
              transform: active ? 'translateY(0)' : 'translateY(10px)',
              opacity: active ? 1 : 0,
              transitionDelay: `${200 + i * 140}ms`,
            }}
          >
            <div
              className="rounded-lg px-2.5 py-1.5 max-w-[78%]"
              style={{
                backgroundColor:
                  m.dir === 'out' ? `rgba(${SAGE_RGB}, 0.28)` : 'rgba(255,255,255,0.08)',
                border:
                  m.dir === 'out'
                    ? `1px solid rgba(${SAGE_RGB}, 0.4)`
                    : '1px solid rgba(255,255,255,0.06)',
              }}
            >
              <p className="text-[9px] text-white/85 leading-snug">{m.text}</p>
              <div className="flex items-center justify-end gap-1 mt-0.5">
                <span className="text-[7px] text-white/35">{m.time}</span>
                {m.tick && (
                  <span className="text-[8px]" style={{ color: m.tick === '✓✓' ? SAGE : 'rgba(255,255,255,0.4)' }}>{m.tick}</span>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function StaffScreen({ active }: { active: boolean }) {
  const staff = [
    { name: 'Dr. Lim Wei Hua', role: 'Aesthetician', bookings: 8, status: 'On shift', accent: true },
    { name: 'Wei Lin Tan', role: 'Therapist', bookings: 6, status: 'Lunch', accent: false },
    { name: 'Priya Nair', role: 'Therapist', bookings: 4, status: 'On shift', accent: true },
    { name: 'Mei Han Ong', role: 'Manager', bookings: null, status: 'On shift', accent: true },
    { name: 'Jasmine Koh', role: 'Receptionist', bookings: null, status: 'Off today', accent: false },
  ];

  return (
    <div className={`transition-opacity duration-500 ${active ? 'opacity-100' : 'opacity-0'}`}>
      <div
        className="flex items-center justify-between mb-2 transition-all duration-500"
        style={{ transform: active ? 'translateY(0)' : 'translateY(-8px)', opacity: active ? 1 : 0 }}
      >
        <div>
          <p className="text-[10px] font-semibold text-white/85">Today&rsquo;s Team</p>
          <p className="text-[8px] text-white/40">Tue, 22 Apr · 4 on shift</p>
        </div>
        <span
          className="text-[8px] px-2 py-0.5 rounded-full"
          style={{ backgroundColor: `rgba(${SAGE_RGB}, 0.22)`, color: SAGE }}
        >
          + Add staff
        </span>
      </div>

      <div className="space-y-1">
        {staff.map((s, i) => (
          <div
            key={s.name}
            className="flex items-center gap-2 bg-white/5 rounded-lg px-2.5 py-1.5 transition-all duration-500"
            style={{
              transform: active ? 'translateX(0)' : 'translateX(-12px)',
              opacity: active ? 1 : 0,
              transitionDelay: `${120 + i * 80}ms`,
            }}
          >
            <div
              className="w-6 h-6 rounded-full flex items-center justify-center text-[8px] font-bold"
              style={{
                backgroundColor: s.accent ? `rgba(${SAGE_RGB}, 0.3)` : 'rgba(255,255,255,0.08)',
                color: s.accent ? SAGE : 'rgba(255,255,255,0.55)',
              }}
            >
              {s.name.split(' ').map(p => p[0]).slice(0, 2).join('')}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[10px] font-medium text-white/85 truncate">{s.name}</p>
              <p className="text-[8px] text-white/40">{s.role}</p>
            </div>
            {s.bookings !== null && (
              <div className="text-right">
                <p className="text-[10px] font-semibold text-white/80">{s.bookings}</p>
                <p className="text-[7px] text-white/35 leading-none">today</p>
              </div>
            )}
            <span
              className="text-[8px] px-1.5 py-0.5 rounded-full whitespace-nowrap"
              style={{
                backgroundColor:
                  s.status === 'On shift'
                    ? `rgba(${SAGE_RGB}, 0.22)`
                    : s.status === 'Lunch'
                      ? 'rgba(255,255,255,0.06)'
                      : 'rgba(255,255,255,0.03)',
                color:
                  s.status === 'On shift'
                    ? SAGE
                    : s.status === 'Lunch'
                      ? 'rgba(255,255,255,0.6)'
                      : 'rgba(255,255,255,0.35)',
              }}
            >
              {s.status}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function SidebarIcon({ id, activeId }: { id: typeof SCREENS[number]['id']; activeId: string }) {
  const isActive = activeId === id;
  const className = `w-3.5 h-3.5 ${isActive ? '' : 'text-white/30'}`;
  const style = isActive ? { color: SAGE } : undefined;
  const common = { fill: 'none' as const, viewBox: '0 0 24 24', strokeWidth: 1.5, stroke: 'currentColor' as const };

  switch (id) {
    case 'analytics':
      return (
        <svg className={className} style={style} {...common}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z" />
        </svg>
      );
    case 'calendar':
      return (
        <svg className={className} style={style} {...common}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 11.25v7.5" />
        </svg>
      );
    case 'campaigns':
      return (
        <svg className={className} style={style} {...common}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M10.34 15.84c-.688-.06-1.386-.09-2.09-.09H7.5a4.5 4.5 0 110-9h.75c.704 0 1.402-.03 2.09-.09m0 9.18c.253.962.584 1.892.985 2.783.247.55.06 1.21-.463 1.511l-.657.38c-.551.318-1.26.117-1.527-.461a20.845 20.845 0 01-1.44-4.282m3.102.069a18.03 18.03 0 01-.59-4.59c0-1.586.205-3.124.59-4.59m0 9.18a23.848 23.848 0 018.835 2.535M10.34 6.66a23.847 23.847 0 018.835-2.535m0 0A23.74 23.74 0 0118.795 3c1.167 0 2.301.068 3.268.2M19.175 4.125c.027.406.044.813.05 1.221M19.175 4.125a23.704 23.704 0 00-.05 14.75m0 0c-.005.408-.022.815-.05 1.221" />
        </svg>
      );
    case 'booking':
      return (
        <svg className={className} style={style} {...common}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9.879 7.519c1.171-1.025 3.071-1.025 4.242 0 1.172 1.025 1.172 2.687 0 3.712-.203.179-.43.326-.67.442-.745.361-1.45.999-1.45 1.827v.75M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9 5.25h.008v.008H12v-.008z" />
        </svg>
      );
    case 'whatsapp':
      return (
        <svg className={className} style={style} {...common}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12.76c0 1.6 1.123 2.994 2.707 3.227 1.087.16 2.185.283 3.293.369V21l4.184-4.183a1.14 1.14 0 01.778-.332 48.294 48.294 0 005.83-.498c1.585-.233 2.708-1.626 2.708-3.228V6.741c0-1.602-1.123-2.995-2.707-3.228A48.394 48.394 0 0012 3c-2.392 0-4.744.175-7.043.513C3.373 3.746 2.25 5.14 2.25 6.741v6.018z" />
        </svg>
      );
    case 'staff':
      return (
        <svg className={className} style={style} {...common}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z" />
        </svg>
      );
  }
}

export default function ProductShowcase() {
  const [activeIdx, setActiveIdx] = useState(0);
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    const interval = setInterval(() => {
      setActiveIdx(prev => (prev + 1) % SCREENS.length);
    }, 4500);
    return () => clearInterval(interval);
  }, []);

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

  const activeId = SCREENS[activeIdx].id;

  return (
    <div id="product-showcase" className="w-full max-w-[589px] mx-auto">
      <div
        className={`bg-[#0a0a0a] rounded-2xl border border-white/10 shadow-2xl shadow-black/40 overflow-hidden transition-all duration-700 ${
          isVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-8'
        }`}
      >
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

        <div className="flex" style={{ minHeight: 322 }}>
          <div className="w-12 bg-white/[0.02] border-r border-white/5 py-3 flex flex-col items-center gap-2">
            <div
              className="w-5 h-5 rounded flex items-center justify-center mb-2"
              style={{ backgroundColor: `rgba(${SAGE_RGB}, 0.22)` }}
            >
              <span className="text-[8px] font-bold" style={{ color: SAGE }}>G</span>
            </div>
            {SCREENS.map((s, i) => (
              <button
                key={s.id}
                onClick={() => setActiveIdx(i)}
                className={`w-7 h-7 rounded-md flex items-center justify-center transition-all duration-300 ${
                  activeIdx === i ? 'bg-white/10' : 'hover:bg-white/5'
                }`}
              >
                <SidebarIcon id={s.id} activeId={activeId} />
              </button>
            ))}
          </div>

          <div className="flex-1 p-3 relative">
            <div className="flex items-center gap-2 mb-3">
              <p className="text-xs font-semibold text-white/80">{SCREENS[activeIdx].label}</p>
              <div className="flex-1" />
              <div className="flex gap-1">
                {SCREENS.map((_, i) => (
                  <button
                    key={i}
                    onClick={() => setActiveIdx(i)}
                    className="h-1.5 rounded-full transition-all duration-300"
                    style={{
                      width: activeIdx === i ? 16 : 6,
                      backgroundColor: activeIdx === i ? SAGE : 'rgba(255,255,255,0.2)',
                    }}
                  />
                ))}
              </div>
            </div>

            <div className="relative" style={{ minHeight: 253 }}>
              <div className="absolute inset-0"><AnalyticsScreen active={activeIdx === 0} /></div>
              <div className="absolute inset-0"><CalendarScreen active={activeIdx === 1} /></div>
              <div className="absolute inset-0"><CampaignsScreen active={activeIdx === 2} /></div>
              <div className="absolute inset-0"><BookingScreen active={activeIdx === 3} /></div>
              <div className="absolute inset-0"><WhatsAppScreen active={activeIdx === 4} /></div>
              <div className="absolute inset-0"><StaffScreen active={activeIdx === 5} /></div>
            </div>
          </div>
        </div>
      </div>

      <div className="flex justify-center flex-wrap gap-2 mt-4">
        {SCREENS.map((s, i) => {
          const isActive = activeIdx === i;
          return (
            <button
              key={s.id}
              onClick={() => setActiveIdx(i)}
              className="text-[11px] px-3 py-1.5 rounded-full transition-all duration-300"
              style={{
                backgroundColor: isActive ? `rgba(${SAGE_RGB}, 0.18)` : 'transparent',
                color: isActive ? SAGE : 'rgb(156, 163, 175)',
                border: isActive ? `1px solid rgba(${SAGE_RGB}, 0.45)` : '1px solid rgb(209, 213, 219)',
              }}
            >
              {s.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
