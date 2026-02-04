import { ReactNode, CSSProperties } from 'react';

interface CardProps {
  children: ReactNode;
  title?: string;
  subtitle?: string;
  headerAction?: ReactNode;
  padding?: string;
  style?: CSSProperties;
  onClick?: () => void;
}

export default function Card({
  children,
  title,
  subtitle,
  headerAction,
  padding = '24px',
  style,
  onClick,
}: CardProps) {
  return (
    <div style={{
      backgroundColor: 'var(--color-surface)',
      borderRadius: '8px',
      border: '1px solid var(--color-border)',
      overflow: 'hidden',
      ...style,
    }}
    onClick={onClick}
    >
      {(title || subtitle || headerAction) && (
        <div style={{
          padding: '20px 24px',
          borderBottom: '1px solid var(--color-border)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}>
          <div>
            {title && (
              <h3 style={{
                fontSize: '18px',
                fontWeight: '600',
                color: 'var(--color-text)',
                marginBottom: subtitle ? '4px' : '0',
              }}>
                {title}
              </h3>
            )}
            {subtitle && (
              <p style={{
                fontSize: '14px',
                color: 'var(--color-text-secondary)',
                margin: 0,
              }}>
                {subtitle}
              </p>
            )}
          </div>
          {headerAction && <div>{headerAction}</div>}
        </div>
      )}
      <div style={{ padding }}>{children}</div>
    </div>
  );
}
