'use client';

import { useState, useEffect } from 'react';
import { useAuth } from '@/components/auth/AuthProvider';
import { supabase } from '@/lib/supabase';
import Card from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import type { ProjectConfig } from '@/lib/types';

export default function ConfigPage() {
  const { profile, organization } = useAuth();
  const [config, setConfig] = useState<ProjectConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  useEffect(() => {
    loadConfig();
  }, [organization]);

  async function loadConfig() {
    if (!organization?.id) return;

    setLoading(true);
    setError(null);

    try {
      const { data, error: loadError } = await supabase
        .from('project_config')
        .select('*')
        .eq('org_id', organization.id)
        .maybeSingle();

      if (loadError) throw loadError;

      if (data) {
        setConfig(data as ProjectConfig);
      } else {
        // Create default config if none exists
        setConfig({
          id: '',
          org_id: organization.id,
          organization_name: organization.name,
          coordinator_name: profile?.full_name || '',
          coordinator_email: '',
          coordinator_phone: '',
          emergency_contact: '',
          beach_name: '',
          beach_latitude: '0',
          beach_longitude: '0',
          timezone: 'America/New_York',
          primary_species: 'Loggerhead',
          active_species: ['Loggerhead', 'Green', 'Leatherback'],
          season_start_month: 5,
          season_start_day: 1,
          season_end_month: 10,
          season_end_day: 31,
          current_season_year: new Date().getFullYear(),
          required_photo_types: ['turtle', 'tags'],
          require_measurements: false,
          injury_diagram_type: 'hardshell',
          pit_tag_pattern: '^[A-Z]{2}\\d{4}$',
          emergency_contact: '',
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        });
      }
    } catch (err: any) {
      console.error('Error loading config:', err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function saveConfig() {
    if (!config || !organization?.id) return;

    setSaving(true);
    setError(null);
    setSuccessMessage(null);

    try {
      const { error: saveError } = await supabase
        .from('project_config')
        .upsert({
          ...config,
          org_id: organization.id,
          updated_at: new Date().toISOString(),
        });

      if (saveError) throw saveError;

      setSuccessMessage('Configuration saved successfully!');
      setTimeout(() => setSuccessMessage(null), 3000);
    } catch (err: any) {
      console.error('Error saving config:', err);
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  const updateField = (field: keyof ProjectConfig, value: any) => {
    if (!config) return;
    setConfig({ ...config, [field]: value });
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
            Loading configuration...
          </div>
        </Card>
      </div>
    );
  }

  if (!config) {
    return (
      <div style={{ padding: '24px' }}>
        <Card>
          <div style={{
            textAlign: 'center',
            padding: '48px 24px',
            color: 'var(--color-error)',
          }}>
            Failed to load configuration
          </div>
        </Card>
      </div>
    );
  }

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
            Project Configuration
          </h1>
          <p style={{
            color: 'var(--color-text-secondary)',
          }}>
            Customize your organization's settings and mobile app behavior
          </p>
        </div>
        <Button onClick={saveConfig} disabled={saving}>
          {saving ? 'Saving...' : 'Save Changes'}
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
          {error}
        </div>
      )}

      {successMessage && (
        <div style={{
          backgroundColor: 'rgba(16, 185, 129, 0.15)',
          border: '1px solid var(--color-success)',
          borderRadius: '8px',
          padding: '16px',
          marginBottom: '24px',
          color: 'var(--color-success)',
        }}>
          {successMessage}
        </div>
      )}

      {/* Organization Info */}
      <Card title="Organization Information" style={{ marginBottom: '24px' }}>
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))',
          gap: '16px',
        }}>
          <div>
            <label style={{
              display: 'block',
              marginBottom: '6px',
              fontSize: '14px',
              fontWeight: '500',
              color: 'var(--color-text)',
            }}>
              Organization Name
            </label>
            <input
              type="text"
              value={config.organization_name}
              onChange={(e) => updateField('organization_name', e.target.value)}
              style={{
                width: '100%',
                padding: '10px 12px',
                fontSize: '14px',
              }}
            />
          </div>

          <div>
            <label style={{
              display: 'block',
              marginBottom: '6px',
              fontSize: '14px',
              fontWeight: '500',
              color: 'var(--color-text)',
            }}>
              Coordinator Name
            </label>
            <input
              type="text"
              value={config.coordinator_name}
              onChange={(e) => updateField('coordinator_name', e.target.value)}
              style={{
                width: '100%',
                padding: '10px 12px',
                fontSize: '14px',
              }}
            />
          </div>

          <div>
            <label style={{
              display: 'block',
              marginBottom: '6px',
              fontSize: '14px',
              fontWeight: '500',
              color: 'var(--color-text)',
            }}>
              Coordinator Email
            </label>
            <input
              type="email"
              value={config.coordinator_email}
              onChange={(e) => updateField('coordinator_email', e.target.value)}
              style={{
                width: '100%',
                padding: '10px 12px',
                fontSize: '14px',
              }}
            />
          </div>

          <div>
            <label style={{
              display: 'block',
              marginBottom: '6px',
              fontSize: '14px',
              fontWeight: '500',
              color: 'var(--color-text)',
            }}>
              Coordinator Phone
            </label>
            <input
              type="tel"
              value={config.coordinator_phone}
              onChange={(e) => updateField('coordinator_phone', e.target.value)}
              style={{
                width: '100%',
                padding: '10px 12px',
                fontSize: '14px',
              }}
            />
          </div>

          <div>
            <label style={{
              display: 'block',
              marginBottom: '6px',
              fontSize: '14px',
              fontWeight: '500',
              color: 'var(--color-text)',
            }}>
              Emergency Contact
            </label>
            <input
              type="text"
              value={config.emergency_contact}
              onChange={(e) => updateField('emergency_contact', e.target.value)}
              style={{
                width: '100%',
                padding: '10px 12px',
                fontSize: '14px',
              }}
            />
          </div>
        </div>
      </Card>

      {/* Beach Location */}
      <Card title="Beach Location" style={{ marginBottom: '24px' }}>
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))',
          gap: '16px',
        }}>
          <div>
            <label style={{
              display: 'block',
              marginBottom: '6px',
              fontSize: '14px',
              fontWeight: '500',
              color: 'var(--color-text)',
            }}>
              Beach Name
            </label>
            <input
              type="text"
              value={config.beach_name}
              onChange={(e) => updateField('beach_name', e.target.value)}
              style={{
                width: '100%',
                padding: '10px 12px',
                fontSize: '14px',
              }}
            />
          </div>

          <div>
            <label style={{
              display: 'block',
              marginBottom: '6px',
              fontSize: '14px',
              fontWeight: '500',
              color: 'var(--color-text)',
            }}>
              Latitude
            </label>
            <input
              type="number"
              step="0.000001"
              value={config.beach_latitude || ''}
              onChange={(e) => updateField('beach_latitude', e.target.value ? parseFloat(e.target.value) : null)}
              style={{
                width: '100%',
                padding: '10px 12px',
                fontSize: '14px',
              }}
            />
          </div>

          <div>
            <label style={{
              display: 'block',
              marginBottom: '6px',
              fontSize: '14px',
              fontWeight: '500',
              color: 'var(--color-text)',
            }}>
              Longitude
            </label>
            <input
              type="number"
              step="0.000001"
              value={config.beach_longitude || ''}
              onChange={(e) => updateField('beach_longitude', e.target.value ? parseFloat(e.target.value) : null)}
              style={{
                width: '100%',
                padding: '10px 12px',
                fontSize: '14px',
              }}
            />
          </div>

          <div>
            <label style={{
              display: 'block',
              marginBottom: '6px',
              fontSize: '14px',
              fontWeight: '500',
              color: 'var(--color-text)',
            }}>
              Timezone
            </label>
            <select
              value={config.timezone}
              onChange={(e) => updateField('timezone', e.target.value)}
              style={{
                width: '100%',
                padding: '10px 12px',
                fontSize: '14px',
              }}
            >
              <option value="America/New_York">Eastern Time</option>
              <option value="America/Chicago">Central Time</option>
              <option value="America/Denver">Mountain Time</option>
              <option value="America/Los_Angeles">Pacific Time</option>
              <option value="America/Anchorage">Alaska Time</option>
              <option value="Pacific/Honolulu">Hawaii Time</option>
            </select>
          </div>
        </div>
      </Card>

      {/* Species & Season Settings */}
      <Card title="Species & Season Settings" style={{ marginBottom: '24px' }}>
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))',
          gap: '16px',
        }}>
          <div>
            <label style={{
              display: 'block',
              marginBottom: '6px',
              fontSize: '14px',
              fontWeight: '500',
              color: 'var(--color-text)',
            }}>
              Primary Species
            </label>
            <select
              value={config.primary_species}
              onChange={(e) => updateField('primary_species', e.target.value)}
              style={{
                width: '100%',
                padding: '10px 12px',
                fontSize: '14px',
              }}
            >
              <option value="Loggerhead">Loggerhead</option>
              <option value="Green">Green</option>
              <option value="Leatherback">Leatherback</option>
              <option value="Kemp's Ridley">Kemp's Ridley</option>
              <option value="Hawksbill">Hawksbill</option>
            </select>
          </div>

          <div>
            <label style={{
              display: 'block',
              marginBottom: '6px',
              fontSize: '14px',
              fontWeight: '500',
              color: 'var(--color-text)',
            }}>
              Current Season Year
            </label>
            <input
              type="number"
              value={config.current_season_year}
              onChange={(e) => updateField('current_season_year', parseInt(e.target.value))}
              style={{
                width: '100%',
                padding: '10px 12px',
                fontSize: '14px',
              }}
            />
          </div>

          <div>
            <label style={{
              display: 'block',
              marginBottom: '6px',
              fontSize: '14px',
              fontWeight: '500',
              color: 'var(--color-text)',
            }}>
              Season Start Month
            </label>
            <select
              value={config.season_start_month}
              onChange={(e) => updateField('season_start_month', parseInt(e.target.value))}
              style={{
                width: '100%',
                padding: '10px 12px',
                fontSize: '14px',
              }}
            >
              {Array.from({ length: 12 }, (_, i) => i + 1).map(month => (
                <option key={month} value={month}>
                  {new Date(2000, month - 1).toLocaleString('en-US', { month: 'long' })}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label style={{
              display: 'block',
              marginBottom: '6px',
              fontSize: '14px',
              fontWeight: '500',
              color: 'var(--color-text)',
            }}>
              Season Start Day
            </label>
            <input
              type="number"
              min="1"
              max="31"
              value={config.season_start_day}
              onChange={(e) => updateField('season_start_day', parseInt(e.target.value))}
              style={{
                width: '100%',
                padding: '10px 12px',
                fontSize: '14px',
              }}
            />
          </div>

          <div>
            <label style={{
              display: 'block',
              marginBottom: '6px',
              fontSize: '14px',
              fontWeight: '500',
              color: 'var(--color-text)',
            }}>
              Season End Month
            </label>
            <select
              value={config.season_end_month}
              onChange={(e) => updateField('season_end_month', parseInt(e.target.value))}
              style={{
                width: '100%',
                padding: '10px 12px',
                fontSize: '14px',
              }}
            >
              {Array.from({ length: 12 }, (_, i) => i + 1).map(month => (
                <option key={month} value={month}>
                  {new Date(2000, month - 1).toLocaleString('en-US', { month: 'long' })}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label style={{
              display: 'block',
              marginBottom: '6px',
              fontSize: '14px',
              fontWeight: '500',
              color: 'var(--color-text)',
            }}>
              Season End Day
            </label>
            <input
              type="number"
              min="1"
              max="31"
              value={config.season_end_day}
              onChange={(e) => updateField('season_end_day', parseInt(e.target.value))}
              style={{
                width: '100%',
                padding: '10px 12px',
                fontSize: '14px',
              }}
            />
          </div>
        </div>
      </Card>

      {/* App Behavior */}
      <Card title="App Behavior" style={{ marginBottom: '24px' }}>
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))',
          gap: '16px',
        }}>
          <div>
            <label style={{
              display: 'block',
              marginBottom: '6px',
              fontSize: '14px',
              fontWeight: '500',
              color: 'var(--color-text)',
            }}>
              Injury Diagram Type
            </label>
            <select
              value={config.injury_diagram_type}
              onChange={(e) => updateField('injury_diagram_type', e.target.value)}
              style={{
                width: '100%',
                padding: '10px 12px',
                fontSize: '14px',
              }}
            >
              <option value="hardshell">Hard-shell Turtle</option>
              <option value="leatherback">Leatherback</option>
            </select>
          </div>

          <div>
            <label style={{
              display: 'block',
              marginBottom: '6px',
              fontSize: '14px',
              fontWeight: '500',
              color: 'var(--color-text)',
            }}>
              PIT Tag Pattern (Regex)
            </label>
            <input
              type="text"
              value={config.pit_tag_pattern}
              onChange={(e) => updateField('pit_tag_pattern', e.target.value)}
              placeholder="^[A-Z]{2}\d{4}$"
              style={{
                width: '100%',
                padding: '10px 12px',
                fontSize: '14px',
                fontFamily: 'monospace',
              }}
            />
          </div>

          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: '12px',
            gridColumn: 'span 2',
          }}>
            <input
              type="checkbox"
              id="require_measurements"
              checked={config.require_measurements}
              onChange={(e) => updateField('require_measurements', e.target.checked)}
              style={{
                width: '20px',
                height: '20px',
              }}
            />
            <label
              htmlFor="require_measurements"
              style={{
                fontSize: '14px',
                fontWeight: '500',
                color: 'var(--color-text)',
                cursor: 'pointer',
              }}
            >
              Require measurements for all observations
            </label>
          </div>
        </div>
      </Card>

      {/* Save Button (bottom) */}
      <div style={{
        display: 'flex',
        justifyContent: 'flex-end',
        marginTop: '24px',
      }}>
        <Button onClick={saveConfig} disabled={saving}>
          {saving ? 'Saving...' : 'Save Changes'}
        </Button>
      </div>
    </div>
  );
}
