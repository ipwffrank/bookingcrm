import Link from 'next/link';

export default function HomePage() {
  return (
    <div className="min-h-screen bg-white">
      {/* Nav */}
      <nav className="border-b border-gray-100 px-6 py-4">
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          <span className="text-xl font-bold text-indigo-600">GlowOS</span>
          <div className="flex items-center gap-4">
            <Link href="/login" className="text-sm text-gray-600 hover:text-gray-900">
              Log in
            </Link>
            <Link
              href="/signup"
              className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 transition-colors"
            >
              Start Free Trial
            </Link>
          </div>
        </div>
      </nav>

      {/* Hero */}
      <section className="bg-gradient-to-br from-indigo-50 via-white to-purple-50 px-6 py-24 text-center">
        <div className="max-w-4xl mx-auto">
          <div className="inline-flex items-center gap-2 rounded-full bg-indigo-100 px-4 py-1.5 text-sm font-medium text-indigo-700 mb-6">
            🇸🇬 Built for Singapore Salons
          </div>
          <h1 className="text-5xl font-bold text-gray-900 leading-tight mb-6">
            The Smart Booking Platform
            <br />
            <span className="text-indigo-600">for Singapore&apos;s Best Salons</span>
          </h1>
          <p className="text-xl text-gray-500 mb-10 max-w-2xl mx-auto">
            Get booked on Google. Keep clients coming back. Zero effort.
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Link
              href="/signup"
              className="rounded-xl bg-indigo-600 px-8 py-4 text-base font-semibold text-white hover:bg-indigo-700 transition-colors shadow-lg shadow-indigo-200"
            >
              Start Free Trial
            </Link>
            <a
              href="#pricing"
              className="rounded-xl border border-gray-200 px-8 py-4 text-base font-semibold text-gray-700 hover:border-indigo-300 hover:text-indigo-600 transition-colors"
            >
              See Pricing
            </a>
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="px-6 py-24 bg-white">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-16">
            <h2 className="text-3xl font-bold text-gray-900 mb-4">Everything you need to grow</h2>
            <p className="text-gray-500 text-lg">Powerful tools, beautifully simple.</p>
          </div>
          <div className="grid md:grid-cols-3 gap-8">
            {[
              {
                icon: '🗺️',
                title: 'Book via Google',
                description:
                  'Get a booking button on Google Maps & Search. Clients find you, book instantly — no phone calls needed.',
              },
              {
                icon: '💎',
                title: 'VIP Intelligence',
                description:
                  'Know your best clients. Spot who\'s slipping away. Our AI scores every client so you know where to focus.',
              },
              {
                icon: '✨',
                title: 'Smart Campaigns',
                description:
                  'AI-powered WhatsApp re-engagement that actually works. Win back lapsed clients on autopilot.',
              },
            ].map((feature) => (
              <div
                key={feature.title}
                className="rounded-2xl border border-gray-100 p-8 hover:border-indigo-200 hover:shadow-lg hover:shadow-indigo-50 transition-all"
              >
                <div className="text-4xl mb-4">{feature.icon}</div>
                <h3 className="text-xl font-semibold text-gray-900 mb-3">{feature.title}</h3>
                <p className="text-gray-500 leading-relaxed">{feature.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Social Proof */}
      <section className="bg-indigo-600 px-6 py-16 text-white text-center">
        <div className="max-w-4xl mx-auto">
          <div className="grid grid-cols-3 gap-8">
            {[
              { stat: '2,400+', label: 'Salons on GlowOS' },
              { stat: '98%', label: 'Client satisfaction' },
              { stat: 'SGD 4.2M', label: 'Processed monthly' },
            ].map((item) => (
              <div key={item.label}>
                <div className="text-4xl font-bold mb-2">{item.stat}</div>
                <div className="text-indigo-200 text-sm">{item.label}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Pricing */}
      <section id="pricing" className="px-6 py-24 bg-gray-50">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-16">
            <h2 className="text-3xl font-bold text-gray-900 mb-4">Simple, transparent pricing</h2>
            <p className="text-gray-500 text-lg">Start free. No credit card required.</p>
          </div>
          <div className="grid md:grid-cols-3 gap-8">
            {[
              {
                name: 'Starter',
                price: '$49',
                period: '/mo',
                description: 'Perfect for solo stylists',
                features: [
                  'Up to 2 staff',
                  'Online booking widget',
                  'Automated reminders',
                  'Basic analytics',
                ],
                cta: 'Start Free Trial',
                highlighted: false,
              },
              {
                name: 'Pro',
                price: '$99',
                period: '/mo',
                description: 'For growing salons',
                features: [
                  'Unlimited staff',
                  'VIP scoring & insights',
                  'WhatsApp campaigns',
                  'Google Reserve integration',
                  'Advanced analytics',
                ],
                cta: 'Start Free Trial',
                highlighted: true,
              },
              {
                name: 'Business',
                price: '$199',
                period: '/mo',
                description: 'For multi-location businesses',
                features: [
                  'Everything in Pro',
                  'Daily payouts',
                  'Priority support',
                  'Custom domain',
                  'Multi-location',
                ],
                cta: 'Contact Sales',
                highlighted: false,
              },
            ].map((plan) => (
              <div
                key={plan.name}
                className={`rounded-2xl p-8 ${
                  plan.highlighted
                    ? 'bg-indigo-600 text-white ring-2 ring-indigo-600 shadow-xl shadow-indigo-100'
                    : 'bg-white border border-gray-200'
                }`}
              >
                <div className="mb-6">
                  <h3
                    className={`text-xl font-bold mb-1 ${
                      plan.highlighted ? 'text-white' : 'text-gray-900'
                    }`}
                  >
                    {plan.name}
                  </h3>
                  <p
                    className={`text-sm mb-4 ${
                      plan.highlighted ? 'text-indigo-200' : 'text-gray-500'
                    }`}
                  >
                    {plan.description}
                  </p>
                  <div className="flex items-end gap-1">
                    <span
                      className={`text-4xl font-bold ${
                        plan.highlighted ? 'text-white' : 'text-gray-900'
                      }`}
                    >
                      {plan.price}
                    </span>
                    <span
                      className={`text-sm mb-1 ${
                        plan.highlighted ? 'text-indigo-200' : 'text-gray-400'
                      }`}
                    >
                      {plan.period}
                    </span>
                  </div>
                </div>
                <ul className="space-y-3 mb-8">
                  {plan.features.map((feature) => (
                    <li key={feature} className="flex items-center gap-2 text-sm">
                      <span
                        className={`text-lg ${plan.highlighted ? 'text-indigo-200' : 'text-indigo-500'}`}
                      >
                        ✓
                      </span>
                      <span className={plan.highlighted ? 'text-indigo-100' : 'text-gray-600'}>
                        {feature}
                      </span>
                    </li>
                  ))}
                </ul>
                <Link
                  href="/signup"
                  className={`block w-full rounded-xl py-3 text-center text-sm font-semibold transition-colors ${
                    plan.highlighted
                      ? 'bg-white text-indigo-600 hover:bg-indigo-50'
                      : 'bg-indigo-600 text-white hover:bg-indigo-700'
                  }`}
                >
                  {plan.cta}
                </Link>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-gray-100 px-6 py-12 bg-white">
        <div className="max-w-6xl mx-auto">
          <div className="flex flex-col md:flex-row justify-between gap-8">
            <div>
              <div className="text-xl font-bold text-indigo-600 mb-2">GlowOS</div>
              <p className="text-sm text-gray-500">Smart booking for Singapore&apos;s best salons.</p>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-8 text-sm">
              <div>
                <div className="font-medium text-gray-900 mb-3">Product</div>
                <ul className="space-y-2 text-gray-500">
                  <li>
                    <a href="#" className="hover:text-indigo-600">
                      Features
                    </a>
                  </li>
                  <li>
                    <a href="#pricing" className="hover:text-indigo-600">
                      Pricing
                    </a>
                  </li>
                  <li>
                    <a href="#" className="hover:text-indigo-600">
                      Changelog
                    </a>
                  </li>
                </ul>
              </div>
              <div>
                <div className="font-medium text-gray-900 mb-3">Company</div>
                <ul className="space-y-2 text-gray-500">
                  <li>
                    <a href="#" className="hover:text-indigo-600">
                      About
                    </a>
                  </li>
                  <li>
                    <a href="#" className="hover:text-indigo-600">
                      Blog
                    </a>
                  </li>
                  <li>
                    <a href="#" className="hover:text-indigo-600">
                      Careers
                    </a>
                  </li>
                </ul>
              </div>
              <div>
                <div className="font-medium text-gray-900 mb-3">Support</div>
                <ul className="space-y-2 text-gray-500">
                  <li>
                    <a href="#" className="hover:text-indigo-600">
                      Help Centre
                    </a>
                  </li>
                  <li>
                    <a href="#" className="hover:text-indigo-600">
                      Contact
                    </a>
                  </li>
                  <li>
                    <a href="#" className="hover:text-indigo-600">
                      Privacy
                    </a>
                  </li>
                </ul>
              </div>
            </div>
          </div>
          <div className="border-t border-gray-100 mt-8 pt-8 text-center text-xs text-gray-400">
            © {new Date().getFullYear()} GlowOS Pte Ltd. All rights reserved.
          </div>
        </div>
      </footer>
    </div>
  );
}
