'use client';

import { useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/components/auth/AuthProvider';
import { SidebarProvider, useSidebar } from '@/contexts/SidebarContext';
import Sidebar from '@/components/layout/Sidebar';
import Header from '@/components/layout/Header';

function DashboardContent({ children, authReady }: { children: React.ReactNode; authReady: boolean }) {
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
        {authReady ? children : null}
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

  // Once auth resolves, keep children mounted permanently — prevents
  // data loss from auth state flickering (token refreshes, etc.)
  const authEverReady = useRef(false);
  if (!loading && !!session && !!profile && isSubscriber) {
    authEverReady.current = true;
  }
  const authReady = authEverReady.current;

  return (
    <SidebarProvider>
      <div style={{
        display: 'flex',
        minHeight: '100vh',
        backgroundColor: 'var(--color-background)',
      }}>
        <Sidebar />
        <DashboardContent authReady={authReady}>{children}</DashboardContent>
      </div>
    </SidebarProvider>
  );
}
