'use client';

import { useAuth } from '@/components/auth/AuthProvider';

export default function Header() {
  const { profile, organization, signOut } = useAuth();

  return (
    <header style={{
      height: '64px',
      backgroundColor: 'var(--color-surface)',
      borderBottom: '1px solid var(--color-border)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      padding: '0 24px',
    }}>
      <div style={{
        fontSize: '14px',
        color: 'var(--color-text-secondary)',
      }}>
        {organization?.name && (
          <span>
            <strong style={{ color: 'var(--color-text)' }}>
              {organization.name}
            </strong>
          </span>
        )}
      </div>

      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: '16px',
      }}>
        <div style={{
          textAlign: 'right',
          fontSize: '14px',
        }}>
          <div style={{
            color: 'var(--color-text)',
            fontWeight: '500',
          }}>
            {profile?.full_name}
          </div>
          <div style={{
            color: 'var(--color-text-muted)',
            fontSize: '12px',
            textTransform: 'capitalize',
          }}>
            {profile?.role}
          </div>
        </div>

        <button
          onClick={signOut}
          style={{
            padding: '8px 16px',
            backgroundColor: 'transparent',
            border: '1px solid var(--color-border)',
            borderRadius: '4px',
            color: 'var(--color-text-secondary)',
            fontSize: '14px',
            cursor: 'pointer',
            transition: 'all 0.2s ease',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.backgroundColor = 'var(--color-surface-elevated)';
            e.currentTarget.style.borderColor = 'var(--color-primary)';
            e.currentTarget.style.color = 'var(--color-primary)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.backgroundColor = 'transparent';
            e.currentTarget.style.borderColor = 'var(--color-border)';
            e.currentTarget.style.color = 'var(--color-text-secondary)';
          }}
        >
          Sign Out
        </button>
      </div>
    </header>
  );
}
