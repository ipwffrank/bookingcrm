'use client';

import { useParams } from 'next/navigation';
import Link from 'next/link';
import { ClientFullDetail } from '../../components/ClientFullDetail';

export default function ClientProfilePage() {
  const params = useParams<{ id: string }>();
  return (
    <div id="client-profile-print-root" className="max-w-3xl mx-auto space-y-6 font-manrope">
      <div className="flex items-center gap-2 print:hidden">
        <Link href="/dashboard/clients" className="flex items-center gap-1.5 text-xs text-grey-60 hover:text-grey-90 transition-colors">
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7"/>
          </svg>
          All Clients
        </Link>
      </div>
      <ClientFullDetail profileId={params.id} />
    </div>
  );
}
