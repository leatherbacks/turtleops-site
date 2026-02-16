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
          backgroundColor: 'rgba(16, 185, 129, 0.12)',
          color: 'var(--color-success-light)',
          border: '1px solid rgba(16, 185, 129, 0.25)',
        };
      case 'warning':
        return {
          backgroundColor: 'rgba(245, 158, 11, 0.12)',
          color: 'var(--color-warning-light)',
          border: '1px solid rgba(245, 158, 11, 0.25)',
        };
      case 'error':
        return {
          backgroundColor: 'rgba(239, 68, 68, 0.12)',
          color: '#f87171',
          border: '1px solid rgba(239, 68, 68, 0.25)',
        };
      case 'info':
        return {
          backgroundColor: 'rgba(59, 130, 246, 0.12)',
          color: 'var(--color-info-light)',
          border: '1px solid rgba(59, 130, 246, 0.25)',
        };
      default:
        return {
          backgroundColor: 'rgba(255, 255, 255, 0.06)',
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
          fontSize: '10px',
        };
      case 'md':
        return {
          padding: '3px 10px',
          fontSize: '11px',
        };
      default:
        return {};
    }
  };

  return (
    <span
      style={{
        display: 'inline-block',
        borderRadius: '20px',
        fontWeight: '600',
        textTransform: 'uppercase' as const,
        letterSpacing: '0.3px',
        ...getVariantStyles(),
        ...getSizeStyles(),
      }}
    >
      {children}
    </span>
  );
}
