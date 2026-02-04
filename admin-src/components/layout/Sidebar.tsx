'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const navItems = [
  { href: '/dashboard', label: 'Dashboard', icon: '📊' },
  { href: '/dashboard/observations', label: 'Observations', icon: '📋' },
  { href: '/dashboard/volunteers', label: 'Active Volunteers', icon: '👥' },
  { href: '/dashboard/turtles', label: 'Turtle Management', icon: '🐢' },
  { href: '/dashboard/alerts', label: 'Turtle Alerts', icon: '⚠️' },
  { href: '/dashboard/config', label: 'Project Config', icon: '⚙️' },
  { href: '/dashboard/team', label: 'Team Management', icon: '🔑' },
  { href: '/dashboard/export', label: 'Export Data', icon: '📥' },
  { href: '/dashboard/import', label: 'Import Data', icon: '📤' },
];

export default function Sidebar() {
  const pathname = usePathname();

  return (
    <aside style={{
      width: '260px',
      backgroundColor: 'var(--color-surface)',
      borderRight: '1px solid var(--color-border)',
      height: '100vh',
      position: 'fixed',
      left: 0,
      top: 0,
      overflowY: 'auto',
      padding: '24px 0',
    }}>
      <div style={{
        padding: '0 24px 24px',
        borderBottom: '1px solid var(--color-border)',
        marginBottom: '24px',
      }}>
        <h1 style={{
          fontSize: '20px',
          fontWeight: '600',
          color: 'var(--color-text)',
          marginBottom: '4px',
        }}>
          TurtleOps
        </h1>
        <p style={{
          fontSize: '12px',
          color: 'var(--color-text-muted)',
          fontFamily: 'var(--font-mono)',
        }}>
          Admin Console
        </p>
      </div>

      <nav style={{ padding: '0 12px' }}>
        {navItems.map((item) => {
          const isActive = pathname === item.href || pathname?.startsWith(item.href + '/');

          return (
            <Link
              key={item.href}
              href={item.href}
              style={{
                display: 'flex',
                alignItems: 'center',
                padding: '12px 16px',
                marginBottom: '4px',
                borderRadius: '6px',
                textDecoration: 'none',
                backgroundColor: isActive ? 'var(--color-primary-glow)' : 'transparent',
                color: isActive ? 'var(--color-primary)' : 'var(--color-text-secondary)',
                fontSize: '14px',
                fontWeight: isActive ? '600' : '400',
                transition: 'all 0.2s ease',
              }}
              onMouseEnter={(e) => {
                if (!isActive) {
                  e.currentTarget.style.backgroundColor = 'var(--color-surface-elevated)';
                }
              }}
              onMouseLeave={(e) => {
                if (!isActive) {
                  e.currentTarget.style.backgroundColor = 'transparent';
                }
              }}
            >
              <span style={{ marginRight: '12px', fontSize: '16px' }}>
                {item.icon}
              </span>
              {item.label}
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
