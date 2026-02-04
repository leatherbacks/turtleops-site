'use client';

import { useState } from 'react';
import { useActiveVolunteers } from '@/hooks/useActiveVolunteers';
import Card from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import Badge from '@/components/ui/Badge';

export default function ActiveVolunteersPage() {
  const { sessions, loading, error, refresh, forceCheckout } = useActiveVolunteers({
    autoRefresh: true,
    refreshInterval: 30000,
  });

  const [checkingOut, setCheckingOut] = useState<string | null>(null);

  const handleForceCheckout = async (sessionId: string, volunteerName: string) => {
    if (!confirm(`Force checkout ${volunteerName}? This will end their active survey session.`)) {
      return;
    }

    setCheckingOut(sessionId);
    const success = await forceCheckout(sessionId);

    if (success) {
      alert(`${volunteerName} has been checked out successfully.`);
    } else {
      alert('Failed to checkout volunteer. Please try again.');
    }

    setCheckingOut(null);
  };

  const getSessionStatus = (elapsedHours: number) => {
    if (elapsedHours >= 8) {
      return { variant: 'error' as const, label: 'FORCE CHECKOUT' };
    } else if (elapsedHours >= 6) {
      return { variant: 'warning' as const, label: 'APPROACHING TIMEOUT' };
    }
    return { variant: 'success' as const, label: 'ACTIVE' };
  };

  const formatElapsedTime = (elapsedHours: number) => {
    const hours = Math.floor(elapsedHours);
    const minutes = Math.round((elapsedHours - hours) * 60);
    return `${hours}h ${minutes}m`;
  };

  const formatDateTime = (isoString: string) => {
    const date = new Date(isoString);
    return date.toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    });
  };

  return (
    <div style={{ padding: '24px' }}>
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: '24px',
      }}>
        <div>
          <h1 style={{
            fontSize: '32px',
            fontWeight: '600',
            color: 'var(--color-text)',
            marginBottom: '8px',
          }}>
            Active Volunteers
          </h1>
          <p style={{
            color: 'var(--color-text-secondary)',
          }}>
            Currently checked-in volunteers • Auto-refreshes every 30 seconds
          </p>
        </div>
        <Button onClick={refresh} variant="secondary" disabled={loading}>
          {loading ? 'Refreshing...' : 'Refresh'}
        </Button>
      </div>

      {error && (
        <div style={{
          backgroundColor: 'rgba(239, 68, 68, 0.15)',
          border: '1px solid var(--color-error)',
          borderRadius: '8px',
          padding: '16px',
          marginBottom: '24px',
          color: 'var(--color-error)',
        }}>
          Error loading active volunteers: {error.message}
        </div>
      )}

      {/* Summary Stats */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
        gap: '16px',
        marginBottom: '32px',
      }}>
        <Card>
          <div style={{ textAlign: 'center' }}>
            <div style={{
              fontSize: '48px',
              fontWeight: '600',
              color: 'var(--color-primary)',
              marginBottom: '8px',
            }}>
              {sessions.length}
            </div>
            <div style={{
              fontSize: '14px',
              color: 'var(--color-text-secondary)',
            }}>
              Active Sessions
            </div>
          </div>
        </Card>

        <Card>
          <div style={{ textAlign: 'center' }}>
            <div style={{
              fontSize: '48px',
              fontWeight: '600',
              color: 'var(--color-warning)',
              marginBottom: '8px',
            }}>
              {sessions.filter((s) => s.elapsed_hours >= 6 && s.elapsed_hours < 8).length}
            </div>
            <div style={{
              fontSize: '14px',
              color: 'var(--color-text-secondary)',
            }}>
              Approaching Timeout (6h+)
            </div>
          </div>
        </Card>

        <Card>
          <div style={{ textAlign: 'center' }}>
            <div style={{
              fontSize: '48px',
              fontWeight: '600',
              color: 'var(--color-error)',
              marginBottom: '8px',
            }}>
              {sessions.filter((s) => s.elapsed_hours >= 8).length}
            </div>
            <div style={{
              fontSize: '14px',
              color: 'var(--color-text-secondary)',
            }}>
              Force Checkout Needed (8h+)
            </div>
          </div>
        </Card>
      </div>

      {/* Active Sessions List */}
      {loading && sessions.length === 0 ? (
        <Card>
          <div style={{
            textAlign: 'center',
            padding: '48px 24px',
            color: 'var(--color-text-secondary)',
          }}>
            Loading active volunteers...
          </div>
        </Card>
      ) : sessions.length === 0 ? (
        <Card>
          <div style={{
            textAlign: 'center',
            padding: '48px 24px',
            color: 'var(--color-text-secondary)',
          }}>
            <div style={{ fontSize: '48px', marginBottom: '16px' }}>🌙</div>
            <div style={{ fontSize: '18px', marginBottom: '8px' }}>No Active Volunteers</div>
            <div style={{ fontSize: '14px' }}>No volunteers are currently checked in for surveys.</div>
          </div>
        </Card>
      ) : (
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          gap: '16px',
        }}>
          {sessions.map((session) => {
            const status = getSessionStatus(session.elapsed_hours);

            return (
              <Card key={session.id}>
                <div style={{
                  display: 'grid',
                  gridTemplateColumns: '1fr auto',
                  gap: '24px',
                  alignItems: 'center',
                }}>
                  <div style={{
                    display: 'grid',
                    gridTemplateColumns: 'auto 1fr auto auto',
                    gap: '24px',
                    alignItems: 'center',
                  }}>
                    {/* Status Indicator */}
                    <div style={{
                      width: '48px',
                      height: '48px',
                      borderRadius: '50%',
                      backgroundColor:
                        status.variant === 'error'
                          ? 'rgba(239, 68, 68, 0.15)'
                          : status.variant === 'warning'
                          ? 'rgba(245, 158, 11, 0.15)'
                          : 'rgba(16, 185, 129, 0.15)',
                      border: `2px solid ${
                        status.variant === 'error'
                          ? 'var(--color-error)'
                          : status.variant === 'warning'
                          ? 'var(--color-warning)'
                          : 'var(--color-success)'
                      }`,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: '24px',
                    }}>
                      👤
                    </div>

                    {/* Volunteer Info */}
                    <div>
                      <div style={{
                        fontSize: '18px',
                        fontWeight: '600',
                        color: 'var(--color-text)',
                        marginBottom: '4px',
                      }}>
                        {session.surveyor.full_name}
                      </div>
                      <div style={{
                        fontSize: '14px',
                        color: 'var(--color-text-secondary)',
                      }}>
                        Checked in: {formatDateTime(session.check_in_time)}
                      </div>
                    </div>

                    {/* Elapsed Time */}
                    <div style={{ textAlign: 'center' }}>
                      <div style={{
                        fontSize: '24px',
                        fontWeight: '600',
                        color:
                          status.variant === 'error'
                            ? 'var(--color-error)'
                            : status.variant === 'warning'
                            ? 'var(--color-warning)'
                            : 'var(--color-text)',
                        marginBottom: '4px',
                      }}>
                        {formatElapsedTime(session.elapsed_hours)}
                      </div>
                      <div style={{
                        fontSize: '12px',
                        color: 'var(--color-text-muted)',
                      }}>
                        Elapsed
                      </div>
                    </div>

                    {/* Status Badge */}
                    <Badge
                      variant={status.variant}
                      size="sm"
                    >
                      {status.label}
                    </Badge>
                  </div>

                  {/* Actions */}
                  <div>
                    <Button
                      variant="danger"
                      size="sm"
                      onClick={() => handleForceCheckout(session.id, session.surveyor.full_name)}
                      disabled={checkingOut === session.id}
                    >
                      {checkingOut === session.id ? 'Checking out...' : 'Force Checkout'}
                    </Button>
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {/* Auto-refresh indicator */}
      <div style={{
        marginTop: '24px',
        padding: '12px',
        backgroundColor: 'var(--color-surface-elevated)',
        borderRadius: '6px',
        fontSize: '12px',
        color: 'var(--color-text-muted)',
        textAlign: 'center',
      }}>
        Auto-refreshing every 30 seconds • Last updated: {new Date().toLocaleTimeString()}
      </div>
    </div>
  );
}
