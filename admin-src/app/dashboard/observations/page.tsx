'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { getObservations, getObservationsCount, exportObservationsToCSV, type ObservationFilters, type ObservationWithTurtle } from '@/lib/database/observations';
import { useAuth } from '@/components/auth/AuthProvider';
import Card from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import Badge from '@/components/ui/Badge';

export default function ObservationsPage() {
  const router = useRouter();
  const { profile } = useAuth();
  const [observations, setObservations] = useState<ObservationWithTurtle[]>([]);
  const [loading, setLoading] = useState(true);
  const [totalCount, setTotalCount] = useState(0);

  // Admin check
  const isAdmin = profile?.role === 'admin';

  // Filter state
  const [searchQuery, setSearchQuery] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [nestingFilter, setNestingFilter] = useState<'all' | 'nested' | 'no-nest'>('all');
  const [speciesFilter, setSpeciesFilter] = useState<string>('all');

  // Pagination
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 25;

  useEffect(() => {
    loadObservations();
  }, [searchQuery, dateFrom, dateTo, nestingFilter, speciesFilter, currentPage]);

  const loadObservations = async () => {
    setLoading(true);

    const filters: ObservationFilters = {};

    if (searchQuery) {
      filters.searchQuery = searchQuery;
    }
    if (dateFrom) {
      filters.dateFrom = new Date(dateFrom);
    }
    if (dateTo) {
      filters.dateTo = new Date(dateTo);
    }
    if (nestingFilter === 'nested') {
      filters.didNest = true;
    } else if (nestingFilter === 'no-nest') {
      filters.didNest = false;
    }

    // Add pagination
    filters.limit = itemsPerPage;
    filters.offset = (currentPage - 1) * itemsPerPage;

    const [data, count] = await Promise.all([
      getObservations(filters),
      getObservationsCount(filters),
    ]);

    setObservations(data);
    setTotalCount(count);
    setLoading(false);
  };

  const handleExportCSV = () => {
    const csv = exportObservationsToCSV(observations);
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `observations_${new Date().toISOString().split('T')[0]}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.URL.revokeObjectURL(url);
  };

  const handleClearFilters = () => {
    setSearchQuery('');
    setDateFrom('');
    setDateTo('');
    setNestingFilter('all');
    setSpeciesFilter('all');
    setCurrentPage(1); // Reset to first page when clearing filters
  };

  // Reset to page 1 when filters change
  useEffect(() => {
    if (currentPage !== 1) {
      setCurrentPage(1);
    }
  }, [searchQuery, dateFrom, dateTo, nestingFilter, speciesFilter]);

  const formatDate = (date: Date | string) => {
    const d = typeof date === 'string' ? new Date(date) : date;
    return d.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  };

  const formatTime = (date: Date | string) => {
    const d = typeof date === 'string' ? new Date(date) : date;
    return d.toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
    });
  };

  // Pagination - now using server-side pagination, so no need to slice
  const totalPages = Math.ceil(totalCount / itemsPerPage);
  const paginatedObservations = observations; // Already paginated from server

  const hasActiveFilters = searchQuery || dateFrom || dateTo || nestingFilter !== 'all';

  return (
    <div style={{ padding: '24px' }}>
      {/* Header */}
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
            Observations
          </h1>
          <p style={{
            color: 'var(--color-text-secondary)',
          }}>
            {totalCount} observation{totalCount !== 1 ? 's' : ''} recorded
          </p>
        </div>
        <div style={{ display: 'flex', gap: '12px' }}>
          {isAdmin && (
            <Button
              onClick={() => router.push('/dashboard/observations/new-historical')}
              variant="secondary"
            >
              📝 Enter Historical Data
            </Button>
          )}
          <Button
            onClick={handleExportCSV}
            variant="secondary"
            disabled={observations.length === 0}
          >
            📥 Export CSV
          </Button>
          <Button onClick={loadObservations} disabled={loading}>
            {loading ? 'Loading...' : '🔄 Refresh'}
          </Button>
        </div>
      </div>

      {/* Filters */}
      <Card style={{ marginBottom: '24px' }}>
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
          gap: '16px',
        }}>
          {/* Search */}
          <div>
            <label style={{
              display: 'block',
              fontSize: '14px',
              fontWeight: '600',
              color: 'var(--color-text)',
              marginBottom: '8px',
            }}>
              Search
            </label>
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Turtle, observer, or comments..."
              style={{
                width: '100%',
                padding: '8px 12px',
                backgroundColor: 'var(--color-background)',
                border: '1px solid var(--color-border)',
                borderRadius: '4px',
                color: 'var(--color-text)',
                fontSize: '14px',
              }}
            />
          </div>

          {/* Date From */}
          <div>
            <label style={{
              display: 'block',
              fontSize: '14px',
              fontWeight: '600',
              color: 'var(--color-text)',
              marginBottom: '8px',
            }}>
              Date From
            </label>
            <input
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              style={{
                width: '100%',
                padding: '8px 12px',
                backgroundColor: 'var(--color-background)',
                border: '1px solid var(--color-border)',
                borderRadius: '4px',
                color: 'var(--color-text)',
                fontSize: '14px',
              }}
            />
          </div>

          {/* Date To */}
          <div>
            <label style={{
              display: 'block',
              fontSize: '14px',
              fontWeight: '600',
              color: 'var(--color-text)',
              marginBottom: '8px',
            }}>
              Date To
            </label>
            <input
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              style={{
                width: '100%',
                padding: '8px 12px',
                backgroundColor: 'var(--color-background)',
                border: '1px solid var(--color-border)',
                borderRadius: '4px',
                color: 'var(--color-text)',
                fontSize: '14px',
              }}
            />
          </div>

          {/* Nesting Filter */}
          <div>
            <label style={{
              display: 'block',
              fontSize: '14px',
              fontWeight: '600',
              color: 'var(--color-text)',
              marginBottom: '8px',
            }}>
              Nesting
            </label>
            <select
              value={nestingFilter}
              onChange={(e) => setNestingFilter(e.target.value as any)}
              style={{
                width: '100%',
                padding: '8px 12px',
                backgroundColor: 'var(--color-background)',
                border: '1px solid var(--color-border)',
                borderRadius: '4px',
                color: 'var(--color-text)',
                fontSize: '14px',
              }}
            >
              <option value="all">All</option>
              <option value="nested">Nested</option>
              <option value="no-nest">No Nest</option>
            </select>
          </div>
        </div>

        {hasActiveFilters && (
          <div style={{ marginTop: '16px', paddingTop: '16px', borderTop: '1px solid var(--color-border)' }}>
            <Button
              variant="secondary"
              size="sm"
              onClick={handleClearFilters}
            >
              Clear Filters
            </Button>
          </div>
        )}
      </Card>

      {/* Observations List */}
      {loading ? (
        <Card>
          <div style={{
            textAlign: 'center',
            padding: '48px 24px',
            color: 'var(--color-text-secondary)',
          }}>
            Loading observations...
          </div>
        </Card>
      ) : observations.length === 0 ? (
        <Card>
          <div style={{
            textAlign: 'center',
            padding: '48px 24px',
            color: 'var(--color-text-secondary)',
          }}>
            <div style={{ fontSize: '48px', marginBottom: '16px' }}>🔍</div>
            <div style={{ fontSize: '18px', marginBottom: '8px' }}>
              No Observations Found
            </div>
            <div style={{ fontSize: '14px' }}>
              {hasActiveFilters
                ? 'Try adjusting your filters'
                : 'No observations have been recorded yet'}
            </div>
          </div>
        </Card>
      ) : (
        <>
          <div style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '12px',
          }}>
            {paginatedObservations.map((obs) => (
              <Card
                key={obs.id}
                style={{
                  cursor: 'pointer',
                  transition: 'all 0.2s ease',
                }}
                onClick={() => router.push(`/dashboard/observations/${obs.id}`)}
              >
                <div style={{
                  display: 'grid',
                  gridTemplateColumns: 'auto 1fr auto',
                  gap: '24px',
                  alignItems: 'center',
                }}>
                  {/* Date/Time */}
                  <div style={{
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    minWidth: '80px',
                  }}>
                    <div style={{
                      fontSize: '24px',
                      fontWeight: '600',
                      color: 'var(--color-primary)',
                    }}>
                      {obs.encounter_date ? new Date(obs.encounter_date).getDate() : '?'}
                    </div>
                    <div style={{
                      fontSize: '12px',
                      color: 'var(--color-text-secondary)',
                      textTransform: 'uppercase',
                    }}>
                      {obs.encounter_date ? new Date(obs.encounter_date).toLocaleDateString('en-US', { month: 'short', year: 'numeric' }) : 'N/A'}
                    </div>
                    <div style={{
                      fontSize: '12px',
                      color: 'var(--color-text-muted)',
                    }}>
                      {obs.encounter_date ? formatTime(obs.encounter_date) : ''}
                    </div>
                  </div>

                  {/* Main Content */}
                  <div>
                    <div style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '12px',
                      marginBottom: '8px',
                    }}>
                      <div style={{
                        fontSize: '20px',
                        fontWeight: '600',
                        color: 'var(--color-text)',
                      }}>
                        {obs.turtle_name || 'Unknown Turtle'}
                      </div>
                      {obs.species && (
                        <Badge variant="default" size="sm">
                          {obs.species}
                        </Badge>
                      )}
                      {obs.did_she_nest && (
                        <Badge variant="success" size="sm">
                          🥚 Nested
                        </Badge>
                      )}
                      {obs.is_recapture && (
                        <Badge variant="info" size="sm">
                          Recapture
                        </Badge>
                      )}
                    </div>

                    <div style={{
                      display: 'grid',
                      gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
                      gap: '12px',
                      fontSize: '14px',
                      color: 'var(--color-text-secondary)',
                    }}>
                      <div>
                        <span style={{ color: 'var(--color-text-muted)' }}>Observer:</span>{' '}
                        {obs.observer_name || 'Unknown'}
                      </div>
                      {obs.beach_sector && (
                        <div>
                          <span style={{ color: 'var(--color-text-muted)' }}>Sector:</span>{' '}
                          {obs.beach_sector}
                        </div>
                      )}
                      {obs.egg_count && (
                        <div>
                          <span style={{ color: 'var(--color-text-muted)' }}>Eggs:</span>{' '}
                          {obs.egg_count}
                        </div>
                      )}
                      {obs.temperature && (
                        <div>
                          <span style={{ color: 'var(--color-text-muted)' }}>Temp:</span>{' '}
                          {obs.temperature}°F
                        </div>
                      )}
                    </div>

                    {obs.comments && (
                      <div style={{
                        marginTop: '8px',
                        fontSize: '13px',
                        color: 'var(--color-text-secondary)',
                        fontStyle: 'italic',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}>
                        "{obs.comments}"
                      </div>
                    )}
                  </div>

                  {/* Arrow */}
                  <div style={{
                    fontSize: '24px',
                    color: 'var(--color-text-muted)',
                  }}>
                    →
                  </div>
                </div>
              </Card>
            ))}
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div style={{
              display: 'flex',
              justifyContent: 'center',
              alignItems: 'center',
              gap: '12px',
              marginTop: '24px',
            }}>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                disabled={currentPage === 1}
              >
                ← Previous
              </Button>
              <div style={{
                fontSize: '14px',
                color: 'var(--color-text-secondary)',
              }}>
                Page {currentPage} of {totalPages}
              </div>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                disabled={currentPage === totalPages}
              >
                Next →
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
