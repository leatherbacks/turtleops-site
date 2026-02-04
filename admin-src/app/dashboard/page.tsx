'use client';

import { useAuth } from '@/components/auth/AuthProvider';
import { useStats } from '@/hooks/useStats';
import StatCard from '@/components/ui/StatCard';
import Button from '@/components/ui/Button';
import Card from '@/components/ui/Card';

export default function DashboardPage() {
  const { profile, organization } = useAuth();
  const { stats, loading, error, refresh } = useStats({ autoRefresh: true, refreshInterval: 30000 });

  return (
    <div style={{ padding: '24px' }}>
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: '24px',
      }}>
        <div>
          <h1 style={{
            fontSize: '32px',
            fontWeight: '600',
            color: 'var(--color-text)',
            marginBottom: '8px',
          }}>
            Statistics Dashboard
          </h1>
          <p style={{
            color: 'var(--color-text-secondary)',
          }}>
            {profile?.full_name} • {organization?.name || 'No Organization'}
          </p>
        </div>
        <Button onClick={refresh} variant="secondary" disabled={loading}>
          {loading ? 'Refreshing...' : 'Refresh'}
        </Button>
      </div>

      {error && (
        <div style={{
          backgroundColor: 'rgba(239, 68, 68, 0.15)',
          border: '1px solid var(--color-error)',
          borderRadius: '8px',
          padding: '16px',
          marginBottom: '24px',
          color: 'var(--color-error)',
        }}>
          Error loading statistics: {error.message}
        </div>
      )}

      {/* Key Metrics Grid */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
        gap: '16px',
        marginBottom: '32px',
      }}>
        <StatCard
          title="Total Turtles"
          value={stats?.totalTurtles ?? 0}
          subtitle="Documented in database"
          icon="🐢"
          loading={loading}
        />
        <StatCard
          title="Observations This Year"
          value={stats?.observationsThisYear ?? 0}
          subtitle={`${new Date().getFullYear()} season`}
          icon="📊"
          loading={loading}
        />
        <StatCard
          title="Last Night"
          value={stats?.lastNightObservations ?? 0}
          subtitle="Observations recorded"
          icon="🌙"
          loading={loading}
        />
        <StatCard
          title="Active Volunteers"
          value={stats?.activeVolunteers ?? 0}
          subtitle="Currently checked in"
          icon="👥"
          loading={loading}
        />
      </div>

      {/* Volunteer Metrics */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
        gap: '16px',
        marginBottom: '32px',
      }}>
        <StatCard
          title="Volunteer Hours"
          value={stats?.volunteerHours ?? 0}
          subtitle="Total logged time"
          icon="⏱️"
          loading={loading}
        />
        <StatCard
          title="Avg Session Duration"
          value={`${stats?.avgSessionDuration ?? 0}h`}
          subtitle="Per survey session"
          icon="📈"
          loading={loading}
        />
      </div>

      {/* Conservation Metrics */}
      <Card title="Conservation Metrics" style={{ marginBottom: '32px' }}>
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
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
            loading={loading}
          />
          <StatCard
            title="Recapture Rate"
            value={`${stats?.recaptureRate ?? 0}%`}
            subtitle="Turtles seen multiple times"
            trend={stats?.recaptureRate && stats.recaptureRate > 0 ? 'up' : 'neutral'}
            loading={loading}
          />
        </div>
      </Card>

      {/* Most Sighted Turtle */}
      {stats?.mostSightedTurtle && (
        <Card title="Most Sighted Turtle" style={{ marginBottom: '32px' }}>
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: '16px',
          }}>
            <div style={{
              fontSize: '48px',
            }}>
              🏆
            </div>
            <div>
              <div style={{
                fontSize: '24px',
                fontWeight: '600',
                color: 'var(--color-text)',
                marginBottom: '4px',
              }}>
                {stats.mostSightedTurtle.name}
              </div>
              <div style={{
                fontSize: '14px',
                color: 'var(--color-text-secondary)',
              }}>
                {stats.mostSightedTurtle.count} observations this year
              </div>
            </div>
          </div>
        </Card>
      )}

      {/* Auto-refresh indicator */}
      <div style={{
        marginTop: '24px',
        padding: '12px',
        backgroundColor: 'var(--color-surface-elevated)',
        borderRadius: '6px',
        fontSize: '12px',
        color: 'var(--color-text-muted)',
        textAlign: 'center',
      }}>
        Auto-refreshing every 30 seconds • Last updated: {new Date().toLocaleTimeString()}
      </div>
    </div>
  );
}
