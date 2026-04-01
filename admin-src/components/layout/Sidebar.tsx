'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useSidebar } from '@/contexts/SidebarContext';

const navItems = [
  { href: '/dashboard', label: 'Dashboard', icon: '📊' },
  { href: '/dashboard/observations', label: 'Observations', icon: '📋' },
  { href: '/dashboard/map', label: 'Map', icon: '🗺️' },
  { href: '/dashboard/volunteers', label: 'Active Volunteers', icon: '👥' },
  { href: '/dashboard/turtles', label: 'Turtles', icon: '🐢' },
  { href: '/dashboard/tags', label: 'Tag History', icon: '🏷️' },
  { href: '/dashboard/alerts', label: 'Alerts', icon: '⚠️' },
  { href: '/dashboard/config', label: 'Settings', icon: '⚙️' },
  { href: '/dashboard/team', label: 'Team', icon: '🔑' },
  { href: '/dashboard/export', label: 'Export', icon: '📥' },
];

export default function Sidebar() {
  const pathname = usePathname();
  const { collapsed, toggleSidebar, sidebarWidth } = useSidebar();

  return (
    <aside style={{
      width: `${sidebarWidth}px`,
      backgroundColor: 'var(--color-surface)',
      borderRight: '1px solid var(--color-border)',
      height: '100vh',
      position: 'fixed',
      left: 0,
      top: 0,
      overflowY: 'auto',
      overflowX: 'hidden',
      display: 'flex',
      flexDirection: 'column',
      transition: 'width 0.2s ease',
    }}>
      {/* Logo */}
      <div style={{
        padding: collapsed ? '20px 14px 16px' : '20px 20px 16px',
        display: 'flex',
        alignItems: 'center',
        gap: '12px',
        minHeight: '68px',
      }}>
        <img
          src="/logo.png"
          alt="TurtleOps"
          style={{ width: '36px', height: '36px', borderRadius: '10px', flexShrink: 0 }}
        />
        {!collapsed && (
          <div>
            <h1 style={{
              fontSize: '17px',
              fontWeight: '700',
              color: 'var(--color-text)',
              letterSpacing: '-0.3px',
              whiteSpace: 'nowrap',
            }}>
              TurtleOps
            </h1>
            <p style={{
              fontSize: '11px',
              color: 'var(--color-text-muted)',
              fontWeight: '500',
              letterSpacing: '0.3px',
              textTransform: 'uppercase',
            }}>
              Dashboard
            </p>
          </div>
        )}
      </div>

      {/* Divider */}
      <div style={{
        height: '1px',
        backgroundColor: 'var(--color-border)',
        margin: collapsed ? '0 8px 8px' : '0 16px 8px',
      }} />

      {/* Navigation */}
      <nav style={{ padding: collapsed ? '0 6px' : '0 10px', flex: 1 }}>
        {navItems.map((item) => {
          const isActive = pathname === item.href ||
            (item.href !== '/dashboard' && pathname?.startsWith(item.href + '/'));

          return (
            <Link
              key={item.href}
              href={item.href}
              title={collapsed ? item.label : undefined}
              style={{
                display: 'flex',
                alignItems: 'center',
                padding: collapsed ? '9px 0' : '9px 14px',
                justifyContent: collapsed ? 'center' : 'flex-start',
                marginBottom: '2px',
                borderRadius: '8px',
                textDecoration: 'none',
                backgroundColor: isActive ? 'var(--color-primary-glow)' : 'transparent',
                color: isActive ? 'var(--color-primary)' : 'var(--color-text-secondary)',
                fontSize: '13.5px',
                fontWeight: isActive ? '600' : '500',
                transition: 'all 0.15s ease',
                position: 'relative',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
              }}
              onMouseEnter={(e) => {
                if (!isActive) {
                  e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.04)';
                  e.currentTarget.style.color = 'var(--color-text)';
                }
              }}
              onMouseLeave={(e) => {
                if (!isActive) {
                  e.currentTarget.style.backgroundColor = 'transparent';
                  e.currentTarget.style.color = 'var(--color-text-secondary)';
                }
              }}
            >
              {isActive && !collapsed && (
                <div style={{
                  position: 'absolute',
                  left: '0',
                  top: '50%',
                  transform: 'translateY(-50%)',
                  width: '3px',
                  height: '16px',
                  backgroundColor: 'var(--color-primary)',
                  borderRadius: '0 3px 3px 0',
                }} />
              )}
              <span style={{
                marginRight: collapsed ? '0' : '10px',
                fontSize: '15px',
                lineHeight: 1,
                flexShrink: 0,
              }}>
                {item.icon}
              </span>
              {!collapsed && item.label}
            </Link>
          );
        })}
      </nav>

      {/* Collapse toggle + Footer */}
      <div style={{
        padding: '8px',
        borderTop: '1px solid var(--color-border)',
      }}>
        <button
          onClick={toggleSidebar}
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          style={{
            width: '100%',
            padding: '8px',
            backgroundColor: 'transparent',
            border: '1px solid transparent',
            borderRadius: '8px',
            color: 'var(--color-text-muted)',
            fontSize: '13px',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: collapsed ? 'center' : 'flex-start',
            gap: '8px',
            transition: 'all 0.15s ease',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.04)';
            e.currentTarget.style.borderColor = 'var(--color-border)';
            e.currentTarget.style.color = 'var(--color-text)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.backgroundColor = 'transparent';
            e.currentTarget.style.borderColor = 'transparent';
            e.currentTarget.style.color = 'var(--color-text-muted)';
          }}
        >
          <span style={{ fontSize: '14px', lineHeight: 1 }}>
            {collapsed ? '→' : '←'}
          </span>
          {!collapsed && <span style={{ fontSize: '12px' }}>Collapse</span>}
        </button>
      </div>
    </aside>
  );
}
