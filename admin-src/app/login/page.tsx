'use client';

import { useState, useEffect, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '@/components/auth/AuthProvider';
import LoadingSpinner from '@/components/ui/LoadingSpinner';

function LoginForm() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const { signIn, profile, loading, isSubscriber } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();

  // Show error if redirected here due to subscriber requirement
  useEffect(() => {
    const errorParam = searchParams?.get('error');
    if (errorParam === 'subscriber_required') {
      setError('Subscriber access required. This console is restricted to subscribed admins only.');
    } else if (errorParam === 'unauthorized') {
      setError('Unauthorized access. Please log in with subscriber credentials.');
    }
  }, [searchParams]);

  // Redirect if already logged in as subscriber
  useEffect(() => {
    if (!loading && profile && isSubscriber) {
      router.push('/dashboard');
    } else if (!loading && profile && !isSubscriber) {
      // User is logged in but not subscriber - show error
      setError('Subscriber access required. Contact your organization admin to request subscriber access.');
    }
  }, [loading, profile, isSubscriber, router]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setIsLoading(true);

    try {
      await signIn(email, password);

      // Wait a moment for profile to load, then check admin status
      // This will be handled by the useEffect above
    } catch (err: any) {
      console.error('Login error:', err);
      setError(err.message || 'Failed to sign in. Please check your credentials.');
      setIsLoading(false);
    }
  };

  if (loading) {
    return <LoadingSpinner />;
  }

  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: 'var(--color-background)',
      padding: '20px',
    }}>
      <div style={{
        width: '100%',
        maxWidth: '400px',
        backgroundColor: 'var(--color-surface)',
        padding: '40px',
        borderRadius: '8px',
        border: '1px solid var(--color-border)',
      }}>
        <div style={{ marginBottom: '32px', textAlign: 'center' }}>
          <h1 style={{
            fontSize: '28px',
            fontWeight: '600',
            color: 'var(--color-text)',
            marginBottom: '8px',
          }}>
            TurtleOps Admin
          </h1>
          <p style={{
            color: 'var(--color-text-secondary)',
            fontSize: '14px',
          }}>
            Sign in to access the admin console
          </p>
        </div>

        {error && (
          <div style={{
            padding: '12px',
            backgroundColor: 'rgba(239, 68, 68, 0.1)',
            border: '1px solid var(--color-error)',
            borderRadius: '4px',
            marginBottom: '20px',
          }}>
            <p style={{
              color: 'var(--color-error)',
              fontSize: '14px',
              margin: 0,
            }}>
              {error}
            </p>
          </div>
        )}

        <form onSubmit={handleSubmit}>
          <div style={{ marginBottom: '20px' }}>
            <label
              htmlFor="email"
              style={{
                display: 'block',
                marginBottom: '6px',
                fontSize: '14px',
                fontWeight: '500',
                color: 'var(--color-text)',
              }}
            >
              Email
            </label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="email"
              style={{
                width: '100%',
                padding: '10px 12px',
                fontSize: '14px',
              }}
            />
          </div>

          <div style={{ marginBottom: '24px' }}>
            <label
              htmlFor="password"
              style={{
                display: 'block',
                marginBottom: '6px',
                fontSize: '14px',
                fontWeight: '500',
                color: 'var(--color-text)',
              }}
            >
              Password
            </label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              autoComplete="current-password"
              style={{
                width: '100%',
                padding: '10px 12px',
                fontSize: '14px',
              }}
            />
          </div>

          <button
            type="submit"
            disabled={isLoading}
            style={{
              width: '100%',
              padding: '12px',
              backgroundColor: 'var(--color-primary)',
              color: 'white',
              border: 'none',
              borderRadius: '4px',
              fontSize: '16px',
              fontWeight: '600',
              cursor: isLoading ? 'not-allowed' : 'pointer',
              opacity: isLoading ? 0.6 : 1,
            }}
          >
            {isLoading ? 'Signing in...' : 'Sign In'}
          </button>
        </form>

        <div style={{
          marginTop: '24px',
          paddingTop: '24px',
          borderTop: '1px solid var(--color-border)',
        }}>
          <p style={{
            textAlign: 'center',
            fontSize: '13px',
            color: 'var(--color-text-muted)',
          }}>
            Subscriber credentials required to access this console
          </p>
        </div>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<LoadingSpinner />}>
      <LoginForm />
    </Suspense>
  );
}
