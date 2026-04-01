'use client';

import { useEffect, useState, useMemo } from 'react';
import dynamic from 'next/dynamic';
import { useRouter } from 'next/navigation';
import { getMapObservations } from '@/lib/database/stats';
import { useAuth } from '@/components/auth/AuthProvider';
import Card from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import LoadingSpinner from '@/components/ui/LoadingSpinner';

// Leaflet must be loaded client-side only
const ObservationMap = dynamic(() => import('@/components/ui/ObservationMap'), {
  ssr: false,
  loading: () => (
    <div style={{
      height: '500px',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: 'var(--color-surface-elevated)',
      borderRadius: 'var(--radius-lg)',
    }}>
      <LoadingSpinner />
    </div>
  ),
});

interface MapObservation {
  id: string;
  turtle_name: string | null;
  encounter_date: string;
  latitude: number;
  longitude: number;
  did_she_nest: boolean | null;
  is_recapture: boolean;
  beach_sector: string | null;
  observer_name: string;
  species: string | null;
}

type YearFilter = 'all' | number;
type NestFilter = 'all' | 'nested' | 'not_nested';

export default function MapPage() {
  const router = useRouter();
  const { profile } = useAuth();
  const orgId = profile?.org_id || '';
  const [observations, setObservations] = useState<MapObservation[]>([]);
  const [loading, setLoading] = useState(true);
  const [yearFilter, setYearFilter] = useState<YearFilter>(new Date().getFullYear());
  const [nestFilter, setNestFilter] = useState<NestFilter>('all');

  useEffect(() => {
    if (!orgId) return;
    async function load() {
      setLoading(true);
      const filters: Parameters<typeof getMapObservations>[1] = {};
      if (yearFilter !== 'all') {
        filters.yearFrom = yearFilter as number;
        filters.yearTo = yearFilter as number;
      }
      if (nestFilter === 'nested') {
        filters.didNest = true;
      } else if (nestFilter === 'not_nested') {
        filters.didNest = false;
      }
      const data = await getMapObservations(orgId, filters);
      setObservations(data);
      setLoading(false);
    }
    load();
  }, [yearFilter, nestFilter, orgId]);

  // Compute available years from data for the filter
  const currentYear = new Date().getFullYear();
  const yearOptions = useMemo(() => {
    const years: number[] = [];
    for (let y = currentYear; y >= currentYear - 5; y--) {
      years.push(y);
    }
    return years;
  }, [currentYear]);

  // Summary stats
  const stats = useMemo(() => {
    const nested = observations.filter(o => o.did_she_nest).length;
    const recaptures = observations.filter(o => o.is_recapture).length;
    const uniqueTurtles = new Set(observations.map(o => o.turtle_name).filter(Boolean)).size;
    return { total: observations.length, nested, recaptures, uniqueTurtles };
  }, [observations]);

  const selectStyle: React.CSSProperties = {
    padding: '6px 12px',
    fontSize: '12px',
    backgroundColor: 'var(--color-surface-elevated)',
    color: 'var(--color-text)',
    border: '1px solid var(--color-border)',
    borderRadius: 'var(--radius-sm)',
    cursor: 'pointer',
  };

  return (
    <div style={{ padding: '28px' }}>
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: '28px',
      }}>
        <div>
          <h1 style={{
            fontSize: '28px',
            fontWeight: '700',
            color: 'var(--color-text)',
            marginBottom: '4px',
            letterSpacing: '-0.5px',
          }}>
            Observation Map
          </h1>
          <p style={{
            color: 'var(--color-text-muted)',
            fontSize: '14px',
          }}>
            GPS-tagged observations across all seasons
          </p>
        </div>

        {/* Filters */}
        <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
          <select
            value={yearFilter}
            onChange={(e) => setYearFilter(e.target.value === 'all' ? 'all' : Number(e.target.value))}
            style={selectStyle}
          >
            <option value="all">All years</option>
            {yearOptions.map(y => (
              <option key={y} value={y}>{y}</option>
            ))}
          </select>

          <select
            value={nestFilter}
            onChange={(e) => setNestFilter(e.target.value as NestFilter)}
            style={selectStyle}
          >
            <option value="all">All observations</option>
            <option value="nested">Nested only</option>
            <option value="not_nested">Did not nest</option>
          </select>
        </div>
      </div>

      {/* Summary chips */}
      <div style={{
        display: 'flex',
        gap: '12px',
        marginBottom: '16px',
        flexWrap: 'wrap',
      }}>
        <div style={{
          padding: '6px 14px',
          backgroundColor: 'rgba(255, 87, 87, 0.08)',
          border: '1px solid rgba(255, 87, 87, 0.15)',
          borderRadius: '20px',
          fontSize: '12px',
          color: 'var(--color-primary-light)',
          fontWeight: '600',
        }}>
          {stats.total} observations
        </div>
        <div style={{
          padding: '6px 14px',
          backgroundColor: 'rgba(16, 185, 129, 0.08)',
          border: '1px solid rgba(16, 185, 129, 0.15)',
          borderRadius: '20px',
          fontSize: '12px',
          color: 'var(--color-success-light)',
          fontWeight: '600',
        }}>
          {stats.nested} nested
        </div>
        <div style={{
          padding: '6px 14px',
          backgroundColor: 'rgba(59, 130, 246, 0.08)',
          border: '1px solid rgba(59, 130, 246, 0.15)',
          borderRadius: '20px',
          fontSize: '12px',
          color: 'var(--color-info-light)',
          fontWeight: '600',
        }}>
          {stats.recaptures} recaptures
        </div>
        <div style={{
          padding: '6px 14px',
          backgroundColor: 'rgba(255, 255, 255, 0.04)',
          border: '1px solid var(--color-border)',
          borderRadius: '20px',
          fontSize: '12px',
          color: 'var(--color-text-secondary)',
          fontWeight: '600',
        }}>
          {stats.uniqueTurtles} unique turtles
        </div>
      </div>

      {/* Map */}
      <Card padding="0px">
        {loading ? (
          <div style={{
            height: '500px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}>
            <LoadingSpinner />
          </div>
        ) : observations.length === 0 ? (
          <div style={{
            height: '500px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexDirection: 'column',
            gap: '12px',
          }}>
            <span style={{ fontSize: '40px' }}>🗺️</span>
            <p style={{ color: 'var(--color-text-muted)', fontSize: '14px' }}>
              No observations with GPS data for this filter
            </p>
          </div>
        ) : (
          <>
            {observations.length >= 500 && (
              <div style={{
                padding: '8px 14px',
                backgroundColor: 'rgba(245, 158, 11, 0.08)',
                borderBottom: '1px solid rgba(245, 158, 11, 0.15)',
                fontSize: '12px',
                color: 'var(--color-warning-light)',
              }}>
                Showing most recent 500 observations. Use filters to narrow results.
              </div>
            )}
            <ObservationMap
              observations={observations}
              onMarkerClick={(id) => router.push(`/dashboard/observations/${id}`)}
              style={{ height: '500px' }}
            />
          </>
        )}
      </Card>

      {/* Legend */}
      <div style={{
        display: 'flex',
        gap: '20px',
        marginTop: '14px',
        justifyContent: 'center',
      }}>
        {[
          { color: '#ff5757', label: 'Standard sighting' },
          { color: '#10b981', label: 'Nested' },
          { color: '#3b82f6', label: 'Recapture' },
        ].map(item => (
          <div key={item.label} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <div style={{
              width: '10px',
              height: '10px',
              borderRadius: '50%',
              backgroundColor: item.color,
              border: '2px solid rgba(255,255,255,0.6)',
            }} />
            <span style={{ fontSize: '12px', color: 'var(--color-text-muted)' }}>{item.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
