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
      border: 'none',
      borderRadius: '6px',
      fontWeight: '600',
      cursor: disabled ? 'not-allowed' : 'pointer',
      opacity: disabled ? 0.6 : 1,
      transition: 'all 0.2s ease',
    };

    switch (variant) {
      case 'primary':
        return {
          ...base,
          backgroundColor: 'var(--color-primary)',
          color: 'white',
        };
      case 'secondary':
        return {
          ...base,
          backgroundColor: 'var(--color-surface-elevated)',
          color: 'var(--color-text)',
          border: '1px solid var(--color-border)',
        };
      case 'danger':
        return {
          ...base,
          backgroundColor: 'var(--color-error)',
          color: 'white',
        };
      case 'ghost':
        return {
          ...base,
          backgroundColor: 'transparent',
          color: 'var(--color-text-secondary)',
          border: '1px solid transparent',
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
          fontSize: '13px',
        };
      case 'md':
        return {
          padding: '10px 16px',
          fontSize: '14px',
        };
      case 'lg':
        return {
          padding: '12px 24px',
          fontSize: '16px',
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
