'use client';

import { useAuth } from '@/components/auth/AuthProvider';
import HeaderSearch from './HeaderSearch';

export default function Header() {
  const { profile, organization, signOut } = useAuth();

  return (
    <header style={{
      height: '56px',
      backgroundColor: 'rgba(9, 9, 11, 0.8)',
      backdropFilter: 'blur(12px)',
      WebkitBackdropFilter: 'blur(12px)',
      borderBottom: '1px solid var(--color-border)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      padding: '0 28px',
      position: 'sticky',
      top: 0,
      zIndex: 10,
      gap: '20px',
    }}>
      <HeaderSearch />

      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: '16px',
      }}>
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: '10px',
        }}>
          {/* Avatar circle */}
          <div style={{
            width: '32px',
            height: '32px',
            borderRadius: '50%',
            backgroundColor: 'var(--color-primary-glow)',
            border: '1px solid var(--color-primary)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: '13px',
            fontWeight: '600',
            color: 'var(--color-primary)',
          }}>
            {profile?.full_name?.charAt(0)?.toUpperCase() || '?'}
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{
              color: 'var(--color-text)',
              fontWeight: '500',
              fontSize: '13px',
              lineHeight: '1.3',
            }}>
              {profile?.full_name}
            </div>
            <div style={{
              color: 'var(--color-text-muted)',
              fontSize: '11px',
              textTransform: 'capitalize',
            }}>
              {profile?.role}
            </div>
          </div>
        </div>

        <div style={{
          width: '1px',
          height: '24px',
          backgroundColor: 'var(--color-border)',
        }} />

        <button
          onClick={signOut}
          style={{
            padding: '6px 14px',
            backgroundColor: 'transparent',
            border: '1px solid var(--color-border)',
            borderRadius: '8px',
            color: 'var(--color-text-muted)',
            fontSize: '13px',
            fontWeight: '500',
            cursor: 'pointer',
            transition: 'all 0.15s ease',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.04)';
            e.currentTarget.style.borderColor = 'var(--color-border-light)';
            e.currentTarget.style.color = 'var(--color-text)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.backgroundColor = 'transparent';
            e.currentTarget.style.borderColor = 'var(--color-border)';
            e.currentTarget.style.color = 'var(--color-text-muted)';
          }}
        >
          Sign Out
        </button>
      </div>
    </header>
  );
}
