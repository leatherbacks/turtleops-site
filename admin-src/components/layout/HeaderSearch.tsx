'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { getTurtlesWithCount } from '@/lib/database/turtles';
import { getObservationsWithCount } from '@/lib/database/observations';

interface SearchResult {
  type: 'turtle' | 'observation';
  id: string;
  title: string;
  subtitle: string;
  icon: string;
}

export default function HeaderSearch() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [searching, setSearching] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const router = useRouter();
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const search = useCallback(async (q: string) => {
    if (q.length < 2) {
      setResults([]);
      return;
    }

    setSearching(true);
    try {
      const [turtles, observations] = await Promise.all([
        getTurtlesWithCount({ searchQuery: q, limit: 5 }),
        getObservationsWithCount({ searchQuery: q, limit: 5 }),
      ]);

      const mapped: SearchResult[] = [
        ...turtles.data.map((t) => ({
          type: 'turtle' as const,
          id: t.id,
          title: t.name,
          subtitle: [t.species, t.lrf, t.rrf].filter(Boolean).join(' · ') || 'No tags',
          icon: '🐢',
        })),
        ...observations.data.map((o) => ({
          type: 'observation' as const,
          id: o.id,
          title: o.turtle_name || 'Unknown',
          subtitle: `${o.observer_name} · ${new Date(o.encounter_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`,
          icon: '📋',
        })),
      ];

      setResults(mapped);
      setSelectedIndex(-1);
    } catch (err) {
      console.error('Search error:', err);
    } finally {
      setSearching(false);
    }
  }, []);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (query.length < 2) {
      setResults([]);
      setIsOpen(false);
      return;
    }
    setIsOpen(true);
    debounceRef.current = setTimeout(() => search(query), 300);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, search]);

  // Close dropdown on click outside
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(e.target as Node) &&
        inputRef.current &&
        !inputRef.current.contains(e.target as Node)
      ) {
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  function navigate(result: SearchResult) {
    if (result.type === 'turtle') {
      router.push(`/dashboard/turtles/${result.id}`);
    } else {
      router.push(`/dashboard/observations/${result.id}`);
    }
    setQuery('');
    setIsOpen(false);
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (!isOpen || results.length === 0) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex((i) => (i < results.length - 1 ? i + 1 : 0));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex((i) => (i > 0 ? i - 1 : results.length - 1));
    } else if (e.key === 'Enter' && selectedIndex >= 0) {
      e.preventDefault();
      navigate(results[selectedIndex]);
    } else if (e.key === 'Escape') {
      setIsOpen(false);
      inputRef.current?.blur();
    }
  }

  return (
    <div style={{ position: 'relative', flex: 1, maxWidth: '360px' }}>
      <div style={{ position: 'relative' }}>
        <span style={{
          position: 'absolute',
          left: '12px',
          top: '50%',
          transform: 'translateY(-50%)',
          fontSize: '13px',
          opacity: 0.4,
          pointerEvents: 'none',
        }}>
          🔍
        </span>
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => { if (results.length > 0) setIsOpen(true); }}
          onKeyDown={handleKeyDown}
          placeholder="Search turtles, tags, observers..."
          style={{
            width: '100%',
            padding: '7px 12px 7px 34px',
            fontSize: '13px',
            backgroundColor: 'rgba(255, 255, 255, 0.04)',
            border: '1px solid var(--color-border)',
            borderRadius: '8px',
            color: 'var(--color-text)',
            outline: 'none',
            transition: 'all 0.15s ease',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.borderColor = 'var(--color-border-light)';
          }}
          onMouseLeave={(e) => {
            if (document.activeElement !== e.currentTarget) {
              e.currentTarget.style.borderColor = 'var(--color-border)';
            }
          }}
        />
      </div>

      {/* Results dropdown */}
      {isOpen && (
        <div
          ref={dropdownRef}
          style={{
            position: 'absolute',
            top: '100%',
            left: 0,
            right: 0,
            marginTop: '6px',
            backgroundColor: 'var(--color-surface-elevated)',
            border: '1px solid var(--color-border-light)',
            borderRadius: 'var(--radius-md)',
            boxShadow: '0 8px 32px rgba(0, 0, 0, 0.4)',
            zIndex: 100,
            overflow: 'hidden',
            maxHeight: '360px',
            overflowY: 'auto',
          }}
        >
          {searching && results.length === 0 && (
            <div style={{ padding: '14px 16px', fontSize: '13px', color: 'var(--color-text-muted)', textAlign: 'center' }}>
              Searching...
            </div>
          )}

          {!searching && query.length >= 2 && results.length === 0 && (
            <div style={{ padding: '14px 16px', fontSize: '13px', color: 'var(--color-text-muted)', textAlign: 'center' }}>
              No results found
            </div>
          )}

          {results.length > 0 && (
            <>
              {/* Group: Turtles */}
              {results.some((r) => r.type === 'turtle') && (
                <>
                  <div style={{
                    padding: '8px 16px 4px',
                    fontSize: '10px',
                    fontWeight: '600',
                    color: 'var(--color-text-muted)',
                    textTransform: 'uppercase',
                    letterSpacing: '0.5px',
                  }}>
                    Turtles
                  </div>
                  {results.filter((r) => r.type === 'turtle').map((result) => {
                    const idx = results.indexOf(result);
                    return (
                      <div
                        key={`${result.type}-${result.id}`}
                        onClick={() => navigate(result)}
                        style={{
                          padding: '8px 16px',
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '10px',
                          backgroundColor: idx === selectedIndex ? 'rgba(255, 255, 255, 0.06)' : 'transparent',
                          transition: 'background-color 0.1s ease',
                        }}
                        onMouseEnter={(e) => {
                          e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.06)';
                          setSelectedIndex(idx);
                        }}
                        onMouseLeave={(e) => {
                          if (idx !== selectedIndex) {
                            e.currentTarget.style.backgroundColor = 'transparent';
                          }
                        }}
                      >
                        <span style={{ fontSize: '14px' }}>{result.icon}</span>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: '13px', fontWeight: '500', color: 'var(--color-text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            {result.title}
                          </div>
                          <div style={{ fontSize: '11px', color: 'var(--color-text-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            {result.subtitle}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </>
              )}

              {/* Group: Observations */}
              {results.some((r) => r.type === 'observation') && (
                <>
                  <div style={{
                    padding: '8px 16px 4px',
                    fontSize: '10px',
                    fontWeight: '600',
                    color: 'var(--color-text-muted)',
                    textTransform: 'uppercase',
                    letterSpacing: '0.5px',
                    borderTop: results.some((r) => r.type === 'turtle') ? '1px solid var(--color-border)' : 'none',
                  }}>
                    Observations
                  </div>
                  {results.filter((r) => r.type === 'observation').map((result) => {
                    const idx = results.indexOf(result);
                    return (
                      <div
                        key={`${result.type}-${result.id}`}
                        onClick={() => navigate(result)}
                        style={{
                          padding: '8px 16px',
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '10px',
                          backgroundColor: idx === selectedIndex ? 'rgba(255, 255, 255, 0.06)' : 'transparent',
                          transition: 'background-color 0.1s ease',
                        }}
                        onMouseEnter={(e) => {
                          e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.06)';
                          setSelectedIndex(idx);
                        }}
                        onMouseLeave={(e) => {
                          if (idx !== selectedIndex) {
                            e.currentTarget.style.backgroundColor = 'transparent';
                          }
                        }}
                      >
                        <span style={{ fontSize: '14px' }}>{result.icon}</span>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: '13px', fontWeight: '500', color: 'var(--color-text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            {result.title}
                          </div>
                          <div style={{ fontSize: '11px', color: 'var(--color-text-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            {result.subtitle}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
