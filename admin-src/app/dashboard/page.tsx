'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/components/auth/AuthProvider';
import { useStats } from '@/hooks/useStats';
import { getRecentActivity, getActionItemCounts, getLastYearObservationCount } from '@/lib/database/stats';
import StatCard from '@/components/ui/StatCard';
import Button from '@/components/ui/Button';
import Card from '@/components/ui/Card';

interface RecentActivityItem {
  id: string;
  turtle_name: string | null;
  encounter_date: string;
  observer_name: string;
  did_she_nest: boolean | null;
  is_recapture: boolean;
  beach_sector: string | null;
}

interface ActionCounts {
  unnamedTurtles: number;
  researchFlags: number;
  activeAlerts: number;
}

export default function DashboardPage() {
  const { profile, organization } = useAuth();
  const router = useRouter();
  const orgId = profile?.org_id || '';
  const { stats, loading, error, refresh } = useStats({ orgId, autoRefresh: false, refreshInterval: 300000 });

  const [recentActivity, setRecentActivity] = useState<RecentActivityItem[]>([]);
  const [actionCounts, setActionCounts] = useState<ActionCounts>({ unnamedTurtles: 0, researchFlags: 0, activeAlerts: 0 });
  const [lastYearObs, setLastYearObs] = useState<number>(0);
  const [extraLoading, setExtraLoading] = useState(true);

  useEffect(() => {
    if (!orgId) return;
    async function fetchExtra() {
      try {
        const [activity, counts, lastYear] = await Promise.all([
          getRecentActivity(orgId, 10),
          getActionItemCounts(orgId),
          getLastYearObservationCount(orgId),
        ]);
        setRecentActivity(activity);
        setActionCounts(counts);
        setLastYearObs(lastYear);
      } catch (err) {
        console.error('Error fetching dashboard extras:', err);
      } finally {
        setExtraLoading(false);
      }
    }
    fetchExtra();
  }, [orgId]);

  const handleRefresh = async () => {
    // Run stats refresh and extras in parallel — no waterfall
    const [, extras] = await Promise.all([
      refresh(),
      Promise.all([
        getRecentActivity(orgId, 10),
        getActionItemCounts(orgId),
        getLastYearObservationCount(orgId),
      ]).catch((err) => {
        console.error('Error refreshing dashboard extras:', err);
        return null;
      }),
    ]);
    if (extras) {
      const [activity, counts, lastYear] = extras;
      setRecentActivity(activity);
      setActionCounts(counts);
      setLastYearObs(lastYear);
    }
  };

  const totalActionItems = actionCounts.unnamedTurtles + actionCounts.researchFlags + actionCounts.activeAlerts;

  // Season comparison
  const obsThisYear = stats?.observationsThisYear ?? 0;
  const seasonDiff = lastYearObs > 0 ? Math.round(((obsThisYear - lastYearObs) / lastYearObs) * 100) : 0;

  function formatDate(dateStr: string) {
    const d = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - d.getTime();
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    if (diffDays === 0) return 'Today';
    if (diffDays === 1) return 'Yesterday';
    if (diffDays < 7) return `${diffDays}d ago`;
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }

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
            Dashboard
          </h1>
          <p style={{
            color: 'var(--color-text-muted)',
            fontSize: '14px',
          }}>
            {organization?.name || 'No Organization'}
          </p>
        </div>
        <Button onClick={handleRefresh} variant="secondary" size="sm" disabled={loading}>
          {loading ? 'Refreshing...' : 'Refresh'}
        </Button>
      </div>

      {error && (
        <div style={{
          backgroundColor: 'rgba(239, 68, 68, 0.08)',
          border: '1px solid rgba(239, 68, 68, 0.2)',
          borderRadius: 'var(--radius-lg)',
          padding: '14px 18px',
          marginBottom: '24px',
          color: '#f87171',
          fontSize: '14px',
        }}>
          Error loading statistics: {error.message}
        </div>
      )}

      {/* Key Metrics Grid */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
        gap: '16px',
        marginBottom: '24px',
      }}>
        <StatCard
          title="Total Turtles"
          value={stats?.totalTurtles ?? 0}
          subtitle="Documented in database"
          icon="🐢"
        />
        <StatCard
          title="Observations This Year"
          value={stats?.observationsThisYear ?? 0}
          subtitle={
            lastYearObs > 0 && !extraLoading
              ? seasonDiff >= 0
                ? `+${seasonDiff}% vs ${new Date().getFullYear() - 1}`
                : `${seasonDiff}% vs ${new Date().getFullYear() - 1}`
              : `${new Date().getFullYear()} season`
          }
          icon="📊"
        />
        <StatCard
          title="Last Night"
          value={stats?.lastNightObservations ?? 0}
          subtitle="Observations recorded"
          icon="🌙"
        />
        <StatCard
          title="Active Volunteers"
          value={stats?.activeVolunteers ?? 0}
          subtitle="Currently checked in"
          icon="👥"
        />
      </div>

      {/* Volunteer Metrics */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
        gap: '16px',
        marginBottom: '24px',
      }}>
        <StatCard
          title="Volunteer Hours"
          value={stats?.volunteerHours ?? 0}
          subtitle="Total logged time"
          icon="⏱️"
        />
        <StatCard
          title="Avg Session Duration"
          value={`${stats?.avgSessionDuration ?? 0}h`}
          subtitle="Per survey session"
          icon="📈"

        />
      </div>

      {/* Action Items Row — placed below stat cards to avoid CLS */}
      {totalActionItems > 0 && !extraLoading && (
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
          gap: '12px',
          marginBottom: '24px',
        }}>
          {actionCounts.unnamedTurtles > 0 && (
            <div
              onClick={() => router.push('/dashboard/turtles/unnamed')}
              style={{
                backgroundColor: 'rgba(245, 158, 11, 0.06)',
                border: '1px solid rgba(245, 158, 11, 0.15)',
                borderRadius: 'var(--radius-lg)',
                padding: '14px 18px',
                cursor: 'pointer',
                transition: 'all 0.15s ease',
                display: 'flex',
                alignItems: 'center',
                gap: '12px',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.borderColor = 'rgba(245, 158, 11, 0.35)';
                e.currentTarget.style.backgroundColor = 'rgba(245, 158, 11, 0.1)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.borderColor = 'rgba(245, 158, 11, 0.15)';
                e.currentTarget.style.backgroundColor = 'rgba(245, 158, 11, 0.06)';
              }}
            >
              <span style={{ fontSize: '20px', lineHeight: 1 }}>🏷️</span>
              <div>
                <div style={{ fontSize: '20px', fontWeight: '700', color: 'var(--color-warning-light)', lineHeight: 1, marginBottom: '3px' }}>
                  {actionCounts.unnamedTurtles}
                </div>
                <div style={{ fontSize: '12px', color: 'var(--color-text-muted)' }}>
                  Unnamed turtles
                </div>
              </div>
            </div>
          )}

          {actionCounts.researchFlags > 0 && (
            <div
              onClick={() => router.push('/dashboard/turtles/research')}
              style={{
                backgroundColor: 'rgba(59, 130, 246, 0.06)',
                border: '1px solid rgba(59, 130, 246, 0.15)',
                borderRadius: 'var(--radius-lg)',
                padding: '14px 18px',
                cursor: 'pointer',
                transition: 'all 0.15s ease',
                display: 'flex',
                alignItems: 'center',
                gap: '12px',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.borderColor = 'rgba(59, 130, 246, 0.35)';
                e.currentTarget.style.backgroundColor = 'rgba(59, 130, 246, 0.1)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.borderColor = 'rgba(59, 130, 246, 0.15)';
                e.currentTarget.style.backgroundColor = 'rgba(59, 130, 246, 0.06)';
              }}
            >
              <span style={{ fontSize: '20px', lineHeight: 1 }}>🔬</span>
              <div>
                <div style={{ fontSize: '20px', fontWeight: '700', color: 'var(--color-info-light)', lineHeight: 1, marginBottom: '3px' }}>
                  {actionCounts.researchFlags}
                </div>
                <div style={{ fontSize: '12px', color: 'var(--color-text-muted)' }}>
                  Research flags
                </div>
              </div>
            </div>
          )}

          {actionCounts.activeAlerts > 0 && (
            <div
              onClick={() => router.push('/dashboard/alerts')}
              style={{
                backgroundColor: 'rgba(239, 68, 68, 0.06)',
                border: '1px solid rgba(239, 68, 68, 0.15)',
                borderRadius: 'var(--radius-lg)',
                padding: '14px 18px',
                cursor: 'pointer',
                transition: 'all 0.15s ease',
                display: 'flex',
                alignItems: 'center',
                gap: '12px',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.borderColor = 'rgba(239, 68, 68, 0.35)';
                e.currentTarget.style.backgroundColor = 'rgba(239, 68, 68, 0.1)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.borderColor = 'rgba(239, 68, 68, 0.15)';
                e.currentTarget.style.backgroundColor = 'rgba(239, 68, 68, 0.06)';
              }}
            >
              <span style={{ fontSize: '20px', lineHeight: 1 }}>⚠️</span>
              <div>
                <div style={{ fontSize: '20px', fontWeight: '700', color: '#f87171', lineHeight: 1, marginBottom: '3px' }}>
                  {actionCounts.activeAlerts}
                </div>
                <div style={{ fontSize: '12px', color: 'var(--color-text-muted)' }}>
                  Active alerts
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Conservation Metrics + Most Sighted */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: '2fr 1fr',
        gap: '16px',
        marginBottom: '24px',
      }}>
        <Card title="Conservation Metrics">
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
            gap: '16px',
          }}>
            <StatCard
              title="Nesting Success Rate"
              value={`${stats?.nestingSuccessRate ?? 0}%`}
              subtitle="Successful nests / attempts"
              trend={
                stats?.nestingSuccessRate
                  ? stats.nestingSuccessRate >= 50
                    ? 'up'
                    : stats.nestingSuccessRate >= 30
                    ? 'neutral'
                    : 'down'
                  : 'neutral'
              }
            />
            <StatCard
              title="Recapture Rate"
              value={`${stats?.recaptureRate ?? 0}%`}
              subtitle="Turtles seen multiple times"
              trend={stats?.recaptureRate && stats.recaptureRate > 0 ? 'up' : 'neutral'}
            />
          </div>
        </Card>

        <Card title="Most Sighted">
          {stats?.mostSightedTurtle ? (
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: '14px',
            }}>
              <div style={{
                fontSize: '40px',
                lineHeight: 1,
              }}>
                🏆
              </div>
              <div>
                <div style={{
                  fontSize: '20px',
                  fontWeight: '700',
                  color: 'var(--color-text)',
                  marginBottom: '2px',
                  letterSpacing: '-0.3px',
                }}>
                  {stats.mostSightedTurtle.name}
                </div>
                <div style={{
                  fontSize: '13px',
                  color: 'var(--color-text-muted)',
                }}>
                  {stats.mostSightedTurtle.count} observations this year
                </div>
              </div>
            </div>
          ) : (
            <div style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              minHeight: '50px',
              color: 'var(--color-text-muted)',
              fontSize: '13px',
            }}>
              {loading ? 'Loading...' : 'No data yet'}
            </div>
          )}
        </Card>
      </div>

      {/* Recent Activity Feed */}
      <Card
        title="Recent Activity"
        subtitle="Latest observations"
        headerAction={
          <Button
            variant="ghost"
            size="sm"
            onClick={() => router.push('/dashboard/observations')}
          >
            View all
          </Button>
        }
      >
        {extraLoading ? (
          <div style={{ padding: '20px', textAlign: 'center', color: 'var(--color-text-muted)', fontSize: '13px' }}>
            Loading activity...
          </div>
        ) : recentActivity.length === 0 ? (
          <div style={{ padding: '20px', textAlign: 'center', color: 'var(--color-text-muted)', fontSize: '13px' }}>
            No recent observations
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {recentActivity.map((item, index) => (
              <div
                key={item.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  padding: '10px 0',
                  borderBottom: index < recentActivity.length - 1 ? '1px solid var(--color-border)' : 'none',
                  gap: '12px',
                }}
              >
                {/* Activity indicator */}
                <div style={{
                  width: '32px',
                  height: '32px',
                  borderRadius: '8px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: '14px',
                  flexShrink: 0,
                  backgroundColor: item.did_she_nest
                    ? 'rgba(16, 185, 129, 0.12)'
                    : item.is_recapture
                    ? 'rgba(59, 130, 246, 0.12)'
                    : 'rgba(255, 255, 255, 0.06)',
                }}>
                  {item.did_she_nest ? '🪺' : item.is_recapture ? '🔄' : '🐢'}
                </div>

                {/* Details */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{
                    fontSize: '13px',
                    color: 'var(--color-text)',
                    fontWeight: '500',
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  }}>
                    <span style={{ fontWeight: '600' }}>{item.turtle_name || 'Unknown'}</span>
                    {item.did_she_nest && (
                      <span style={{ color: 'var(--color-success-light)', marginLeft: '6px', fontSize: '11px', fontWeight: '600' }}>
                        NESTED
                      </span>
                    )}
                    {item.is_recapture && (
                      <span style={{ color: 'var(--color-info-light)', marginLeft: '6px', fontSize: '11px', fontWeight: '600' }}>
                        RECAPTURE
                      </span>
                    )}
                  </div>
                  <div style={{
                    fontSize: '12px',
                    color: 'var(--color-text-muted)',
                    marginTop: '1px',
                  }}>
                    by {item.observer_name}{item.beach_sector ? ` · ${item.beach_sector}` : ''}
                  </div>
                </div>

                {/* Date */}
                <div style={{
                  fontSize: '12px',
                  color: 'var(--color-text-muted)',
                  whiteSpace: 'nowrap',
                  flexShrink: 0,
                }}>
                  {formatDate(item.encounter_date)}
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
