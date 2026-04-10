import Link from 'next/link';
import NavBar from './components/NavBar';
import AnimateOnScroll from './components/AnimateOnScroll';
import FloatingCTA from './components/FloatingCTA';
import TestimonialCarousel from './components/TestimonialCarousel';
import ParallaxSection from './components/ParallaxSection';
import ButtonRipple from './components/ButtonRipple';

// ─── Static data ────────────────────────────────────────────────────────────

const FEATURES = [
  {
    tag: 'Google Integration',
    title: 'Get Booked Directly from Google',
    description:
      'When guests search for your business, your booking button appears right in Google Maps and Search. Whether it\'s a dinner reservation, a haircut, or a facial — they book in seconds without ever calling.',
    details: ['Reserve with Google', 'Instant confirmation', 'No app needed'],
    icon: (
      <svg className="w-7 h-7" fill="none" viewBox="0 0 24 24" strokeWidth={1.2} stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" d="M15 10.5a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
        <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 1 1 15 0Z" />
      </svg>
    ),
  },
  {
    tag: 'VIP Intelligence',
    title: 'Know Your Best Clients Before They Walk In',
    description:
      'AI scores every client based on spend, frequency, and loyalty signals. Know exactly who your VIPs are, which guests are drifting away, and where to focus your energy — across every location.',
    details: ['Client scoring', 'Churn alerts', 'Lifetime value'],
    icon: (
      <svg className="w-7 h-7" fill="none" viewBox="0 0 24 24" strokeWidth={1.2} stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904 9 18.75l-.813-2.846a4.5 4.5 0 0 0-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 0 0 3.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 0 0 3.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 0 0-3.09 3.09ZM18.259 8.715 18 9.75l-.259-1.035a3.375 3.375 0 0 0-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 0 0 2.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 0 0 2.455 2.456L21.75 6l-1.036.259a3.375 3.375 0 0 0-2.455 2.456Z" />
      </svg>
    ),
  },
  {
    tag: 'Smart Campaigns',
    title: 'Win Back Lapsed Clients on Autopilot',
    description:
      'AI-powered WhatsApp and SMS campaigns that send at the right moment with the right message. Remind a diner about your new tasting menu, or bring a spa client back for their next treatment — automatically.',
    details: ['WhatsApp campaigns', 'Auto triggers', 'A/B testing'],
    icon: (
      <svg className="w-7 h-7" fill="none" viewBox="0 0 24 24" strokeWidth={1.2} stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 8.25h9m-9 3H12m-9.75 1.51c0 1.6 1.123 2.994 2.707 3.227 1.129.166 2.27.293 3.423.379.35.026.67.21.865.501L12 21l2.755-4.133a1.14 1.14 0 0 1 .865-.501 48.172 48.172 0 0 0 3.423-.379c1.584-.233 2.707-1.626 2.707-3.228V6.741c0-1.602-1.123-2.995-2.707-3.228A48.394 48.394 0 0 0 12 3c-2.392 0-4.744.175-7.043.513C3.373 3.746 2.25 5.14 2.25 6.741v6.018Z" />
      </svg>
    ),
  },
  {
    tag: 'Real-time Dashboard',
    title: 'Your Entire Operation, One Screen',
    description:
      'Bookings, staff schedules, client history, revenue analytics — all in a single, beautifully designed dashboard. Whether you\'re managing tables, chairs, or treatment rooms, every decision is backed by data.',
    details: ['Live bookings', 'Staff management', 'Revenue reports'],
    icon: (
      <svg className="w-7 h-7" fill="none" viewBox="0 0 24 24" strokeWidth={1.2} stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6A2.25 2.25 0 0 1 6 3.75h2.25A2.25 2.25 0 0 1 10.5 6v2.25a2.25 2.25 0 0 1-2.25 2.25H6a2.25 2.25 0 0 1-2.25-2.25V6ZM3.75 15.75A2.25 2.25 0 0 1 6 13.5h2.25a2.25 2.25 0 0 1 2.25 2.25V18a2.25 2.25 0 0 1-2.25 2.25H6A2.25 2.25 0 0 1 3.75 18v-2.25ZM13.5 6a2.25 2.25 0 0 1 2.25-2.25H18A2.25 2.25 0 0 1 20.25 6v2.25A2.25 2.25 0 0 1 18 10.5h-2.25a2.25 2.25 0 0 1-2.25-2.25V6ZM13.5 15.75a2.25 2.25 0 0 1 2.25-2.25H18a2.25 2.25 0 0 1 2.25 2.25V18A2.25 2.25 0 0 1 18 20.25h-2.25a2.25 2.25 0 0 1-2.25-2.25v-2.25Z" />
      </svg>
    ),
  },
];

const STEPS = [
  {
    number: '01',
    title: 'Set up your business in minutes',
    description: 'Add your services, set your availability, and invite your team. Restaurant menus, spa treatments, clinic procedures — all in one place.',
  },
  {
    number: '02',
    title: 'Share your booking link everywhere',
    description: 'Get a custom booking page. Embed it on your website, share on Instagram, drop it in WhatsApp — your clients book from wherever they find you.',
  },
  {
    number: '03',
    title: 'Guests book, you focus on what matters',
    description: 'Clients book and pay online. You get notified instantly. No phone tag, no double-bookings, no manual scheduling.',
  },
];

const PLANS = [
  {
    name: 'Starter',
    price: '$49',
    period: '/mo',
    tagline: 'For solo operators',
    features: ['Up to 2 staff members', 'Online booking widget', 'Automated reminders', 'Basic analytics', 'Email support'],
    cta: 'Start Free Trial',
    href: '/signup',
    popular: false,
  },
  {
    name: 'Pro',
    price: '$99',
    period: '/mo',
    tagline: 'For growing businesses',
    features: ['Unlimited staff', 'VIP scoring & insights', 'WhatsApp & SMS campaigns', 'Google Reserve', 'Advanced analytics', 'Priority support'],
    cta: 'Start Free Trial',
    href: '/signup',
    popular: true,
  },
  {
    name: 'Business',
    price: '$199',
    period: '/mo',
    tagline: 'Multi-location',
    features: ['Everything in Pro', 'Daily payouts', 'Google Actions', 'Multi-location', 'Custom domain', 'Dedicated manager'],
    cta: 'Contact Sales',
    href: '/signup',
    popular: false,
  },
];

const STATS = [
  { value: '2,400+', label: 'Businesses onboard' },
  { value: '98%', label: 'Client satisfaction' },
  { value: '$4.2M', label: 'Processed monthly' },
  { value: '10K+', label: 'Weekly bookings' },
];

const TESTIMONIALS = [
  {
    quote: 'Since switching to GlowOS, our no-show rate dropped by 60% and we\u2019re filling 30% more slots every week. It\u2019s like having a full-time front desk \u2014 except it never sleeps.',
    name: 'Jessica Ng',
    role: 'Owner, Lumi\u00e8re Wellness \u00b7 Orchard Road',
    initial: 'J',
  },
  {
    quote: 'The VIP scoring changed everything. We now know exactly which clients to prioritize, and our repeat bookings are up 45% in just three months.',
    name: 'David Lim',
    role: 'Founder, The Gentlemen\u2019s Club Barbershop \u00b7 Tanjong Pagar',
    initial: 'D',
  },
  {
    quote: 'Our Google bookings went from zero to 40% of total appointments within the first month. The setup took literally five minutes.',
    name: 'Rachel Tan',
    role: 'Manager, Bloom Nail Studio \u00b7 Tiong Bahru',
    initial: 'R',
  },
];

// ─── Page ────────────────────────────────────────────────────────────────────

export default function HomePage() {
  return (
    <div className="min-h-screen bg-[var(--surface)] text-white grain-overlay">
      <NavBar />
      <FloatingCTA />

      {/* ── Hero ─────────────────────────────────────────────────────────── */}
      <section className="relative min-h-screen flex items-center overflow-hidden">
        {/* Atmospheric background layers */}
        <div className="absolute inset-0">
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_70%_50%_at_50%_-10%,rgba(196,167,120,0.07),transparent)]" />
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_40%_40%_at_80%_50%,rgba(196,167,120,0.04),transparent)]" />
          <div className="absolute inset-0 bg-[linear-gradient(to_right,rgba(255,255,255,0.008)_1px,transparent_1px),linear-gradient(to_bottom,rgba(255,255,255,0.008)_1px,transparent_1px)] bg-[size:80px_80px]" />
          {/* Extra depth layer - diagonal gradient */}
          <div className="absolute inset-0 bg-[linear-gradient(135deg,rgba(196,167,120,0.03)_0%,transparent_40%,transparent_60%,rgba(196,167,120,0.02)_100%)]" />
        </div>

        {/* Floating ambient orbs with parallax */}
        <ParallaxSection speed={0.2} className="absolute inset-0 pointer-events-none">
          <div className="absolute top-[20%] left-[10%] w-[500px] h-[500px] bg-[var(--gold)]/[0.03] rounded-full blur-[150px] animate-subtle-float" />
          <div className="absolute bottom-[15%] right-[5%] w-[400px] h-[400px] bg-[var(--gold)]/[0.02] rounded-full blur-[120px] animate-subtle-float delay-400" />
          <div className="absolute top-[60%] left-[50%] w-[300px] h-[300px] bg-[var(--gold)]/[0.015] rounded-full blur-[100px] animate-subtle-float delay-700" />
        </ParallaxSection>

        <div className="relative max-w-7xl mx-auto px-6 lg:px-8 pt-32 pb-20 lg:pt-36 lg:pb-28">
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-20 xl:gap-16 items-center">
            {/* Text side */}
            <div>
              {/* Overline */}
              <div className="animate-hero-load flex items-center gap-3 mb-12">
                <span className="block w-10 h-px bg-[var(--gold)]/60 animate-line-grow delay-300" />
                <span className="text-[11px] font-medium tracking-[0.25em] uppercase text-[var(--gold)] opacity-80">
                  The operating system for service businesses
                </span>
              </div>

              {/* Headline — editorial scale */}
              <h1 className="animate-hero-load delay-200 mb-8">
                <span className="block text-[clamp(3rem,7vw,5.5rem)] font-[family-name:var(--font-display)] font-light leading-[0.95] tracking-tight text-white/90">
                  Your business,
                </span>
                <span className="block text-[clamp(3rem,7vw,5.5rem)] font-[family-name:var(--font-display)] italic font-light leading-[0.95] tracking-tight text-gradient-gold">
                  fully booked.
                </span>
              </h1>

              {/* Subheadline */}
              <p className="animate-hero-load delay-300 text-[17px] text-neutral-500 leading-[1.7] mb-14 max-w-md font-light">
                Whether you run a restaurant, salon, clinic, or spa — GlowOS
                gives you Google bookings, VIP client intelligence, and AI-powered
                campaigns that fill your calendar automatically.
              </p>

              {/* CTAs */}
              <div className="animate-hero-load delay-500 flex flex-col sm:flex-row gap-4 mb-14">
                <ButtonRipple color="rgba(10,10,10,0.15)">
                  <Link
                    href="/signup"
                    className="btn-glow group inline-flex items-center justify-center gap-3 bg-[var(--gold)] hover:bg-[var(--gold-light)] px-8 py-4 rounded-xl text-[14px] font-medium text-[#0a0a0a] transition-all duration-500 hover:shadow-xl hover:shadow-[var(--gold)]/20 hover:-translate-y-px min-h-[48px]"
                  >
                    Start Free Trial
                    <svg className="w-4 h-4 group-hover:translate-x-1 transition-transform duration-500" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5 21 12m0 0-7.5 7.5M21 12H3" />
                    </svg>
                  </Link>
                </ButtonRipple>
                <a
                  href="#how-it-works"
                  className="inline-flex items-center justify-center gap-3 border border-white/[0.08] hover:border-[var(--gold)]/30 bg-white/[0.02] hover:bg-white/[0.04] px-8 py-4 rounded-xl text-[14px] font-medium text-neutral-400 hover:text-white transition-all duration-500 min-h-[48px]"
                >
                  See How It Works
                </a>
              </div>

              {/* Trust micro-copy */}
              <div className="animate-hero-load delay-700 flex items-center gap-6 text-[12px] text-neutral-600 tracking-wide">
                <span>No credit card</span>
                <span className="w-1 h-1 rounded-full bg-neutral-700" />
                <span>14-day trial</span>
                <span className="w-1 h-1 rounded-full bg-neutral-700" />
                <span>Cancel anytime</span>
              </div>
            </div>

            {/* Dashboard mockup */}
            <div className="animate-hero-load delay-600 relative hidden lg:block">
              <ParallaxSection speed={0.08}>
              {/* Glow behind card */}
              <div className="absolute -inset-8 bg-gradient-to-br from-[var(--gold)]/[0.06] via-transparent to-[var(--gold)]/[0.03] rounded-3xl blur-3xl" />

              <div className="relative rounded-2xl border border-white/[0.06] bg-[var(--surface-raised)]/90 backdrop-blur-xl overflow-hidden shadow-2xl shadow-black/50 animate-subtle-float card-hover-lift">
                {/* Window chrome */}
                <div className="flex items-center gap-2 px-5 py-4 border-b border-white/[0.04]">
                  <div className="flex gap-1.5">
                    <div className="w-2.5 h-2.5 rounded-full bg-[#ff5f57]/70" />
                    <div className="w-2.5 h-2.5 rounded-full bg-[#febc2e]/70" />
                    <div className="w-2.5 h-2.5 rounded-full bg-[#28c840]/70" />
                  </div>
                  <div className="ml-4 flex-1 h-3.5 rounded-full bg-white/[0.03]" />
                </div>

                {/* Stats row */}
                <div className="grid grid-cols-3 gap-3 p-5">
                  {[
                    { label: 'Bookings today', value: '24' },
                    { label: 'Revenue', value: 'S$3,240' },
                    { label: 'VIP clients', value: '47' },
                  ].map((s) => (
                    <div key={s.label} className="rounded-xl bg-white/[0.025] border border-white/[0.04] p-4 hover:border-[var(--gold)]/10 hover:bg-white/[0.035] transition-all duration-500">
                      <div className="text-[10px] text-neutral-600 mb-2 tracking-wider uppercase">{s.label}</div>
                      <div className="text-xl font-medium text-white">{s.value}</div>
                    </div>
                  ))}
                </div>

                {/* Booking list */}
                <div className="px-5 pb-5 space-y-1">
                  {[
                    { name: 'Sarah Tan', service: 'Deep Tissue Massage', time: '10:00 AM', status: 'Confirmed' },
                    { name: 'Mei Ling', service: 'Table for 4', time: '11:30 AM', status: 'VIP' },
                    { name: 'Priya K.', service: 'Balayage + Cut', time: '2:00 PM', status: 'Confirmed' },
                    { name: 'Dr. Chen', service: 'Consultation', time: '3:30 PM', status: 'New' },
                  ].map((b) => (
                    <div key={b.name} className="flex items-center justify-between rounded-lg bg-white/[0.015] hover:bg-white/[0.03] transition-all duration-300 px-4 py-3 group/row">
                      <div className="flex items-center gap-3">
                        <div className="w-7 h-7 rounded-full bg-gradient-to-br from-[var(--gold)] to-[var(--gold-dark)] flex items-center justify-center text-[10px] font-semibold text-white group-hover/row:shadow-md group-hover/row:shadow-[var(--gold)]/10 transition-shadow duration-300">
                          {b.name[0]}
                        </div>
                        <div>
                          <div className="text-[13px] font-medium text-neutral-200">{b.name}</div>
                          <div className="text-[11px] text-neutral-600">{b.service} &middot; {b.time}</div>
                        </div>
                      </div>
                      <span className={`text-[10px] font-medium px-2.5 py-1 rounded-full tracking-wide ${
                        b.status === 'VIP'
                          ? 'bg-[var(--gold)]/10 text-[var(--gold)]'
                          : b.status === 'New'
                          ? 'bg-emerald-500/8 text-emerald-400/80'
                          : 'bg-white/[0.04] text-neutral-500'
                      }`}>
                        {b.status}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
              </ParallaxSection>
            </div>
          </div>
        </div>

        {/* Scroll indicator */}
        <div className="absolute bottom-10 left-1/2 -translate-x-1/2 flex flex-col items-center gap-3">
          <span className="text-[10px] text-neutral-600 tracking-[0.2em] uppercase">Scroll</span>
          <div className="w-px h-12 bg-gradient-to-b from-neutral-600/50 to-transparent animate-scroll-indicator" />
        </div>
      </section>

      {/* ── Divider ──────────────────────────────────────────────────────── */}
      <div className="gold-line max-w-7xl mx-auto" />

      {/* ── Social Proof Bar ──────────────────────────────────────────────── */}
      <section className="py-20 lg:py-28 bg-depth-1">
        <div className="max-w-7xl mx-auto px-6 lg:px-8">
          <AnimateOnScroll animation="fade-in">
            <p className="text-center text-[10px] font-medium tracking-[0.3em] uppercase text-neutral-600 mb-14">
              Trusted by leading service businesses
            </p>
          </AnimateOnScroll>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-12 md:gap-4">
            {STATS.map((stat, i) => (
              <AnimateOnScroll key={stat.label} animation="fade-up" delay={i * 120}>
                <div className="text-center group cursor-default">
                  <div className="text-4xl lg:text-5xl font-[family-name:var(--font-display)] font-light text-white mb-3 group-hover:text-gradient-gold transition-colors duration-700">
                    {stat.value}
                  </div>
                  <div className="text-[12px] text-neutral-600 tracking-wide group-hover:text-neutral-500 transition-colors duration-500">{stat.label}</div>
                </div>
              </AnimateOnScroll>
            ))}
          </div>
        </div>
      </section>

      {/* ── Divider ──────────────────────────────────────────────────────── */}
      <div className="gold-line max-w-7xl mx-auto" />

      {/* ── Features ─────────────────────────────────────────────────────── */}
      <section id="features" className="py-32 lg:py-44">
        <div className="max-w-7xl mx-auto px-6 lg:px-8">
          <AnimateOnScroll animation="fade-up" className="text-center mb-28">
            <div className="flex items-center justify-center gap-4 mb-6">
              <span className="w-12 h-px bg-[var(--gold)]/30" />
              <span className="text-[10px] font-medium tracking-[0.3em] uppercase text-[var(--gold)]">
                Platform
              </span>
              <span className="w-12 h-px bg-[var(--gold)]/30" />
            </div>
            <h2 className="text-4xl lg:text-6xl font-[family-name:var(--font-display)] font-light tracking-tight mb-7">
              Everything you need to{' '}
              <em className="not-italic text-gradient-gold">grow</em>
            </h2>
            <p className="text-[16px] text-neutral-500 max-w-lg mx-auto font-light leading-relaxed">
              Purpose-built for service businesses. Every feature designed around how restaurants, salons, clinics, and spas actually operate.
            </p>
          </AnimateOnScroll>

          <div className="space-y-36">
            {FEATURES.map((feature, idx) => {
              const isFlipped = idx % 2 === 1;
              return (
                <div
                  key={feature.title}
                  className={`grid lg:grid-cols-2 gap-16 lg:gap-24 items-center ${
                    isFlipped ? 'lg:grid-flow-dense' : ''
                  }`}
                >
                  {/* Text side */}
                  <AnimateOnScroll
                    animation={isFlipped ? 'slide-in-right' : 'slide-in-left'}
                    className={isFlipped ? 'lg:col-start-2' : ''}
                  >
                    <div className="flex items-center gap-3 mb-8">
                      <span className="w-8 h-px bg-[var(--gold)]/40" />
                      <span className="text-[10px] font-medium tracking-[0.25em] uppercase text-[var(--gold)] opacity-80">
                        {feature.tag}
                      </span>
                    </div>
                    <h3 className="text-3xl lg:text-[42px] font-[family-name:var(--font-display)] font-light leading-[1.1] mb-7">
                      {feature.title}
                    </h3>
                    <p className="text-[16px] text-neutral-500 leading-[1.8] mb-10 font-light">
                      {feature.description}
                    </p>
                    <div className="flex flex-wrap gap-3">
                      {feature.details.map((d) => (
                        <span
                          key={d}
                          className="inline-flex items-center gap-2 text-[12px] text-neutral-400 bg-white/[0.02] border border-white/[0.05] rounded-full px-4 py-2 tracking-wide hover:border-[var(--gold)]/15 hover:text-neutral-300 transition-all duration-500"
                        >
                          <span className="w-1 h-1 rounded-full bg-[var(--gold)]/60" />
                          {d}
                        </span>
                      ))}
                    </div>
                  </AnimateOnScroll>

                  {/* Visual side */}
                  <AnimateOnScroll
                    animation={isFlipped ? 'slide-in-left' : 'slide-in-right'}
                    className={isFlipped ? 'lg:col-start-1 lg:row-start-1' : ''}
                  >
                    <div className="relative group">
                      <div className="absolute -inset-4 bg-gradient-to-br from-[var(--gold)]/[0.04] to-transparent rounded-3xl blur-2xl opacity-0 group-hover:opacity-100 transition-opacity duration-1000" />
                      <div className="relative rounded-2xl border border-white/[0.05] bg-[var(--surface-raised)]/40 overflow-hidden aspect-[4/3] flex items-center justify-center group-hover:border-white/[0.08] transition-all duration-700 card-hover-lift">
                        <div className="text-center">
                          <div className="w-20 h-20 rounded-2xl bg-[var(--gold)]/[0.06] border border-[var(--gold)]/[0.12] flex items-center justify-center mx-auto mb-6 text-[var(--gold)]/70 group-hover:scale-110 group-hover:text-[var(--gold)] group-hover:border-[var(--gold)]/25 group-hover:bg-[var(--gold)]/[0.1] transition-all duration-700 glow-dot">
                            {feature.icon}
                          </div>
                          <div className="text-[12px] font-light text-neutral-600 tracking-widest uppercase">{feature.tag}</div>
                        </div>
                        {/* Subtle grid */}
                        <div className="absolute inset-0 bg-[linear-gradient(to_right,rgba(255,255,255,0.01)_1px,transparent_1px),linear-gradient(to_bottom,rgba(255,255,255,0.01)_1px,transparent_1px)] bg-[size:56px_56px]" />
                        {/* Hover shimmer */}
                        <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-1000 animate-shimmer" />
                      </div>
                    </div>
                  </AnimateOnScroll>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* ── Divider ──────────────────────────────────────────────────────── */}
      <div className="gold-line max-w-7xl mx-auto" />

      {/* ── How It Works ─────────────────────────────────────────────────── */}
      <section id="how-it-works" className="py-32 lg:py-44 bg-depth-2">
        <div className="max-w-7xl mx-auto px-6 lg:px-8">
          <AnimateOnScroll animation="fade-up" className="text-center mb-28">
            <div className="flex items-center justify-center gap-4 mb-6">
              <span className="w-12 h-px bg-[var(--gold)]/30" />
              <span className="text-[10px] font-medium tracking-[0.3em] uppercase text-[var(--gold)]">
                Process
              </span>
              <span className="w-12 h-px bg-[var(--gold)]/30" />
            </div>
            <h2 className="text-4xl lg:text-6xl font-[family-name:var(--font-display)] font-light tracking-tight mb-7">
              Up and running in <em className="not-italic text-gradient-gold">minutes</em>
            </h2>
            <p className="text-[16px] text-neutral-500 max-w-md mx-auto font-light leading-relaxed">
              No complicated setup. No IT team needed. Just sign up and go.
            </p>
          </AnimateOnScroll>

          <div className="grid md:grid-cols-3 gap-8 lg:gap-20 relative">
            {/* Connector line */}
            <div className="hidden md:block absolute top-14 left-[22%] right-[22%] h-px">
              <AnimateOnScroll animation="fade-in" delay={400}>
                <div className="h-px w-full bg-gradient-to-r from-transparent via-[var(--gold)]/15 to-transparent" />
              </AnimateOnScroll>
            </div>

            {STEPS.map((step, idx) => (
              <AnimateOnScroll key={step.number} animation="scale-up" delay={idx * 200}>
                <div className="relative text-center group">
                  <div className="relative inline-flex mb-12">
                    {/* Glow ring on hover */}
                    <div className="absolute inset-0 rounded-2xl bg-[var(--gold)]/[0.06] blur-xl opacity-0 group-hover:opacity-100 transition-opacity duration-700" />
                    <div className="relative w-24 h-24 rounded-2xl bg-white/[0.02] border border-white/[0.05] flex items-center justify-center group-hover:border-[var(--gold)]/20 group-hover:bg-[var(--gold)]/[0.03] transition-all duration-700 group-hover:scale-105">
                      <span className="text-3xl font-[family-name:var(--font-display)] font-light text-[var(--gold)]/60 group-hover:text-[var(--gold)] transition-colors duration-700">
                        {step.number}
                      </span>
                    </div>
                    {/* Step progress dot */}
                    <div className="absolute -bottom-3 left-1/2 -translate-x-1/2 w-2 h-2 rounded-full bg-[var(--gold)]/30 group-hover:bg-[var(--gold)] group-hover:shadow-md group-hover:shadow-[var(--gold)]/20 transition-all duration-500" />
                  </div>
                  <h3 className="text-lg font-medium text-white mb-4 tracking-tight">{step.title}</h3>
                  <p className="text-neutral-500 leading-relaxed font-light text-[15px]">{step.description}</p>
                </div>
              </AnimateOnScroll>
            ))}
          </div>
        </div>
      </section>

      {/* ── Divider ──────────────────────────────────────────────────────── */}
      <div className="gold-line max-w-7xl mx-auto" />

      {/* ── Pricing ──────────────────────────────────────────────────────── */}
      <section id="pricing" className="py-32 lg:py-44">
        <div className="max-w-7xl mx-auto px-6 lg:px-8">
          <AnimateOnScroll animation="fade-up" className="text-center mb-24">
            <div className="flex items-center justify-center gap-4 mb-6">
              <span className="w-12 h-px bg-[var(--gold)]/30" />
              <span className="text-[10px] font-medium tracking-[0.3em] uppercase text-[var(--gold)]">
                Pricing
              </span>
              <span className="w-12 h-px bg-[var(--gold)]/30" />
            </div>
            <h2 className="text-4xl lg:text-6xl font-[family-name:var(--font-display)] font-light tracking-tight mb-7">
              Simple, <em className="not-italic text-gradient-gold">transparent</em> pricing
            </h2>
            <p className="text-[16px] text-neutral-500 font-light">
              Start free. No credit card required. Cancel anytime.
            </p>
          </AnimateOnScroll>

          <div className="grid md:grid-cols-3 gap-6 lg:gap-8 items-start">
            {PLANS.map((plan, idx) => (
              <AnimateOnScroll key={plan.name} animation="fade-up" delay={idx * 120}>
                <div
                  className={`relative rounded-2xl p-8 lg:p-10 transition-all duration-700 group card-hover-lift ${
                    plan.popular
                      ? 'bg-gradient-to-b from-[var(--gold)]/[0.06] to-transparent border border-[var(--gold)]/20 hover:border-[var(--gold)]/35'
                      : 'bg-white/[0.015] border border-white/[0.05] hover:border-white/[0.1]'
                  }`}
                >
                  {plan.popular && (
                    <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                      <span className="inline-flex text-[10px] font-semibold text-[#0a0a0a] bg-[var(--gold)] rounded-full px-4 py-1.5 tracking-[0.1em] uppercase shadow-lg shadow-[var(--gold)]/15">
                        Most Popular
                      </span>
                    </div>
                  )}

                  <div className="mb-10">
                    <h3 className="text-lg font-medium text-white mb-1 tracking-tight">{plan.name}</h3>
                    <p className="text-[12px] text-neutral-600 mb-8 tracking-wide">{plan.tagline}</p>
                    <div className="flex items-end gap-1">
                      <span className="text-5xl font-[family-name:var(--font-display)] font-light text-white">{plan.price}</span>
                      <span className="text-neutral-600 mb-2 text-sm">{plan.period}</span>
                    </div>
                  </div>

                  <ul className="space-y-4 mb-10">
                    {plan.features.map((feature) => (
                      <li key={feature} className="flex items-start gap-3 text-[13px]">
                        <svg
                          className={`w-4 h-4 mt-0.5 flex-shrink-0 ${plan.popular ? 'text-[var(--gold)]' : 'text-neutral-700'}`}
                          fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"
                        >
                          <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
                        </svg>
                        <span className={plan.popular ? 'text-neutral-300' : 'text-neutral-500'}>{feature}</span>
                      </li>
                    ))}
                  </ul>

                  <ButtonRipple className="w-full rounded-xl" color={plan.popular ? 'rgba(10,10,10,0.15)' : 'rgba(255,255,255,0.05)'}>
                    <Link
                      href={plan.href}
                      className={`block w-full rounded-xl py-3.5 text-center text-[13px] font-medium transition-all duration-500 min-h-[44px] flex items-center justify-center ${
                        plan.popular
                          ? 'bg-[var(--gold)] hover:bg-[var(--gold-light)] text-[#0a0a0a] hover:shadow-xl hover:shadow-[var(--gold)]/15 hover:-translate-y-px'
                          : 'bg-white/[0.03] hover:bg-white/[0.06] border border-white/[0.06] hover:border-white/[0.12] text-neutral-300'
                      }`}
                    >
                      {plan.cta}
                    </Link>
                  </ButtonRipple>
                </div>
              </AnimateOnScroll>
            ))}
          </div>
        </div>
      </section>

      {/* ── Divider ──────────────────────────────────────────────────────── */}
      <div className="gold-line max-w-7xl mx-auto" />

      {/* ── Testimonials ─────────────────────────────────────────────────── */}
      <section className="py-32 lg:py-44 bg-depth-1">
        <div className="max-w-3xl mx-auto px-6 lg:px-8">
          <AnimateOnScroll animation="scale-in">
            <TestimonialCarousel testimonials={TESTIMONIALS} />
          </AnimateOnScroll>
        </div>
      </section>

      {/* ── Divider ──────────────────────────────────────────────────────── */}
      <div className="gold-line max-w-7xl mx-auto" />

      {/* ── Bottom CTA ───────────────────────────────────────────────────── */}
      <section className="py-32 lg:py-44 relative overflow-hidden">
        {/* Layered atmospheric background */}
        <div className="absolute inset-0">
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_50%_50%_at_50%_50%,rgba(196,167,120,0.04),transparent)]" />
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_80%_40%_at_50%_100%,rgba(196,167,120,0.03),transparent)]" />
        </div>
        <ParallaxSection speed={0.1} className="absolute inset-0 pointer-events-none">
          <div className="absolute top-[30%] left-[20%] w-[300px] h-[300px] bg-[var(--gold)]/[0.02] rounded-full blur-[100px]" />
          <div className="absolute bottom-[20%] right-[25%] w-[250px] h-[250px] bg-[var(--gold)]/[0.015] rounded-full blur-[80px]" />
        </ParallaxSection>
        <AnimateOnScroll animation="blur-in" className="relative max-w-3xl mx-auto px-6 lg:px-8 text-center">
          <h2 className="text-4xl lg:text-[64px] font-[family-name:var(--font-display)] font-light tracking-tight leading-[1.05] mb-8">
            Ready to grow
            <br />
            <span className="text-gradient-gold italic">your business?</span>
          </h2>
          <p className="text-[16px] text-neutral-500 mb-16 max-w-md mx-auto font-light leading-relaxed">
            Join 2,400+ restaurants, salons, clinics, and spas already using GlowOS.
            Start your free 14-day trial today.
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <ButtonRipple color="rgba(10,10,10,0.15)">
              <Link
                href="/signup"
                className="btn-glow group inline-flex items-center justify-center gap-3 bg-[var(--gold)] hover:bg-[var(--gold-light)] px-10 py-4 rounded-xl text-[14px] font-medium text-[#0a0a0a] transition-all duration-500 hover:shadow-xl hover:shadow-[var(--gold)]/20 hover:-translate-y-px min-h-[48px]"
              >
                Start Free Trial
                <svg className="w-4 h-4 group-hover:translate-x-1 transition-transform duration-500" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5 21 12m0 0-7.5 7.5M21 12H3" />
                </svg>
              </Link>
            </ButtonRipple>
            <Link
              href="/login"
              className="inline-flex items-center justify-center gap-3 border border-white/[0.08] hover:border-[var(--gold)]/30 bg-white/[0.02] hover:bg-white/[0.04] px-10 py-4 rounded-xl text-[14px] font-medium text-neutral-400 hover:text-white transition-all duration-500 min-h-[48px]"
            >
              Sign in to your account
            </Link>
          </div>
        </AnimateOnScroll>
      </section>

      {/* ── Footer ───────────────────────────────────────────────────────── */}
      <footer className="border-t border-white/[0.04]">
        <div className="max-w-7xl mx-auto px-6 lg:px-8 py-20">
          <div className="grid grid-cols-1 md:grid-cols-5 gap-12 mb-16">
            {/* Brand */}
            <div className="md:col-span-2">
              <Link href="/" className="flex items-center gap-3 group mb-6" aria-label="GlowOS home">
                <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-[var(--gold)] to-[var(--gold-dark)] flex items-center justify-center group-hover:scale-105 transition-transform duration-500">
                  <span className="text-white text-sm font-semibold">G</span>
                </div>
                <span className="text-[17px] font-medium text-white">
                  Glow<span className="text-[var(--gold)]">OS</span>
                </span>
              </Link>
              <p className="text-[14px] text-neutral-600 leading-relaxed mb-8 max-w-xs font-light">
                The smart booking and CRM platform for service businesses.
                Grow your revenue, delight your clients.
              </p>
              <div className="flex gap-3">
                {['In', 'Ig', 'X'].map((social) => (
                  <a
                    key={social}
                    href="#"
                    aria-label={social}
                    className="w-9 h-9 rounded-lg bg-white/[0.02] border border-white/[0.05] hover:border-[var(--gold)]/20 hover:bg-white/[0.04] flex items-center justify-center transition-all duration-500 hover:scale-110 min-w-[44px] min-h-[44px]"
                  >
                    <span className="text-[11px] text-neutral-600">{social}</span>
                  </a>
                ))}
              </div>
            </div>

            {/* Links */}
            {[
              {
                title: 'Product',
                links: [
                  { label: 'Features', href: '#features' },
                  { label: 'Pricing', href: '#pricing' },
                  { label: 'How It Works', href: '#how-it-works' },
                  { label: 'Changelog', href: '#' },
                ],
              },
              {
                title: 'Company',
                links: [
                  { label: 'About', href: '#' },
                  { label: 'Blog', href: '#' },
                  { label: 'Careers', href: '#' },
                  { label: 'Contact', href: '#' },
                ],
              },
              {
                title: 'Legal',
                links: [
                  { label: 'Privacy Policy', href: '#' },
                  { label: 'Terms of Service', href: '#' },
                  { label: 'Cookie Policy', href: '#' },
                  { label: 'Help Centre', href: '#' },
                ],
              },
            ].map((group) => (
              <div key={group.title}>
                <div className="text-[10px] font-medium tracking-[0.2em] uppercase text-neutral-500 mb-6">
                  {group.title}
                </div>
                <ul className="space-y-4 text-[13px] text-neutral-600">
                  {group.links.map((link) => (
                    <li key={link.label}>
                      <a href={link.href} className="hover:text-white transition-colors duration-500 font-light inline-flex items-center py-0.5 min-h-[44px]">
                        {link.label}
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>

          {/* Bottom row */}
          <div className="border-t border-white/[0.04] pt-8 flex flex-col sm:flex-row items-center justify-between gap-4">
            <p className="text-[12px] text-neutral-700 font-light">
              &copy; {new Date().getFullYear()} GlowOS Pte. Ltd. All rights reserved.
            </p>
            <p className="text-[12px] text-neutral-700 font-light">
              Made with pride in Singapore
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
}
