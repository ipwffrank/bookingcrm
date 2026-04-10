import Link from 'next/link';
import NavBar from './components/NavBar';

// ─── Static data ────────────────────────────────────────────────────────────

const FEATURES = [
  {
    icon: '🗺️',
    tag: 'Google Integration',
    title: 'Get Booked Directly from Google',
    description:
      'When clients search for salons near them, your booking button appears right in Google Maps and Search. Zero friction — they book in seconds without ever calling.',
    detail: 'Reserve with Google · Instant confirmation · No app download needed',
    flip: false,
  },
  {
    icon: '💎',
    tag: 'VIP Intelligence',
    title: 'Know Your Best Clients Before They Walk In',
    description:
      'Our AI scores every client based on spend, frequency, and loyalty signals. Know exactly who your VIPs are, which clients are drifting away, and where to focus your energy.',
    detail: 'Client scoring · Churn alerts · Lifetime value tracking',
    flip: true,
  },
  {
    icon: '✨',
    tag: 'Smart Campaigns',
    title: 'Win Back Lapsed Clients on Autopilot',
    description:
      'AI-powered WhatsApp and SMS re-engagement campaigns that send at the right moment with the right message. Your clients come back — without you lifting a finger.',
    detail: 'WhatsApp campaigns · Automated triggers · A/B testing',
    flip: false,
  },
  {
    icon: '📊',
    tag: 'Real-time Dashboard',
    title: 'Everything in One Place',
    description:
      'Bookings, staff schedules, client history, revenue analytics — all in a single, beautifully designed dashboard. Make decisions with confidence, not guesswork.',
    detail: 'Live booking feed · Staff management · Revenue reports',
    flip: true,
  },
];

const STEPS = [
  {
    number: '01',
    title: 'Sign up & add your services',
    description:
      'Create your account, add your services with pricing, and invite your staff. Takes about 2 minutes.',
    duration: '~2 minutes',
  },
  {
    number: '02',
    title: 'Share your booking link',
    description:
      'Get your custom booking page URL. Share it on Instagram, WhatsApp, your website — everywhere.',
    duration: 'Instant',
  },
  {
    number: '03',
    title: 'Clients book, you focus on craft',
    description:
      'Clients book and pay online. You get notified. No phone tag, no manual scheduling. Just you doing what you do best.',
    duration: 'Always on',
  },
];

const PLANS = [
  {
    name: 'Starter',
    price: '$49',
    period: '/mo',
    tagline: 'For solo stylists getting started',
    features: [
      'Up to 2 staff members',
      'Online booking widget',
      'Automated reminders',
      'Basic analytics dashboard',
      'Email support',
    ],
    cta: 'Start Free Trial',
    href: '/signup',
    popular: false,
  },
  {
    name: 'Pro',
    price: '$99',
    period: '/mo',
    tagline: 'For growing salons',
    features: [
      'Unlimited staff members',
      'VIP scoring & client insights',
      'WhatsApp & SMS campaigns',
      'Google Reserve integration',
      'Advanced analytics',
      'Priority support',
    ],
    cta: 'Start Free Trial',
    href: '/signup',
    popular: true,
  },
  {
    name: 'Business',
    price: '$199',
    period: '/mo',
    tagline: 'For multi-location businesses',
    features: [
      'Everything in Pro',
      'Daily payouts',
      'Google Actions integration',
      'Multi-location management',
      'Custom domain',
      'Dedicated account manager',
    ],
    cta: 'Contact Sales',
    href: '/signup',
    popular: false,
  },
];

const STATS = [
  { value: '2,400+', label: 'Salons on GlowOS' },
  { value: '98%', label: 'Client satisfaction' },
  { value: 'SGD 4.2M', label: 'Processed monthly' },
  { value: '10,000+', label: 'Bookings per week' },
];

// ─── Page ────────────────────────────────────────────────────────────────────

export default function HomePage() {
  return (
    <div className="min-h-screen bg-gray-950 text-white">
      <NavBar />

      {/* ── Hero ─────────────────────────────────────────────────────────── */}
      <section className="relative min-h-screen flex items-center overflow-hidden">
        {/* Background gradients */}
        <div className="absolute inset-0 bg-gradient-to-br from-gray-950 via-gray-900 to-gray-950" />
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_80%_80%_at_50%_-20%,rgba(120,80,220,0.25),transparent)]" />
        <div className="absolute top-1/4 -left-32 w-96 h-96 bg-violet-600/10 rounded-full blur-3xl" />
        <div className="absolute bottom-1/4 -right-32 w-96 h-96 bg-indigo-600/10 rounded-full blur-3xl" />

        <div className="relative max-w-7xl mx-auto px-6 lg:px-8 pt-24 pb-20 lg:pt-32">
          <div className="max-w-4xl">
            {/* Badge */}
            <div className="inline-flex items-center gap-2 rounded-full border border-violet-500/30 bg-violet-500/10 px-4 py-1.5 text-sm font-medium text-violet-300 mb-8">
              <span className="w-1.5 h-1.5 rounded-full bg-violet-400 animate-pulse" />
              Built exclusively for Singapore salons
            </div>

            {/* Headline */}
            <h1 className="text-5xl sm:text-6xl lg:text-7xl font-bold leading-[1.08] tracking-tight mb-8">
              More than just{' '}
              <span className="block text-transparent bg-clip-text bg-gradient-to-r from-violet-400 via-purple-400 to-indigo-400">
                booking software.
              </span>
            </h1>

            {/* Subheadline */}
            <p className="text-xl lg:text-2xl text-gray-400 leading-relaxed mb-12 max-w-2xl">
              GlowOS gives your salon a complete growth engine — Google bookings,
              VIP client intelligence, and AI-powered campaigns that fill your calendar automatically.
            </p>

            {/* CTAs */}
            <div className="flex flex-col sm:flex-row gap-4 mb-16">
              <Link
                href="/signup"
                className="inline-flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-500 hover:to-indigo-500 px-8 py-4 text-base font-semibold text-white shadow-xl shadow-violet-900/40 hover:shadow-violet-700/50 transition-all duration-200 group"
              >
                Start Free Trial
                <svg className="w-4 h-4 group-hover:translate-x-0.5 transition-transform" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5 21 12m0 0-7.5 7.5M21 12H3" />
                </svg>
              </Link>
              <a
                href="#how-it-works"
                onClick={(e) => {
                  e.preventDefault();
                  document.getElementById('how-it-works')?.scrollIntoView({ behavior: 'smooth' });
                }}
                className="inline-flex items-center justify-center gap-2 rounded-xl border border-white/15 hover:border-white/30 bg-white/5 hover:bg-white/10 px-8 py-4 text-base font-semibold text-white transition-all duration-200"
              >
                <svg className="w-4 h-4 text-violet-400" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5.25 5.653c0-.856.917-1.398 1.667-.986l11.54 6.347a1.125 1.125 0 0 1 0 1.972l-11.54 6.347a1.125 1.125 0 0 1-1.667-.986V5.653Z" />
                </svg>
                See How It Works
              </a>
            </div>

            {/* Trust signal */}
            <p className="text-sm text-gray-500">
              No credit card required &nbsp;·&nbsp; Free 14-day trial &nbsp;·&nbsp; Cancel anytime
            </p>
          </div>

          {/* Hero visual — abstract dashboard mockup */}
          <div className="absolute right-0 top-1/2 -translate-y-1/2 hidden xl:block w-[520px] opacity-60">
            <div className="relative">
              {/* Outer glow */}
              <div className="absolute inset-0 bg-gradient-to-br from-violet-600/20 to-indigo-600/10 rounded-3xl blur-2xl scale-110" />
              {/* Card */}
              <div className="relative rounded-2xl border border-white/10 bg-gray-900/80 backdrop-blur-md overflow-hidden shadow-2xl">
                {/* Toolbar */}
                <div className="flex items-center gap-2 px-5 py-3 border-b border-white/8 bg-gray-800/50">
                  <div className="w-3 h-3 rounded-full bg-red-500/70" />
                  <div className="w-3 h-3 rounded-full bg-yellow-500/70" />
                  <div className="w-3 h-3 rounded-full bg-green-500/70" />
                  <div className="ml-4 flex-1 h-5 rounded-md bg-white/5" />
                </div>
                {/* Mock stats row */}
                <div className="grid grid-cols-3 gap-3 p-5">
                  {[
                    { label: 'Bookings today', value: '24', color: 'from-violet-500/20 to-violet-600/10' },
                    { label: 'Revenue', value: 'S$3,240', color: 'from-emerald-500/20 to-emerald-600/10' },
                    { label: 'VIP clients', value: '47', color: 'from-amber-500/20 to-amber-600/10' },
                  ].map((s) => (
                    <div key={s.label} className={`rounded-xl bg-gradient-to-br ${s.color} border border-white/8 p-4`}>
                      <div className="text-xs text-gray-400 mb-2">{s.label}</div>
                      <div className="text-xl font-bold text-white">{s.value}</div>
                    </div>
                  ))}
                </div>
                {/* Mock booking list */}
                <div className="px-5 pb-5 space-y-2">
                  {[
                    { name: 'Sarah Tan', service: 'Balayage', time: '10:00 AM', status: 'Confirmed' },
                    { name: 'Mei Ling', service: 'Gel Manicure', time: '11:30 AM', status: 'VIP' },
                    { name: 'Priya K.', service: 'Hair Treatment', time: '2:00 PM', status: 'Confirmed' },
                    { name: 'Amanda Lim', service: 'Full Set', time: '3:30 PM', status: 'New' },
                  ].map((b) => (
                    <div key={b.name} className="flex items-center justify-between rounded-lg bg-white/4 hover:bg-white/6 transition-colors px-4 py-3">
                      <div className="flex items-center gap-3">
                        <div className="w-7 h-7 rounded-full bg-gradient-to-br from-violet-500 to-indigo-600 flex items-center justify-center text-xs font-semibold text-white">
                          {b.name[0]}
                        </div>
                        <div>
                          <div className="text-sm font-medium text-white">{b.name}</div>
                          <div className="text-xs text-gray-500">{b.service} · {b.time}</div>
                        </div>
                      </div>
                      <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                        b.status === 'VIP'
                          ? 'bg-amber-500/20 text-amber-300'
                          : b.status === 'New'
                          ? 'bg-emerald-500/20 text-emerald-300'
                          : 'bg-violet-500/20 text-violet-300'
                      }`}>
                        {b.status}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Scroll indicator */}
        <div className="absolute bottom-8 left-1/2 -translate-x-1/2 flex flex-col items-center gap-2 text-gray-600">
          <span className="text-xs font-medium tracking-widest uppercase">Scroll</span>
          <div className="w-px h-10 bg-gradient-to-b from-gray-600 to-transparent" />
        </div>
      </section>

      {/* ── Social Proof Bar ──────────────────────────────────────────────── */}
      <section className="border-y border-white/8 bg-gray-900/50 backdrop-blur-sm py-12">
        <div className="max-w-7xl mx-auto px-6 lg:px-8">
          <p className="text-center text-xs font-semibold tracking-widest uppercase text-gray-500 mb-10">
            Trusted by Singapore&apos;s best salons
          </p>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-8 md:gap-4">
            {STATS.map((stat) => (
              <div key={stat.label} className="text-center">
                <div className="text-3xl lg:text-4xl font-bold text-white mb-1">{stat.value}</div>
                <div className="text-sm text-gray-500">{stat.label}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Features ─────────────────────────────────────────────────────── */}
      <section id="features" className="py-24 lg:py-36 overflow-hidden">
        <div className="max-w-7xl mx-auto px-6 lg:px-8">
          <div className="text-center mb-20">
            <p className="text-sm font-semibold tracking-widest uppercase text-violet-400 mb-4">
              Platform Features
            </p>
            <h2 className="text-4xl lg:text-5xl font-bold tracking-tight mb-6">
              Everything you need to{' '}
              <span className="text-transparent bg-clip-text bg-gradient-to-r from-violet-400 to-indigo-400">
                grow faster
              </span>
            </h2>
            <p className="text-xl text-gray-400 max-w-2xl mx-auto">
              Purpose-built for beauty businesses. Every feature designed around how salons actually work.
            </p>
          </div>

          <div className="space-y-28">
            {FEATURES.map((feature) => (
              <div
                key={feature.title}
                className={`grid lg:grid-cols-2 gap-12 lg:gap-20 items-center ${
                  feature.flip ? 'lg:grid-flow-dense' : ''
                }`}
              >
                {/* Text side */}
                <div className={feature.flip ? 'lg:col-start-2' : ''}>
                  <div className="inline-flex items-center gap-2 rounded-full border border-violet-500/25 bg-violet-500/10 px-3 py-1 text-xs font-semibold text-violet-300 uppercase tracking-wider mb-6">
                    {feature.tag}
                  </div>
                  <h3 className="text-3xl lg:text-4xl font-bold leading-tight mb-5">
                    {feature.title}
                  </h3>
                  <p className="text-lg text-gray-400 leading-relaxed mb-8">
                    {feature.description}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {feature.detail.split(' · ').map((d) => (
                      <span
                        key={d}
                        className="inline-flex items-center gap-1.5 text-sm text-gray-300 bg-white/5 border border-white/8 rounded-full px-3 py-1"
                      >
                        <span className="w-1 h-1 rounded-full bg-violet-400" />
                        {d}
                      </span>
                    ))}
                  </div>
                </div>

                {/* Visual side */}
                <div className={feature.flip ? 'lg:col-start-1 lg:row-start-1' : ''}>
                  <div className="relative">
                    <div className="absolute inset-0 bg-gradient-to-br from-violet-600/15 to-indigo-600/10 rounded-3xl blur-2xl" />
                    <div className="relative rounded-2xl border border-white/10 bg-gray-900/60 backdrop-blur-md overflow-hidden aspect-[4/3] flex items-center justify-center">
                      <div className="text-center">
                        <div className="text-7xl mb-6">{feature.icon}</div>
                        <div className="text-sm font-medium text-gray-400 px-6">{feature.tag}</div>
                      </div>
                      {/* Decorative grid overlay */}
                      <div className="absolute inset-0 bg-[linear-gradient(to_right,rgba(255,255,255,0.02)_1px,transparent_1px),linear-gradient(to_bottom,rgba(255,255,255,0.02)_1px,transparent_1px)] bg-[size:48px_48px]" />
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── How It Works ─────────────────────────────────────────────────── */}
      <section id="how-it-works" className="py-24 lg:py-36 bg-gray-900/40 border-y border-white/8">
        <div className="max-w-7xl mx-auto px-6 lg:px-8">
          <div className="text-center mb-20">
            <p className="text-sm font-semibold tracking-widest uppercase text-violet-400 mb-4">
              How It Works
            </p>
            <h2 className="text-4xl lg:text-5xl font-bold tracking-tight mb-6">
              Up and running in minutes
            </h2>
            <p className="text-xl text-gray-400 max-w-xl mx-auto">
              No complicated setup. No IT team needed. Just sign up and start taking bookings.
            </p>
          </div>

          <div className="grid md:grid-cols-3 gap-8 lg:gap-12 relative">
            {/* Connector line */}
            <div className="hidden md:block absolute top-12 left-1/4 right-1/4 h-px bg-gradient-to-r from-transparent via-violet-500/40 to-transparent" />

            {STEPS.map((step, idx) => (
              <div key={step.number} className="relative text-center group">
                {/* Step number */}
                <div className="relative inline-flex mb-8">
                  <div className="w-24 h-24 rounded-2xl bg-gradient-to-br from-violet-600/20 to-indigo-600/10 border border-violet-500/25 flex items-center justify-center group-hover:border-violet-500/50 transition-colors">
                    <span className="text-3xl font-bold text-transparent bg-clip-text bg-gradient-to-br from-violet-400 to-indigo-400">
                      {step.number}
                    </span>
                  </div>
                  {idx < STEPS.length - 1 && (
                    <div className="md:hidden absolute top-1/2 -right-4 transform -translate-y-1/2">
                      <svg className="w-4 h-4 text-gray-600" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5 21 12m0 0-7.5 7.5M21 12H3" />
                      </svg>
                    </div>
                  )}
                </div>

                <div className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 rounded-full px-3 py-1 mb-4">
                  <span className="w-1 h-1 rounded-full bg-emerald-400" />
                  {step.duration}
                </div>
                <h3 className="text-xl font-semibold text-white mb-3">{step.title}</h3>
                <p className="text-gray-400 leading-relaxed">{step.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Pricing ──────────────────────────────────────────────────────── */}
      <section id="pricing" className="py-24 lg:py-36">
        <div className="max-w-7xl mx-auto px-6 lg:px-8">
          <div className="text-center mb-20">
            <p className="text-sm font-semibold tracking-widest uppercase text-violet-400 mb-4">
              Pricing
            </p>
            <h2 className="text-4xl lg:text-5xl font-bold tracking-tight mb-6">
              Simple, transparent pricing
            </h2>
            <p className="text-xl text-gray-400">
              Start free. No credit card required. Cancel anytime.
            </p>
          </div>

          <div className="grid md:grid-cols-3 gap-6 lg:gap-8 items-start">
            {PLANS.map((plan) => (
              <div
                key={plan.name}
                className={`relative rounded-2xl p-8 transition-all duration-300 ${
                  plan.popular
                    ? 'bg-gradient-to-b from-violet-600/20 to-indigo-600/10 border-2 border-violet-500/50 shadow-2xl shadow-violet-900/30'
                    : 'bg-gray-900/60 border border-white/10 hover:border-white/20'
                }`}
              >
                {/* Popular badge */}
                {plan.popular && (
                  <div className="absolute -top-4 left-1/2 -translate-x-1/2">
                    <span className="inline-flex items-center gap-1.5 text-xs font-bold text-white bg-gradient-to-r from-violet-600 to-indigo-600 rounded-full px-4 py-1.5 shadow-lg shadow-violet-900/50">
                      <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                        <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
                      </svg>
                      Most Popular
                    </span>
                  </div>
                )}

                <div className="mb-8">
                  <h3 className={`text-xl font-bold mb-1 ${plan.popular ? 'text-white' : 'text-white'}`}>
                    {plan.name}
                  </h3>
                  <p className="text-sm text-gray-400 mb-6">{plan.tagline}</p>
                  <div className="flex items-end gap-1">
                    <span className="text-5xl font-bold text-white">{plan.price}</span>
                    <span className="text-gray-400 mb-2">{plan.period}</span>
                  </div>
                </div>

                <ul className="space-y-3.5 mb-8">
                  {plan.features.map((feature) => (
                    <li key={feature} className="flex items-start gap-3 text-sm">
                      <svg
                        className={`w-4 h-4 mt-0.5 flex-shrink-0 ${plan.popular ? 'text-violet-400' : 'text-gray-500'}`}
                        fill="none"
                        viewBox="0 0 24 24"
                        strokeWidth={2.5}
                        stroke="currentColor"
                      >
                        <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
                      </svg>
                      <span className={plan.popular ? 'text-gray-200' : 'text-gray-400'}>{feature}</span>
                    </li>
                  ))}
                </ul>

                <Link
                  href={plan.href}
                  className={`block w-full rounded-xl py-3.5 text-center text-sm font-semibold transition-all duration-200 ${
                    plan.popular
                      ? 'bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-500 hover:to-indigo-500 text-white shadow-lg shadow-violet-900/40 hover:shadow-violet-700/40'
                      : 'bg-white/8 hover:bg-white/12 border border-white/10 hover:border-white/20 text-white'
                  }`}
                >
                  {plan.cta}
                </Link>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Testimonial ──────────────────────────────────────────────────── */}
      <section className="py-24 lg:py-32 bg-gray-900/40 border-y border-white/8">
        <div className="max-w-4xl mx-auto px-6 lg:px-8 text-center">
          <div className="relative">
            {/* Quote mark */}
            <div className="absolute -top-8 left-1/2 -translate-x-1/2 text-8xl text-violet-600/20 font-serif leading-none select-none">
              &ldquo;
            </div>
            <blockquote className="relative text-2xl lg:text-3xl font-medium text-white leading-relaxed mb-10">
              Since switching to GlowOS, our no-show rate dropped by 60% and we&apos;re booking
              30% more appointments every week. It&apos;s like having a full-time receptionist — except smarter.
            </blockquote>
          </div>
          <div className="flex items-center justify-center gap-4">
            <div className="w-12 h-12 rounded-full bg-gradient-to-br from-violet-500 to-indigo-600 flex items-center justify-center text-white font-bold text-lg">
              J
            </div>
            <div className="text-left">
              <div className="font-semibold text-white">Jessica Ng</div>
              <div className="text-sm text-gray-400">Owner, Lumière Hair Studio · Orchard Road</div>
            </div>
          </div>
          {/* Stars */}
          <div className="flex items-center justify-center gap-1 mt-6">
            {[...Array(5)].map((_, i) => (
              <svg key={i} className="w-5 h-5 text-amber-400" fill="currentColor" viewBox="0 0 20 20">
                <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
              </svg>
            ))}
          </div>
        </div>
      </section>

      {/* ── Bottom CTA ───────────────────────────────────────────────────── */}
      <section className="py-24 lg:py-36 relative overflow-hidden">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_60%_60%_at_50%_50%,rgba(120,80,220,0.15),transparent)]" />
        <div className="relative max-w-4xl mx-auto px-6 lg:px-8 text-center">
          <h2 className="text-4xl lg:text-6xl font-bold tracking-tight mb-6">
            Ready to grow your salon?
          </h2>
          <p className="text-xl text-gray-400 mb-12 max-w-2xl mx-auto">
            Join 2,400+ salons across Singapore already using GlowOS.
            Start your free 14-day trial — no credit card needed.
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Link
              href="/signup"
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-500 hover:to-indigo-500 px-10 py-4 text-base font-semibold text-white shadow-xl shadow-violet-900/40 hover:shadow-violet-700/50 transition-all duration-200 group"
            >
              Start Free Trial
              <svg className="w-4 h-4 group-hover:translate-x-0.5 transition-transform" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5 21 12m0 0-7.5 7.5M21 12H3" />
              </svg>
            </Link>
            <Link
              href="/login"
              className="inline-flex items-center justify-center gap-2 rounded-xl border border-white/15 hover:border-white/30 bg-white/5 hover:bg-white/10 px-10 py-4 text-base font-semibold text-white transition-all duration-200"
            >
              Sign in to your account
            </Link>
          </div>
        </div>
      </section>

      {/* ── Footer ───────────────────────────────────────────────────────── */}
      <footer className="border-t border-white/8 bg-gray-950/80">
        <div className="max-w-7xl mx-auto px-6 lg:px-8 py-16">
          <div className="grid grid-cols-1 md:grid-cols-5 gap-12 mb-16">
            {/* Brand */}
            <div className="md:col-span-2">
              <Link href="/" className="flex items-center gap-2 group mb-4" aria-label="GlowOS home">
                <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-violet-500 to-indigo-600 flex items-center justify-center">
                  <span className="text-white text-sm font-bold">G</span>
                </div>
                <span className="text-xl font-bold text-white">GlowOS</span>
              </Link>
              <p className="text-sm text-gray-400 leading-relaxed mb-6 max-w-xs">
                The smart booking platform for Singapore&apos;s best salons.
                Grow your business, delight your clients.
              </p>
              {/* Social links */}
              <div className="flex gap-3">
                {['Instagram', 'LinkedIn', 'Twitter'].map((social) => (
                  <a
                    key={social}
                    href="#"
                    aria-label={social}
                    className="w-9 h-9 rounded-lg bg-white/5 border border-white/10 hover:border-white/25 hover:bg-white/10 flex items-center justify-center transition-colors"
                  >
                    <span className="text-xs text-gray-400">{social[0]}</span>
                  </a>
                ))}
              </div>
            </div>

            {/* Product */}
            <div>
              <div className="text-sm font-semibold text-white mb-5">Product</div>
              <ul className="space-y-3 text-sm text-gray-400">
                {[
                  { label: 'Features', href: '#features' },
                  { label: 'Pricing', href: '#pricing' },
                  { label: 'How It Works', href: '#how-it-works' },
                  { label: 'Changelog', href: '#' },
                ].map((link) => (
                  <li key={link.label}>
                    <a href={link.href} className="hover:text-white transition-colors">
                      {link.label}
                    </a>
                  </li>
                ))}
              </ul>
            </div>

            {/* Company */}
            <div>
              <div className="text-sm font-semibold text-white mb-5">Company</div>
              <ul className="space-y-3 text-sm text-gray-400">
                {[
                  { label: 'About', href: '#' },
                  { label: 'Blog', href: '#' },
                  { label: 'Careers', href: '#' },
                  { label: 'Contact', href: '#' },
                ].map((link) => (
                  <li key={link.label}>
                    <a href={link.href} className="hover:text-white transition-colors">
                      {link.label}
                    </a>
                  </li>
                ))}
              </ul>
            </div>

            {/* Legal */}
            <div>
              <div className="text-sm font-semibold text-white mb-5">Legal</div>
              <ul className="space-y-3 text-sm text-gray-400">
                {[
                  { label: 'Privacy Policy', href: '#' },
                  { label: 'Terms of Service', href: '#' },
                  { label: 'Cookie Policy', href: '#' },
                  { label: 'Help Centre', href: '#' },
                ].map((link) => (
                  <li key={link.label}>
                    <a href={link.href} className="hover:text-white transition-colors">
                      {link.label}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          </div>

          {/* Bottom row */}
          <div className="border-t border-white/8 pt-8 flex flex-col sm:flex-row items-center justify-between gap-4">
            <p className="text-sm text-gray-500">
              &copy; {new Date().getFullYear()} GlowOS Pte. Ltd. All rights reserved.
            </p>
            <p className="text-sm text-gray-500">
              Made with pride in Singapore{' '}
              <span role="img" aria-label="Singapore flag">🇸🇬</span>
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
}
