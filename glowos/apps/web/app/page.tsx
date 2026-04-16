import Link from 'next/link';

export default function LandingPage() {
  return (
    <div className="bg-surface text-on-surface overflow-x-hidden antialiased">

      {/* ── Navigation ──────────────────────────────────────────────────────── */}
      <nav className="fixed top-0 w-full z-50 bg-surface/80 backdrop-blur-xl transition-all duration-300 border-b border-outline-variant/10">
        <div className="flex justify-between items-center px-12 py-6 max-w-[1440px] mx-auto">
          <span className="font-newsreader text-2xl font-semibold tracking-tight text-primary">GlowOS</span>

          <div className="hidden md:flex gap-10 items-center">
            <a href="#features" className="font-newsreader italic text-lg text-primary border-b border-primary/20 pb-1 hover:text-secondary hover:border-secondary transition-colors duration-300">Platform</a>
            <a href="#concierge" className="font-newsreader italic text-lg text-primary/70 hover:text-primary transition-colors duration-300">Solutions</a>
            <a href="#pricing" className="font-newsreader italic text-lg text-primary/70 hover:text-primary transition-colors duration-300">Membership</a>
            <a href="#" className="font-newsreader italic text-lg text-primary/70 hover:text-primary transition-colors duration-300">Journal</a>
          </div>

          <div className="flex items-center gap-6">
            <Link href="/login">
              <span className="material-symbols-outlined text-primary/70 hover:text-primary transition-colors cursor-pointer">account_circle</span>
            </Link>
            <Link
              href="/signup"
              className="bg-primary text-on-primary px-8 py-2.5 rounded font-inter text-xs uppercase tracking-widest font-semibold hover:bg-primary-container transition-all duration-200 active:scale-95"
            >
              Request Access
            </Link>
          </div>
        </div>
      </nav>

      <main>

        {/* ── Hero ────────────────────────────────────────────────────────────── */}
        <section className="min-h-screen flex flex-col md:flex-row relative">

          {/* Left: Content */}
          <div className="w-full md:w-1/2 flex items-center px-12 md:px-24 py-32 bg-surface">
            <div className="max-w-xl flex flex-col items-start">
              <span className="font-inter text-[11px] uppercase tracking-[0.25em] text-secondary mb-6">
                The Digital Maître D&apos;
              </span>
              <h1 className="font-newsreader text-7xl md:text-8xl leading-[1.05] text-primary tracking-tight mb-8 font-light">
                Every detail,<br />
                <span className="italic font-normal">attended to.</span>
              </h1>
              <p className="font-manrope text-lg text-on-surface-variant max-w-md leading-relaxed mb-10 opacity-80">
                GlowOS brings the precision of fine hospitality to clinical practice. Scheduling, patient flow, and revenue—managed quietly, so your attention stays where it belongs.
              </p>
              <div className="flex items-center gap-8">
                <Link
                  href="/login"
                  className="bg-primary text-on-primary px-10 py-5 rounded text-xs font-inter font-semibold uppercase tracking-widest hover:bg-primary-container transition-all"
                >
                  Explore the Platform
                </Link>
                <Link
                  href="/signup"
                  className="text-primary border-b border-secondary/40 pb-1 text-xs font-inter font-semibold uppercase tracking-widest hover:border-secondary transition-all"
                >
                  Request a Private Demo
                </Link>
              </div>
            </div>
          </div>

          {/* Right: Video */}
          <div className="w-full md:w-1/2 relative bg-surface-container overflow-hidden min-h-[50vh] md:min-h-screen">
            <video
              autoPlay
              muted
              loop
              playsInline
              className="absolute inset-0 w-full h-full object-cover grayscale-[15%] brightness-[0.95] hover:grayscale-0 transition-all duration-1000"
              poster="https://images.pexels.com/photos/3757942/pexels-photo-3757942.jpeg?auto=compress&cs=tinysrgb&w=1260&h=750&dpr=2"
            >
              <source
                src="https://player.vimeo.com/external/494163966.sd.mp4?s=99a7702f30b91011867e35b0b23b8f1c8435d88a&profile_id=165"
                type="video/mp4"
              />
            </video>
          </div>
        </section>

        {/* ── Feature Bento Grid ──────────────────────────────────────────────── */}
        <section id="features" className="bg-surface-container-low py-40 px-12">
          <div className="max-w-[1440px] mx-auto">
            <div className="mb-24 flex flex-col items-start">
              <span className="font-inter text-[11px] uppercase tracking-[0.25em] text-secondary mb-4 block">The Platform</span>
              <h2 className="font-newsreader text-5xl md:text-6xl text-primary max-w-2xl leading-[1.15] font-light italic">
                Everything in its place. Everyone in their lane.
              </h2>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-12 gap-12">

              {/* Command Center — wide */}
              <div className="md:col-span-8 bg-surface-container-lowest p-16 rounded flex flex-col justify-between min-h-[480px] shadow-sm">
                <div>
                  <span
                    className="material-symbols-outlined text-secondary mb-10 block text-4xl"
                    style={{ fontVariationSettings: "'opsz' 48" }}
                  >
                    space_dashboard
                  </span>
                  <h3 className="font-newsreader italic text-4xl text-primary mb-6">Command Center</h3>
                  <p className="font-manrope text-on-surface-variant max-w-sm mb-8 leading-relaxed">
                    A single, composed view of your clinic&apos;s operations. Patient flow, capacity, and performance—visible at a glance.
                  </p>
                </div>
                <div className="pt-10 border-t border-outline-variant/30 flex gap-20">
                  <div className="flex flex-col gap-1">
                    <div className="font-inter text-[10px] text-secondary uppercase tracking-[0.2em] mb-1">Active Patients</div>
                    <div className="font-newsreader text-4xl text-primary">24</div>
                  </div>
                  <div className="flex flex-col gap-1">
                    <div className="font-inter text-[10px] text-secondary uppercase tracking-[0.2em] mb-1">Daily Rev</div>
                    <div className="font-newsreader text-4xl text-primary">$12.4k</div>
                  </div>
                </div>
              </div>

              {/* Smart Scheduling — narrow, dark */}
              <div className="md:col-span-4 bg-primary text-on-primary p-16 rounded flex flex-col justify-between min-h-[480px]">
                <span className="material-symbols-outlined text-primary-fixed/60 mb-10 block text-4xl">event_upcoming</span>
                <div>
                  <h3 className="font-newsreader italic text-4xl mb-6">Smart Scheduling</h3>
                  <p className="font-manrope text-on-primary-container text-base leading-relaxed opacity-90">
                    Booking logic that fills gaps before they form and surfaces your most valuable appointments first.
                  </p>
                </div>
              </div>

              {/* Patient Portfolios — narrow */}
              <div className="md:col-span-4 bg-surface-container-highest p-16 rounded min-h-[400px]">
                <span className="material-symbols-outlined text-secondary mb-10 block text-4xl">folder_shared</span>
                <h3 className="font-newsreader italic text-3xl text-primary mb-6">Patient Portfolios</h3>
                <p className="font-manrope text-on-surface-variant text-base leading-relaxed">
                  Complete histories, noted preferences, and clinical records—held securely, retrieved effortlessly.
                </p>
              </div>

              {/* Revenue Ops — wide */}
              <div className="md:col-span-8 bg-surface-container-lowest p-16 rounded flex items-center gap-16 min-h-[400px] shadow-sm">
                <div className="flex-1">
                  <span className="material-symbols-outlined text-secondary mb-10 block text-4xl">payments</span>
                  <h3 className="font-newsreader italic text-3xl text-primary mb-6">Revenue Ops</h3>
                  <p className="font-manrope text-on-surface-variant text-base leading-relaxed max-w-lg">
                    Billing and recovery handled with the same composure as the treatments themselves. Nothing overlooked. Nothing chased twice.
                  </p>
                </div>
              </div>

            </div>
          </div>
        </section>

        {/* ── Concierge Section ───────────────────────────────────────────────── */}
        <section id="concierge" className="py-40 px-12 max-w-[1440px] mx-auto">
          <div className="flex flex-col md:flex-row gap-24 items-center">

            <div className="w-full md:w-1/2">
              <span className="font-inter text-[11px] uppercase tracking-[0.25em] text-secondary mb-6 block">The Concierge</span>
              <h2 className="font-newsreader text-6xl text-primary mb-10 leading-[1.1] font-light italic">
                Your clinic, remembered. Your standards, upheld.
              </h2>
              <p className="font-manrope text-lg text-on-surface-variant mb-14 max-w-lg leading-relaxed">
                GlowOS learns the rhythms of your practice—how you communicate, how you prioritize, how you care. What follows is administration that requires no management.
              </p>
              <ul className="space-y-8">
                <li className="flex gap-6 items-start">
                  <span className="material-symbols-outlined text-secondary pt-1 text-2xl">check_circle</span>
                  <div>
                    <span className="block font-semibold text-primary font-inter text-sm uppercase tracking-wider mb-1">Considered Triage</span>
                    <span className="font-manrope text-base text-on-surface-variant opacity-80 leading-relaxed">
                      Patient inquiries received, assessed, and addressed—by urgency, by preference, without intervention.
                    </span>
                  </div>
                </li>
                <li className="flex gap-6 items-start">
                  <span className="material-symbols-outlined text-secondary pt-1 text-2xl">check_circle</span>
                  <div>
                    <span className="block font-semibold text-primary font-inter text-sm uppercase tracking-wider mb-1">Quiet Reception</span>
                    <span className="font-manrope text-base text-on-surface-variant opacity-80 leading-relaxed">
                      Appointments confirmed, questions answered, schedules held. All through secure messaging. No phone required.
                    </span>
                  </div>
                </li>
              </ul>
            </div>

            {/* Abstract visual */}
            <div className="w-full md:w-1/2">
              <div className="aspect-square bg-surface-container-low rounded border border-outline-variant/20 flex items-center justify-center relative overflow-hidden group">
                <div className="absolute inset-0 bg-gradient-to-tr from-secondary/5 to-transparent" />
                <div className="w-3/4 h-3/4 border border-outline-variant/10 rounded-full flex items-center justify-center group-hover:scale-110 transition-transform duration-[2000ms]">
                  <div className="w-1/2 h-1/2 border border-outline-variant/20 rounded-full flex items-center justify-center">
                    <span
                      className="material-symbols-outlined text-outline-variant/40 animate-pulse"
                      style={{ fontSize: '64px' }}
                    >
                      blur_on
                    </span>
                  </div>
                </div>
              </div>
            </div>

          </div>
        </section>

        {/* ── Quote / Dark CTA ─────────────────────────────────────────────────── */}
        <section className="bg-primary text-on-primary py-48 text-center overflow-hidden relative">
          <div className="max-w-4xl mx-auto px-12 relative z-10">
            <h3 className="font-newsreader text-4xl md:text-5xl leading-[1.4] font-light">
              Your practice, precisely as you intended.
              <span className="block mt-10 italic opacity-80">
                GlowOS maintains the standard behind every appointment, every interaction, every outcome—without ever drawing attention to itself.
              </span>
            </h3>
            <div className="mt-16">
              <div className="font-inter text-[10px] uppercase tracking-[0.4em] text-primary-fixed/60 font-semibold">
                GlowOS | The Standard in Clinical Hospitality
              </div>
            </div>
          </div>
          {/* Ambient glows */}
          <div className="absolute top-0 right-0 w-[600px] h-[600px] bg-primary-container rounded-full blur-[150px] -mr-[300px] -mt-[300px] opacity-30" />
          <div className="absolute bottom-0 left-0 w-[600px] h-[600px] bg-primary-container rounded-full blur-[150px] -ml-[300px] -mb-[300px] opacity-20" />
        </section>

        {/* ── Pricing ─────────────────────────────────────────────────────────── */}
        <section id="pricing" className="py-40 px-12 bg-surface">
          <div className="max-w-[1440px] mx-auto">

            <div className="text-center mb-24">
              <span className="font-inter text-[11px] uppercase tracking-[0.25em] text-secondary mb-4 block">Membership</span>
              <h2 className="font-newsreader text-5xl text-primary font-light italic">Structured for Your Practice</h2>
              <p className="font-manrope text-on-surface-variant mt-6 opacity-80">
                Three levels of integration. Each calibrated to a different scale of ambition.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-12 items-stretch">

              {/* Studio */}
              <div className="bg-surface-container-low p-16 rounded border border-transparent hover:border-outline-variant/20 transition-all duration-500 flex flex-col h-full">
                <div className="font-inter text-[10px] uppercase tracking-[0.2em] text-secondary mb-10 font-bold">Studio</div>
                <div className="font-newsreader text-6xl text-primary mb-8 font-light">
                  $499<span className="text-lg text-on-surface-variant font-normal">/mo</span>
                </div>
                <ul className="space-y-6 mb-16 flex-grow font-manrope">
                  <li className="text-sm flex items-center gap-4 text-on-surface-variant">
                    <span className="material-symbols-outlined text-secondary text-sm">check</span>
                    <span>Core Dashboard</span>
                  </li>
                  <li className="text-sm flex items-center gap-4 text-on-surface-variant">
                    <span className="material-symbols-outlined text-secondary text-sm">check</span>
                    <span>Smart Scheduling</span>
                  </li>
                  <li className="text-sm flex items-center gap-4 text-on-surface-variant">
                    <span className="material-symbols-outlined text-secondary text-sm">check</span>
                    <span>Up to 500 Patients</span>
                  </li>
                </ul>
                <Link
                  href="/signup"
                  className="w-full border border-primary text-primary py-5 text-xs font-inter font-semibold uppercase tracking-widest hover:bg-primary hover:text-on-primary transition-all text-center block"
                >
                  Begin Trial
                </Link>
              </div>

              {/* Estate — featured */}
              <div className="bg-surface-container-lowest p-16 rounded border-2 border-primary relative shadow-2xl flex flex-col h-full md:-translate-y-4">
                <div className="absolute top-0 right-0 bg-primary text-on-primary text-[9px] uppercase tracking-widest px-6 py-2 rounded-bl font-inter font-bold">
                  Most Refined
                </div>
                <div className="font-inter text-[10px] uppercase tracking-[0.2em] text-secondary mb-10 font-bold">Estate</div>
                <div className="font-newsreader text-6xl text-primary mb-8 font-light">
                  $1,299<span className="text-lg text-on-surface-variant font-normal">/mo</span>
                </div>
                <ul className="space-y-6 mb-16 flex-grow font-manrope">
                  <li className="text-sm flex items-center gap-4 text-on-surface-variant">
                    <span className="material-symbols-outlined text-secondary text-sm">check</span>
                    <span>AI Concierge Access</span>
                  </li>
                  <li className="text-sm flex items-center gap-4 text-on-surface-variant">
                    <span className="material-symbols-outlined text-secondary text-sm">check</span>
                    <span>Custom Patient Portals</span>
                  </li>
                  <li className="text-sm flex items-center gap-4 text-on-surface-variant">
                    <span className="material-symbols-outlined text-secondary text-sm">check</span>
                    <span>Unlimited Capacity</span>
                  </li>
                  <li className="text-sm flex items-center gap-4 text-on-surface-variant">
                    <span className="material-symbols-outlined text-secondary text-sm">check</span>
                    <span>Revenue Automation</span>
                  </li>
                </ul>
                <Link
                  href="/signup"
                  className="w-full bg-primary text-on-primary py-5 text-xs font-inter font-semibold uppercase tracking-widest hover:bg-primary-container transition-all text-center block"
                >
                  Select Estate
                </Link>
              </div>

              {/* Institutional */}
              <div className="bg-surface-container-low p-16 rounded border border-transparent flex flex-col h-full">
                <div className="font-inter text-[10px] uppercase tracking-[0.2em] text-secondary mb-10 font-bold">Institutional</div>
                <div className="font-newsreader text-6xl text-primary mb-8 font-light italic">Bespoke</div>
                <p className="font-manrope text-sm text-on-surface-variant mb-8 leading-relaxed opacity-80">
                  For multi-location clinics and aesthetic groups requiring custom infrastructure.
                </p>
                <ul className="space-y-6 mb-16 flex-grow font-manrope">
                  <li className="text-sm flex items-center gap-4 text-on-surface-variant">
                    <span className="material-symbols-outlined text-secondary text-sm">check</span>
                    <span>White-glove Onboarding</span>
                  </li>
                  <li className="text-sm flex items-center gap-4 text-on-surface-variant">
                    <span className="material-symbols-outlined text-secondary text-sm">check</span>
                    <span>Multi-location Sync</span>
                  </li>
                  <li className="text-sm flex items-center gap-4 text-on-surface-variant">
                    <span className="material-symbols-outlined text-secondary text-sm">check</span>
                    <span>Dedicated Concierge Manager</span>
                  </li>
                </ul>
                <button className="w-full border border-outline-variant text-primary py-5 text-xs font-inter font-semibold uppercase tracking-widest hover:border-primary transition-all">
                  Arrange a Conversation
                </button>
              </div>

            </div>
          </div>
        </section>

      </main>

      {/* ── Footer ──────────────────────────────────────────────────────────── */}
      <footer className="bg-surface-container-low w-full py-24 px-12 border-t border-outline-variant/20">
        <div className="max-w-[1440px] mx-auto flex flex-col md:flex-row justify-between items-start md:items-center gap-12 w-full">
          <div className="flex flex-col gap-4">
            <span className="font-newsreader text-2xl italic font-semibold text-primary">GlowOS Hospitality.</span>
            <p className="font-manrope text-xs tracking-wide text-on-surface-variant/60 font-medium">
              © 2026 GlowOS Hospitality. All rights reserved.
            </p>
          </div>
          <div className="flex flex-wrap gap-x-12 gap-y-4">
            <a href="#" className="font-inter text-[10px] uppercase tracking-[0.2em] text-on-surface-variant/60 hover:text-primary transition-colors underline underline-offset-8 decoration-outline-variant/30">Privacy Policy</a>
            <a href="#" className="font-inter text-[10px] uppercase tracking-[0.2em] text-on-surface-variant/60 hover:text-primary transition-colors">Terms of Service</a>
            <a href="#" className="font-inter text-[10px] uppercase tracking-[0.2em] text-on-surface-variant/60 hover:text-primary transition-colors">Accessibility</a>
            <a href="#" className="font-inter text-[10px] uppercase tracking-[0.2em] text-on-surface-variant/60 hover:text-primary transition-colors">Contact</a>
          </div>
        </div>
      </footer>

    </div>
  );
}
