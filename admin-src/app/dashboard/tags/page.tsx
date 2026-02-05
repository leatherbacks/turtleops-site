'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/components/auth/AuthProvider';
import { supabase } from '@/lib/supabase';
import { formatDateWithTimezone, getTimezoneAbbreviation } from '@/lib/utils/datetime';
import Card from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import Badge from '@/components/ui/Badge';

interface TagHistoryRecord {
  id: string;
  turtle_id: string;
  turtle_name: string;
  observation_id: string;
  encounter_date: string;
  observer_name: string;
  lrf: string | null;
  rrf: string | null;
  rff: string | null;
  lff: string | null;
  previous_lrf: string | null;
  previous_rrf: string | null;
  previous_rff: string | null;
  previous_lff: string | null;
  notes: string | null;
}

interface TagChange {
  turtle_name: string;
  encounter_date: string;
  observer_name: string;
  position: string;
  old_tag: string;
  new_tag: string;
  change_type: 'new' | 'replaced' | 'lost';
}

export default function TagHistoryPage() {
  const router = useRouter();
  const { profile } = useAuth();
  const [tagHistory, setTagHistory] = useState<TagHistoryRecord[]>([]);
  const [tagChanges, setTagChanges] = useState<TagChange[]>([]);
  const [loading, setLoading] = useState(true);
  const [timezone, setTimezone] = useState('America/New_York');
  const [searchTag, setSearchTag] = useState('');
  const [showChangesOnly, setShowChangesOnly] = useState(false);

  // Filter state
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [changeTypeFilter, setChangeTypeFilter] = useState<'all' | 'new' | 'replaced' | 'lost'>('all');

  // Load timezone
  useEffect(() => {
    const loadTimezone = async () => {
      if (!profile?.org_id) return;

      const { data } = await supabase
        .from('project_config')
        .select('timezone')
        .eq('org_id', profile.org_id)
        .maybeSingle();

      if (data?.timezone) {
        setTimezone(data.timezone);
      }
    };

    loadTimezone();
  }, [profile?.org_id]);

  // Load tag history
  useEffect(() => {
    loadTagHistory();
  }, [dateFrom, dateTo, searchTag]);

  const loadTagHistory = async () => {
    setLoading(true);

    try {
      let query = supabase
        .from('tag_history')
        .select(`
          id,
          turtle_id,
          observation_id,
          encounter_date,
          observer_name,
          lrf,
          rrf,
          rff,
          lff,
          previous_lrf,
          previous_rrf,
          previous_rff,
          previous_lff,
          notes,
          turtles!inner(name)
        `)
        .order('encounter_date', { ascending: false });

      // Apply filters
      if (dateFrom) {
        query = query.gte('encounter_date', new Date(dateFrom).toISOString());
      }
      if (dateTo) {
        query = query.lte('encounter_date', new Date(dateTo).toISOString());
      }

      // Search by tag
      if (searchTag) {
        query = query.or(
          `lrf.ilike.%${searchTag}%,rrf.ilike.%${searchTag}%,rff.ilike.%${searchTag}%,lff.ilike.%${searchTag}%,previous_lrf.ilike.%${searchTag}%,previous_rrf.ilike.%${searchTag}%,previous_rff.ilike.%${searchTag}%,previous_lff.ilike.%${searchTag}%`
        );
      }

      const { data, error } = await query;

      if (error) {
        console.error('Error loading tag history:', error);
        return;
      }

      // Transform data
      const records: TagHistoryRecord[] = (data || []).map((record: any) => ({
        ...record,
        turtle_name: record.turtles?.name || 'Unknown',
      }));

      setTagHistory(records);

      // Extract tag changes
      const changes: TagChange[] = [];

      records.forEach((record) => {
        const positions = ['lrf', 'rrf', 'rff', 'lff'] as const;
        const positionNames = {
          lrf: 'LRF (Left Rear)',
          rrf: 'RRF (Right Rear)',
          rff: 'RFF (Right Front)',
          lff: 'LFF (Left Front)',
        };

        positions.forEach((pos) => {
          const currentTag = record[pos];
          const previousTag = record[`previous_${pos}` as keyof TagHistoryRecord] as string | null;

          if (currentTag && !previousTag) {
            // New tag applied
            changes.push({
              turtle_name: record.turtle_name,
              encounter_date: record.encounter_date,
              observer_name: record.observer_name,
              position: positionNames[pos],
              old_tag: '(none)',
              new_tag: currentTag,
              change_type: 'new',
            });
          } else if (currentTag && previousTag && currentTag !== previousTag) {
            // Tag replaced
            changes.push({
              turtle_name: record.turtle_name,
              encounter_date: record.encounter_date,
              observer_name: record.observer_name,
              position: positionNames[pos],
              old_tag: previousTag,
              new_tag: currentTag,
              change_type: 'replaced',
            });
          } else if (!currentTag && previousTag) {
            // Tag lost
            changes.push({
              turtle_name: record.turtle_name,
              encounter_date: record.encounter_date,
              observer_name: record.observer_name,
              position: positionNames[pos],
              old_tag: previousTag,
              new_tag: '(none)',
              change_type: 'lost',
            });
          }
        });
      });

      setTagChanges(changes);
    } finally {
      setLoading(false);
    }
  };

  const exportToCMTTPExcel = () => {
    // CMTTP format headers
    const headers = [
      'Turtle Name',
      'Tag Number',
      'Tag Position',
      'Tag Applied Date',
      'Tag Applied By',
      'Tag Status',
      'Previous Tag',
      'Tag Change Type',
      'Notes',
    ];

    // Create rows for all tag changes
    const rows = tagChanges
      .filter(change => {
        if (changeTypeFilter !== 'all' && change.change_type !== changeTypeFilter) {
          return false;
        }
        return true;
      })
      .map(change => {
        const status = change.change_type === 'lost' ? 'Lost' :
                      change.change_type === 'replaced' ? 'Replaced' :
                      'Active';

        return [
          change.turtle_name,
          change.new_tag !== '(none)' ? change.new_tag : change.old_tag,
          change.position,
          formatDateWithTimezone(change.encounter_date, timezone),
          change.observer_name,
          status,
          change.old_tag,
          change.change_type.charAt(0).toUpperCase() + change.change_type.slice(1),
          '', // Notes field - can be populated with additional info
        ];
      });

    // Create CSV
    const csvContent = [
      headers.join(','),
      ...rows.map(row => row.map(cell => `"${cell}"`).join(','))
    ].join('\n');

    // Download
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `cmttp_tag_history_${new Date().toISOString().split('T')[0]}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.URL.revokeObjectURL(url);
  };

  const filteredChanges = tagChanges.filter(change => {
    if (changeTypeFilter !== 'all' && change.change_type !== changeTypeFilter) {
      return false;
    }
    return true;
  });

  const stats = {
    totalTags: tagHistory.length,
    newTags: tagChanges.filter(c => c.change_type === 'new').length,
    replacedTags: tagChanges.filter(c => c.change_type === 'replaced').length,
    lostTags: tagChanges.filter(c => c.change_type === 'lost').length,
  };

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
            Tag History & Analytics
          </h1>
          <p style={{
            color: 'var(--color-text-secondary)',
          }}>
            {stats.totalTags} tag records • {filteredChanges.length} changes tracked
          </p>
          <p style={{
            color: 'var(--color-text-muted)',
            fontSize: '13px',
            marginTop: '4px',
          }}>
            All times shown in {getTimezoneAbbreviation(timezone)}
          </p>
        </div>
        <div style={{ display: 'flex', gap: '12px' }}>
          <Button onClick={exportToCMTTPExcel} variant="secondary" disabled={filteredChanges.length === 0}>
            📊 Export CMTTP Excel
          </Button>
          <Button onClick={loadTagHistory} disabled={loading}>
            {loading ? 'Loading...' : '🔄 Refresh'}
          </Button>
        </div>
      </div>

      {/* Stats Cards */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
        gap: '16px',
        marginBottom: '24px',
      }}>
        <Card>
          <div style={{ padding: '16px' }}>
            <div style={{ fontSize: '32px', fontWeight: '600', color: 'var(--color-primary)' }}>
              {stats.newTags}
            </div>
            <div style={{ fontSize: '14px', color: 'var(--color-text-secondary)', marginTop: '4px' }}>
              New Tags Applied
            </div>
          </div>
        </Card>
        <Card>
          <div style={{ padding: '16px' }}>
            <div style={{ fontSize: '32px', fontWeight: '600', color: 'var(--color-warning)' }}>
              {stats.replacedTags}
            </div>
            <div style={{ fontSize: '14px', color: 'var(--color-text-secondary)', marginTop: '4px' }}>
              Tags Replaced
            </div>
          </div>
        </Card>
        <Card>
          <div style={{ padding: '16px' }}>
            <div style={{ fontSize: '32px', fontWeight: '600', color: 'var(--color-error)' }}>
              {stats.lostTags}
            </div>
            <div style={{ fontSize: '14px', color: 'var(--color-text-secondary)', marginTop: '4px' }}>
              Tags Lost
            </div>
          </div>
        </Card>
      </div>

      {/* Filters */}
      <Card style={{ marginBottom: '24px' }}>
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
          gap: '16px',
        }}>
          {/* Search Tag */}
          <div>
            <label style={{
              display: 'block',
              fontSize: '14px',
              fontWeight: '600',
              color: 'var(--color-text)',
              marginBottom: '8px',
            }}>
              Search Tag Number
            </label>
            <input
              type="text"
              value={searchTag}
              onChange={(e) => setSearchTag(e.target.value)}
              placeholder="Search current or previous tags..."
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

          {/* Change Type Filter */}
          <div>
            <label style={{
              display: 'block',
              fontSize: '14px',
              fontWeight: '600',
              color: 'var(--color-text)',
              marginBottom: '8px',
            }}>
              Change Type
            </label>
            <select
              value={changeTypeFilter}
              onChange={(e) => setChangeTypeFilter(e.target.value as any)}
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
              <option value="all">All Changes</option>
              <option value="new">New Tags</option>
              <option value="replaced">Replaced Tags</option>
              <option value="lost">Lost Tags</option>
            </select>
          </div>
        </div>
      </Card>

      {/* Tag Changes List */}
      {loading ? (
        <Card>
          <div style={{
            textAlign: 'center',
            padding: '48px 24px',
            color: 'var(--color-text-secondary)',
          }}>
            Loading tag history...
          </div>
        </Card>
      ) : filteredChanges.length === 0 ? (
        <Card>
          <div style={{
            textAlign: 'center',
            padding: '48px 24px',
            color: 'var(--color-text-secondary)',
          }}>
            <div style={{ fontSize: '48px', marginBottom: '16px' }}>🏷️</div>
            <div style={{ fontSize: '18px', marginBottom: '8px' }}>
              No Tag Changes Found
            </div>
            <div style={{ fontSize: '14px' }}>
              Try adjusting your filters
            </div>
          </div>
        </Card>
      ) : (
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          gap: '12px',
        }}>
          {filteredChanges.map((change, index) => (
            <Card
              key={index}
              style={{
                cursor: 'pointer',
              }}
              onClick={() => {
                // Navigate to turtle detail or observation
              }}
            >
              <div style={{
                display: 'grid',
                gridTemplateColumns: 'auto 1fr auto',
                gap: '24px',
                alignItems: 'center',
              }}>
                {/* Date */}
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
                    {new Date(change.encounter_date).getDate()}
                  </div>
                  <div style={{
                    fontSize: '12px',
                    color: 'var(--color-text-secondary)',
                    textTransform: 'uppercase',
                  }}>
                    {new Date(change.encounter_date).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}
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
                      {change.turtle_name}
                    </div>
                    <Badge
                      variant={
                        change.change_type === 'new' ? 'success' :
                        change.change_type === 'replaced' ? 'warning' :
                        'error'
                      }
                      size="sm"
                    >
                      {change.change_type === 'new' && '🆕 New Tag'}
                      {change.change_type === 'replaced' && '🔄 Replaced'}
                      {change.change_type === 'lost' && '❌ Lost'}
                    </Badge>
                  </div>

                  <div style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
                    gap: '12px',
                    fontSize: '14px',
                    color: 'var(--color-text-secondary)',
                  }}>
                    <div>
                      <span style={{ color: 'var(--color-text-muted)' }}>Position:</span>{' '}
                      {change.position}
                    </div>
                    <div>
                      <span style={{ color: 'var(--color-text-muted)' }}>Old Tag:</span>{' '}
                      <code style={{
                        backgroundColor: 'var(--color-surface)',
                        padding: '2px 6px',
                        borderRadius: '3px',
                        fontSize: '13px',
                      }}>
                        {change.old_tag}
                      </code>
                    </div>
                    <div>
                      <span style={{ color: 'var(--color-text-muted)' }}>New Tag:</span>{' '}
                      <code style={{
                        backgroundColor: 'var(--color-surface)',
                        padding: '2px 6px',
                        borderRadius: '3px',
                        fontSize: '13px',
                      }}>
                        {change.new_tag}
                      </code>
                    </div>
                    <div>
                      <span style={{ color: 'var(--color-text-muted)' }}>Observer:</span>{' '}
                      {change.observer_name}
                    </div>
                  </div>
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
      )}
    </div>
  );
}
