import { ReactNode } from 'react';

interface StatCardProps {
  title: string;
  value: string | number;
  subtitle?: string;
  icon?: ReactNode;
  trend?: 'up' | 'down' | 'neutral';
  trendValue?: string;
  loading?: boolean;
}

export default function StatCard({
  title,
  value,
  subtitle,
  icon,
  trend,
  trendValue,
  loading = false,
}: StatCardProps) {
  const getTrendColor = () => {
    if (trend === 'up') return 'var(--color-success)';
    if (trend === 'down') return 'var(--color-error)';
    return 'var(--color-text-secondary)';
  };

  const getTrendIcon = () => {
    if (trend === 'up') return '↑';
    if (trend === 'down') return '↓';
    return '→';
  };

  if (loading) {
    return (
      <div style={{
        backgroundColor: 'var(--color-surface)',
        padding: '24px',
        borderRadius: '8px',
        border: '1px solid var(--color-border)',
        minHeight: '140px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}>
        <div style={{
          width: '32px',
          height: '32px',
          border: '3px solid var(--color-surface-elevated)',
          borderTopColor: 'var(--color-primary)',
          borderRadius: '50%',
          animation: 'spin 1s linear infinite',
        }} />
      </div>
    );
  }

  return (
    <div style={{
      backgroundColor: 'var(--color-surface)',
      padding: '24px',
      borderRadius: '8px',
      border: '1px solid var(--color-border)',
      transition: 'all 0.2s ease',
    }}>
      <div style={{
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'space-between',
        marginBottom: '12px',
      }}>
        <h3 style={{
          fontSize: '14px',
          fontWeight: '500',
          color: 'var(--color-text-secondary)',
          textTransform: 'uppercase',
          letterSpacing: '0.5px',
        }}>
          {title}
        </h3>
        {icon && (
          <div style={{ fontSize: '24px', opacity: 0.6 }}>
            {icon}
          </div>
        )}
      </div>

      <div style={{
        fontSize: '36px',
        fontWeight: '600',
        color: 'var(--color-text)',
        marginBottom: '8px',
        fontFamily: 'var(--font-mono)',
      }}>
        {value}
      </div>

      {(subtitle || trendValue) && (
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          fontSize: '14px',
        }}>
          {trendValue && trend && (
            <span style={{
              color: getTrendColor(),
              fontWeight: '600',
              display: 'flex',
              alignItems: 'center',
              gap: '2px',
            }}>
              <span>{getTrendIcon()}</span>
              {trendValue}
            </span>
          )}
          {subtitle && (
            <span style={{
              color: 'var(--color-text-muted)',
            }}>
              {subtitle}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
