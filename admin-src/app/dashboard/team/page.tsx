'use client';

import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/components/auth/AuthProvider';
import Card from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import Badge from '@/components/ui/Badge';

interface TeamMember {
  id: string;
  email: string;
  full_name: string | null;
  role: string;
  is_active: boolean;
  disabled_at: string | null;
  created_at: string;
  last_sign_in_at: string | null;
}

export default function TeamManagementPage() {
  const { profile, organization } = useAuth();
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [showInviteForm, setShowInviteForm] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<'admin' | 'user'>('user');
  const [processing, setProcessing] = useState(false);

  // Admin check
  const isAdmin = profile?.role === 'admin';

  useEffect(() => {
    if (profile?.org_id) {
      loadTeamMembers();
    }
  }, [profile?.org_id]);

  const loadTeamMembers = async () => {
    if (!profile?.org_id) {
      setLoading(false);
      return;
    }

    setLoading(true);

    try {
      // Get all profiles in this organization with optimized query
      const { data, error } = await supabase
        .from('profiles')
        .select('id, email, full_name, role, is_active, disabled_at, created_at')
        .eq('org_id', profile.org_id)
        .order('is_active', { ascending: false }) // Active users first
        .order('role', { ascending: false }) // Then by role (admins first)
        .order('full_name', { ascending: true })
        .limit(100); // Reasonable limit for team size

      if (error) {
        console.error('Error loading team members:', error);
        alert('Failed to load team members. Please check your connection.');
        setLoading(false);
        return;
      }

      setTeamMembers(data || []);
    } catch (error) {
      console.error('Error loading team members:', error);
      alert('An error occurred while loading team members.');
    } finally {
      setLoading(false);
    }
  };

  const handleUpdateRole = async (userId: string, newRole: string) => {
    if (!isAdmin) {
      alert('Only admins can change user roles');
      return;
    }

    if (!confirm(`Are you sure you want to change this user's role to ${newRole}?`)) {
      return;
    }

    setProcessing(true);

    try {
      // Use the database function for role changes (includes safety checks)
      const { data, error } = await supabase.rpc('set_user_role', {
        target_user_id: userId,
        new_role: newRole,
      });

      if (error) {
        console.error('Error updating role:', error);
        alert(error.message || 'Failed to update role');
        return;
      }

      alert('Role updated successfully');
      loadTeamMembers();
    } catch (error: any) {
      console.error('Error updating role:', error);
      alert(error.message || 'Failed to update role');
    } finally {
      setProcessing(false);
    }
  };

  const handleToggleActive = async (userId: string, userName: string, currentActive: boolean) => {
    if (!isAdmin) {
      alert('Only admins can disable/enable users');
      return;
    }

    if (userId === profile?.id) {
      alert('You cannot disable yourself');
      return;
    }

    const action = currentActive ? 'disable' : 'enable';
    if (!confirm(`Are you sure you want to ${action} ${userName || 'this user'}?`)) {
      return;
    }

    setProcessing(true);

    try {
      console.log(`[Team] ${action}ing user:`, userId, 'active:', !currentActive);

      // Try the RPC function first
      const { data, error } = await supabase.rpc('set_user_active', {
        target_user_id: userId,
        active: !currentActive,
      });

      console.log(`[Team] RPC result:`, { data, error });

      if (error) {
        // If RPC function doesn't exist or fails, fall back to direct update
        console.warn(`[Team] RPC failed, trying direct update:`, error.message);
        const { error: updateError } = await supabase
          .from('profiles')
          .update({
            is_active: !currentActive,
            disabled_at: !currentActive ? null : new Date().toISOString(),
            disabled_by: !currentActive ? null : profile?.id,
          })
          .eq('id', userId);

        if (updateError) {
          console.error(`Error ${action}ing user:`, updateError);
          alert(updateError.message || `Failed to ${action} user`);
          return;
        }
      }

      alert(`User ${action}d successfully`);
      loadTeamMembers();
    } catch (error: any) {
      console.error(`Error ${action}ing user:`, error);
      alert(error.message || `Failed to ${action} user`);
    } finally {
      setProcessing(false);
    }
  };

  const getRoleBadgeColor = (role: string): 'primary' | 'success' | 'warning' | 'error' => {
    switch (role) {
      case 'admin':
        return 'error';
      case 'coordinator':
        return 'warning';
      case 'volunteer':
        return 'success';
      default:
        return 'primary';
    }
  };

  const formatRoleDisplay = (role: string): string => {
    return role.charAt(0).toUpperCase() + role.slice(1);
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
            Team Management
          </h1>
          <p style={{
            color: 'var(--color-text-secondary)',
          }}>
            {organization?.name || 'Your Organization'} • {teamMembers.length} member{teamMembers.length !== 1 ? 's' : ''}
          </p>
        </div>
        {isAdmin && (
          <Button
            onClick={() => setShowInviteForm(!showInviteForm)}
            disabled={processing}
          >
            {showInviteForm ? '❌ Cancel' : '➕ Invite Member'}
          </Button>
        )}
      </div>

      {/* Invite Form - Hidden for now to improve performance */}
      {showInviteForm && isAdmin && (
        <Card style={{ marginBottom: '24px' }}>
          <h3 style={{
            fontSize: '18px',
            fontWeight: '600',
            color: 'var(--color-text)',
            marginBottom: '16px',
          }}>
            Team Invitation
          </h3>
          <div style={{
            padding: '16px',
            backgroundColor: 'rgba(59, 130, 246, 0.1)',
            border: '1px solid rgba(59, 130, 246, 0.3)',
            borderRadius: '6px',
            fontSize: '14px',
            color: 'var(--color-text-secondary)',
          }}>
            <p style={{ marginBottom: '12px' }}>
              To add team members to TurtleOps:
            </p>
            <ol style={{ paddingLeft: '20px', lineHeight: '1.8' }}>
              <li>Have them sign up at the TurtleOps mobile app</li>
              <li>Contact support to assign them to your organization</li>
              <li>Once assigned, they'll appear here and you can manage their roles</li>
            </ol>
          </div>
        </Card>
      )}

      {/* Team Members List */}
      <Card>
        <h3 style={{
          fontSize: '18px',
          fontWeight: '600',
          color: 'var(--color-text)',
          marginBottom: '16px',
        }}>
          Team Members
        </h3>

        {loading ? (
          <div style={{
            padding: '48px',
            textAlign: 'center',
            color: 'var(--color-text-muted)',
          }}>
            Loading team members...
          </div>
        ) : teamMembers.length === 0 ? (
          <div style={{
            padding: '48px',
            textAlign: 'center',
            color: 'var(--color-text-muted)',
          }}>
            No team members found
          </div>
        ) : (
          <div style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '12px',
          }}>
            {teamMembers.map((member) => (
              <div
                key={member.id}
                style={{
                  padding: '16px',
                  backgroundColor: member.id === profile?.id ? 'var(--color-primary-glow)' : 'var(--color-surface-elevated)',
                  borderRadius: '8px',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                }}
              >
                <div style={{ flex: 1 }}>
                  <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '12px',
                    marginBottom: '4px',
                  }}>
                    <div style={{
                      fontSize: '16px',
                      fontWeight: '600',
                      color: member.is_active ? 'var(--color-text)' : 'var(--color-text-muted)',
                    }}>
                      {member.full_name || member.email}
                    </div>
                    {member.id === profile?.id && (
                      <Badge variant="primary">You</Badge>
                    )}
                    <Badge variant={getRoleBadgeColor(member.role)}>
                      {formatRoleDisplay(member.role)}
                    </Badge>
                    {!member.is_active && (
                      <Badge variant="error">Disabled</Badge>
                    )}
                  </div>
                  <div style={{
                    fontSize: '13px',
                    color: 'var(--color-text-muted)',
                  }}>
                    {member.email}
                  </div>
                  <div style={{
                    fontSize: '12px',
                    color: 'var(--color-text-muted)',
                    marginTop: '4px',
                  }}>
                    Joined {new Date(member.created_at).toLocaleDateString()}
                    {member.disabled_at && (
                      <span style={{ marginLeft: '8px' }}>
                        • Disabled {new Date(member.disabled_at).toLocaleDateString()}
                      </span>
                    )}
                  </div>
                </div>

                {isAdmin && member.id !== profile?.id && (
                  <div style={{
                    display: 'flex',
                    gap: '8px',
                    alignItems: 'center',
                  }}>
                    <select
                      value={member.role}
                      onChange={(e) => handleUpdateRole(member.id, e.target.value)}
                      disabled={processing || !member.is_active}
                      style={{
                        padding: '6px 10px',
                        fontSize: '13px',
                        backgroundColor: 'var(--color-surface)',
                        border: '1px solid var(--color-border)',
                        borderRadius: '4px',
                        color: 'var(--color-text)',
                        opacity: !member.is_active ? 0.5 : 1,
                      }}
                    >
                      <option value="volunteer">Volunteer</option>
                      <option value="coordinator">Coordinator</option>
                      <option value="admin">Admin</option>
                    </select>
                    <Button
                      onClick={() => handleToggleActive(member.id, member.full_name || member.email, member.is_active)}
                      variant={member.is_active ? 'secondary' : 'primary'}
                      disabled={processing}
                      style={{
                        padding: '6px 12px',
                        fontSize: '13px',
                        minWidth: '80px',
                      }}
                    >
                      {member.is_active ? 'Disable' : 'Enable'}
                    </Button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* Roles Info */}
      <Card style={{ marginTop: '24px' }}>
        <h3 style={{
          fontSize: '16px',
          fontWeight: '600',
          color: 'var(--color-text)',
          marginBottom: '12px',
        }}>
          ℹ️ Role Permissions
        </h3>
        <div style={{
          fontSize: '14px',
          color: 'var(--color-text-secondary)',
          lineHeight: '1.6',
        }}>
          <div style={{ marginBottom: '12px' }}>
            <strong style={{ color: 'var(--color-text)' }}>Admin:</strong> Full access to all features including team management, project configuration, data export, and historical data entry
          </div>
          <div style={{ marginBottom: '12px' }}>
            <strong style={{ color: 'var(--color-text)' }}>Coordinator:</strong> Can manage observations, create reports, and assist with data validation. Cannot change team or project settings
          </div>
          <div>
            <strong style={{ color: 'var(--color-text)' }}>Volunteer:</strong> Can record observations and view turtle data. Limited editing capabilities
          </div>
        </div>
      </Card>
    </div>
  );
}
