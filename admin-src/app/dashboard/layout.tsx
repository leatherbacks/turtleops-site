'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/components/auth/AuthProvider';
import { SidebarProvider, useSidebar } from '@/contexts/SidebarContext';
import Sidebar from '@/components/layout/Sidebar';
import Header from '@/components/layout/Header';

function DashboardContent({ children }: { children: React.ReactNode }) {
  const { sidebarWidth } = useSidebar();

  return (
    <div style={{
      marginLeft: `${sidebarWidth}px`,
      width: `calc(100% - ${sidebarWidth}px)`,
      transition: 'margin-left 0.2s ease, width 0.2s ease',
    }}>
      <Header />
      <main style={{
        minHeight: 'calc(100vh - 56px)',
      }}>
        {children}
      </main>
    </div>
  );
}

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { session, profile, loading, isSubscriber } = useAuth();
  const router = useRouter();

  // Subscriber-only access guard — redirect after auth resolves
  useEffect(() => {
    if (!loading) {
      if (!session) {
        router.push('/login');
      } else if (profile && !isSubscriber) {
        router.push('/login?error=subscriber_required');
      }
    }
  }, [loading, session, profile, isSubscriber, router]);

  // Always render the full layout to avoid CLS. The middleware already
  // redirects unauthenticated users server-side. Pages handle missing
  // orgId gracefully by showing zero values until auth resolves.
  return (
    <SidebarProvider>
      <div style={{
        display: 'flex',
        minHeight: '100vh',
        backgroundColor: 'var(--color-background)',
      }}>
        <Sidebar />
        <DashboardContent>{children}</DashboardContent>
      </div>
    </SidebarProvider>
  );
}
