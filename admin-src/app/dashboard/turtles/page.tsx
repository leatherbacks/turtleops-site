'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { getTurtles, getTurtlesCount, exportTurtlesToCSV, type TurtleFilters } from '@/lib/database/turtles';
import type { Turtle } from '@/lib/types';
import Card from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import Badge from '@/components/ui/Badge';

export default function TurtlesPage() {
  const router = useRouter();
  const [turtles, setTurtles] = useState<Turtle[]>([]);
  const [loading, setLoading] = useState(true);
  const [totalCount, setTotalCount] = useState(0);

  // Filter state
  const [searchQuery, setSearchQuery] = useState('');
  const [speciesFilter, setSpeciesFilter] = useState<string>('all');
  const [nameStatusFilter, setNameStatusFilter] = useState<'all' | 'named' | 'unnamed'>('all');
  const [researchFilter, setResearchFilter] = useState<'all' | 'needs-research' | 'no-research'>('all');

  // Pagination
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 25;

  useEffect(() => {
    loadTurtles();
  }, [searchQuery, speciesFilter, nameStatusFilter, researchFilter]);

  const loadTurtles = async () => {
    setLoading(true);

    const filters: TurtleFilters = {};

    if (searchQuery) {
      filters.searchQuery = searchQuery;
    }
    if (speciesFilter !== 'all') {
      filters.species = speciesFilter;
    }
    if (nameStatusFilter === 'named') {
      filters.hasName = true;
    } else if (nameStatusFilter === 'unnamed') {
      filters.hasName = false;
    }
    if (researchFilter === 'needs-research') {
      filters.needsResearch = true;
    } else if (researchFilter === 'no-research') {
      filters.needsResearch = false;
    }

    const [data, count] = await Promise.all([
      getTurtles(filters),
      getTurtlesCount(filters),
    ]);

    setTurtles(data);
    setTotalCount(count);
    setLoading(false);
  };

  const handleExportCSV = () => {
    const csv = exportTurtlesToCSV(turtles);
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `turtles_${new Date().toISOString().split('T')[0]}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.URL.revokeObjectURL(url);
  };

  const handleClearFilters = () => {
    setSearchQuery('');
    setSpeciesFilter('all');
    setNameStatusFilter('all');
    setResearchFilter('all');
  };

  const formatDate = (date: Date | string) => {
    const d = typeof date === 'string' ? new Date(date) : date;
    return d.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  };

  const isUnnamed = (name: string) => {
    return name.toUpperCase().startsWith('UNNAMED-');
  };

  const getSpeciesAbbreviation = (species: string | null) => {
    if (!species) return '?';
    const upper = species.toUpperCase();
    if (upper.includes('LOGGERHEAD')) return 'CC';
    if (upper.includes('GREEN')) return 'CM';
    if (upper.includes('LEATHERBACK')) return 'DC';
    if (upper.includes('KEMP')) return 'LK';
    if (upper.includes('HAWKSBILL')) return 'EI';
    return species.substring(0, 2).toUpperCase();
  };

  // Pagination
  const totalPages = Math.ceil(turtles.length / itemsPerPage);
  const startIndex = (currentPage - 1) * itemsPerPage;
  const endIndex = startIndex + itemsPerPage;
  const paginatedTurtles = turtles.slice(startIndex, endIndex);

  const hasActiveFilters =
    searchQuery ||
    speciesFilter !== 'all' ||
    nameStatusFilter !== 'all' ||
    researchFilter !== 'all';

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
            Turtles
          </h1>
          <p style={{
            color: 'var(--color-text-secondary)',
          }}>
            {totalCount} turtle{totalCount !== 1 ? 's' : ''} in database
          </p>
        </div>
        <div style={{ display: 'flex', gap: '12px' }}>
          <Button
            onClick={handleExportCSV}
            variant="secondary"
            disabled={turtles.length === 0}
          >
            📥 Export CSV
          </Button>
          <Button onClick={loadTurtles} disabled={loading}>
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
              placeholder="Name or tag number..."
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

          {/* Species Filter */}
          <div>
            <label style={{
              display: 'block',
              fontSize: '14px',
              fontWeight: '600',
              color: 'var(--color-text)',
              marginBottom: '8px',
            }}>
              Species
            </label>
            <select
              value={speciesFilter}
              onChange={(e) => setSpeciesFilter(e.target.value)}
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
              <option value="all">All Species</option>
              <option value="Loggerhead">Loggerhead</option>
              <option value="Green">Green</option>
              <option value="Leatherback">Leatherback</option>
              <option value="Kemps Ridley">Kemp&apos;s Ridley</option>
              <option value="Hawksbill">Hawksbill</option>
            </select>
          </div>

          {/* Name Status Filter */}
          <div>
            <label style={{
              display: 'block',
              fontSize: '14px',
              fontWeight: '600',
              color: 'var(--color-text)',
              marginBottom: '8px',
            }}>
              Name Status
            </label>
            <select
              value={nameStatusFilter}
              onChange={(e) => setNameStatusFilter(e.target.value as any)}
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
              <option value="named">Named Only</option>
              <option value="unnamed">Unnamed Only</option>
            </select>
          </div>

          {/* Research Status Filter */}
          <div>
            <label style={{
              display: 'block',
              fontSize: '14px',
              fontWeight: '600',
              color: 'var(--color-text)',
              marginBottom: '8px',
            }}>
              Research Status
            </label>
            <select
              value={researchFilter}
              onChange={(e) => setResearchFilter(e.target.value as any)}
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
              <option value="needs-research">Needs Research</option>
              <option value="no-research">No Research Needed</option>
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

      {/* Turtles List */}
      {loading ? (
        <Card>
          <div style={{
            textAlign: 'center',
            padding: '48px 24px',
            color: 'var(--color-text-secondary)',
          }}>
            Loading turtles...
          </div>
        </Card>
      ) : turtles.length === 0 ? (
        <Card>
          <div style={{
            textAlign: 'center',
            padding: '48px 24px',
            color: 'var(--color-text-secondary)',
          }}>
            <div style={{ fontSize: '48px', marginBottom: '16px' }}>🐢</div>
            <div style={{ fontSize: '18px', marginBottom: '8px' }}>
              No Turtles Found
            </div>
            <div style={{ fontSize: '14px' }}>
              {hasActiveFilters
                ? 'Try adjusting your filters'
                : 'No turtles have been recorded yet'}
            </div>
          </div>
        </Card>
      ) : (
        <>
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(350px, 1fr))',
            gap: '16px',
          }}>
            {paginatedTurtles.map((turtle) => (
              <Card
                key={turtle.id}
                style={{
                  cursor: 'pointer',
                  transition: 'all 0.2s ease',
                }}
                onClick={() => router.push(`/dashboard/turtles/${turtle.id}`)}
              >
                <div>
                  {/* Header with name and badges */}
                  <div style={{
                    display: 'flex',
                    alignItems: 'flex-start',
                    justifyContent: 'space-between',
                    marginBottom: '12px',
                  }}>
                    <div style={{ flex: 1 }}>
                      <div style={{
                        fontSize: '20px',
                        fontWeight: '600',
                        color: 'var(--color-text)',
                        marginBottom: '8px',
                      }}>
                        {turtle.name}
                      </div>
                      <div style={{
                        display: 'flex',
                        flexWrap: 'wrap',
                        gap: '6px',
                      }}>
                        {/* Species Badge */}
                        {turtle.species && (
                          <Badge variant="default" size="sm">
                            {getSpeciesAbbreviation(turtle.species)}
                          </Badge>
                        )}
                        {/* Unnamed Badge */}
                        {isUnnamed(turtle.name) && (
                          <Badge variant="warning" size="sm">
                            Unnamed
                          </Badge>
                        )}
                        {/* Needs Research Badge */}
                        {turtle.needs_research && (
                          <Badge variant="error" size="sm">
                            Research
                          </Badge>
                        )}
                        {/* Suggested Name Badge */}
                        {turtle.suggested_name && (
                          <Badge variant="info" size="sm">
                            Name Suggested
                          </Badge>
                        )}
                      </div>
                    </div>
                    {/* Encounter Count */}
                    <div style={{
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      minWidth: '60px',
                      padding: '8px',
                      backgroundColor: 'var(--color-background)',
                      borderRadius: '8px',
                    }}>
                      <div style={{
                        fontSize: '24px',
                        fontWeight: '600',
                        color: 'var(--color-primary)',
                      }}>
                        {turtle.encounter_count || 0}
                      </div>
                      <div style={{
                        fontSize: '11px',
                        color: 'var(--color-text-muted)',
                        textTransform: 'uppercase',
                      }}>
                        Sightings
                      </div>
                    </div>
                  </div>

                  {/* Tags */}
                  <div style={{
                    display: 'grid',
                    gridTemplateColumns: '1fr 1fr',
                    gap: '8px',
                    marginBottom: '12px',
                    padding: '12px',
                    backgroundColor: 'var(--color-background)',
                    borderRadius: '6px',
                  }}>
                    <div style={{ fontSize: '13px' }}>
                      <span style={{
                        color: 'var(--color-text-muted)',
                        fontWeight: '600',
                        textTransform: 'uppercase',
                        fontSize: '11px',
                      }}>
                        LRF:
                      </span>{' '}
                      <span style={{ color: 'var(--color-text-secondary)' }}>
                        {turtle.lrf || '—'}
                      </span>
                    </div>
                    <div style={{ fontSize: '13px' }}>
                      <span style={{
                        color: 'var(--color-text-muted)',
                        fontWeight: '600',
                        textTransform: 'uppercase',
                        fontSize: '11px',
                      }}>
                        RRF:
                      </span>{' '}
                      <span style={{ color: 'var(--color-text-secondary)' }}>
                        {turtle.rrf || '—'}
                      </span>
                    </div>
                    <div style={{ fontSize: '13px' }}>
                      <span style={{
                        color: 'var(--color-text-muted)',
                        fontWeight: '600',
                        textTransform: 'uppercase',
                        fontSize: '11px',
                      }}>
                        RFF:
                      </span>{' '}
                      <span style={{ color: 'var(--color-text-secondary)' }}>
                        {turtle.rff || '—'}
                      </span>
                    </div>
                    <div style={{ fontSize: '13px' }}>
                      <span style={{
                        color: 'var(--color-text-muted)',
                        fontWeight: '600',
                        textTransform: 'uppercase',
                        fontSize: '11px',
                      }}>
                        LFF:
                      </span>{' '}
                      <span style={{ color: 'var(--color-text-secondary)' }}>
                        {turtle.lff || '—'}
                      </span>
                    </div>
                  </div>

                  {/* Dates */}
                  <div style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    fontSize: '13px',
                    color: 'var(--color-text-secondary)',
                    paddingTop: '12px',
                    borderTop: '1px solid var(--color-border)',
                  }}>
                    <div>
                      <span style={{ color: 'var(--color-text-muted)' }}>First:</span>{' '}
                      {turtle.first_encountered_at ? formatDate(turtle.first_encountered_at) : '—'}
                    </div>
                    <div>
                      <span style={{ color: 'var(--color-text-muted)' }}>Last:</span>{' '}
                      {turtle.last_encountered_at ? formatDate(turtle.last_encountered_at) : '—'}
                    </div>
                  </div>

                  {/* Suggested Name */}
                  {turtle.suggested_name && (
                    <div style={{
                      marginTop: '12px',
                      padding: '8px',
                      backgroundColor: 'rgba(59, 130, 246, 0.1)',
                      borderRadius: '4px',
                      fontSize: '13px',
                      color: 'var(--color-info-light)',
                    }}>
                      Suggested name: <strong>{turtle.suggested_name}</strong>
                      {turtle.suggested_by_name && (
                        <span style={{ opacity: 0.8 }}>
                          {' '}by {turtle.suggested_by_name}
                        </span>
                      )}
                    </div>
                  )}
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
