'use client';

import { useState, useEffect } from 'react';
import { getTurtlesNeedingResearch, updateTurtle } from '@/lib/database/turtles';
import { useAuth } from '@/components/auth/AuthProvider';
import type { Turtle } from '@/lib/types';
import Card from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import Badge from '@/components/ui/Badge';

export default function ResearchFlagsPage() {
  const { profile } = useAuth();
  const [turtles, setTurtles] = useState<Turtle[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'active' | 'resolved'>('active');
  const [processing, setProcessing] = useState<string | null>(null);
  const [editingNotes, setEditingNotes] = useState<Record<string, string>>({});
  const [editingName, setEditingName] = useState<Record<string, string>>({});

  useEffect(() => {
    loadTurtles();
  }, []);

  const loadTurtles = async () => {
    setLoading(true);
    const data = await getTurtlesNeedingResearch();
    setTurtles(data);
    setLoading(false);
  };

  const filteredTurtles = turtles.filter((t) =>
    filter === 'active' ? !t.researchResolvedAt : !!t.researchResolvedAt
  );

  const handleUpdateNotes = async (turtle: Turtle) => {
    const notes = editingNotes[turtle.id];

    if (!notes || !profile) return;

    setProcessing(turtle.id);

    const updated = await updateTurtle(turtle.id, {
      researchNotes: notes,
    });

    if (updated) {
      alert('Research notes updated');
      await loadTurtles();
      setEditingNotes((prev) => {
        const next = { ...prev };
        delete next[turtle.id];
        return next;
      });
    } else {
      alert('Failed to update notes. Please try again.');
    }

    setProcessing(null);
  };

  const handleAssignName = async (turtle: Turtle) => {
    const newName = editingName[turtle.id]?.trim().toUpperCase();

    if (!newName || !profile) return;

    if (!confirm(`Assign permanent name "${newName}" to ${turtle.name}?`)) {
      return;
    }

    setProcessing(turtle.id);

    const updated = await updateTurtle(turtle.id, {
      name: newName,
    });

    if (updated) {
      alert(`Name updated to ${updated.name}`);
      await loadTurtles();
      setEditingName((prev) => {
        const next = { ...prev };
        delete next[turtle.id];
        return next;
      });
    } else {
      alert('Failed to update name. Please try again.');
    }

    setProcessing(null);
  };

  const handleResolve = async (turtle: Turtle) => {
    if (!profile) return;

    if (!confirm(`Mark research as resolved for ${turtle.name}?`)) {
      return;
    }

    setProcessing(turtle.id);

    const updated = await updateTurtle(turtle.id, {
      needsResearch: false,
      researchResolvedAt: new Date(),
      researchResolvedBy: profile.id,
    });

    if (updated) {
      alert('Research flag resolved');
      await loadTurtles();
    } else {
      alert('Failed to resolve. Please try again.');
    }

    setProcessing(null);
  };

  const handleReopen = async (turtle: Turtle) => {
    if (!profile) return;

    if (!confirm(`Reopen research flag for ${turtle.name}?`)) {
      return;
    }

    setProcessing(turtle.id);

    const updated = await updateTurtle(turtle.id, {
      needsResearch: true,
      researchResolvedAt: null,
      researchResolvedBy: null,
    });

    if (updated) {
      alert('Research flag reopened');
      await loadTurtles();
    } else {
      alert('Failed to reopen. Please try again.');
    }

    setProcessing(null);
  };

  const formatDate = (date: Date | null) => {
    if (!date) return 'Unknown';
    return new Date(date).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  };

  return (
    <div style={{ padding: '24px' }}>
      <div style={{ marginBottom: '32px' }}>
        <h1
          style={{
            fontSize: '32px',
            fontWeight: '600',
            color: 'var(--color-text)',
            marginBottom: '8px',
          }}
        >
          Research Flags
        </h1>
        <p
          style={{
            color: 'var(--color-text-secondary)',
          }}
        >
          Turtles flagged for research or verification
        </p>
      </div>

      {/* Filter Tabs */}
      <div
        style={{
          display: 'flex',
          gap: '8px',
          marginBottom: '24px',
          borderBottom: '1px solid var(--color-border)',
        }}
      >
        <button
          onClick={() => setFilter('active')}
          style={{
            padding: '12px 24px',
            backgroundColor: 'transparent',
            border: 'none',
            borderBottom:
              filter === 'active' ? '2px solid var(--color-primary)' : '2px solid transparent',
            color: filter === 'active' ? 'var(--color-primary)' : 'var(--color-text-secondary)',
            fontSize: '14px',
            fontWeight: filter === 'active' ? '600' : '400',
            cursor: 'pointer',
            transition: 'all 0.2s ease',
          }}
        >
          Active ({turtles.filter((t) => !t.researchResolvedAt).length})
        </button>
        <button
          onClick={() => setFilter('resolved')}
          style={{
            padding: '12px 24px',
            backgroundColor: 'transparent',
            border: 'none',
            borderBottom:
              filter === 'resolved' ? '2px solid var(--color-primary)' : '2px solid transparent',
            color:
              filter === 'resolved' ? 'var(--color-primary)' : 'var(--color-text-secondary)',
            fontSize: '14px',
            fontWeight: filter === 'resolved' ? '600' : '400',
            cursor: 'pointer',
            transition: 'all 0.2s ease',
          }}
        >
          Resolved ({turtles.filter((t) => !!t.researchResolvedAt).length})
        </button>
      </div>

      {loading ? (
        <Card>
          <div
            style={{
              textAlign: 'center',
              padding: '48px 24px',
              color: 'var(--color-text-secondary)',
            }}
          >
            Loading research flags...
          </div>
        </Card>
      ) : filteredTurtles.length === 0 ? (
        <Card>
          <div
            style={{
              textAlign: 'center',
              padding: '48px 24px',
              color: 'var(--color-text-secondary)',
            }}
          >
            <div style={{ fontSize: '48px', marginBottom: '16px' }}>
              {filter === 'active' ? '✅' : '📁'}
            </div>
            <div style={{ fontSize: '18px', marginBottom: '8px' }}>
              {filter === 'active' ? 'No Active Research Flags' : 'No Resolved Flags'}
            </div>
            <div style={{ fontSize: '14px' }}>
              {filter === 'active'
                ? 'No turtles currently flagged for research'
                : 'No research flags have been resolved yet'}
            </div>
          </div>
        </Card>
      ) : (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '16px',
          }}
        >
          {filteredTurtles.map((turtle) => (
            <Card key={turtle.id}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                {/* Header */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start' }}>
                  <div>
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '12px',
                        marginBottom: '8px',
                      }}
                    >
                      <div
                        style={{
                          fontSize: '24px',
                          fontWeight: '600',
                          color: 'var(--color-text)',
                        }}
                      >
                        {turtle.name}
                      </div>
                      {turtle.researchResolvedAt ? (
                        <Badge variant="success" size="sm">
                          RESOLVED
                        </Badge>
                      ) : (
                        <Badge variant="warning" size="sm">
                          NEEDS RESEARCH
                        </Badge>
                      )}
                    </div>
                    <div
                      style={{
                        fontSize: '14px',
                        color: 'var(--color-text-secondary)',
                      }}
                    >
                      Flagged by {turtle.researchFlaggedByName || 'Unknown'} on{' '}
                      {formatDate(turtle.researchFlaggedAt)}
                    </div>
                    {turtle.researchResolvedAt && (
                      <div
                        style={{
                          fontSize: '14px',
                          color: 'var(--color-success)',
                          marginTop: '4px',
                        }}
                      >
                        Resolved on {formatDate(turtle.researchResolvedAt)}
                      </div>
                    )}
                  </div>

                  {filter === 'active' ? (
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => handleResolve(turtle)}
                      disabled={processing === turtle.id}
                    >
                      {processing === turtle.id ? 'Processing...' : 'Mark Resolved'}
                    </Button>
                  ) : (
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => handleReopen(turtle)}
                      disabled={processing === turtle.id}
                    >
                      {processing === turtle.id ? 'Processing...' : 'Reopen'}
                    </Button>
                  )}
                </div>

                {/* Turtle Info */}
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
                    gap: '12px',
                    fontSize: '14px',
                    color: 'var(--color-text-secondary)',
                  }}
                >
                  <div>
                    <span style={{ color: 'var(--color-text-muted)' }}>Species:</span>{' '}
                    {turtle.species}
                  </div>
                  <div>
                    <span style={{ color: 'var(--color-text-muted)' }}>Encounters:</span>{' '}
                    {turtle.encounterCount}
                  </div>
                  <div>
                    <span style={{ color: 'var(--color-text-muted)' }}>First Seen:</span>{' '}
                    {formatDate(turtle.firstEncounteredAt)}
                  </div>
                  <div>
                    <span style={{ color: 'var(--color-text-muted)' }}>Last Seen:</span>{' '}
                    {formatDate(turtle.lastEncounteredAt)}
                  </div>
                </div>

                {/* Tags */}
                <div
                  style={{
                    padding: '12px',
                    backgroundColor: 'var(--color-surface-elevated)',
                    borderRadius: '6px',
                    fontSize: '13px',
                    fontFamily: 'var(--font-mono)',
                  }}
                >
                  <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns: 'repeat(auto-fit, minmax(100px, 1fr))',
                      gap: '8px',
                    }}
                  >
                    <div>
                      <span style={{ color: 'var(--color-text-muted)' }}>LRF:</span>{' '}
                      {turtle.lrf || '-'}
                    </div>
                    <div>
                      <span style={{ color: 'var(--color-text-muted)' }}>RRF:</span>{' '}
                      {turtle.rrf || '-'}
                    </div>
                    <div>
                      <span style={{ color: 'var(--color-text-muted)' }}>RFF:</span>{' '}
                      {turtle.rff || '-'}
                    </div>
                    <div>
                      <span style={{ color: 'var(--color-text-muted)' }}>LFF/PIT:</span>{' '}
                      {turtle.lff || '-'}
                    </div>
                  </div>
                </div>

                {/* Research Notes */}
                <div>
                  <div
                    style={{
                      fontSize: '14px',
                      fontWeight: '600',
                      color: 'var(--color-text)',
                      marginBottom: '8px',
                    }}
                  >
                    Research Notes
                  </div>
                  {turtle.researchNotes && !editingNotes[turtle.id] ? (
                    <div
                      style={{
                        padding: '12px',
                        backgroundColor: 'var(--color-surface-elevated)',
                        borderRadius: '6px',
                        fontSize: '14px',
                        color: 'var(--color-text-secondary)',
                        marginBottom: '8px',
                      }}
                    >
                      {turtle.researchNotes}
                    </div>
                  ) : null}
                  {filter === 'active' && (
                    <>
                      <textarea
                        value={editingNotes[turtle.id] ?? turtle.researchNotes ?? ''}
                        onChange={(e) =>
                          setEditingNotes((prev) => ({
                            ...prev,
                            [turtle.id]: e.target.value,
                          }))
                        }
                        placeholder="Add research notes..."
                        rows={3}
                        style={{
                          width: '100%',
                          padding: '12px',
                          backgroundColor: 'var(--color-background)',
                          border: '1px solid var(--color-border)',
                          borderRadius: '6px',
                          color: 'var(--color-text)',
                          fontSize: '14px',
                          fontFamily: 'inherit',
                          resize: 'vertical',
                          marginBottom: '8px',
                        }}
                        disabled={processing === turtle.id}
                      />
                      {editingNotes[turtle.id] !== undefined && (
                        <Button
                          size="sm"
                          onClick={() => handleUpdateNotes(turtle)}
                          disabled={processing === turtle.id}
                        >
                          {processing === turtle.id ? 'Saving...' : 'Save Notes'}
                        </Button>
                      )}
                    </>
                  )}
                </div>

                {/* Assign Name (for unnamed turtles only) */}
                {filter === 'active' && turtle.name.startsWith('UNNAMED-') && (
                  <div>
                    <div
                      style={{
                        fontSize: '14px',
                        fontWeight: '600',
                        color: 'var(--color-text)',
                        marginBottom: '8px',
                      }}
                    >
                      Assign Permanent Name
                    </div>
                    <div style={{ display: 'flex', gap: '8px' }}>
                      <input
                        type="text"
                        value={editingName[turtle.id] || ''}
                        onChange={(e) =>
                          setEditingName((prev) => ({
                            ...prev,
                            [turtle.id]: e.target.value,
                          }))
                        }
                        placeholder="Enter permanent name"
                        style={{
                          flex: 1,
                          padding: '8px 12px',
                          backgroundColor: 'var(--color-background)',
                          border: '1px solid var(--color-border)',
                          borderRadius: '4px',
                          color: 'var(--color-text)',
                          fontSize: '14px',
                          textTransform: 'uppercase',
                        }}
                        disabled={processing === turtle.id}
                      />
                      <Button
                        size="sm"
                        onClick={() => handleAssignName(turtle)}
                        disabled={processing === turtle.id || !editingName[turtle.id]?.trim()}
                      >
                        {processing === turtle.id ? 'Saving...' : 'Assign Name'}
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
