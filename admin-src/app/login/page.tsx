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
      {/* Subtle background glow */}
      <div style={{
        position: 'fixed',
        top: '-200px',
        left: '50%',
        transform: 'translateX(-50%)',
        width: '600px',
        height: '600px',
        background: 'radial-gradient(circle, rgba(255, 87, 87, 0.06) 0%, transparent 70%)',
        pointerEvents: 'none',
      }} />

      <div style={{
        width: '100%',
        maxWidth: '380px',
        backgroundColor: 'var(--color-surface)',
        padding: '40px 36px',
        borderRadius: 'var(--radius-xl)',
        border: '1px solid var(--color-border)',
        boxShadow: '0 8px 32px rgba(0, 0, 0, 0.4)',
        position: 'relative',
      }}>
        <div style={{ marginBottom: '32px', textAlign: 'center' }}>
          <img
            src="/logo.png"
            alt="TurtleOps"
            style={{
              width: '64px',
              height: '64px',
              borderRadius: '16px',
              marginBottom: '20px',
            }}
          />
          <h1 style={{
            fontSize: '24px',
            fontWeight: '700',
            color: 'var(--color-text)',
            marginBottom: '6px',
            letterSpacing: '-0.5px',
          }}>
            Welcome back
          </h1>
          <p style={{
            color: 'var(--color-text-muted)',
            fontSize: '14px',
          }}>
            Sign in to the admin dashboard
          </p>
        </div>

        {error && (
          <div style={{
            padding: '12px 14px',
            backgroundColor: 'rgba(239, 68, 68, 0.08)',
            border: '1px solid rgba(239, 68, 68, 0.2)',
            borderRadius: 'var(--radius-md)',
            marginBottom: '20px',
          }}>
            <p style={{
              color: '#f87171',
              fontSize: '13px',
              margin: 0,
              lineHeight: 1.5,
            }}>
              {error}
            </p>
          </div>
        )}

        <form onSubmit={handleSubmit}>
          <div style={{ marginBottom: '16px' }}>
            <label
              htmlFor="email"
              style={{
                display: 'block',
                marginBottom: '6px',
                fontSize: '13px',
                fontWeight: '500',
                color: 'var(--color-text-secondary)',
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
              placeholder="you@example.com"
              style={{
                width: '100%',
                padding: '10px 14px',
                fontSize: '14px',
                borderRadius: 'var(--radius-md)',
              }}
            />
          </div>

          <div style={{ marginBottom: '24px' }}>
            <label
              htmlFor="password"
              style={{
                display: 'block',
                marginBottom: '6px',
                fontSize: '13px',
                fontWeight: '500',
                color: 'var(--color-text-secondary)',
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
              placeholder="Enter your password"
              style={{
                width: '100%',
                padding: '10px 14px',
                fontSize: '14px',
                borderRadius: 'var(--radius-md)',
              }}
            />
          </div>

          <button
            type="submit"
            disabled={isLoading}
            style={{
              width: '100%',
              padding: '11px',
              backgroundColor: 'var(--color-primary)',
              color: 'white',
              border: 'none',
              borderRadius: 'var(--radius-md)',
              fontSize: '14px',
              fontWeight: '600',
              cursor: isLoading ? 'not-allowed' : 'pointer',
              opacity: isLoading ? 0.6 : 1,
              transition: 'all 0.15s ease',
            }}
          >
            {isLoading ? 'Signing in...' : 'Sign In'}
          </button>
        </form>

        <div style={{
          marginTop: '24px',
          paddingTop: '20px',
          borderTop: '1px solid var(--color-border)',
        }}>
          <p style={{
            textAlign: 'center',
            fontSize: '12px',
            color: 'var(--color-text-muted)',
          }}>
            Requires an active TurtleOps Pro subscription
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
