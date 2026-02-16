import { ButtonHTMLAttributes, ReactNode } from 'react';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
  size?: 'sm' | 'md' | 'lg';
  children: ReactNode;
}

export default function Button({
  variant = 'primary',
  size = 'md',
  children,
  disabled,
  ...props
}: ButtonProps) {
  const getVariantStyles = () => {
    const base = {
      border: 'none' as const,
      fontWeight: '600' as const,
      cursor: disabled ? 'not-allowed' as const : 'pointer' as const,
      opacity: disabled ? 0.5 : 1,
      transition: 'all 0.15s ease',
      display: 'inline-flex' as const,
      alignItems: 'center' as const,
      justifyContent: 'center' as const,
      gap: '6px',
    };

    switch (variant) {
      case 'primary':
        return {
          ...base,
          backgroundColor: 'var(--color-primary)',
          color: 'white',
          borderRadius: 'var(--radius-md)',
        };
      case 'secondary':
        return {
          ...base,
          backgroundColor: 'var(--color-surface-elevated)',
          color: 'var(--color-text)',
          border: '1px solid var(--color-border)',
          borderRadius: 'var(--radius-md)',
        };
      case 'danger':
        return {
          ...base,
          backgroundColor: 'var(--color-error)',
          color: 'white',
          borderRadius: 'var(--radius-md)',
        };
      case 'ghost':
        return {
          ...base,
          backgroundColor: 'transparent',
          color: 'var(--color-text-secondary)',
          border: '1px solid transparent',
          borderRadius: 'var(--radius-md)',
        };
      default:
        return base;
    }
  };

  const getSizeStyles = () => {
    switch (size) {
      case 'sm':
        return {
          padding: '6px 12px',
          fontSize: '12px',
        };
      case 'md':
        return {
          padding: '8px 16px',
          fontSize: '13px',
        };
      case 'lg':
        return {
          padding: '10px 20px',
          fontSize: '14px',
        };
      default:
        return {};
    }
  };

  return (
    <button
      disabled={disabled}
      style={{
        ...getVariantStyles(),
        ...getSizeStyles(),
      }}
      {...props}
    >
      {children}
    </button>
  );
}
