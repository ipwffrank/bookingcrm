'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { apiFetch, ApiError } from '../../lib/api';

interface ReviewStats {
  avgRating: number;
  totalReviews: number;
  reviewsThisMonth: number;
  responseRate: number;
  completedBookings: number;
  needsAttention: number;
}

interface ReviewItem {
  id: string;
  rating: number;
  comment: string | null;
  createdAt: string;
  clientName: string;
  clientEmail: string;
  serviceName: string;
  staffName: string;
  appointmentDate: string;
}

type Period = '7d' | '30d' | '90d' | 'all';

function getInitials(name: string): string {
  return name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleDateString('en-SG', { day: 'numeric', month: 'short', year: 'numeric' });
}

function Stars({ rating }: { rating: number }) {
  return (
    <span className="text-sm tracking-wider">
      {[1, 2, 3, 4, 5].map(s => (
        <span key={s} className={s <= rating ? 'text-[#c4a778]' : 'text-gray-200'}>★</span>
      ))}
    </span>
  );
}

const AVATAR_COLORS = [
  { bg: 'bg-blue-100', text: 'text-blue-600' },
  { bg: 'bg-pink-100', text: 'text-pink-600' },
  { bg: 'bg-purple-100', text: 'text-purple-600' },
  { bg: 'bg-emerald-100', text: 'text-emerald-600' },
  { bg: 'bg-amber-100', text: 'text-amber-700' },
  { bg: 'bg-cyan-100', text: 'text-cyan-600' },
];

function avatarColor(name: string) {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

export default function ReviewsPage() {
  const router = useRouter();
  const [stats, setStats] = useState<ReviewStats | null>(null);
  const [reviews, setReviews] = useState<ReviewItem[]>([]);
  const [loading, setLoading] = useState(true);

  const [period, setPeriod] = useState<Period>('30d');
  const [ratingFilter, setRatingFilter] = useState<string>('');
  const [staffFilter, setStaffFilter] = useState<string>('');
  const [staffList, setStaffList] = useState<{ id: string; name: string }[]>([]);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ period });
      if (ratingFilter) params.set('rating', ratingFilter);
      if (staffFilter) params.set('staffId', staffFilter);

      const [statsData, reviewsData] = await Promise.all([
        apiFetch(`/merchant/reviews/stats?period=${period}`),
        apiFetch(`/merchant/reviews?${params.toString()}`),
      ]);

      setStats(statsData as ReviewStats);
      setReviews((reviewsData as { reviews: ReviewItem[] }).reviews);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) router.push('/login');
    } finally {
      setLoading(false);
    }
  }, [period, ratingFilter, staffFilter, router]);

  useEffect(() => {
    apiFetch('/merchant/staff')
      .then((data: unknown) => {
        const result = data as { staff: { id: string; name: string }[] };
        setStaffList(result.staff);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    const token = localStorage.getItem('access_token');
    if (!token) { router.push('/login'); return; }
    fetchData();
  }, [fetchData, router]);

  return (
    <div className="max-w-4xl mx-auto">
      <h1 className="text-2xl font-bold text-gray-900 mb-6">Reviews</h1>

      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
          <div className="bg-white border border-gray-200 rounded-xl p-4">
            <p className="text-xs text-gray-500 uppercase tracking-wide">Avg Rating</p>
            <p className="text-2xl font-bold text-gray-900 mt-1">{stats.avgRating.toFixed(1)}</p>
            <Stars rating={Math.round(stats.avgRating)} />
          </div>
          <div className="bg-white border border-gray-200 rounded-xl p-4">
            <p className="text-xs text-gray-500 uppercase tracking-wide">Total Reviews</p>
            <p className="text-2xl font-bold text-gray-900 mt-1">{stats.totalReviews}</p>
            <p className="text-xs text-emerald-600 mt-0.5">+{stats.reviewsThisMonth} this month</p>
          </div>
          <div className="bg-white border border-gray-200 rounded-xl p-4">
            <p className="text-xs text-gray-500 uppercase tracking-wide">Response Rate</p>
            <p className="text-2xl font-bold text-gray-900 mt-1">{Math.round(stats.responseRate * 100)}%</p>
            <p className="text-xs text-gray-400 mt-0.5">{stats.totalReviews} of {stats.completedBookings} bookings</p>
          </div>
          <div className="bg-white border border-gray-200 rounded-xl p-4">
            <p className="text-xs text-gray-500 uppercase tracking-wide">Needs Attention</p>
            <p className={`text-2xl font-bold mt-1 ${stats.needsAttention > 0 ? 'text-red-500' : 'text-gray-900'}`}>{stats.needsAttention}</p>
            <p className="text-xs text-red-400 mt-0.5">&le; 3 stars</p>
          </div>
        </div>
      )}

      <div className="flex flex-wrap gap-2 mb-4">
        <select
          value={ratingFilter}
          onChange={e => setRatingFilter(e.target.value)}
          className="px-3 py-2 border border-gray-200 rounded-lg text-sm text-gray-700 bg-white"
        >
          <option value="">All ratings</option>
          {[5, 4, 3, 2, 1].map(r => (
            <option key={r} value={r}>{'★'.repeat(r)} ({r})</option>
          ))}
        </select>
        <select
          value={staffFilter}
          onChange={e => setStaffFilter(e.target.value)}
          className="px-3 py-2 border border-gray-200 rounded-lg text-sm text-gray-700 bg-white"
        >
          <option value="">All staff</option>
          {staffList.map(s => (
            <option key={s.id} value={s.id}>{s.name}</option>
          ))}
        </select>
        <select
          value={period}
          onChange={e => setPeriod(e.target.value as Period)}
          className="px-3 py-2 border border-gray-200 rounded-lg text-sm text-gray-700 bg-white"
        >
          <option value="7d">Last 7 days</option>
          <option value="30d">Last 30 days</option>
          <option value="90d">Last 90 days</option>
          <option value="all">All time</option>
        </select>
      </div>

      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3].map(i => (
            <div key={i} className="bg-white border border-gray-200 rounded-xl p-4 animate-pulse">
              <div className="flex gap-3">
                <div className="w-9 h-9 rounded-full bg-gray-200" />
                <div className="flex-1 space-y-2">
                  <div className="h-4 bg-gray-200 rounded w-1/3" />
                  <div className="h-3 bg-gray-100 rounded w-1/2" />
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : reviews.length === 0 ? (
        <div className="bg-white border border-gray-200 rounded-xl p-8 text-center">
          <p className="text-gray-400 text-sm">No reviews found for the selected filters.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {reviews.map(review => {
            const isLow = review.rating <= 3;
            const color = avatarColor(review.clientName);
            return (
              <div
                key={review.id}
                className={`rounded-xl border p-4 ${isLow ? 'bg-red-50 border-red-200' : 'bg-white border-gray-200'}`}
              >
                <div className="flex justify-between items-start mb-2">
                  <div className="flex items-center gap-3">
                    <div className={`w-9 h-9 rounded-full ${color.bg} flex items-center justify-center font-semibold text-xs ${color.text} flex-shrink-0`}>
                      {getInitials(review.clientName)}
                    </div>
                    <div>
                      <p className="font-semibold text-sm text-gray-900">{review.clientName}</p>
                      <p className="text-xs text-gray-400">{review.serviceName} &middot; {review.staffName} &middot; {formatDate(review.appointmentDate)}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    {isLow && (
                      <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-red-100 text-red-600 border border-red-200">Needs attention</span>
                    )}
                    <Stars rating={review.rating} />
                  </div>
                </div>
                {review.comment && (
                  <p className="text-sm text-gray-700 leading-relaxed">&ldquo;{review.comment}&rdquo;</p>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
