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
        borderRadius: 'var(--radius-lg)',
        border: '1px solid var(--color-border)',
        minHeight: '130px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}>
        <div style={{
          width: '28px',
          height: '28px',
          border: '2.5px solid var(--color-surface-elevated)',
          borderTopColor: 'var(--color-primary)',
          borderRadius: '50%',
          animation: 'spin 0.8s linear infinite',
        }} />
      </div>
    );
  }

  return (
    <div style={{
      backgroundColor: 'var(--color-surface)',
      padding: '22px 24px',
      borderRadius: 'var(--radius-lg)',
      border: '1px solid var(--color-border)',
      minHeight: '130px',
      transition: 'all 0.2s ease',
      cursor: 'default',
    }}
    onMouseEnter={(e) => {
      e.currentTarget.style.borderColor = 'var(--color-border-light)';
      e.currentTarget.style.boxShadow = 'var(--shadow-card-hover)';
      e.currentTarget.style.transform = 'translateY(-1px)';
    }}
    onMouseLeave={(e) => {
      e.currentTarget.style.borderColor = 'var(--color-border)';
      e.currentTarget.style.boxShadow = 'none';
      e.currentTarget.style.transform = 'translateY(0)';
    }}
    >
      <div style={{
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'space-between',
        marginBottom: '14px',
      }}>
        <h3 style={{
          fontSize: '12px',
          fontWeight: '600',
          color: 'var(--color-text-muted)',
          textTransform: 'uppercase',
          letterSpacing: '0.5px',
        }}>
          {title}
        </h3>
        {icon && (
          <div style={{ fontSize: '20px', opacity: 0.5 }}>
            {icon}
          </div>
        )}
      </div>

      <div style={{
        fontSize: '32px',
        fontWeight: '700',
        color: 'var(--color-text)',
        marginBottom: '6px',
        fontFamily: 'var(--font-mono)',
        letterSpacing: '-1px',
        lineHeight: 1,
      }}>
        {value}
      </div>

      {(subtitle || trendValue) && (
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          fontSize: '13px',
          marginTop: '8px',
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
