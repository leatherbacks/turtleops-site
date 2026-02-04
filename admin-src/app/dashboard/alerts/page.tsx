'use client';

import { useState, useEffect } from 'react';
import {
  getAllAlerts,
  createTurtleAlert,
  updateTurtleAlert,
  deleteTurtleAlert,
} from '@/lib/database/alerts';
import { searchTurtlesByTag } from '@/lib/database/turtles';
import { useAuth } from '@/components/auth/AuthProvider';
import type { TurtleAlert } from '@/lib/types';
import Card from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import Badge from '@/components/ui/Badge';

export default function TurtleAlertsPage() {
  const { profile, organization } = useAuth();
  const [alerts, setAlerts] = useState<TurtleAlert[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingAlert, setEditingAlert] = useState<TurtleAlert | null>(null);
  const [processing, setProcessing] = useState(false);

  // Form state
  const [turtleSearch, setTurtleSearch] = useState('');
  const [selectedTurtle, setSelectedTurtle] = useState<{ id: string; name: string } | null>(null);
  const [alertType, setAlertType] = useState<'named_by' | 'health_note' | 'custom'>('custom');
  const [priority, setPriority] = useState<'low' | 'normal' | 'high'>('normal');
  const [message, setMessage] = useState('');
  const [isActive, setIsActive] = useState(true);

  // Filter state
  const [filterPriority, setFilterPriority] = useState<'all' | 'low' | 'normal' | 'high'>('all');
  const [filterType, setFilterType] = useState<'all' | 'named_by' | 'health_note' | 'custom'>(
    'all'
  );
  const [filterActive, setFilterActive] = useState<'all' | 'active' | 'inactive'>('all');

  useEffect(() => {
    loadAlerts();
  }, []);

  const loadAlerts = async () => {
    setLoading(true);
    const data = await getAllAlerts();
    setAlerts(data);
    setLoading(false);
  };

  const handleSearchTurtle = async () => {
    if (!turtleSearch.trim()) return;

    const results = await searchTurtlesByTag(turtleSearch.trim());
    if (results.length > 0) {
      setSelectedTurtle({ id: results[0].turtle.id, name: results[0].turtle.name });
    } else {
      alert('No turtle found with that tag or name');
    }
  };

  const resetForm = () => {
    setTurtleSearch('');
    setSelectedTurtle(null);
    setAlertType('custom');
    setPriority('normal');
    setMessage('');
    setIsActive(true);
    setEditingAlert(null);
    setShowForm(false);
  };

  const handleStartEdit = (alert: TurtleAlert) => {
    setEditingAlert(alert);
    setSelectedTurtle({ id: alert.turtleId, name: alert.turtleName });
    setAlertType(alert.type);
    setPriority(alert.priority);
    setMessage(alert.message);
    setIsActive(alert.isActive);
    setShowForm(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    console.log('[Alert Form] Submit attempt', {
      selectedTurtle,
      message,
      profile: !!profile,
    });

    if (!selectedTurtle) {
      alert('Please select a turtle');
      return;
    }

    if (!message.trim()) {
      alert('Please enter a message');
      return;
    }

    if (!profile) {
      alert('Profile not loaded');
      return;
    }

    if (!organization) {
      alert('Organization not loaded');
      return;
    }

    setProcessing(true);

    if (editingAlert) {
      // Update existing alert
      const updated = await updateTurtleAlert(editingAlert.id, {
        type: alertType,
        priority,
        message: message.trim(),
        isActive,
      });

      if (updated) {
        alert('Alert updated successfully');
        await loadAlerts();
        resetForm();
      } else {
        alert('Failed to update alert');
      }
    } else {
      // Create new alert
      const created = await createTurtleAlert({
        orgId: organization.id,
        turtleId: selectedTurtle.id,
        type: alertType,
        priority,
        message: message.trim(),
        isActive,
        createdBy: profile.id,
        createdByName: profile.full_name,
      });

      if (created) {
        alert('Alert created successfully');
        await loadAlerts();
        resetForm();
      } else {
        alert('Failed to create alert');
      }
    }

    setProcessing(false);
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Are you sure you want to delete this alert?')) {
      return;
    }

    setProcessing(true);
    const success = await deleteTurtleAlert(id);

    if (success) {
      alert('Alert deleted');
      await loadAlerts();
    } else {
      alert('Failed to delete alert');
    }

    setProcessing(false);
  };

  const filteredAlerts = alerts.filter((alert) => {
    if (filterPriority !== 'all' && alert.priority !== filterPriority) return false;
    if (filterType !== 'all' && alert.type !== filterType) return false;
    if (filterActive === 'active' && !alert.isActive) return false;
    if (filterActive === 'inactive' && alert.isActive) return false;
    return true;
  }).sort((a, b) => a.turtleName.localeCompare(b.turtleName));

  const getPriorityBadge = (priority: string) => {
    switch (priority) {
      case 'high':
        return { variant: 'error' as const, label: 'HIGH' };
      case 'normal':
        return { variant: 'warning' as const, label: 'NORMAL' };
      case 'low':
        return { variant: 'info' as const, label: 'LOW' };
      default:
        return { variant: 'default' as const, label: priority.toUpperCase() };
    }
  };

  const getTypeBadge = (type: string) => {
    switch (type) {
      case 'named_by':
        return 'Named By';
      case 'health_note':
        return 'Health Note';
      case 'custom':
        return 'Custom';
      default:
        return type;
    }
  };

  const formatDate = (date: Date) => {
    return new Date(date).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  };

  return (
    <div style={{ padding: '24px' }}>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: '32px',
        }}
      >
        <div>
          <h1
            style={{
              fontSize: '32px',
              fontWeight: '600',
              color: 'var(--color-text)',
              marginBottom: '8px',
            }}
          >
            Turtle Alerts
          </h1>
          <p
            style={{
              color: 'var(--color-text-secondary)',
            }}
          >
            Manage alerts that appear when specific turtles are encountered
          </p>
        </div>
        <Button
          onClick={() => {
            resetForm();
            setShowForm(true);
          }}
        >
          Create Alert
        </Button>
      </div>

      {/* Create/Edit Form */}
      {showForm && (
        <Card style={{ marginBottom: '32px' }}>
          <h2
            style={{
              fontSize: '20px',
              fontWeight: '600',
              color: 'var(--color-text)',
              marginBottom: '24px',
            }}
          >
            {editingAlert ? 'Edit Alert' : 'Create New Alert'}
          </h2>

          <form onSubmit={handleSubmit}>
            {/* Turtle Selection */}
            <div style={{ marginBottom: '20px' }}>
              <label
                style={{
                  display: 'block',
                  fontSize: '14px',
                  fontWeight: '500',
                  color: 'var(--color-text)',
                  marginBottom: '8px',
                }}
              >
                Turtle *
              </label>
              {selectedTurtle ? (
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '12px',
                    padding: '12px',
                    backgroundColor: 'var(--color-surface-elevated)',
                    borderRadius: '6px',
                  }}
                >
                  <span style={{ fontSize: '16px', fontWeight: '600' }}>
                    {selectedTurtle.name}
                  </span>
                  {!editingAlert && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => setSelectedTurtle(null)}
                    >
                      Change
                    </Button>
                  )}
                </div>
              ) : (
                <div style={{ display: 'flex', gap: '8px' }}>
                  <input
                    type="text"
                    value={turtleSearch}
                    onChange={(e) => setTurtleSearch(e.target.value)}
                    placeholder="Search by tag or name..."
                    style={{
                      flex: 1,
                      padding: '12px',
                      backgroundColor: 'var(--color-background)',
                      border: '1px solid var(--color-border)',
                      borderRadius: '6px',
                      color: 'var(--color-text)',
                      fontSize: '14px',
                    }}
                  />
                  <Button type="button" variant="secondary" onClick={handleSearchTurtle}>
                    Search
                  </Button>
                </div>
              )}
            </div>

            {/* Alert Type */}
            <div style={{ marginBottom: '20px' }}>
              <label
                style={{
                  display: 'block',
                  fontSize: '14px',
                  fontWeight: '500',
                  color: 'var(--color-text)',
                  marginBottom: '8px',
                }}
              >
                Type *
              </label>
              <select
                value={alertType}
                onChange={(e) =>
                  setAlertType(e.target.value as 'named_by' | 'health_note' | 'custom')
                }
                style={{
                  width: '100%',
                  padding: '12px',
                  backgroundColor: 'var(--color-background)',
                  border: '1px solid var(--color-border)',
                  borderRadius: '6px',
                  color: 'var(--color-text)',
                  fontSize: '14px',
                }}
              >
                <option value="custom">Custom</option>
                <option value="named_by">Named By</option>
                <option value="health_note">Health Note</option>
              </select>
            </div>

            {/* Priority */}
            <div style={{ marginBottom: '20px' }}>
              <label
                style={{
                  display: 'block',
                  fontSize: '14px',
                  fontWeight: '500',
                  color: 'var(--color-text)',
                  marginBottom: '8px',
                }}
              >
                Priority *
              </label>
              <select
                value={priority}
                onChange={(e) => setPriority(e.target.value as 'low' | 'normal' | 'high')}
                style={{
                  width: '100%',
                  padding: '12px',
                  backgroundColor: 'var(--color-background)',
                  border: '1px solid var(--color-border)',
                  borderRadius: '6px',
                  color: 'var(--color-text)',
                  fontSize: '14px',
                }}
              >
                <option value="low">Low</option>
                <option value="normal">Normal</option>
                <option value="high">High</option>
              </select>
            </div>

            {/* Message */}
            <div style={{ marginBottom: '20px' }}>
              <label
                style={{
                  display: 'block',
                  fontSize: '14px',
                  fontWeight: '500',
                  color: 'var(--color-text)',
                  marginBottom: '8px',
                }}
              >
                Message *
              </label>
              <textarea
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder="Enter alert message..."
                rows={4}
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
                }}
              />
            </div>

            {/* Active Status */}
            <div style={{ marginBottom: '24px' }}>
              <label
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  fontSize: '14px',
                  color: 'var(--color-text)',
                  cursor: 'pointer',
                }}
              >
                <input
                  type="checkbox"
                  checked={isActive}
                  onChange={(e) => setIsActive(e.target.checked)}
                  style={{ width: '16px', height: '16px' }}
                />
                Alert is active
              </label>
            </div>

            {/* Form Actions */}
            <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
              <Button type="button" variant="secondary" onClick={resetForm} disabled={processing}>
                Cancel
              </Button>
              <Button type="submit" disabled={processing || !selectedTurtle || !message.trim()}>
                {processing ? 'Saving...' : editingAlert ? 'Update Alert' : 'Create Alert'}
              </Button>
            </div>
          </form>
        </Card>
      )}

      {/* Filters */}
      <Card style={{ marginBottom: '24px' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '16px' }}>
          <div>
            <label
              style={{
                display: 'block',
                fontSize: '13px',
                fontWeight: '500',
                color: 'var(--color-text-muted)',
                marginBottom: '6px',
              }}
            >
              Priority
            </label>
            <select
              value={filterPriority}
              onChange={(e) => setFilterPriority(e.target.value as any)}
              style={{
                width: '100%',
                padding: '8px',
                backgroundColor: 'var(--color-background)',
                border: '1px solid var(--color-border)',
                borderRadius: '4px',
                color: 'var(--color-text)',
                fontSize: '13px',
              }}
            >
              <option value="all">All Priorities</option>
              <option value="low">Low</option>
              <option value="normal">Normal</option>
              <option value="high">High</option>
            </select>
          </div>

          <div>
            <label
              style={{
                display: 'block',
                fontSize: '13px',
                fontWeight: '500',
                color: 'var(--color-text-muted)',
                marginBottom: '6px',
              }}
            >
              Type
            </label>
            <select
              value={filterType}
              onChange={(e) => setFilterType(e.target.value as any)}
              style={{
                width: '100%',
                padding: '8px',
                backgroundColor: 'var(--color-background)',
                border: '1px solid var(--color-border)',
                borderRadius: '4px',
                color: 'var(--color-text)',
                fontSize: '13px',
              }}
            >
              <option value="all">All Types</option>
              <option value="custom">Custom</option>
              <option value="named_by">Named By</option>
              <option value="health_note">Health Note</option>
            </select>
          </div>

          <div>
            <label
              style={{
                display: 'block',
                fontSize: '13px',
                fontWeight: '500',
                color: 'var(--color-text-muted)',
                marginBottom: '6px',
              }}
            >
              Status
            </label>
            <select
              value={filterActive}
              onChange={(e) => setFilterActive(e.target.value as any)}
              style={{
                width: '100%',
                padding: '8px',
                backgroundColor: 'var(--color-background)',
                border: '1px solid var(--color-border)',
                borderRadius: '4px',
                color: 'var(--color-text)',
                fontSize: '13px',
              }}
            >
              <option value="all">All Statuses</option>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </select>
          </div>
        </div>
      </Card>

      {/* Alerts List */}
      {loading ? (
        <Card>
          <div
            style={{
              textAlign: 'center',
              padding: '48px 24px',
              color: 'var(--color-text-secondary)',
            }}
          >
            Loading alerts...
          </div>
        </Card>
      ) : filteredAlerts.length === 0 ? (
        <Card>
          <div
            style={{
              textAlign: 'center',
              padding: '48px 24px',
              color: 'var(--color-text-secondary)',
            }}
          >
            <div style={{ fontSize: '48px', marginBottom: '16px' }}>⚠️</div>
            <div style={{ fontSize: '18px', marginBottom: '8px' }}>No Alerts Found</div>
            <div style={{ fontSize: '14px' }}>Create an alert to get started</div>
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
            Showing {filteredAlerts.length} alert{filteredAlerts.length !== 1 ? 's' : ''}
          </div>

          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: '16px',
            }}
          >
            {filteredAlerts.map((alert) => {
              const priorityBadge = getPriorityBadge(alert.priority);

              return (
                <Card key={alert.id}>
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'start',
                      gap: '24px',
                    }}
                  >
                    <div style={{ flex: 1 }}>
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
                            color: 'var(--color-text)',
                          }}
                        >
                          <span style={{ color: 'var(--color-text-secondary)', fontSize: '14px', fontWeight: '400' }}>
                            Turtle:{' '}
                          </span>
                          {alert.turtleName || '(No name)'}
                        </div>
                        <Badge variant={priorityBadge.variant} size="sm">
                          {priorityBadge.label}
                        </Badge>
                        <Badge variant="info" size="sm">
                          {getTypeBadge(alert.type)}
                        </Badge>
                        {!alert.isActive && (
                          <Badge variant="default" size="sm">
                            INACTIVE
                          </Badge>
                        )}
                      </div>

                      <div
                        style={{
                          fontSize: '14px',
                          color: 'var(--color-text)',
                          marginBottom: '12px',
                        }}
                      >
                        {alert.message}
                      </div>

                      <div
                        style={{
                          fontSize: '13px',
                          color: 'var(--color-text-muted)',
                        }}
                      >
                        Created by {alert.createdByName} on {formatDate(alert.createdAt)}
                      </div>
                    </div>

                    <div style={{ display: 'flex', gap: '8px' }}>
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => handleStartEdit(alert)}
                        disabled={processing}
                      >
                        Edit
                      </Button>
                      <Button
                        variant="danger"
                        size="sm"
                        onClick={() => handleDelete(alert.id)}
                        disabled={processing}
                      >
                        Delete
                      </Button>
                    </div>
                  </div>
                </Card>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
