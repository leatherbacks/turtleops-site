'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/components/auth/AuthProvider';
import LoadingSpinner from '@/components/ui/LoadingSpinner';
import Sidebar from '@/components/layout/Sidebar';
import Header from '@/components/layout/Header';

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { session, profile, loading, isSubscriber } = useAuth();
  const router = useRouter();

  // CRITICAL: Subscriber-only access guard
  useEffect(() => {
    if (!loading) {
      if (!session) {
        // Not authenticated - redirect to login
        router.push('/login');
      } else if (profile && !isSubscriber) {
        // Authenticated but not subscriber - redirect to login with error
        router.push('/login?error=subscriber_required');
      }
    }
  }, [loading, session, profile, isSubscriber, router]);

  // Show loading spinner while checking auth
  if (loading) {
    return <LoadingSpinner />;
  }

  // If not authenticated or not subscriber, don't render anything
  // (will redirect in useEffect above)
  if (!session || !profile || !isSubscriber) {
    return null;
  }

  // User is authenticated AND is admin - show dashboard
  return (
    <div style={{
      display: 'flex',
      minHeight: '100vh',
      backgroundColor: 'var(--color-background)',
    }}>
      <Sidebar />
      <div style={{
        marginLeft: '260px',
        width: 'calc(100% - 260px)',
      }}>
        <Header />
        <main style={{
          minHeight: 'calc(100vh - 64px)',
        }}>
          {children}
        </main>
      </div>
    </div>
  );
}
