'use client';

import { useState, useEffect } from 'react';
import { getUnnamedTurtles, updateTurtle, findTurtleByName } from '@/lib/database/turtles';
import { useAuth } from '@/components/auth/AuthProvider';
import type { Turtle } from '@/lib/types';
import Card from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import Badge from '@/components/ui/Badge';

export default function UnnamedTurtlesPage() {
  const { profile } = useAuth();
  const [turtles, setTurtles] = useState<Turtle[]>([]);
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState<string | null>(null);
  const [customNames, setCustomNames] = useState<Record<string, string>>({});

  useEffect(() => {
    loadTurtles();
  }, []);

  const loadTurtles = async () => {
    setLoading(true);
    const data = await getUnnamedTurtles();
    setTurtles(data);
    setLoading(false);
  };

  const handleApproveSuggestedName = async (turtle: Turtle) => {
    if (!turtle.suggestedName || !profile) return;

    // Check if name already exists
    const existing = await findTurtleByName(turtle.suggestedName);
    if (existing && existing.id !== turtle.id) {
      alert(
        `Cannot approve: A turtle named "${turtle.suggestedName}" already exists.\n\nPlease choose a different name or merge these turtles if they are the same individual.`
      );
      return;
    }

    if (
      !confirm(
        `Approve suggested name "${turtle.suggestedName}" for ${turtle.name}?`
      )
    ) {
      return;
    }

    setProcessing(turtle.id);

    const updated = await updateTurtle(turtle.id, {
      name: turtle.suggestedName,
      suggestedName: null,
      suggestedBy: null,
      suggestedByName: null,
      suggestedAt: null,
    });

    if (updated) {
      alert(`Name approved! Turtle is now named ${updated.name}`);
      await loadTurtles();
    } else {
      alert('Failed to approve name. Please try again.');
    }

    setProcessing(null);
  };

  const handleRejectSuggestion = async (turtle: Turtle) => {
    if (!confirm(`Reject suggested name "${turtle.suggestedName}"?`)) {
      return;
    }

    setProcessing(turtle.id);

    const updated = await updateTurtle(turtle.id, {
      suggestedName: null,
      suggestedBy: null,
      suggestedByName: null,
      suggestedAt: null,
    });

    if (updated) {
      alert('Suggestion rejected');
      await loadTurtles();
    } else {
      alert('Failed to reject suggestion. Please try again.');
    }

    setProcessing(null);
  };

  const handleApproveCustomName = async (turtle: Turtle) => {
    const customName = customNames[turtle.id]?.trim().toUpperCase();

    if (!customName) {
      alert('Please enter a name');
      return;
    }

    // Check if name already exists
    const existing = await findTurtleByName(customName);
    if (existing && existing.id !== turtle.id) {
      alert(
        `Cannot use name: A turtle named "${customName}" already exists.\n\nPlease choose a different name or merge these turtles if they are the same individual.`
      );
      return;
    }

    if (
      !confirm(
        `Name this turtle "${customName}"?\n\nThis will replace the temporary name ${turtle.name}`
      )
    ) {
      return;
    }

    setProcessing(turtle.id);

    const updated = await updateTurtle(turtle.id, {
      name: customName,
      suggestedName: null,
      suggestedBy: null,
      suggestedByName: null,
      suggestedAt: null,
    });

    if (updated) {
      alert(`Turtle named ${updated.name}!`);
      setCustomNames((prev) => {
        const next = { ...prev };
        delete next[turtle.id];
        return next;
      });
      await loadTurtles();
    } else {
      alert('Failed to set name. Please try again.');
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
          Unnamed Turtles
        </h1>
        <p
          style={{
            color: 'var(--color-text-secondary)',
          }}
        >
          Approve suggested names or assign custom names to turtles
        </p>
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
            Loading unnamed turtles...
          </div>
        </Card>
      ) : turtles.length === 0 ? (
        <Card>
          <div
            style={{
              textAlign: 'center',
              padding: '48px 24px',
              color: 'var(--color-text-secondary)',
            }}
          >
            <div style={{ fontSize: '48px', marginBottom: '16px' }}>✅</div>
            <div style={{ fontSize: '18px', marginBottom: '8px' }}>
              All Turtles Named
            </div>
            <div style={{ fontSize: '14px' }}>
              No turtles with temporary names at this time
            </div>
          </div>
        </Card>
      ) : (
        <div>
          <div
            style={{
              fontSize: '14px',
              color: 'var(--color-text-secondary)',
              marginBottom: '16px',
            }}
          >
            {turtles.length} turtle{turtles.length !== 1 ? 's' : ''} awaiting names
          </div>

          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: '16px',
            }}
          >
            {turtles.map((turtle) => (
              <Card key={turtle.id}>
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '1fr auto',
                    gap: '24px',
                    alignItems: 'start',
                  }}
                >
                  {/* Turtle Info */}
                  <div>
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '12px',
                        marginBottom: '12px',
                      }}
                    >
                      <div
                        style={{
                          fontSize: '20px',
                          fontWeight: '600',
                          color: 'var(--color-text-muted)',
                          fontFamily: 'var(--font-mono)',
                        }}
                      >
                        {turtle.name}
                      </div>
                      <Badge variant="warning" size="sm">
                        TEMPORARY NAME
                      </Badge>
                    </div>

                    <div
                      style={{
                        display: 'grid',
                        gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
                        gap: '12px',
                        fontSize: '14px',
                        color: 'var(--color-text-secondary)',
                        marginBottom: '16px',
                      }}
                    >
                      <div>
                        <span style={{ color: 'var(--color-text-muted)' }}>Species:</span>{' '}
                        {turtle.species}
                      </div>
                      <div>
                        <span style={{ color: 'var(--color-text-muted)' }}>
                          First Seen:
                        </span>{' '}
                        {formatDate(turtle.firstEncounteredAt)}
                      </div>
                      <div>
                        <span style={{ color: 'var(--color-text-muted)' }}>
                          Encounters:
                        </span>{' '}
                        {turtle.encounterCount}
                      </div>
                    </div>

                    {/* Tags */}
                    <div
                      style={{
                        marginBottom: '16px',
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
                          <span style={{ color: 'var(--color-text-muted)' }}>
                            LFF/PIT:
                          </span>{' '}
                          {turtle.lff || '-'}
                        </div>
                      </div>
                    </div>

                    {/* Suggested Name Section */}
                    {turtle.suggestedName ? (
                      <div
                        style={{
                          padding: '16px',
                          backgroundColor: 'rgba(59, 130, 246, 0.1)',
                          border: '1px solid var(--color-info)',
                          borderRadius: '6px',
                        }}
                      >
                        <div
                          style={{
                            fontSize: '14px',
                            fontWeight: '600',
                            color: 'var(--color-info)',
                            marginBottom: '8px',
                          }}
                        >
                          Suggested Name: {turtle.suggestedName}
                        </div>
                        <div
                          style={{
                            fontSize: '13px',
                            color: 'var(--color-text-secondary)',
                            marginBottom: '12px',
                          }}
                        >
                          Suggested by {turtle.suggestedByName || 'Unknown'} on{' '}
                          {formatDate(turtle.suggestedAt)}
                        </div>
                        <div style={{ display: 'flex', gap: '8px' }}>
                          <Button
                            size="sm"
                            onClick={() => handleApproveSuggestedName(turtle)}
                            disabled={processing === turtle.id}
                          >
                            {processing === turtle.id ? 'Processing...' : 'Approve'}
                          </Button>
                          <Button
                            variant="secondary"
                            size="sm"
                            onClick={() => handleRejectSuggestion(turtle)}
                            disabled={processing === turtle.id}
                          >
                            Reject
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <div
                        style={{
                          padding: '16px',
                          backgroundColor: 'var(--color-surface-elevated)',
                          borderRadius: '6px',
                        }}
                      >
                        <div
                          style={{
                            fontSize: '14px',
                            fontWeight: '600',
                            color: 'var(--color-text)',
                            marginBottom: '12px',
                          }}
                        >
                          Assign Custom Name
                        </div>
                        <div style={{ display: 'flex', gap: '8px' }}>
                          <input
                            type="text"
                            value={customNames[turtle.id] || ''}
                            onChange={(e) =>
                              setCustomNames((prev) => ({
                                ...prev,
                                [turtle.id]: e.target.value,
                              }))
                            }
                            placeholder="Enter turtle name (e.g., SANDY)"
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
                            onClick={() => handleApproveCustomName(turtle)}
                            disabled={
                              processing === turtle.id || !customNames[turtle.id]?.trim()
                            }
                          >
                            {processing === turtle.id ? 'Processing...' : 'Save Name'}
                          </Button>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </Card>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
