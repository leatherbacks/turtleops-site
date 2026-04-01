'use client';

import { useState, useEffect } from 'react';
import { getObservations, type ObservationWithTurtle } from '@/lib/database/observations';
import { getTurtles } from '@/lib/database/turtles';
import { downloadCMTTPExport } from '@/lib/utils/cmttp';
import { useAuth } from '@/components/auth/AuthProvider';
import type { Turtle } from '@/lib/types';
import Card from '@/components/ui/Card';
import Button from '@/components/ui/Button';

export default function ExportDataPage() {
  const { profile } = useAuth();
  const [loading, setLoading] = useState(false);
  const [stats, setStats] = useState({
    totalObservations: 0,
    totalTurtles: 0,
  });

  useEffect(() => {
    loadStats();
  }, []);

  const loadStats = async () => {
    setLoading(true);

    const [observations, turtles] = await Promise.all([
      getObservations(profile?.org_id || '', { limit: 1 }),
      getTurtles(profile?.org_id || ''),
    ]);

    setStats({
      totalObservations: 0, // Would need count query
      totalTurtles: turtles.length,
    });

    setLoading(false);
  };

  const handleExportAllObservations = async () => {
    setLoading(true);
    try {
      // Get all observations (no pagination)
      const observations = await getObservations(profile?.org_id || '', {});

      if (observations.length === 0) {
        alert('No observations to export');
        return;
      }

      // Export as standard CSV
      const headers = [
        'ID',
        'Turtle Name',
        'Encounter Date',
        'Observer',
        'Location (Lat, Lon)',
        'Did Nest',
        'Recapture',
        'Tags',
        'Measurements (CCL Max, Min, CCW)',
        'Comments',
      ];

      const rows = observations.map(obs => [
        obs.id,
        obs.turtle?.name || 'Unknown',
        obs.encounter_date ? new Date(obs.encounter_date).toLocaleDateString() : '',
        obs.observer_name || '',
        `${obs.final_latitude || obs.latitude || ''}, ${obs.final_longitude || obs.longitude || ''}`,
        obs.did_she_nest === 'yes' ? 'Yes' : obs.did_she_nest === 'no' ? 'No' : 'Unsure',
        obs.is_recapture ? 'Yes' : 'No',
        `LRF: ${obs.tag_lrf || ''}, RRF: ${obs.tag_rrf || ''}, RFF: ${obs.tag_rff || ''}, LFF: ${obs.tag_lff || ''}`,
        `${obs.curved_carapace_length_max || ''}, ${obs.curved_carapace_length_min || ''}, ${obs.curved_carapace_width || ''}`,
        obs.comments || '',
      ]);

      const csv = [headers.join(','), ...rows.map(row => row.map(cell => `"${cell}"`).join(','))].join('\n');

      const blob = new Blob([csv], { type: 'text/csv' });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `all_observations_${new Date().toISOString().split('T')[0]}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
    } catch (error) {
      console.error('Export error:', error);
      alert('Failed to export observations');
    } finally {
      setLoading(false);
    }
  };

  const handleExportAllTurtles = async () => {
    setLoading(true);
    try {
      const turtles = await getTurtles(profile?.org_id || '');

      if (turtles.length === 0) {
        alert('No turtles to export');
        return;
      }

      const headers = [
        'ID',
        'Name',
        'Species',
        'LRF',
        'RRF',
        'RFF',
        'LFF',
        'First Encountered',
        'Last Encountered',
        'Encounter Count',
        'Needs Research',
      ];

      const rows = turtles.map(turtle => [
        turtle.id,
        turtle.name || '',
        turtle.species || '',
        turtle.lrf || '',
        turtle.rrf || '',
        turtle.rff || '',
        turtle.lff || '',
        turtle.first_encountered_at ? new Date(turtle.first_encountered_at).toLocaleDateString() : '',
        turtle.last_encountered_at ? new Date(turtle.last_encountered_at).toLocaleDateString() : '',
        turtle.encounter_count || 0,
        turtle.needs_research ? 'Yes' : 'No',
      ]);

      const csv = [headers.join(','), ...rows.map(row => row.join(','))].join('\n');

      const blob = new Blob([csv], { type: 'text/csv' });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `all_turtles_${new Date().toISOString().split('T')[0]}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
    } catch (error) {
      console.error('Export error:', error);
      alert('Failed to export turtles');
    } finally {
      setLoading(false);
    }
  };

  const handleExportCMTTP = async () => {
    setLoading(true);
    try {
      const observations = await getObservations(profile?.org_id || '', {});

      if (observations.length === 0) {
        alert('No observations to export');
        return;
      }

      downloadCMTTPExport(observations, `cmttp_export_${new Date().toISOString().split('T')[0]}.csv`, {
        projectType: 'Monitoring',
        county: '',
        state: 'FL',
        country: 'USA',
      });
    } catch (error) {
      console.error('Export error:', error);
      alert('Failed to export CMTTP data');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ padding: '24px' }}>
      {/* Header */}
      <div style={{
        marginBottom: '24px',
      }}>
        <h1 style={{
          fontSize: '32px',
          fontWeight: '600',
          color: 'var(--color-text)',
          marginBottom: '8px',
        }}>
          Export Data
        </h1>
        <p style={{
          color: 'var(--color-text-secondary)',
        }}>
          Export your data in various formats for reporting, backup, or analysis
        </p>
      </div>

      {/* Export Options */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
        gap: '24px',
      }}>
        {/* Observations Export */}
        <Card>
          <div style={{ marginBottom: '16px' }}>
            <div style={{
              fontSize: '48px',
              marginBottom: '12px',
            }}>📋</div>
            <h2 style={{
              fontSize: '20px',
              fontWeight: '600',
              color: 'var(--color-text)',
              marginBottom: '8px',
            }}>
              All Observations
            </h2>
            <p style={{
              fontSize: '14px',
              color: 'var(--color-text-secondary)',
              marginBottom: '16px',
            }}>
              Export all observation records with turtle names, dates, locations, measurements, and comments
            </p>
            <div style={{
              padding: '12px',
              backgroundColor: 'var(--color-surface-elevated)',
              borderRadius: '6px',
              marginBottom: '16px',
            }}>
              <div style={{
                fontSize: '12px',
                color: 'var(--color-text-muted)',
                marginBottom: '4px',
              }}>
                Format: CSV
              </div>
              <div style={{
                fontSize: '12px',
                color: 'var(--color-text-muted)',
              }}>
                Includes: Basic observation data
              </div>
            </div>
          </div>
          <Button
            onClick={handleExportAllObservations}
            disabled={loading}
            style={{ width: '100%' }}
          >
            {loading ? 'Exporting...' : '📥 Export Observations'}
          </Button>
        </Card>

        {/* Turtles Export */}
        <Card>
          <div style={{ marginBottom: '16px' }}>
            <div style={{
              fontSize: '48px',
              marginBottom: '12px',
            }}>🐢</div>
            <h2 style={{
              fontSize: '20px',
              fontWeight: '600',
              color: 'var(--color-text)',
              marginBottom: '8px',
            }}>
              All Turtles
            </h2>
            <p style={{
              fontSize: '14px',
              color: 'var(--color-text-secondary)',
              marginBottom: '16px',
            }}>
              Export complete turtle database with names, species, tags, and encounter history
            </p>
            <div style={{
              padding: '12px',
              backgroundColor: 'var(--color-surface-elevated)',
              borderRadius: '6px',
              marginBottom: '16px',
            }}>
              <div style={{
                fontSize: '12px',
                color: 'var(--color-text-muted)',
                marginBottom: '4px',
              }}>
                Format: CSV
              </div>
              <div style={{
                fontSize: '12px',
                color: 'var(--color-text-muted)',
              }}>
                Includes: {stats.totalTurtles} turtles
              </div>
            </div>
          </div>
          <Button
            onClick={handleExportAllTurtles}
            disabled={loading}
            style={{ width: '100%' }}
          >
            {loading ? 'Exporting...' : '📥 Export Turtles'}
          </Button>
        </Card>

        {/* CMTTP Export */}
        <Card>
          <div style={{ marginBottom: '16px' }}>
            <div style={{
              fontSize: '48px',
              marginBottom: '12px',
            }}>📊</div>
            <h2 style={{
              fontSize: '20px',
              fontWeight: '600',
              color: 'var(--color-text)',
              marginBottom: '8px',
            }}>
              CMTTP Format
            </h2>
            <p style={{
              fontSize: '14px',
              color: 'var(--color-text-secondary)',
              marginBottom: '16px',
            }}>
              Export observations in Cooperative Marine Turtle Tagging Program (CMTTP) format for regulatory reporting
            </p>
            <div style={{
              padding: '12px',
              backgroundColor: 'var(--color-surface-elevated)',
              borderRadius: '6px',
              marginBottom: '16px',
            }}>
              <div style={{
                fontSize: '12px',
                color: 'var(--color-text-muted)',
                marginBottom: '4px',
              }}>
                Format: CSV (30 columns)
              </div>
              <div style={{
                fontSize: '12px',
                color: 'var(--color-text-muted)',
              }}>
                Ready to paste into CMTTP template
              </div>
            </div>
          </div>
          <Button
            onClick={handleExportCMTTP}
            disabled={loading}
            style={{ width: '100%' }}
          >
            {loading ? 'Exporting...' : '📥 Export CMTTP'}
          </Button>
        </Card>
      </div>

      {/* Info Section */}
      <Card style={{ marginTop: '24px' }}>
        <h3 style={{
          fontSize: '16px',
          fontWeight: '600',
          color: 'var(--color-text)',
          marginBottom: '12px',
        }}>
          ℹ️ Export Information
        </h3>
        <ul style={{
          fontSize: '14px',
          color: 'var(--color-text-secondary)',
          lineHeight: '1.6',
          paddingLeft: '20px',
        }}>
          <li>All exports are in CSV format, compatible with Excel and other spreadsheet applications</li>
          <li>CMTTP exports follow the exact format required by the Cooperative Marine Turtle Tagging Program</li>
          <li>Exported files include data from your entire organization</li>
          <li>File names include the current date for easy organization</li>
          <li>For filtered exports, use the specific pages (Observations, Turtles) and their export buttons</li>
        </ul>
      </Card>
    </div>
  );
}
