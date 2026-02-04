import { ReactNode } from 'react';

interface BadgeProps {
  children: ReactNode;
  variant?: 'default' | 'success' | 'warning' | 'error' | 'info';
  size?: 'sm' | 'md';
}

export default function Badge({
  children,
  variant = 'default',
  size = 'md',
}: BadgeProps) {
  const getVariantStyles = () => {
    switch (variant) {
      case 'success':
        return {
          backgroundColor: 'rgba(16, 185, 129, 0.15)',
          color: 'var(--color-success-light)',
          border: '1px solid var(--color-success)',
        };
      case 'warning':
        return {
          backgroundColor: 'rgba(245, 158, 11, 0.15)',
          color: 'var(--color-warning-light)',
          border: '1px solid var(--color-warning)',
        };
      case 'error':
        return {
          backgroundColor: 'rgba(239, 68, 68, 0.15)',
          color: 'var(--color-error)',
          border: '1px solid var(--color-error)',
        };
      case 'info':
        return {
          backgroundColor: 'rgba(59, 130, 246, 0.15)',
          color: 'var(--color-info-light)',
          border: '1px solid var(--color-info)',
        };
      default:
        return {
          backgroundColor: 'var(--color-surface-elevated)',
          color: 'var(--color-text-secondary)',
          border: '1px solid var(--color-border)',
        };
    }
  };

  const getSizeStyles = () => {
    switch (size) {
      case 'sm':
        return {
          padding: '2px 8px',
          fontSize: '11px',
        };
      case 'md':
        return {
          padding: '4px 10px',
          fontSize: '12px',
        };
      default:
        return {};
    }
  };

  return (
    <span
      style={{
        display: 'inline-block',
        borderRadius: '4px',
        fontWeight: '600',
        textTransform: 'uppercase',
        letterSpacing: '0.5px',
        ...getVariantStyles(),
        ...getSizeStyles(),
      }}
    >
      {children}
    </span>
  );
}
