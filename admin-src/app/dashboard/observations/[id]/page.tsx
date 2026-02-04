'use client';

import { useState, useEffect } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { getObservationById, type ObservationWithTurtle } from '@/lib/database/observations';
import { getPhotosByObservation, getPhotoUrl, getPhotoTypeLabel } from '@/lib/database/photos';
import { useAuth } from '@/components/auth/AuthProvider';
import type { Photo } from '@/lib/types';
import Card from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import Badge from '@/components/ui/Badge';

export default function ObservationDetailPage() {
  const router = useRouter();
  const params = useParams();
  const { profile } = useAuth();
  const [observation, setObservation] = useState<ObservationWithTurtle | null>(null);
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (params.id) {
      loadObservation(params.id as string);
    }
  }, [params.id]);

  const loadObservation = async (id: string) => {
    setLoading(true);

    // Load observation and photos in parallel
    const [observationData, photosData] = await Promise.all([
      getObservationById(id),
      getPhotosByObservation(id),
    ]);

    setObservation(observationData);
    setPhotos(photosData);
    setLoading(false);
  };

  const formatDate = (date: Date | string | null) => {
    if (!date) return 'N/A';
    const d = typeof date === 'string' ? new Date(date) : date;
    return d.toLocaleDateString('en-US', {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
      year: 'numeric',
    });
  };

  const formatTime = (date: Date | string | null) => {
    if (!date) return 'N/A';
    const d = typeof date === 'string' ? new Date(date) : date;
    return d.toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      second: '2-digit',
    });
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
            Loading observation...
          </div>
        </Card>
      </div>
    );
  }

  if (!observation) {
    return (
      <div style={{ padding: '24px' }}>
        <Card>
          <div style={{
            textAlign: 'center',
            padding: '48px 24px',
            color: 'var(--color-text-secondary)',
          }}>
            <div style={{ fontSize: '48px', marginBottom: '16px' }}>❌</div>
            <div style={{ fontSize: '18px', marginBottom: '8px' }}>
              Observation Not Found
            </div>
            <div style={{ fontSize: '14px', marginBottom: '24px' }}>
              This observation may have been deleted or you don't have access to it.
            </div>
            <Button onClick={() => router.push('/dashboard/observations')}>
              ← Back to Observations
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
            onClick={() => router.push('/dashboard/observations')}
          >
            ← Back
          </Button>
          <div>
            <h1 style={{
              fontSize: '32px',
              fontWeight: '600',
              color: 'var(--color-text)',
              marginBottom: '4px',
            }}>
              {observation.turtle_name || 'Unknown Turtle'}
            </h1>
            <p style={{
              color: 'var(--color-text-secondary)',
              fontSize: '14px',
            }}>
              Observation ID: {observation.id.slice(0, 8)}...
            </p>
          </div>
        </div>
        <div style={{ display: 'flex', gap: '12px' }}>
          {/* Future: Add Edit and Delete buttons here */}
        </div>
      </div>

      {/* Status Badges */}
      <div style={{
        display: 'flex',
        gap: '12px',
        marginBottom: '24px',
        flexWrap: 'wrap',
      }}>
        {observation.species && (
          <Badge variant="default">{observation.species}</Badge>
        )}
        {observation.did_she_nest && (
          <Badge variant="success">🥚 Nested</Badge>
        )}
        {observation.is_recapture && (
          <Badge variant="info">Recapture</Badge>
        )}
        {observation.sync_status && (
          <Badge variant={observation.sync_status === 'synced' ? 'success' : 'warning'}>
            {observation.sync_status}
          </Badge>
        )}
      </div>

      {/* Main Info */}
      <Card title="Observation Details" style={{ marginBottom: '24px' }}>
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))',
          gap: '24px',
        }}>
          <div>
            <div style={{
              fontSize: '12px',
              color: 'var(--color-text-muted)',
              textTransform: 'uppercase',
              marginBottom: '4px',
            }}>
              Encounter Date
            </div>
            <div style={{
              fontSize: '16px',
              color: 'var(--color-text)',
              fontWeight: '500',
            }}>
              {formatDate(observation.encounter_date)}
            </div>
            <div style={{
              fontSize: '14px',
              color: 'var(--color-text-secondary)',
            }}>
              {formatTime(observation.encounter_date)}
            </div>
          </div>

          <div>
            <div style={{
              fontSize: '12px',
              color: 'var(--color-text-muted)',
              textTransform: 'uppercase',
              marginBottom: '4px',
            }}>
              Observer
            </div>
            <div style={{
              fontSize: '16px',
              color: 'var(--color-text)',
              fontWeight: '500',
            }}>
              {observation.observer_name || 'Unknown'}
            </div>
          </div>

          {observation.beach_sector && (
            <div>
              <div style={{
                fontSize: '12px',
                color: 'var(--color-text-muted)',
                textTransform: 'uppercase',
                marginBottom: '4px',
              }}>
                Beach Sector
              </div>
              <div style={{
                fontSize: '16px',
                color: 'var(--color-text)',
                fontWeight: '500',
              }}>
                {observation.beach_sector}
              </div>
            </div>
          )}
        </div>
      </Card>

      {/* PIT Tags */}
      <Card title="PIT Tags" style={{ marginBottom: '24px' }}>
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
          gap: '16px',
        }}>
          <div>
            <div style={{
              fontSize: '12px',
              color: 'var(--color-text-muted)',
              marginBottom: '4px',
            }}>
              LRF (Left Rear Flipper)
            </div>
            <div style={{
              fontSize: '16px',
              fontFamily: 'var(--font-mono)',
              color: observation.tag_lrf ? 'var(--color-text)' : 'var(--color-text-muted)',
            }}>
              {observation.tag_lrf || '-'}
            </div>
          </div>

          <div>
            <div style={{
              fontSize: '12px',
              color: 'var(--color-text-muted)',
              marginBottom: '4px',
            }}>
              RRF (Right Rear Flipper)
            </div>
            <div style={{
              fontSize: '16px',
              fontFamily: 'var(--font-mono)',
              color: observation.tag_rrf ? 'var(--color-text)' : 'var(--color-text-muted)',
            }}>
              {observation.tag_rrf || '-'}
            </div>
          </div>

          <div>
            <div style={{
              fontSize: '12px',
              color: 'var(--color-text-muted)',
              marginBottom: '4px',
            }}>
              RFF (Right Front Flipper)
            </div>
            <div style={{
              fontSize: '16px',
              fontFamily: 'var(--font-mono)',
              color: observation.tag_rff ? 'var(--color-text)' : 'var(--color-text-muted)',
            }}>
              {observation.tag_rff || '-'}
            </div>
          </div>

          <div>
            <div style={{
              fontSize: '12px',
              color: 'var(--color-text-muted)',
              marginBottom: '4px',
            }}>
              LFF/PIT (Left Front Flipper)
            </div>
            <div style={{
              fontSize: '16px',
              fontFamily: 'var(--font-mono)',
              color: observation.tag_lff ? 'var(--color-text)' : 'var(--color-text-muted)',
            }}>
              {observation.tag_lff || '-'}
            </div>
          </div>
        </div>
      </Card>

      {/* Photos */}
      {photos.length > 0 && (
        <Card
          title="Photos"
          subtitle={`${photos.length} ${photos.length === 1 ? 'photo' : 'photos'}`}
          style={{ marginBottom: '24px' }}
        >
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(250px, 1fr))',
            gap: '16px',
          }}>
            {photos.map((photo) => {
              const photoUrl = getPhotoUrl(photo);
              if (!photoUrl) return null;

              return (
                <div
                  key={photo.id}
                  style={{
                    position: 'relative',
                    backgroundColor: 'var(--color-surface-elevated)',
                    borderRadius: '8px',
                    overflow: 'hidden',
                    border: '1px solid var(--color-border)',
                  }}
                >
                  {/* Photo Image */}
                  <div style={{
                    position: 'relative',
                    paddingTop: '75%', // 4:3 aspect ratio
                    backgroundColor: 'var(--color-background)',
                  }}>
                    <img
                      src={photoUrl}
                      alt={photo.caption || getPhotoTypeLabel(photo.photo_type)}
                      style={{
                        position: 'absolute',
                        top: 0,
                        left: 0,
                        width: '100%',
                        height: '100%',
                        objectFit: 'cover',
                      }}
                      onError={(e) => {
                        // Hide image if it fails to load
                        (e.target as HTMLImageElement).style.display = 'none';
                      }}
                    />
                    {/* Photo Type Badge */}
                    <div style={{
                      position: 'absolute',
                      top: '8px',
                      right: '8px',
                    }}>
                      <Badge variant="default" size="sm">
                        {getPhotoTypeLabel(photo.photo_type)}
                      </Badge>
                    </div>
                  </div>

                  {/* Photo Info */}
                  {photo.caption && (
                    <div style={{
                      padding: '12px',
                      fontSize: '13px',
                      color: 'var(--color-text-secondary)',
                      lineHeight: '1.4',
                    }}>
                      {photo.caption}
                    </div>
                  )}

                  {/* Sync Status */}
                  {photo.sync_status !== 'synced' && (
                    <div style={{
                      padding: '8px 12px',
                      fontSize: '12px',
                      color: 'var(--color-text-muted)',
                      borderTop: '1px solid var(--color-border)',
                    }}>
                      <Badge
                        variant={
                          photo.sync_status === 'uploading'
                            ? 'warning'
                            : photo.sync_status === 'failed'
                            ? 'error'
                            : 'default'
                        }
                        size="sm"
                      >
                        {photo.sync_status}
                      </Badge>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </Card>
      )}

      {/* Nesting Information */}
      {observation.did_she_nest && (
        <Card title="Nesting Information" style={{ marginBottom: '24px' }}>
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
            gap: '24px',
          }}>
            {observation.egg_count !== null && (
              <div>
                <div style={{
                  fontSize: '12px',
                  color: 'var(--color-text-muted)',
                  textTransform: 'uppercase',
                  marginBottom: '4px',
                }}>
                  Egg Count
                </div>
                <div style={{
                  fontSize: '24px',
                  color: 'var(--color-success)',
                  fontWeight: '600',
                }}>
                  {observation.egg_count}
                </div>
              </div>
            )}

            {observation.chamber_depth !== null && (
              <div>
                <div style={{
                  fontSize: '12px',
                  color: 'var(--color-text-muted)',
                  textTransform: 'uppercase',
                  marginBottom: '4px',
                }}>
                  Chamber Depth
                </div>
                <div style={{
                  fontSize: '24px',
                  color: 'var(--color-text)',
                  fontWeight: '600',
                }}>
                  {observation.chamber_depth} cm
                </div>
              </div>
            )}
          </div>
        </Card>
      )}

      {/* Environmental Conditions */}
      <Card title="Environmental Conditions" style={{ marginBottom: '24px' }}>
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
          gap: '24px',
        }}>
          {observation.temperature !== null && (
            <div>
              <div style={{
                fontSize: '12px',
                color: 'var(--color-text-muted)',
                textTransform: 'uppercase',
                marginBottom: '4px',
              }}>
                Temperature
              </div>
              <div style={{
                fontSize: '20px',
                color: 'var(--color-text)',
                fontWeight: '500',
              }}>
                {observation.temperature}°F
              </div>
            </div>
          )}

          {observation.tide_stage && (
            <div>
              <div style={{
                fontSize: '12px',
                color: 'var(--color-text-muted)',
                textTransform: 'uppercase',
                marginBottom: '4px',
              }}>
                Tide Stage
              </div>
              <div style={{
                fontSize: '16px',
                color: 'var(--color-text)',
                fontWeight: '500',
              }}>
                {observation.tide_stage}
              </div>
            </div>
          )}

          {observation.weather && (
            <div>
              <div style={{
                fontSize: '12px',
                color: 'var(--color-text-muted)',
                textTransform: 'uppercase',
                marginBottom: '4px',
              }}>
                Weather
              </div>
              <div style={{
                fontSize: '16px',
                color: 'var(--color-text)',
                fontWeight: '500',
              }}>
                {observation.weather}
              </div>
            </div>
          )}
        </div>
      </Card>

      {/* Location */}
      {(observation.latitude || observation.longitude) && (
        <Card title="Location" style={{ marginBottom: '24px' }}>
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
            gap: '24px',
          }}>
            {observation.latitude && (
              <div>
                <div style={{
                  fontSize: '12px',
                  color: 'var(--color-text-muted)',
                  textTransform: 'uppercase',
                  marginBottom: '4px',
                }}>
                  Latitude
                </div>
                <div style={{
                  fontSize: '16px',
                  fontFamily: 'var(--font-mono)',
                  color: 'var(--color-text)',
                }}>
                  {observation.latitude.toFixed(6)}
                </div>
              </div>
            )}

            {observation.longitude && (
              <div>
                <div style={{
                  fontSize: '12px',
                  color: 'var(--color-text-muted)',
                  textTransform: 'uppercase',
                  marginBottom: '4px',
                }}>
                  Longitude
                </div>
                <div style={{
                  fontSize: '16px',
                  fontFamily: 'var(--font-mono)',
                  color: 'var(--color-text)',
                }}>
                  {observation.longitude.toFixed(6)}
                </div>
              </div>
            )}

            {observation.location_accuracy && (
              <div>
                <div style={{
                  fontSize: '12px',
                  color: 'var(--color-text-muted)',
                  textTransform: 'uppercase',
                  marginBottom: '4px',
                }}>
                  Accuracy
                </div>
                <div style={{
                  fontSize: '16px',
                  color: 'var(--color-text)',
                }}>
                  ±{observation.location_accuracy.toFixed(0)} m
                </div>
              </div>
            )}
          </div>

          {observation.latitude && observation.longitude && (
            <div style={{ marginTop: '16px' }}>
              <a
                href={`https://www.google.com/maps?q=${observation.latitude},${observation.longitude}`}
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  color: 'var(--color-primary)',
                  textDecoration: 'none',
                  fontSize: '14px',
                }}
              >
                📍 View on Google Maps →
              </a>
            </div>
          )}
        </Card>
      )}

      {/* Comments */}
      {observation.comments && (
        <Card title="Comments" style={{ marginBottom: '24px' }}>
          <div style={{
            padding: '16px',
            backgroundColor: 'var(--color-surface-elevated)',
            borderRadius: '6px',
            fontSize: '14px',
            color: 'var(--color-text-secondary)',
            lineHeight: '1.6',
            whiteSpace: 'pre-wrap',
          }}>
            {observation.comments}
          </div>
        </Card>
      )}

      {/* Metadata */}
      <Card title="Metadata" style={{ marginBottom: '24px' }}>
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
          gap: '24px',
          fontSize: '14px',
        }}>
          <div>
            <div style={{
              color: 'var(--color-text-muted)',
              marginBottom: '4px',
            }}>
              Created At
            </div>
            <div style={{ color: 'var(--color-text-secondary)' }}>
              {formatDate(observation.created_at)}<br />
              {formatTime(observation.created_at)}
            </div>
          </div>

          <div>
            <div style={{
              color: 'var(--color-text-muted)',
              marginBottom: '4px',
            }}>
              Last Updated
            </div>
            <div style={{ color: 'var(--color-text-secondary)' }}>
              {formatDate(observation.updated_at)}<br />
              {formatTime(observation.updated_at)}
            </div>
          </div>

          {observation.session_id && (
            <div>
              <div style={{
                color: 'var(--color-text-muted)',
                marginBottom: '4px',
              }}>
                Session ID
              </div>
              <div style={{
                color: 'var(--color-text-secondary)',
                fontFamily: 'var(--font-mono)',
                fontSize: '12px',
              }}>
                {observation.session_id.slice(0, 8)}...
              </div>
            </div>
          )}
        </div>
      </Card>
    </div>
  );
}
