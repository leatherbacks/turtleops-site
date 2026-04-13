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

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { session, profile, loading, isSubscriber } = useAuth();
  const router = useRouter();

  // Track if we've ever authenticated in this browser session.
  // Initialize false to match server render, then hydrate from sessionStorage
  // in useEffect to avoid React hydration mismatch (error #418).
  const [hasAuthed, setHasAuthed] = useState(false);

  // Read sessionStorage after hydration
  useEffect(() => {
    if (sessionStorage.getItem('hasAuthed') === 'true') {
      setHasAuthed(true);
    }
  }, []);

  // Update hasAuthed when we successfully authenticate
  useEffect(() => {
    if (session && profile && isSubscriber) {
      setHasAuthed(true);
      sessionStorage.setItem('hasAuthed', 'true');
    }
  }, [session, profile, isSubscriber]);

  // CRITICAL: Subscriber-only access guard
  useEffect(() => {
    if (!loading) {
      if (!session) {
        sessionStorage.removeItem('hasAuthed');
        router.push('/login');
      } else if (profile && !isSubscriber) {
        sessionStorage.removeItem('hasAuthed');
        router.push('/login?error=subscriber_required');
      }
    }
  }, [loading, session, profile, isSubscriber, router]);

  // While auth is resolving with no prior session, show a simple spinner.
  // Otherwise render the full layout with children immediately to avoid CLS —
  // pages already handle missing orgId gracefully by showing zero values.
  if (loading || !session || !profile || !isSubscriber) {
    if (!(hasAuthed || session)) {
      return <LoadingSpinner />;
    }
  }

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
