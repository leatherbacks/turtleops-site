'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/components/auth/AuthProvider';
import { SidebarProvider, useSidebar } from '@/contexts/SidebarContext';
import LoadingSpinner from '@/components/ui/LoadingSpinner';
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

function DashboardSkeleton() {
  const { sidebarWidth } = useSidebar();

  return (
    <div style={{
      marginLeft: `${sidebarWidth}px`,
      width: `calc(100% - ${sidebarWidth}px)`,
      transition: 'margin-left 0.2s ease, width 0.2s ease',
    }}>
      <Header />
      <main style={{ minHeight: 'calc(100vh - 56px)' }} />
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

  // Track if we've ever authenticated in this session
  // Persists across component remounts via sessionStorage
  const [hasAuthed, setHasAuthed] = useState(() => {
    if (typeof window !== 'undefined') {
      return sessionStorage.getItem('hasAuthed') === 'true';
    }
    return false;
  });

  // Update hasAuthed when we successfully authenticate
  useEffect(() => {
    if (session && profile && isSubscriber) {
      setHasAuthed(true);
      if (typeof window !== 'undefined') {
        sessionStorage.setItem('hasAuthed', 'true');
      }
    }
  }, [session, profile, isSubscriber]);

  // CRITICAL: Subscriber-only access guard
  useEffect(() => {
    if (!loading) {
      if (!session) {
        if (typeof window !== 'undefined') {
          sessionStorage.removeItem('hasAuthed');
        }
        router.push('/login');
      } else if (profile && !isSubscriber) {
        if (typeof window !== 'undefined') {
          sessionStorage.removeItem('hasAuthed');
        }
        router.push('/login?error=subscriber_required');
      }
    }
  }, [loading, session, profile, isSubscriber, router]);

  // Show spinner while auth is loading
  if (loading) {
    if (hasAuthed) {
      return (
        <SidebarProvider>
          <div style={{
            display: 'flex',
            minHeight: '100vh',
            backgroundColor: 'var(--color-background)',
          }}>
            <Sidebar />
            <DashboardSkeleton />
          </div>
        </SidebarProvider>
      );
    }
    return <LoadingSpinner />;
  }

  // Not authenticated or not subscriber - show spinner while redirect happens
  if (!session || !profile || !isSubscriber) {
    return <LoadingSpinner />;
  }

  // User is authenticated AND is subscriber - show dashboard
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
