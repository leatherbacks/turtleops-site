'use client';

import { useState, useEffect } from 'react';
import { useRouter, useParams } from 'next/navigation';
import {
  getTurtleById,
  getTagHistoryForTurtle,
  getAdditionalTagsForTurtle,
} from '@/lib/database/turtles';
import { getObservationsByTurtle } from '@/lib/database/observations';
import { useAuth } from '@/components/auth/AuthProvider';
import { getTurtlePdfUrl, isR2Configured } from '@/lib/r2';
import type { Turtle } from '@/lib/types';
import Card from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import Badge from '@/components/ui/Badge';

interface TagHistoryRecord {
  id: string;
  encounter_date: string;
  lrf: string | null;
  rrf: string | null;
  rff: string | null;
  lff: string | null;
  observer_name: string;
  notes: string | null;
  created_at: string;
}

interface AdditionalTag {
  id: string;
  tag_number: string;
  location: string | null;
  added_at: string;
  notes: string | null;
}

interface ObservationRecord {
  id: string;
  encounter_date: string;
  observer_name: string;
  beach_sector: string | null;
  did_she_nest: boolean | null;
  comments: string | null;
  latitude: number | null;
  longitude: number | null;
}

export default function TurtleDetailPage() {
  const router = useRouter();
  const params = useParams();
  const { profile, loading: authLoading } = useAuth();
  const [turtle, setTurtle] = useState<Turtle | null>(null);
  const [tagHistory, setTagHistory] = useState<TagHistoryRecord[]>([]);
  const [additionalTags, setAdditionalTags] = useState<AdditionalTag[]>([]);
  const [observations, setObservations] = useState<ObservationRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [pdfExists, setPdfExists] = useState<boolean>(false);

  useEffect(() => {
    // Wait for auth to be ready before loading data
    if (!authLoading && profile && params.id) {
      loadTurtleData(params.id as string);
    } else if (!authLoading && !profile) {
      // Not authenticated, redirect to login
      router.push('/login');
    }
  }, [params.id, authLoading, profile, router]);

  const loadTurtleData = async (id: string) => {
    setLoading(true);

    try {
      console.log('Loading turtle data for ID:', id);

      // Load all data in parallel
      const [turtleData, tagHistoryData, additionalTagsData, observationsData] = await Promise.all([
        getTurtleById(id),
        getTagHistoryForTurtle(id),
        getAdditionalTagsForTurtle(id),
        getObservationsByTurtle(id),
      ]);

      console.log('Turtle data loaded:', {
        turtle: turtleData,
        tagHistoryCount: tagHistoryData?.length,
        additionalTagsCount: additionalTagsData?.length,
        observationsCount: observationsData?.length,
      });

      setTurtle(turtleData);
      setTagHistory(tagHistoryData as TagHistoryRecord[]);
      setAdditionalTags(additionalTagsData as AdditionalTag[]);
      setObservations(observationsData as ObservationRecord[]);

      // Check for historical PDF if R2 is configured
      // Try Title Case first (most common: "Aries.pdf", "Jupiter.pdf")
      // If it doesn't exist, the iframe will handle the error
      if (isR2Configured() && turtleData) {
        const url = getTurtlePdfUrl(turtleData.name, 'title');
        if (url) {
          setPdfUrl(url);
          setPdfExists(true); // Assume it exists; iframe will handle 404
        }
      }
    } catch (error) {
      console.error('Error loading turtle data:', error);
      setTurtle(null);
    } finally {
      setLoading(false);
    }
  };

  const formatDate = (date: Date | string | null) => {
    if (!date) return 'N/A';
    const d = typeof date === 'string' ? new Date(date) : date;
    return d.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  };

  const formatDateTime = (date: Date | string | null) => {
    if (!date) return 'N/A';
    const d = typeof date === 'string' ? new Date(date) : date;
    return d.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  };

  const isUnnamed = (name: string) => {
    return name.startsWith('UNNAMED-');
  };

  if (loading) {
    return (
      <div style={{ padding: '24px' }}>
        <Card>
          <div style={{
            textAlign: 'center',
            padding: '48px 24px',
            color: 'var(--color-text-secondary)',
          }}>
            Loading turtle details...
          </div>
        </Card>
      </div>
    );
  }

  if (!turtle) {
    return (
      <div style={{ padding: '24px' }}>
        <Card>
          <div style={{
            textAlign: 'center',
            padding: '48px 24px',
            color: 'var(--color-text-secondary)',
          }}>
            <div style={{ fontSize: '48px', marginBottom: '16px' }}>🐢</div>
            <div style={{ fontSize: '18px', marginBottom: '8px' }}>
              Turtle Not Found
            </div>
            <div style={{ fontSize: '14px', marginBottom: '24px' }}>
              This turtle may have been deleted or you don't have access to it.
            </div>
            <Button onClick={() => router.push('/dashboard/turtles')}>
              Back to Turtles
            </Button>
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div style={{ padding: '24px' }}>
      {/* Header */}
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: '24px',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => router.push('/dashboard/turtles')}
          >
            Back
          </Button>
          <div>
            <h1 style={{
              fontSize: '32px',
              fontWeight: '600',
              color: 'var(--color-text)',
              marginBottom: '4px',
            }}>
              {turtle.name}
            </h1>
            <p style={{
              color: 'var(--color-text-secondary)',
              fontSize: '14px',
            }}>
              {turtle.encounter_count} {turtle.encounter_count === 1 ? 'encounter' : 'encounters'}
            </p>
          </div>
        </div>
      </div>

      {/* Status Badges */}
      <div style={{
        display: 'flex',
        gap: '12px',
        marginBottom: '24px',
        flexWrap: 'wrap',
      }}>
        {turtle.species && (
          <Badge variant="default">{turtle.species}</Badge>
        )}
        {isUnnamed(turtle.name) && (
          <Badge variant="warning">Unnamed</Badge>
        )}
        {turtle.needs_research && (
          <Badge variant="error">Needs Research</Badge>
        )}
        {turtle.suggested_name && !isUnnamed(turtle.name) && (
          <Badge variant="info">Suggested Name: {turtle.suggested_name}</Badge>
        )}
      </div>

      {/* Identity Card */}
      <Card title="Identity" style={{ marginBottom: '24px' }}>
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
          gap: '24px',
        }}>
          <div>
            <div style={{
              fontSize: '12px',
              color: 'var(--color-text-muted)',
              textTransform: 'uppercase',
              marginBottom: '4px',
            }}>
              LRF (Left Rear Flipper)
            </div>
            <div style={{
              fontSize: '16px',
              fontFamily: 'var(--font-mono)',
              color: turtle.lrf ? 'var(--color-text)' : 'var(--color-text-muted)',
            }}>
              {turtle.lrf || '-'}
            </div>
          </div>

          <div>
            <div style={{
              fontSize: '12px',
              color: 'var(--color-text-muted)',
              textTransform: 'uppercase',
              marginBottom: '4px',
            }}>
              RRF (Right Rear Flipper)
            </div>
            <div style={{
              fontSize: '16px',
              fontFamily: 'var(--font-mono)',
              color: turtle.rrf ? 'var(--color-text)' : 'var(--color-text-muted)',
            }}>
              {turtle.rrf || '-'}
            </div>
          </div>

          <div>
            <div style={{
              fontSize: '12px',
              color: 'var(--color-text-muted)',
              textTransform: 'uppercase',
              marginBottom: '4px',
            }}>
              RFF (Right Front Flipper)
            </div>
            <div style={{
              fontSize: '16px',
              fontFamily: 'var(--font-mono)',
              color: turtle.rff ? 'var(--color-text)' : 'var(--color-text-muted)',
            }}>
              {turtle.rff || '-'}
            </div>
          </div>

          <div>
            <div style={{
              fontSize: '12px',
              color: 'var(--color-text-muted)',
              textTransform: 'uppercase',
              marginBottom: '4px',
            }}>
              LFF (Left Front Flipper)
            </div>
            <div style={{
              fontSize: '16px',
              fontFamily: 'var(--font-mono)',
              color: turtle.lff ? 'var(--color-text)' : 'var(--color-text-muted)',
            }}>
              {turtle.lff || '-'}
            </div>
          </div>

          <div>
            <div style={{
              fontSize: '12px',
              color: 'var(--color-text-muted)',
              textTransform: 'uppercase',
              marginBottom: '4px',
            }}>
              Species
            </div>
            <div style={{
              fontSize: '16px',
              color: 'var(--color-text)',
              fontWeight: '500',
            }}>
              {turtle.species || 'Unknown'}
            </div>
          </div>

          <div>
            <div style={{
              fontSize: '12px',
              color: 'var(--color-text-muted)',
              textTransform: 'uppercase',
              marginBottom: '4px',
            }}>
              First Encountered
            </div>
            <div style={{
              fontSize: '16px',
              color: 'var(--color-text)',
              fontWeight: '500',
            }}>
              {formatDate(turtle.first_encountered_at)}
            </div>
          </div>

          <div>
            <div style={{
              fontSize: '12px',
              color: 'var(--color-text-muted)',
              textTransform: 'uppercase',
              marginBottom: '4px',
            }}>
              Last Encountered
            </div>
            <div style={{
              fontSize: '16px',
              color: 'var(--color-text)',
              fontWeight: '500',
            }}>
              {formatDate(turtle.last_encountered_at)}
            </div>
          </div>
        </div>
      </Card>

      {/* Historical PDF */}
      {pdfUrl && pdfExists && (
        <Card
          title="Historical Data"
          subtitle="Legacy observation records"
          style={{ marginBottom: '24px' }}
        >
          <div style={{ marginBottom: '16px' }}>
            <div style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: '12px',
            }}>
              <p style={{
                fontSize: '14px',
                color: 'var(--color-text-secondary)',
                margin: 0,
              }}>
                Historical observation data available for this turtle
              </p>
              <div style={{ display: 'flex', gap: '8px' }}>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => window.open(pdfUrl, '_blank')}
                >
                  Open in New Tab
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => {
                    const link = document.createElement('a');
                    link.href = pdfUrl;
                    link.download = `${turtle.name}-historical.pdf`;
                    link.click();
                  }}
                >
                  Download PDF
                </Button>
              </div>
            </div>
          </div>

          {/* PDF Viewer */}
          <div style={{
            position: 'relative',
            width: '100%',
            height: '800px',
            backgroundColor: 'var(--color-background)',
            borderRadius: '8px',
            overflow: 'hidden',
            border: '1px solid var(--color-border)',
          }}>
            <iframe
              src={pdfUrl}
              style={{
                width: '100%',
                height: '100%',
                border: 'none',
              }}
              title={`Historical data for ${turtle.name}`}
            />
          </div>
        </Card>
      )}

      {/* Research Notes */}
      {turtle.needs_research && turtle.research_notes && (
        <Card title="Research Notes" style={{ marginBottom: '24px' }}>
          <div style={{
            padding: '16px',
            backgroundColor: 'var(--color-surface-elevated)',
            borderRadius: '6px',
            marginBottom: '16px',
          }}>
            <div style={{
              fontSize: '14px',
              color: 'var(--color-text-secondary)',
              lineHeight: '1.6',
              whiteSpace: 'pre-wrap',
            }}>
              {turtle.research_notes}
            </div>
          </div>
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
            gap: '16px',
            fontSize: '14px',
          }}>
            {turtle.research_flagged_by_name && (
              <div>
                <div style={{
                  color: 'var(--color-text-muted)',
                  marginBottom: '4px',
                }}>
                  Flagged By
                </div>
                <div style={{ color: 'var(--color-text-secondary)' }}>
                  {turtle.research_flagged_by_name}
                </div>
              </div>
            )}
            {turtle.research_flagged_at && (
              <div>
                <div style={{
                  color: 'var(--color-text-muted)',
                  marginBottom: '4px',
                }}>
                  Flagged At
                </div>
                <div style={{ color: 'var(--color-text-secondary)' }}>
                  {formatDateTime(turtle.research_flagged_at)}
                </div>
              </div>
            )}
          </div>
        </Card>
      )}

      {/* Tag History */}
      {tagHistory.length > 0 && (
        <Card title="Tag History" subtitle={`${tagHistory.length} historical tag changes`} style={{ marginBottom: '24px' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            {tagHistory.map((record) => (
              <div
                key={record.id}
                style={{
                  padding: '16px',
                  backgroundColor: 'var(--color-surface-elevated)',
                  borderRadius: '6px',
                  borderLeft: '3px solid var(--color-primary)',
                }}
              >
                <div style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'flex-start',
                  marginBottom: '12px',
                }}>
                  <div>
                    <div style={{
                      fontSize: '14px',
                      fontWeight: '600',
                      color: 'var(--color-text)',
                      marginBottom: '4px',
                    }}>
                      {formatDate(record.encounter_date)}
                    </div>
                    <div style={{
                      fontSize: '12px',
                      color: 'var(--color-text-secondary)',
                    }}>
                      Observer: {record.observer_name}
                    </div>
                  </div>
                </div>
                <div style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))',
                  gap: '12px',
                  fontSize: '12px',
                }}>
                  <div>
                    <div style={{ color: 'var(--color-text-muted)', marginBottom: '2px' }}>LRF</div>
                    <div style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-text)' }}>
                      {record.lrf || '-'}
                    </div>
                  </div>
                  <div>
                    <div style={{ color: 'var(--color-text-muted)', marginBottom: '2px' }}>RRF</div>
                    <div style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-text)' }}>
                      {record.rrf || '-'}
                    </div>
                  </div>
                  <div>
                    <div style={{ color: 'var(--color-text-muted)', marginBottom: '2px' }}>RFF</div>
                    <div style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-text)' }}>
                      {record.rff || '-'}
                    </div>
                  </div>
                  <div>
                    <div style={{ color: 'var(--color-text-muted)', marginBottom: '2px' }}>LFF</div>
                    <div style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-text)' }}>
                      {record.lff || '-'}
                    </div>
                  </div>
                </div>
                {record.notes && (
                  <div style={{
                    marginTop: '12px',
                    paddingTop: '12px',
                    borderTop: '1px solid var(--color-border)',
                    fontSize: '12px',
                    color: 'var(--color-text-secondary)',
                    fontStyle: 'italic',
                  }}>
                    {record.notes}
                  </div>
                )}
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* Additional Tags */}
      {additionalTags.length > 0 && (
        <Card title="Additional Tags" subtitle={`${additionalTags.length} extra tags`} style={{ marginBottom: '24px' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {additionalTags.map((tag) => (
              <div
                key={tag.id}
                style={{
                  padding: '12px 16px',
                  backgroundColor: 'var(--color-surface-elevated)',
                  borderRadius: '6px',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                }}
              >
                <div>
                  <div style={{
                    fontSize: '16px',
                    fontFamily: 'var(--font-mono)',
                    fontWeight: '600',
                    color: 'var(--color-text)',
                    marginBottom: '4px',
                  }}>
                    {tag.tag_number}
                  </div>
                  {tag.location && (
                    <div style={{
                      fontSize: '12px',
                      color: 'var(--color-text-secondary)',
                    }}>
                      Location: {tag.location}
                    </div>
                  )}
                  {tag.notes && (
                    <div style={{
                      fontSize: '12px',
                      color: 'var(--color-text-secondary)',
                      marginTop: '4px',
                    }}>
                      {tag.notes}
                    </div>
                  )}
                </div>
                <div style={{
                  fontSize: '12px',
                  color: 'var(--color-text-muted)',
                }}>
                  Added {formatDate(tag.added_at)}
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* Observation History */}
      <Card
        title="Observation History"
        subtitle={`${observations.length} ${observations.length === 1 ? 'observation' : 'observations'}`}
        style={{ marginBottom: '24px' }}
      >
        {observations.length === 0 ? (
          <div style={{
            textAlign: 'center',
            padding: '32px',
            color: 'var(--color-text-secondary)',
          }}>
            No observations recorded yet.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {observations.map((obs) => (
              <div
                key={obs.id}
                onClick={() => router.push(`/dashboard/observations/${obs.id}`)}
                style={{
                  padding: '16px',
                  backgroundColor: 'var(--color-surface-elevated)',
                  borderRadius: '6px',
                  cursor: 'pointer',
                  transition: 'all 0.2s',
                  border: '1px solid transparent',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.backgroundColor = 'var(--color-surface-hover)';
                  e.currentTarget.style.borderColor = 'var(--color-primary)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.backgroundColor = 'var(--color-surface-elevated)';
                  e.currentTarget.style.borderColor = 'transparent';
                }}
              >
                <div style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'flex-start',
                  marginBottom: '8px',
                }}>
                  <div>
                    <div style={{
                      fontSize: '16px',
                      fontWeight: '600',
                      color: 'var(--color-text)',
                      marginBottom: '4px',
                    }}>
                      {formatDate(obs.encounter_date)}
                    </div>
                    <div style={{
                      fontSize: '14px',
                      color: 'var(--color-text-secondary)',
                    }}>
                      Observer: {obs.observer_name}
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                    {obs.did_she_nest && (
                      <Badge variant="success" size="sm">Nested</Badge>
                    )}
                    {obs.beach_sector && (
                      <Badge variant="default" size="sm">{obs.beach_sector}</Badge>
                    )}
                  </div>
                </div>
                {obs.comments && (
                  <div style={{
                    fontSize: '13px',
                    color: 'var(--color-text-secondary)',
                    marginTop: '8px',
                    paddingTop: '8px',
                    borderTop: '1px solid var(--color-border)',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}>
                    {obs.comments}
                  </div>
                )}
                {(obs.latitude || obs.longitude) && (
                  <div style={{
                    fontSize: '12px',
                    color: 'var(--color-text-muted)',
                    marginTop: '8px',
                    fontFamily: 'var(--font-mono)',
                  }}>
                    Location: {obs.latitude?.toFixed(6)}, {obs.longitude?.toFixed(6)}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
