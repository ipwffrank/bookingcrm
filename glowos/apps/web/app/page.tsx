import Link from 'next/link';
import ProductShowcase from './components/ProductShowcase';

export default function LandingPage() {
  return (
    <div className="bg-surface text-on-surface overflow-x-hidden antialiased scroll-pt-20 scroll-smooth">

      {/* ── Navigation ──────────────────────────────────────────────────────── */}
      <nav className="fixed top-0 w-full z-50 bg-surface/80 backdrop-blur-xl transition-all duration-300 border-b border-outline-variant/10">
        <div className="flex justify-between items-center px-6 sm:px-12 py-4 md:py-6 max-w-[1440px] mx-auto">
          <span className="font-serif text-2xl font-semibold tracking-tight text-primary">GlowOS</span>

          <div className="hidden md:flex gap-10 items-center">
            <a href="#features" className="font-sans text-[13px] font-medium text-primary uppercase tracking-[0.15em] border-b border-primary/20 pb-1 hover:text-secondary hover:border-secondary transition-colors duration-300">Platform</a>
            <a href="#concierge" className="font-sans text-[13px] font-medium text-primary/70 uppercase tracking-[0.15em] hover:text-primary transition-colors duration-300">Solutions</a>
            <a href="#pricing" className="font-sans text-[13px] font-medium text-primary/70 uppercase tracking-[0.15em] hover:text-primary transition-colors duration-300">Membership</a>
          </div>

          <div className="flex items-center gap-4 sm:gap-6">
            <Link href="/login" className="p-2 -m-2">
              <span className="material-symbols-outlined text-primary/70 hover:text-primary transition-colors cursor-pointer">account_circle</span>
            </Link>
            <Link
              href="/signup"
              className="bg-primary text-on-primary px-4 sm:px-8 py-2.5 rounded font-sans text-xs uppercase tracking-[0.2em] font-semibold hover:bg-primary-container transition-all duration-200 active:scale-95"
            >
              <span className="hidden sm:inline">Request Access</span>
              <span className="sm:hidden">Sign Up</span>
            </Link>
          </div>
        </div>
      </nav>

      <main>

        {/* ── Hero ────────────────────────────────────────────────────────────── */}
        <section className="min-h-screen flex flex-col md:flex-row relative">

          {/* Left: Content */}
          <div className="w-full md:w-1/2 flex items-center px-6 sm:px-12 md:px-16 lg:px-24 pt-24 pb-12 md:py-32 bg-surface">
            <div className="max-w-xl flex flex-col items-start">
              <span className="label-luxury text-secondary mb-6">
                For Self-Care Businesses That Refuse to Blend In
              </span>
              <h1 className="font-serif text-fluid-h1 text-primary tracking-tight mb-8 font-light">
                They booked<br />
                <span className="italic font-normal">somewhere else.</span>
              </h1>
              <p className="font-sans text-fluid-body-lg text-on-surface-variant max-w-md mb-10 opacity-80">
                Your best client tried to book at 11pm on a Tuesday. Your competitor&apos;s system answered. Yours didn&apos;t. GlowOS makes sure that never happens again.
              </p>
              <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4 sm:gap-8">
                <Link
                  href="/login"
                  className="bg-primary text-on-primary px-8 py-4 md:px-10 md:py-5 rounded font-sans text-xs font-semibold uppercase tracking-[0.2em] hover:bg-primary-container transition-all"
                >
                  See What You&apos;re Missing
                </Link>
                <Link
                  href="/signup"
                  className="text-primary border-b border-secondary/40 pb-1 font-sans text-xs font-semibold uppercase tracking-[0.2em] hover:border-secondary transition-all"
                >
                  Book a Private Walkthrough
                </Link>
              </div>
            </div>
          </div>

          {/* Right: Video */}
          <div className="w-full md:w-1/2 relative bg-black overflow-hidden min-h-[35vh] sm:min-h-[50vh] md:min-h-screen">
            <video
              autoPlay
              muted
              loop
              playsInline
              className="absolute inset-0 w-full h-full object-cover"
            >
              <source src="/videos/hero-bg.mp4" type="video/mp4" />
            </video>
            {/* Subtle gradient overlay blending into left panel */}
            <div className="absolute inset-0 bg-gradient-to-r from-[var(--surface)]/40 via-transparent to-transparent" />
          </div>
        </section>

        {/* ── Feature Bento Grid ──────────────────────────────────────────────── */}
        <section id="features" className="bg-surface-container-low py-20 md:py-40 px-6 sm:px-12">
          <div className="max-w-[1440px] mx-auto">
            <div className="mb-12 md:mb-24 flex flex-col items-start">
              <span className="label-luxury text-secondary mb-4 block">The Platform</span>
              <h2 className="font-serif text-fluid-h2 text-primary max-w-2xl font-light italic">
                The things you shouldn&apos;t be doing manually.
              </h2>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-12 gap-6 sm:gap-8 lg:gap-12">

              {/* Command Center — wide. All four cards share the same
                  top-aligned icon → title → paragraph rhythm so the grid
                  reads consistently regardless of which card is wide vs
                  narrow. Fake "24 / $12.4k" stats removed — the showcase
                  shouldn't claim numbers it can't substantiate. */}
              <div className="md:col-span-8 bg-surface-container-lowest p-8 sm:p-10 lg:p-16 rounded min-h-[280px] md:min-h-[400px] shadow-sm">
                <span
                  className="material-symbols-outlined text-secondary mb-10 block text-4xl"
                  style={{ fontVariationSettings: "'opsz' 48" }}
                >
                  space_dashboard
                </span>
                <h3 className="font-serif italic text-fluid-h3 text-primary mb-6">Command Center</h3>
                <p className="font-sans text-fluid-body text-on-surface-variant max-w-lg">
                  Revenue, no-shows, schedule utilisation, top clients—one screen, no spreadsheets. Know exactly where the money is and where it&apos;s leaking.
                </p>
              </div>

              {/* Smart Scheduling — narrow, dark */}
              <div className="md:col-span-4 bg-primary text-on-primary p-8 sm:p-10 lg:p-16 rounded min-h-[280px] md:min-h-[400px]">
                <span className="material-symbols-outlined text-primary-fixed/60 mb-10 block text-4xl">event_upcoming</span>
                <h3 className="font-serif italic text-fluid-h3 mb-6">Smart Scheduling</h3>
                <p className="font-sans text-on-primary-container text-fluid-body opacity-90">
                  Empty slots are costly. GlowOS fills cancellations automatically and lets your best clients book 24/7—even while you sleep.
                </p>
              </div>

              {/* Client Portfolios — narrow */}
              <div className="md:col-span-4 bg-surface-container-highest p-8 sm:p-10 lg:p-16 rounded min-h-[280px] md:min-h-[400px]">
                <span className="material-symbols-outlined text-secondary mb-10 block text-4xl">folder_shared</span>
                <h3 className="font-serif italic text-fluid-h3 text-primary mb-6">Client Portfolios</h3>
                <p className="font-sans text-on-surface-variant text-fluid-body">
                  She always requests Rachel, prefers the quiet room, and hasn&apos;t been in since March. You&apos;ll know all of this before she walks in.
                </p>
              </div>

              {/* Revenue Ops — wide */}
              <div className="md:col-span-8 bg-surface-container-lowest p-8 sm:p-10 lg:p-16 rounded min-h-[280px] md:min-h-[400px] shadow-sm">
                <span className="material-symbols-outlined text-secondary mb-10 block text-4xl">payments</span>
                <h3 className="font-serif italic text-fluid-h3 text-primary mb-6">Revenue Ops</h3>
                <p className="font-sans text-on-surface-variant text-fluid-body max-w-lg">
                  Outstanding invoices followed up. Package renewals prompted at the right moment. Deposits collected before no-shows happen, not after.
                </p>
              </div>

            </div>
          </div>
        </section>

        {/* ── Concierge Section ───────────────────────────────────────────────── */}
        <section id="concierge" className="py-20 md:py-40 px-6 sm:px-12 max-w-[1440px] mx-auto">
          <div className="flex flex-col md:flex-row gap-12 md:gap-24 items-center">

            <div className="w-full md:w-1/2">
              <span className="label-luxury text-secondary mb-6 block">The Concierge</span>
              <h2 className="font-serif text-fluid-h2 text-primary mb-10 font-light italic">
                Your front desk, minus the front desk.
              </h2>
              <p className="font-sans text-fluid-body-lg text-on-surface-variant mb-8 md:mb-14 max-w-lg">
                Most businesses lose clients between appointments—missed follow-ups, slow replies, forgotten birthdays. GlowOS handles the relationship when you&apos;re not in the room.
              </p>
              <ul className="space-y-8">
                <li className="flex gap-6 items-start">
                  <span className="material-symbols-outlined text-secondary pt-1 text-2xl">check_circle</span>
                  <div>
                    <span className="block font-semibold text-primary font-sans text-[13px] uppercase tracking-[0.15em] mb-1">Intelligent Routing</span>
                    <span className="font-sans text-fluid-body text-on-surface-variant opacity-80">
                      New enquiry at 2am? Sorted by urgency, matched to the right team member, and replied to before your competitor wakes up.
                    </span>
                  </div>
                </li>
                <li className="flex gap-6 items-start">
                  <span className="material-symbols-outlined text-secondary pt-1 text-2xl">check_circle</span>
                  <div>
                    <span className="block font-semibold text-primary font-sans text-[13px] uppercase tracking-[0.15em] mb-1">Automated Follow-Up</span>
                    <span className="font-sans text-fluid-body text-on-surface-variant opacity-80">
                      Confirmations, reminders, post-visit check-ins—sent at the right time, in the right tone. Clients feel remembered, not marketed to.
                    </span>
                  </div>
                </li>
              </ul>
            </div>

            {/* Animated product showcase */}
            <div className="w-full md:w-1/2">
              <ProductShowcase />
            </div>

          </div>
        </section>

        {/* ── Quote / Dark CTA ─────────────────────────────────────────────────── */}
        <section className="bg-primary text-on-primary py-24 md:py-48 text-center overflow-hidden relative">
          <div className="max-w-4xl mx-auto px-6 sm:px-12 relative z-10">
            <h3 className="font-serif text-fluid-h3 leading-[1.4] font-light">
              The businesses that win don&apos;t work harder. They stop losing.
              <span className="block mt-10 italic opacity-80">
                Losing clients to slow replies. Losing revenue to empty slots. Losing staff to admin chaos. GlowOS closes every gap quietly.
              </span>
            </h3>
            <div className="mt-16">
              <div className="label-luxury text-primary-fixed/60 tracking-[0.4em]">
                GlowOS | Trusted by 200+ Premium Service Businesses Across Asia
              </div>
            </div>
          </div>
          {/* Ambient glows */}
          <div className="hidden md:block absolute top-0 right-0 w-[600px] h-[600px] bg-primary-container rounded-full blur-[150px] -mr-[300px] -mt-[300px] opacity-30" />
          <div className="hidden md:block absolute bottom-0 left-0 w-[600px] h-[600px] bg-primary-container rounded-full blur-[150px] -ml-[300px] -mb-[300px] opacity-20" />
        </section>

        {/* ── Pricing ─────────────────────────────────────────────────────────── */}
        <section id="pricing" className="py-20 md:py-40 px-6 sm:px-12 bg-surface">
          <div className="max-w-[1440px] mx-auto">

            <div className="text-center mb-12 md:mb-24">
              <span className="label-luxury text-secondary mb-4 block">Membership</span>
              <h2 className="font-serif text-fluid-h2 text-primary font-light italic">Choose How Seriously You Take This</h2>
              <p className="font-sans text-fluid-body text-on-surface-variant mt-6 opacity-80 max-w-2xl mx-auto">
                Every tier pays for itself. The only question is how much revenue you&apos;re currently leaving on the table.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 sm:gap-8 lg:gap-12 items-stretch">

              {/* Studio */}
              <div className="bg-surface-container-low p-8 sm:p-10 lg:p-16 rounded border border-transparent hover:border-outline-variant/20 transition-all duration-500 flex flex-col h-full">
                <div className="label-luxury text-secondary mb-10">Studio</div>
                <div className="font-serif text-4xl sm:text-5xl md:text-6xl text-primary mb-8 font-light">
                  $499<span className="text-lg text-on-surface-variant font-sans font-normal">/mo</span>
                </div>
                <ul className="space-y-6 mb-10 md:mb-16 flex-grow font-sans">
                  <li className="text-fluid-body flex items-center gap-4 text-on-surface-variant">
                    <span className="material-symbols-outlined text-secondary text-sm">check</span>
                    <span>Single location (upgrade for multi-branch)</span>
                  </li>
                  <li className="text-fluid-body flex items-center gap-4 text-on-surface-variant">
                    <span className="material-symbols-outlined text-secondary text-sm">check</span>
                    <span>Live Dashboard &amp; Analytics</span>
                  </li>
                  <li className="text-fluid-body flex items-center gap-4 text-on-surface-variant">
                    <span className="material-symbols-outlined text-secondary text-sm">check</span>
                    <span>24/7 Online Booking</span>
                  </li>
                  <li className="text-fluid-body flex items-center gap-4 text-on-surface-variant">
                    <span className="material-symbols-outlined text-secondary text-sm">check</span>
                    <span>Up to 500 Client Profiles</span>
                  </li>
                </ul>
                <Link
                  href="/signup"
                  className="w-full border border-primary text-primary py-5 font-sans text-xs font-semibold uppercase tracking-[0.2em] hover:bg-primary hover:text-on-primary transition-all text-center block"
                >
                  Start Free Trial
                </Link>
              </div>

              {/* Estate — featured */}
              <div className="bg-surface-container-lowest p-8 sm:p-10 lg:p-16 rounded border-2 border-primary relative shadow-2xl flex flex-col h-full md:-translate-y-4">
                <div className="absolute top-0 right-0 bg-primary text-on-primary text-[9px] uppercase tracking-[0.2em] px-3 py-1.5 sm:px-6 sm:py-2 rounded-bl font-sans font-semibold">
                  Most Popular
                </div>
                <div className="label-luxury text-secondary mb-10">Estate</div>
                <div className="font-serif text-4xl sm:text-5xl md:text-6xl text-primary mb-8 font-light">
                  $1,299<span className="text-lg text-on-surface-variant font-sans font-normal">/mo</span>
                </div>
                <ul className="space-y-6 mb-10 md:mb-16 flex-grow font-sans">
                  <li className="text-fluid-body flex items-center gap-4 text-on-surface-variant">
                    <span className="material-symbols-outlined text-secondary text-sm">check</span>
                    <span>Multi-branch (add unlimited locations)</span>
                  </li>
                  <li className="text-fluid-body flex items-center gap-4 text-on-surface-variant">
                    <span className="material-symbols-outlined text-secondary text-sm">check</span>
                    <span>AI Concierge &amp; Auto Follow-Up</span>
                  </li>
                  <li className="text-fluid-body flex items-center gap-4 text-on-surface-variant">
                    <span className="material-symbols-outlined text-secondary text-sm">check</span>
                    <span>Branded Client Portal</span>
                  </li>
                  <li className="text-fluid-body flex items-center gap-4 text-on-surface-variant">
                    <span className="material-symbols-outlined text-secondary text-sm">check</span>
                    <span>Unlimited Clients &amp; Staff</span>
                  </li>
                  <li className="text-fluid-body flex items-center gap-4 text-on-surface-variant">
                    <span className="material-symbols-outlined text-secondary text-sm">check</span>
                    <span>Automated Billing &amp; Recovery</span>
                  </li>
                </ul>
                <Link
                  href="/signup"
                  className="w-full bg-primary text-on-primary py-5 font-sans text-xs font-semibold uppercase tracking-[0.2em] hover:bg-primary-container transition-all text-center block"
                >
                  Start Free Trial
                </Link>
              </div>

              {/* Institutional */}
              <div className="bg-surface-container-low p-8 sm:p-10 lg:p-16 rounded border border-transparent flex flex-col h-full">
                <div className="label-luxury text-secondary mb-10">Institutional</div>
                <div className="font-serif text-4xl sm:text-5xl md:text-6xl text-primary mb-8 font-light italic">Bespoke</div>
                <p className="font-sans text-fluid-body text-on-surface-variant mb-8 opacity-80">
                  For multi-location brands and service groups requiring custom infrastructure.
                </p>
                <ul className="space-y-6 mb-10 md:mb-16 flex-grow font-sans">
                  <li className="text-fluid-body flex items-center gap-4 text-on-surface-variant">
                    <span className="material-symbols-outlined text-secondary text-sm">check</span>
                    <span>White-glove Onboarding</span>
                  </li>
                  <li className="text-fluid-body flex items-center gap-4 text-on-surface-variant">
                    <span className="material-symbols-outlined text-secondary text-sm">check</span>
                    <span>Custom Infrastructure &amp; Integrations</span>
                  </li>
                  <li className="text-fluid-body flex items-center gap-4 text-on-surface-variant">
                    <span className="material-symbols-outlined text-secondary text-sm">check</span>
                    <span>Dedicated Concierge Manager</span>
                  </li>
                </ul>
                <button className="w-full border border-outline-variant text-primary py-5 font-sans text-xs font-semibold uppercase tracking-[0.2em] hover:border-primary transition-all">
                  Arrange a Conversation
                </button>
              </div>

            </div>
          </div>
        </section>

      </main>

      {/* ── Footer ──────────────────────────────────────────────────────────── */}
      <footer className="bg-surface-container-low w-full py-12 md:py-24 px-6 sm:px-12 border-t border-outline-variant/20">
        <div className="max-w-[1440px] mx-auto flex flex-col md:flex-row justify-between items-start md:items-center gap-12 w-full">
          <div className="flex flex-col gap-4">
            <span className="font-serif text-2xl italic font-semibold text-primary">GlowOS.</span>
            <p className="font-sans text-fluid-small tracking-wide text-on-surface-variant/60 font-medium">
              &copy; 2026 GlowOS. All rights reserved.
            </p>
          </div>
          <div className="flex flex-wrap gap-x-12 gap-y-4">
            <a href="#" className="label-luxury text-on-surface-variant/60 hover:text-primary transition-colors underline underline-offset-8 decoration-outline-variant/30 py-2">Privacy Policy</a>
            <a href="#" className="label-luxury text-on-surface-variant/60 hover:text-primary transition-colors py-2">Terms of Service</a>
            <a href="#" className="label-luxury text-on-surface-variant/60 hover:text-primary transition-colors py-2">Accessibility</a>
            <a href="#" className="label-luxury text-on-surface-variant/60 hover:text-primary transition-colors py-2">Contact</a>
          </div>
        </div>
      </footer>

    </div>
  );
}
