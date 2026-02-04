'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/components/auth/AuthProvider';
import { getTurtles, type Turtle } from '@/lib/database/turtles';
import { supabase } from '@/lib/supabase';
import type { Profile } from '@/lib/types';
import Card from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import Badge from '@/components/ui/Badge';

export default function NewHistoricalObservationPage() {
  const router = useRouter();
  const { profile } = useAuth();
  const [loading, setLoading] = useState(true);

  // Admin check
  useEffect(() => {
    if (profile === null) {
      // Still loading
      return;
    }

    if (!profile || profile.role !== 'admin') {
      router.push('/dashboard/observations');
      return;
    }

    setLoading(false);
  }, [profile, router]);

  // Load org users for observer dropdown
  useEffect(() => {
    const loadOrgUsers = async () => {
      if (!profile?.org_id) {
        console.log('[Observer Loading] No org_id in profile yet');
        return;
      }

      console.log('[Observer Loading] Loading org users for org:', profile.org_id);

      try {
        const { data, error } = await supabase
          .from('profiles')
          .select('*')
          .eq('org_id', profile.org_id)
          .order('full_name', { ascending: true });

        if (error) {
          console.error('[Observer Loading] Error loading org users:', error);
          return;
        }

        console.log('[Observer Loading] Loaded users:', data);
        setOrgUsers(data || []);
      } catch (error) {
        console.error('[Observer Loading] Exception loading org users:', error);
      }
    };

    if (profile?.org_id) {
      loadOrgUsers();
    }
  }, [profile?.org_id]);

  // Basic form state
  const [encounterDateTime, setEncounterDateTime] = useState<string>(
    new Date().toISOString().slice(0, 16) // Format: "YYYY-MM-DDTHH:mm"
  );
  const [observerSelection, setObserverSelection] = useState<string>(''); // User ID or 'other'
  const [observerName, setObserverName] = useState<string>('');
  const [comments, setComments] = useState<string>('');

  // Org users for observer dropdown
  const [orgUsers, setOrgUsers] = useState<Profile[]>([]);

  // Turtle selection
  const [turtleSearch, setTurtleSearch] = useState<string>('');
  const [searchResults, setSearchResults] = useState<Turtle[]>([]);
  const [selectedTurtle, setSelectedTurtle] = useState<Turtle | null>(null);
  const [isSearching, setIsSearching] = useState(false);

  // Location state
  const [latitude, setLatitude] = useState<string>('');
  const [longitude, setLongitude] = useState<string>('');

  // Tag state - Previous tags (what turtle had before this encounter)
  const [previousLrf, setPreviousLrf] = useState<string>('');
  const [previousRrf, setPreviousRrf] = useState<string>('');
  const [previousRff, setPreviousRff] = useState<string>('');
  const [previousLff, setPreviousLff] = useState<string>('');

  // Tag state - Current tags (observed during this encounter)
  const [currentLrf, setCurrentLrf] = useState<string>('');
  const [currentRrf, setCurrentRrf] = useState<string>('');
  const [currentRff, setCurrentRff] = useState<string>('');
  const [currentLff, setCurrentLff] = useState<string>('');

  // Tag change status for each position
  const [lrfChange, setLrfChange] = useState<string>('no_change'); // no_change, new, fell_off, replaced
  const [rrfChange, setRrfChange] = useState<string>('no_change');
  const [rffChange, setRffChange] = useState<string>('no_change');
  const [lffChange, setLffChange] = useState<string>('no_change');

  // Nesting state
  const [didSheNest, setDidSheNest] = useState<string>('unsure');
  const [eggCount, setEggCount] = useState<string>('');
  const [nestChamberDepth, setNestChamberDepth] = useState<string>('');

  // Nesting event times
  const [exitWaterTime, setExitWaterTime] = useState<string>('');
  const [bodyPitTime, setBodyPitTime] = useState<string>('');
  const [startDiggingTime, setStartDiggingTime] = useState<string>('');
  const [layingTime, setLayingTime] = useState<string>('');
  const [coveringTime, setCoveringTime] = useState<string>('');
  const [returnSeaTime, setReturnSeaTime] = useState<string>('');
  const [enterWaterTime, setEnterWaterTime] = useState<string>('');

  // Measurements - Curved Carapace
  const [ccMinLength, setCcMinLength] = useState<string>('');
  const [ccMaxLength, setCcMaxLength] = useState<string>('');
  const [ccWidth, setCcWidth] = useState<string>('');

  // Injuries
  const [hasInjuries, setHasInjuries] = useState(false);
  const [injuryNotes, setInjuryNotes] = useState<string>('');
  const [injuryLocations, setInjuryLocations] = useState<string[]>([]);

  // Samples
  const [hasSamples, setHasSamples] = useState(false);
  const [sampleTypes, setSampleTypes] = useState<string[]>([]);
  const [sampleNotes, setSampleNotes] = useState<string>('');

  // Photo state
  const [datasheetPhoto, setDatasheetPhoto] = useState<File | null>(null);
  const [datasheetPreview, setDatasheetPreview] = useState<string | null>(null);
  const [injuryPhotos, setInjuryPhotos] = useState<File[]>([]);
  const [tagPhotos, setTagPhotos] = useState<File[]>([]);
  const [turtlePhotos, setTurtlePhotos] = useState<File[]>([]);
  const [otherPhotos, setOtherPhotos] = useState<File[]>([]);

  // Search turtles
  const handleTurtleSearch = async () => {
    if (!turtleSearch.trim()) {
      setSearchResults([]);
      return;
    }

    setIsSearching(true);
    const results = await getTurtles({ searchQuery: turtleSearch.trim() });
    setSearchResults(results);
    setIsSearching(false);
  };

  // Select turtle from search results
  const handleSelectTurtle = (turtle: Turtle) => {
    setSelectedTurtle(turtle);
    setSearchResults([]);
    setTurtleSearch('');

    // Pre-fill previous tags (what turtle had before this encounter)
    setPreviousLrf(turtle.lrf || '');
    setPreviousRrf(turtle.rrf || '');
    setPreviousRff(turtle.rff || '');
    setPreviousLff(turtle.lff || '');

    // Pre-fill current tags (start with what they had, user can modify)
    setCurrentLrf(turtle.lrf || '');
    setCurrentRrf(turtle.rrf || '');
    setCurrentRff(turtle.rff || '');
    setCurrentLff(turtle.lff || '');

    // Reset change status
    setLrfChange('no_change');
    setRrfChange('no_change');
    setRffChange('no_change');
    setLffChange('no_change');
  };

  // Handle datasheet photo change
  const handleDatasheetPhotoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setDatasheetPhoto(file);
      // Create preview
      const reader = new FileReader();
      reader.onloadend = () => {
        setDatasheetPreview(reader.result as string);
      };
      reader.readAsDataURL(file);
    }
  };

  // Toggle injury location
  const toggleInjuryLocation = (location: string) => {
    if (injuryLocations.includes(location)) {
      setInjuryLocations(injuryLocations.filter((l) => l !== location));
    } else {
      setInjuryLocations([...injuryLocations, location]);
    }
  };

  // Toggle sample type
  const toggleSampleType = (type: string) => {
    if (sampleTypes.includes(type)) {
      setSampleTypes(sampleTypes.filter((t) => t !== type));
    } else {
      setSampleTypes([...sampleTypes, type]);
    }
  };

  // Form submission
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    // Basic validation
    if (!encounterDateTime) {
      alert('Encounter date and time is required');
      return;
    }

    if (!observerSelection) {
      alert('Please select an observer');
      return;
    }

    if (observerSelection === 'other' && !observerName.trim()) {
      alert('Please enter the observer name');
      return;
    }

    if (!datasheetPhoto) {
      alert('Datasheet photo is required for historical observations');
      return;
    }

    if (!latitude || !longitude) {
      alert('Location (latitude and longitude) is required');
      return;
    }

    if (!selectedTurtle && (!currentLrf && !currentRrf && !currentRff && !currentLff)) {
      alert('Please either select an existing turtle or enter at least one tag value');
      return;
    }

    if (!profile?.org_id) {
      alert('Organization ID not found. Please refresh and try again.');
      return;
    }

    try {
      setLoading(true);
      console.log('[Form Submit] Starting submission...');
      console.log('[Form Submit] Profile:', profile);
      console.log('[Form Submit] Observer selection:', observerSelection);
      console.log('[Form Submit] Observer name:', observerName);

      // Parse datetime for database
      // datetime-local returns "YYYY-MM-DDTHH:mm" format, convert to ISO string
      // Add seconds if not present, then treat as UTC for consistency
      const dateTimeWithSeconds = encounterDateTime.includes(':00', encounterDateTime.length - 3)
        ? encounterDateTime
        : encounterDateTime + ':00';
      const encounterDateISO = new Date(dateTimeWithSeconds + 'Z').toISOString();
      const observerId = observerSelection !== 'other' ? observerSelection : null;
      console.log('[Form Submit] Input datetime:', encounterDateTime);
      console.log('[Form Submit] Parsed encounter date:', encounterDateISO);
      console.log('[Form Submit] Observer ID:', observerId);

      // Step 1: Handle turtle (create new or update existing)
      let turtleId = selectedTurtle?.id;
      let turtleName = selectedTurtle?.name;
      let tagsChanged = false;

      if (!selectedTurtle) {
        // Create new turtle
        const newTurtleName = `UNNAMED-${new Date(encounterDateTime).toISOString().split('T')[0].replace(/-/g, '')}-001`;
        console.log('[Form Submit] Creating new turtle:', newTurtleName);

        const insertData = {
          org_id: profile.org_id,
          name: newTurtleName,
          lrf: currentLrf || null,
          rrf: currentRrf || null,
          rff: currentRff || null,
          lff: currentLff || null,
          first_encountered_at: encounterDateISO,
          last_encountered_at: encounterDateISO,
          encounter_count: 1,
          created_by: profile.id,
        };
        console.log('[Form Submit] Turtle insert data:', insertData);

        const { data: newTurtle, error: turtleError } = await supabase
          .from('turtles')
          .insert(insertData)
          .select()
          .single();

        console.log('[Form Submit] Turtle create result:', { data: newTurtle, error: turtleError });

        if (turtleError) {
          console.error('Error creating turtle:', turtleError);
          alert(`Failed to create turtle: ${turtleError.message}`);
          setLoading(false);
          return;
        }

        turtleId = newTurtle.id;
        turtleName = newTurtle.name;
        console.log('[Form Submit] New turtle created:', { turtleId, turtleName });
      } else {
        // Check if tags changed
        tagsChanged =
          currentLrf !== previousLrf ||
          currentRrf !== previousRrf ||
          currentRff !== previousRff ||
          currentLff !== previousLff;

        // Update existing turtle
        const { error: updateError } = await supabase
          .from('turtles')
          .update({
            lrf: currentLrf || null,
            rrf: currentRrf || null,
            rff: currentRff || null,
            lff: currentLff || null,
            last_encountered_at: encounterDateISO,
            encounter_count: (selectedTurtle.encounter_count || 0) + 1,
          })
          .eq('id', turtleId);

        if (updateError) {
          console.error('Error updating turtle:', updateError);
          alert(`Failed to update turtle: ${updateError.message}`);
          setLoading(false);
          return;
        }
      }

      // Step 2: Create observation
      console.log('[Form Submit] Creating observation...');
      const obsInsertData = {
        org_id: profile.org_id,
        turtle_id: turtleId!,
        turtle_name: turtleName,
        encounter_date: encounterDateISO,
        observer: observerId,
        observer_name: observerName,
        latitude: parseFloat(latitude),
        longitude: parseFloat(longitude),
        did_she_nest: didSheNest === 'yes' ? true : didSheNest === 'no' ? false : null,
        egg_count: eggCount ? parseInt(eggCount) : null,
        chamber_depth: nestChamberDepth ? parseFloat(nestChamberDepth) : null,
        tag_lrf: currentLrf || null,
        tag_rrf: currentRrf || null,
        tag_rff: currentRff || null,
        tag_lff: currentLff || null,
        is_recapture: !!selectedTurtle,
        is_submitted: true,  // Historical observations are already complete
        comments: comments || null,
        sync_status: 'synced',
      };
      console.log('[Form Submit] Observation insert data:', obsInsertData);

      const { data: observation, error: obsError } = await supabase
        .from('observations')
        .insert(obsInsertData)
        .select()
        .single();

      console.log('[Form Submit] Observation create result:', { data: observation, error: obsError });

      if (obsError) {
        console.error('Error creating observation:', obsError);
        alert(`Failed to create observation: ${obsError.message}`);
        setLoading(false);
        return;
      }
      console.log('[Form Submit] Observation created:', observation?.id);

      // Step 3: Create tag history if tags changed
      if (tagsChanged && selectedTurtle) {
        const tagChanges = [
          lrfChange !== 'no_change' && `LRF ${lrfChange}`,
          rrfChange !== 'no_change' && `RRF ${rrfChange}`,
          rffChange !== 'no_change' && `RFF ${rffChange}`,
          lffChange !== 'no_change' && `LFF ${lffChange}`,
        ].filter(Boolean);

        const { error: tagHistoryError} = await supabase
          .from('tag_history')
          .insert({
            org_id: profile.org_id,
            turtle_id: turtleId!,
            observation_id: observation.id,
            encounter_date: encounterDateISO,
            observer_id: observerId,
            observer_name: observerName,
            lrf: currentLrf || null,
            rrf: currentRrf || null,
            rff: currentRff || null,
            lff: currentLff || null,
            previous_lrf: previousLrf || null,  // Save previous tags for searchability
            previous_rrf: previousRrf || null,
            previous_rff: previousRff || null,
            previous_lff: previousLff || null,
            notes: tagChanges.length > 0 ? `Tags updated: ${tagChanges.join(', ')}` : null,
          });

        if (tagHistoryError) {
          console.error('Error creating tag history:', tagHistoryError);
          // Don't fail the whole submission for tag history
        }
      }

      // Step 4: Upload datasheet photo
      if (datasheetPhoto) {
        const fileExt = datasheetPhoto.name.split('.').pop();
        const fileName = `${observation.id}-datasheet-${Date.now()}.${fileExt}`;
        const filePath = `${profile.org_id}/${fileName}`;

        const { error: uploadError } = await supabase.storage
          .from('turtle-photos')
          .upload(filePath, datasheetPhoto);

        if (uploadError) {
          console.error('Error uploading datasheet photo:', uploadError);
          // Continue even if photo upload fails
        } else {
          // Get public URL
          const { data: { publicUrl } } = supabase.storage
            .from('turtle-photos')
            .getPublicUrl(filePath);

          // Create photo record
          await supabase.from('photos').insert({
            org_id: profile.org_id,
            observation_id: observation.id,
            photo_type: 'datasheet',
            remote_url: publicUrl,
            sync_status: 'synced',
          });
        }
      }

      // Step 5: Upload additional photos
      const additionalPhotoArrays = [
        { photos: injuryPhotos, type: 'injury' as const },
        { photos: tagPhotos, type: 'tags' as const },
        { photos: turtlePhotos, type: 'turtle' as const },
        { photos: otherPhotos, type: 'other' as const },
      ];

      for (const { photos, type } of additionalPhotoArrays) {
        for (const photo of photos) {
          const fileExt = photo.name.split('.').pop();
          const fileName = `${observation.id}-${type}-${Date.now()}.${fileExt}`;
          const filePath = `${profile.org_id}/${fileName}`;

          const { error: uploadError } = await supabase.storage
            .from('turtle-photos')
            .upload(filePath, photo);

          if (!uploadError) {
            const { data: { publicUrl } } = supabase.storage
              .from('turtle-photos')
              .getPublicUrl(filePath);

            await supabase.from('photos').insert({
              org_id: profile.org_id,
              observation_id: observation.id,
              photo_type: type,
              remote_url: publicUrl,
              sync_status: 'synced',
            });
          }
        }
      }

      // Step 6: Create injuries if any
      if (hasInjuries && injuryLocations.length > 0) {
        // For simplicity, create one injury record with all locations
        // In a full implementation, you might want separate records per location
        await supabase.from('injuries').insert({
          org_id: profile.org_id,
          observation_id: observation.id,
          turtle_id: turtleId!,
          injury_type: 'other', // Default type, could be enhanced
          body_location: injuryLocations[0] as any, // First location
          severity: 'minor', // Default severity
          healing_status: 'fresh', // Default status
          description: injuryNotes || `Injuries at: ${injuryLocations.join(', ')}`,
        });
      }

      // Success! Navigate to observations list
      alert('Historical observation saved successfully!');
      router.push('/dashboard/observations');
    } catch (error) {
      console.error('Error submitting observation:', error);
      alert('An unexpected error occurred. Please try again.');
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div style={{ padding: '24px' }}>
        <Card>
          <div
            style={{
              textAlign: 'center',
              padding: '48px 24px',
              color: 'var(--color-text-secondary)',
            }}
          >
            Loading...
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div style={{ padding: '24px', maxWidth: '1200px', margin: '0 auto' }}>
      {/* Header */}
      <div style={{ marginBottom: '32px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '8px' }}>
          <h1
            style={{
              fontSize: '32px',
              fontWeight: '600',
              color: 'var(--color-text)',
              margin: 0,
            }}
          >
            Enter Historical Observation
          </h1>
          <Badge variant="warning" size="sm">
            ADMIN ONLY
          </Badge>
        </div>
        <p
          style={{
            color: 'var(--color-text-secondary)',
            margin: 0,
          }}
        >
          Enter comprehensive observation data for historical records
        </p>
      </div>

      <form onSubmit={handleSubmit}>
        {/* Basic Information */}
        <Card style={{ marginBottom: '24px' }} title="Basic Information">
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))',
              gap: '20px',
            }}
          >
            {/* Encounter Date & Time */}
            <div>
              <label
                style={{
                  display: 'block',
                  fontSize: '14px',
                  fontWeight: '500',
                  color: 'var(--color-text)',
                  marginBottom: '8px',
                }}
              >
                Encounter Date & Time *
              </label>
              <input
                type="datetime-local"
                value={encounterDateTime}
                onChange={(e) => setEncounterDateTime(e.target.value)}
                max={new Date().toISOString().slice(0, 16)}
                required
                style={{
                  width: '100%',
                  padding: '12px',
                  backgroundColor: 'var(--color-background)',
                  border: '1px solid var(--color-border)',
                  borderRadius: '6px',
                  color: 'var(--color-text)',
                  fontSize: '14px',
                }}
              />
              <div
                style={{
                  marginTop: '4px',
                  fontSize: '12px',
                  color: 'var(--color-text-muted)',
                }}
              >
                Select the date and time of the observation
              </div>
            </div>

            {/* Observer Selection */}
            <div>
              <label
                style={{
                  display: 'block',
                  fontSize: '14px',
                  fontWeight: '500',
                  color: 'var(--color-text)',
                  marginBottom: '8px',
                }}
              >
                Observer *
              </label>
              <select
                value={observerSelection}
                onChange={(e) => {
                  const value = e.target.value;
                  setObserverSelection(value);
                  // If selecting a user, set their name
                  if (value && value !== 'other') {
                    const user = orgUsers.find((u) => u.id === value);
                    if (user) {
                      setObserverName(user.full_name);
                    }
                  } else if (value === 'other') {
                    // Clear name when switching to "Other"
                    setObserverName('');
                  }
                }}
                required
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
                <option value="">
                  {orgUsers.length === 0 ? 'Loading observers...' : 'Select observer...'}
                </option>
                {orgUsers.map((user) => (
                  <option key={user.id} value={user.id}>
                    {user.full_name}
                  </option>
                ))}
                <option value="other">Other (enter name)</option>
              </select>

              {/* Show text input when "Other" is selected */}
              {observerSelection === 'other' && (
                <input
                  type="text"
                  value={observerName}
                  onChange={(e) => setObserverName(e.target.value)}
                  placeholder="Enter observer name"
                  required
                  style={{
                    width: '100%',
                    marginTop: '8px',
                    padding: '12px',
                    backgroundColor: 'var(--color-background)',
                    border: '1px solid var(--color-border)',
                    borderRadius: '6px',
                    color: 'var(--color-text)',
                    fontSize: '14px',
                  }}
                />
              )}
            </div>
          </div>
        </Card>

        {/* Turtle Selection */}
        <Card style={{ marginBottom: '24px' }} title="Turtle Identification">
          {selectedTurtle ? (
            <div
              style={{
                padding: '16px',
                backgroundColor: 'var(--color-surface-elevated)',
                borderRadius: '8px',
                marginBottom: '16px',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <div style={{ fontSize: '18px', fontWeight: '600', marginBottom: '4px' }}>
                    {selectedTurtle.name}
                  </div>
                  <div style={{ fontSize: '14px', color: 'var(--color-text-secondary)' }}>
                    {selectedTurtle.species || 'Unknown species'}
                  </div>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setSelectedTurtle(null)}
                >
                  Change
                </Button>
              </div>
            </div>
          ) : (
            <div>
              <label
                style={{
                  display: 'block',
                  fontSize: '14px',
                  fontWeight: '500',
                  color: 'var(--color-text)',
                  marginBottom: '8px',
                }}
              >
                Search for Existing Turtle
              </label>
              <div style={{ display: 'flex', gap: '8px', marginBottom: '16px' }}>
                <input
                  type="text"
                  value={turtleSearch}
                  onChange={(e) => setTurtleSearch(e.target.value)}
                  onKeyPress={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      handleTurtleSearch();
                    }
                  }}
                  placeholder="Search by name or tag..."
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
                <Button
                  type="button"
                  variant="secondary"
                  onClick={handleTurtleSearch}
                  disabled={isSearching || !turtleSearch.trim()}
                >
                  {isSearching ? 'Searching...' : 'Search'}
                </Button>
              </div>

              {searchResults.length > 0 && (
                <div
                  style={{
                    border: '1px solid var(--color-border)',
                    borderRadius: '6px',
                    maxHeight: '200px',
                    overflowY: 'auto',
                  }}
                >
                  {searchResults.map((turtle) => (
                    <div
                      key={turtle.id}
                      onClick={() => handleSelectTurtle(turtle)}
                      style={{
                        padding: '12px',
                        borderBottom: '1px solid var(--color-border)',
                        cursor: 'pointer',
                        transition: 'background-color 0.2s',
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.backgroundColor = 'var(--color-surface-elevated)';
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.backgroundColor = 'transparent';
                      }}
                    >
                      <div style={{ fontWeight: '600' }}>{turtle.name}</div>
                      <div style={{ fontSize: '12px', color: 'var(--color-text-secondary)' }}>
                        {[turtle.lrf, turtle.rrf, turtle.rff, turtle.lff]
                          .filter(Boolean)
                          .join(' | ') || 'No tags'}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              <div
                style={{
                  marginTop: '16px',
                  padding: '12px',
                  backgroundColor: 'var(--color-surface)',
                  borderRadius: '6px',
                  fontSize: '13px',
                  color: 'var(--color-text-secondary)',
                }}
              >
                💡 Can't find the turtle? Enter tag values below to create a new record
              </div>
            </div>
          )}
        </Card>

        {/* Tag Tracking */}
        <Card style={{ marginBottom: '24px' }} title="Tag Tracking">
          <div style={{ marginBottom: '20px', fontSize: '13px', color: 'var(--color-text-secondary)' }}>
            {selectedTurtle
              ? 'Track what tags changed during this encounter. Previous tags are shown for reference.'
              : 'Enter tag values observed during this encounter. For new turtles, all tags will be marked as "new".'}
          </div>

          {/* Left Rear Flipper */}
          <div style={{ marginBottom: '24px', padding: '16px', backgroundColor: 'var(--color-surface)', borderRadius: '8px' }}>
            <h4 style={{ fontSize: '15px', fontWeight: '600', marginBottom: '12px' }}>
              Left Rear Flipper (LRF)
            </h4>
            <div style={{ display: 'grid', gridTemplateColumns: selectedTurtle ? '1fr 1fr 1fr' : '1fr', gap: '12px' }}>
              {selectedTurtle && (
                <div>
                  <label style={{ display: 'block', fontSize: '12px', marginBottom: '6px', color: 'var(--color-text-muted)' }}>
                    Previous Tag
                  </label>
                  <div
                    style={{
                      padding: '12px',
                      backgroundColor: 'var(--color-background)',
                      border: '1px solid var(--color-border)',
                      borderRadius: '6px',
                      color: previousLrf ? 'var(--color-text)' : 'var(--color-text-muted)',
                      fontSize: '14px',
                      fontFamily: 'monospace',
                    }}
                  >
                    {previousLrf || '(no tag)'}
                  </div>
                </div>
              )}
              <div>
                <label style={{ display: 'block', fontSize: '12px', marginBottom: '6px', fontWeight: '500' }}>
                  Current Tag (Observed)
                </label>
                <input
                  type="text"
                  value={currentLrf}
                  onChange={(e) => setCurrentLrf(e.target.value.toUpperCase())}
                  placeholder="e.g., ABC123"
                  style={{
                    width: '100%',
                    padding: '12px',
                    backgroundColor: 'var(--color-background)',
                    border: '1px solid var(--color-border)',
                    borderRadius: '6px',
                    color: 'var(--color-text)',
                    fontSize: '14px',
                    textTransform: 'uppercase',
                  }}
                />
              </div>
              {selectedTurtle && (
                <div>
                  <label style={{ display: 'block', fontSize: '12px', marginBottom: '6px', fontWeight: '500' }}>
                    What Changed?
                  </label>
                  <select
                    value={lrfChange}
                    onChange={(e) => setLrfChange(e.target.value)}
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
                    <option value="no_change">No change</option>
                    <option value="new">New tag applied</option>
                    <option value="fell_off">Tag fell off</option>
                    <option value="replaced">Tag replaced</option>
                  </select>
                </div>
              )}
            </div>
          </div>

          {/* Right Rear Flipper */}
          <div style={{ marginBottom: '24px', padding: '16px', backgroundColor: 'var(--color-surface)', borderRadius: '8px' }}>
            <h4 style={{ fontSize: '15px', fontWeight: '600', marginBottom: '12px' }}>
              Right Rear Flipper (RRF)
            </h4>
            <div style={{ display: 'grid', gridTemplateColumns: selectedTurtle ? '1fr 1fr 1fr' : '1fr', gap: '12px' }}>
              {selectedTurtle && (
                <div>
                  <label style={{ display: 'block', fontSize: '12px', marginBottom: '6px', color: 'var(--color-text-muted)' }}>
                    Previous Tag
                  </label>
                  <div
                    style={{
                      padding: '12px',
                      backgroundColor: 'var(--color-background)',
                      border: '1px solid var(--color-border)',
                      borderRadius: '6px',
                      color: previousRrf ? 'var(--color-text)' : 'var(--color-text-muted)',
                      fontSize: '14px',
                      fontFamily: 'monospace',
                    }}
                  >
                    {previousRrf || '(no tag)'}
                  </div>
                </div>
              )}
              <div>
                <label style={{ display: 'block', fontSize: '12px', marginBottom: '6px', fontWeight: '500' }}>
                  Current Tag (Observed)
                </label>
                <input
                  type="text"
                  value={currentRrf}
                  onChange={(e) => setCurrentRrf(e.target.value.toUpperCase())}
                  placeholder="e.g., DEF456"
                  style={{
                    width: '100%',
                    padding: '12px',
                    backgroundColor: 'var(--color-background)',
                    border: '1px solid var(--color-border)',
                    borderRadius: '6px',
                    color: 'var(--color-text)',
                    fontSize: '14px',
                    textTransform: 'uppercase',
                  }}
                />
              </div>
              {selectedTurtle && (
                <div>
                  <label style={{ display: 'block', fontSize: '12px', marginBottom: '6px', fontWeight: '500' }}>
                    What Changed?
                  </label>
                  <select
                    value={rrfChange}
                    onChange={(e) => setRrfChange(e.target.value)}
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
                    <option value="no_change">No change</option>
                    <option value="new">New tag applied</option>
                    <option value="fell_off">Tag fell off</option>
                    <option value="replaced">Tag replaced</option>
                  </select>
                </div>
              )}
            </div>
          </div>

          {/* Right Front Flipper */}
          <div style={{ marginBottom: '24px', padding: '16px', backgroundColor: 'var(--color-surface)', borderRadius: '8px' }}>
            <h4 style={{ fontSize: '15px', fontWeight: '600', marginBottom: '12px' }}>
              Right Front Flipper (RFF)
            </h4>
            <div style={{ display: 'grid', gridTemplateColumns: selectedTurtle ? '1fr 1fr 1fr' : '1fr', gap: '12px' }}>
              {selectedTurtle && (
                <div>
                  <label style={{ display: 'block', fontSize: '12px', marginBottom: '6px', color: 'var(--color-text-muted)' }}>
                    Previous Tag
                  </label>
                  <div
                    style={{
                      padding: '12px',
                      backgroundColor: 'var(--color-background)',
                      border: '1px solid var(--color-border)',
                      borderRadius: '6px',
                      color: previousRff ? 'var(--color-text)' : 'var(--color-text-muted)',
                      fontSize: '14px',
                      fontFamily: 'monospace',
                    }}
                  >
                    {previousRff || '(no tag)'}
                  </div>
                </div>
              )}
              <div>
                <label style={{ display: 'block', fontSize: '12px', marginBottom: '6px', fontWeight: '500' }}>
                  Current Tag (Observed)
                </label>
                <input
                  type="text"
                  value={currentRff}
                  onChange={(e) => setCurrentRff(e.target.value.toUpperCase())}
                  placeholder="e.g., GHI789"
                  style={{
                    width: '100%',
                    padding: '12px',
                    backgroundColor: 'var(--color-background)',
                    border: '1px solid var(--color-border)',
                    borderRadius: '6px',
                    color: 'var(--color-text)',
                    fontSize: '14px',
                    textTransform: 'uppercase',
                  }}
                />
              </div>
              {selectedTurtle && (
                <div>
                  <label style={{ display: 'block', fontSize: '12px', marginBottom: '6px', fontWeight: '500' }}>
                    What Changed?
                  </label>
                  <select
                    value={rffChange}
                    onChange={(e) => setRffChange(e.target.value)}
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
                    <option value="no_change">No change</option>
                    <option value="new">New tag applied</option>
                    <option value="fell_off">Tag fell off</option>
                    <option value="replaced">Tag replaced</option>
                  </select>
                </div>
              )}
            </div>
          </div>

          {/* Left Front Flipper */}
          <div style={{ padding: '16px', backgroundColor: 'var(--color-surface)', borderRadius: '8px' }}>
            <h4 style={{ fontSize: '15px', fontWeight: '600', marginBottom: '12px' }}>
              Left Front Flipper (LFF)
            </h4>
            <div style={{ display: 'grid', gridTemplateColumns: selectedTurtle ? '1fr 1fr 1fr' : '1fr', gap: '12px' }}>
              {selectedTurtle && (
                <div>
                  <label style={{ display: 'block', fontSize: '12px', marginBottom: '6px', color: 'var(--color-text-muted)' }}>
                    Previous Tag
                  </label>
                  <div
                    style={{
                      padding: '12px',
                      backgroundColor: 'var(--color-background)',
                      border: '1px solid var(--color-border)',
                      borderRadius: '6px',
                      color: previousLff ? 'var(--color-text)' : 'var(--color-text-muted)',
                      fontSize: '14px',
                      fontFamily: 'monospace',
                    }}
                  >
                    {previousLff || '(no tag)'}
                  </div>
                </div>
              )}
              <div>
                <label style={{ display: 'block', fontSize: '12px', marginBottom: '6px', fontWeight: '500' }}>
                  Current Tag (Observed)
                </label>
                <input
                  type="text"
                  value={currentLff}
                  onChange={(e) => setCurrentLff(e.target.value.toUpperCase())}
                  placeholder="e.g., JKL012"
                  style={{
                    width: '100%',
                    padding: '12px',
                    backgroundColor: 'var(--color-background)',
                    border: '1px solid var(--color-border)',
                    borderRadius: '6px',
                    color: 'var(--color-text)',
                    fontSize: '14px',
                    textTransform: 'uppercase',
                  }}
                />
              </div>
              {selectedTurtle && (
                <div>
                  <label style={{ display: 'block', fontSize: '12px', marginBottom: '6px', fontWeight: '500' }}>
                    What Changed?
                  </label>
                  <select
                    value={lffChange}
                    onChange={(e) => setLffChange(e.target.value)}
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
                    <option value="no_change">No change</option>
                    <option value="new">New tag applied</option>
                    <option value="fell_off">Tag fell off</option>
                    <option value="replaced">Tag replaced</option>
                  </select>
                </div>
              )}
            </div>
          </div>
        </Card>

        {/* Location */}
        <Card style={{ marginBottom: '24px' }} title="Location (Manual Entry)">
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))',
              gap: '20px',
            }}
          >
            <div>
              <label
                style={{
                  display: 'block',
                  fontSize: '14px',
                  fontWeight: '500',
                  color: 'var(--color-text)',
                  marginBottom: '8px',
                }}
              >
                Latitude *
              </label>
              <input
                type="number"
                step="0.000001"
                value={latitude}
                onChange={(e) => setLatitude(e.target.value)}
                placeholder="e.g., 26.123456"
                required
                style={{
                  width: '100%',
                  padding: '12px',
                  backgroundColor: 'var(--color-background)',
                  border: '1px solid var(--color-border)',
                  borderRadius: '6px',
                  color: 'var(--color-text)',
                  fontSize: '14px',
                }}
              />
            </div>

            <div>
              <label
                style={{
                  display: 'block',
                  fontSize: '14px',
                  fontWeight: '500',
                  color: 'var(--color-text)',
                  marginBottom: '8px',
                }}
              >
                Longitude *
              </label>
              <input
                type="number"
                step="0.000001"
                value={longitude}
                onChange={(e) => setLongitude(e.target.value)}
                placeholder="e.g., -80.123456"
                required
                style={{
                  width: '100%',
                  padding: '12px',
                  backgroundColor: 'var(--color-background)',
                  border: '1px solid var(--color-border)',
                  borderRadius: '6px',
                  color: 'var(--color-text)',
                  fontSize: '14px',
                }}
              />
            </div>
          </div>
        </Card>

        {/* Datasheet Photo */}
        <Card style={{ marginBottom: '24px' }} title="Datasheet Photo (Required)">
          <div>
            <label
              style={{
                display: 'block',
                fontSize: '14px',
                fontWeight: '500',
                color: 'var(--color-text)',
                marginBottom: '8px',
              }}
            >
              Upload Datasheet Photo *
            </label>
            <input
              type="file"
              accept="image/*"
              onChange={handleDatasheetPhotoChange}
              required
              style={{
                width: '100%',
                padding: '12px',
                backgroundColor: 'var(--color-background)',
                border: '1px solid var(--color-border)',
                borderRadius: '6px',
                color: 'var(--color-text)',
                fontSize: '14px',
              }}
            />
            {datasheetPreview && (
              <div style={{ marginTop: '16px' }}>
                <img
                  src={datasheetPreview}
                  alt="Datasheet preview"
                  style={{
                    maxWidth: '100%',
                    maxHeight: '400px',
                    borderRadius: '8px',
                    border: '1px solid var(--color-border)',
                  }}
                />
              </div>
            )}
          </div>
        </Card>

        {/* Nesting Information */}
        <Card style={{ marginBottom: '24px' }} title="Nesting Information">
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))',
              gap: '20px',
            }}
          >
            <div>
              <label
                style={{
                  display: 'block',
                  fontSize: '14px',
                  fontWeight: '500',
                  color: 'var(--color-text)',
                  marginBottom: '8px',
                }}
              >
                Did She Nest?
              </label>
              <select
                value={didSheNest}
                onChange={(e) => setDidSheNest(e.target.value)}
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
                <option value="unsure">Unsure</option>
                <option value="yes">Yes</option>
                <option value="no">No</option>
              </select>
            </div>

            {didSheNest === 'yes' && (
              <>
                <div>
                  <label
                    style={{
                      display: 'block',
                      fontSize: '14px',
                      fontWeight: '500',
                      color: 'var(--color-text)',
                      marginBottom: '8px',
                    }}
                  >
                    Egg Count
                  </label>
                  <input
                    type="number"
                    value={eggCount}
                    onChange={(e) => setEggCount(e.target.value)}
                    placeholder="Number of eggs"
                    style={{
                      width: '100%',
                      padding: '12px',
                      backgroundColor: 'var(--color-background)',
                      border: '1px solid var(--color-border)',
                      borderRadius: '6px',
                      color: 'var(--color-text)',
                      fontSize: '14px',
                    }}
                  />
                </div>

                <div>
                  <label
                    style={{
                      display: 'block',
                      fontSize: '14px',
                      fontWeight: '500',
                      color: 'var(--color-text)',
                      marginBottom: '8px',
                    }}
                  >
                    Nest Chamber Depth (cm)
                  </label>
                  <input
                    type="number"
                    step="0.1"
                    value={nestChamberDepth}
                    onChange={(e) => setNestChamberDepth(e.target.value)}
                    placeholder="Depth in centimeters"
                    style={{
                      width: '100%',
                      padding: '12px',
                      backgroundColor: 'var(--color-background)',
                      border: '1px solid var(--color-border)',
                      borderRadius: '6px',
                      color: 'var(--color-text)',
                      fontSize: '14px',
                    }}
                  />
                </div>
              </>
            )}
          </div>

          {/* Nesting Event Times */}
          {didSheNest === 'yes' && (
            <div style={{ marginTop: '24px' }}>
              <h3 style={{ fontSize: '16px', fontWeight: '600', marginBottom: '16px' }}>
                Nesting Event Times (Optional)
              </h3>
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
                  gap: '16px',
                }}
              >
                <div>
                  <label style={{ display: 'block', fontSize: '13px', marginBottom: '6px' }}>
                    Exit Water
                  </label>
                  <input
                    type="time"
                    value={exitWaterTime}
                    onChange={(e) => setExitWaterTime(e.target.value)}
                    style={{
                      width: '100%',
                      padding: '10px',
                      backgroundColor: 'var(--color-background)',
                      border: '1px solid var(--color-border)',
                      borderRadius: '6px',
                      color: 'var(--color-text)',
                      fontSize: '13px',
                    }}
                  />
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: '13px', marginBottom: '6px' }}>
                    Body Pit
                  </label>
                  <input
                    type="time"
                    value={bodyPitTime}
                    onChange={(e) => setBodyPitTime(e.target.value)}
                    style={{
                      width: '100%',
                      padding: '10px',
                      backgroundColor: 'var(--color-background)',
                      border: '1px solid var(--color-border)',
                      borderRadius: '6px',
                      color: 'var(--color-text)',
                      fontSize: '13px',
                    }}
                  />
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: '13px', marginBottom: '6px' }}>
                    Start Digging
                  </label>
                  <input
                    type="time"
                    value={startDiggingTime}
                    onChange={(e) => setStartDiggingTime(e.target.value)}
                    style={{
                      width: '100%',
                      padding: '10px',
                      backgroundColor: 'var(--color-background)',
                      border: '1px solid var(--color-border)',
                      borderRadius: '6px',
                      color: 'var(--color-text)',
                      fontSize: '13px',
                    }}
                  />
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: '13px', marginBottom: '6px' }}>
                    Laying Eggs
                  </label>
                  <input
                    type="time"
                    value={layingTime}
                    onChange={(e) => setLayingTime(e.target.value)}
                    style={{
                      width: '100%',
                      padding: '10px',
                      backgroundColor: 'var(--color-background)',
                      border: '1px solid var(--color-border)',
                      borderRadius: '6px',
                      color: 'var(--color-text)',
                      fontSize: '13px',
                    }}
                  />
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: '13px', marginBottom: '6px' }}>
                    Covering Nest
                  </label>
                  <input
                    type="time"
                    value={coveringTime}
                    onChange={(e) => setCoveringTime(e.target.value)}
                    style={{
                      width: '100%',
                      padding: '10px',
                      backgroundColor: 'var(--color-background)',
                      border: '1px solid var(--color-border)',
                      borderRadius: '6px',
                      color: 'var(--color-text)',
                      fontSize: '13px',
                    }}
                  />
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: '13px', marginBottom: '6px' }}>
                    Return to Sea
                  </label>
                  <input
                    type="time"
                    value={returnSeaTime}
                    onChange={(e) => setReturnSeaTime(e.target.value)}
                    style={{
                      width: '100%',
                      padding: '10px',
                      backgroundColor: 'var(--color-background)',
                      border: '1px solid var(--color-border)',
                      borderRadius: '6px',
                      color: 'var(--color-text)',
                      fontSize: '13px',
                    }}
                  />
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: '13px', marginBottom: '6px' }}>
                    Enter Water
                  </label>
                  <input
                    type="time"
                    value={enterWaterTime}
                    onChange={(e) => setEnterWaterTime(e.target.value)}
                    style={{
                      width: '100%',
                      padding: '10px',
                      backgroundColor: 'var(--color-background)',
                      border: '1px solid var(--color-border)',
                      borderRadius: '6px',
                      color: 'var(--color-text)',
                      fontSize: '13px',
                    }}
                  />
                </div>
              </div>
            </div>
          )}
        </Card>

        {/* Measurements - Curved Carapace */}
        <Card style={{ marginBottom: '24px' }} title="Measurements - Curved Carapace">
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
              gap: '20px',
            }}
          >
            <div>
              <label
                style={{
                  display: 'block',
                  fontSize: '14px',
                  fontWeight: '500',
                  color: 'var(--color-text)',
                  marginBottom: '8px',
                }}
              >
                Min Length (cm)
              </label>
              <input
                type="number"
                step="0.1"
                value={ccMinLength}
                onChange={(e) => setCcMinLength(e.target.value)}
                placeholder="e.g., 85.5"
                style={{
                  width: '100%',
                  padding: '12px',
                  backgroundColor: 'var(--color-background)',
                  border: '1px solid var(--color-border)',
                  borderRadius: '6px',
                  color: 'var(--color-text)',
                  fontSize: '14px',
                }}
              />
            </div>

            <div>
              <label
                style={{
                  display: 'block',
                  fontSize: '14px',
                  fontWeight: '500',
                  color: 'var(--color-text)',
                  marginBottom: '8px',
                }}
              >
                Max Length (cm)
              </label>
              <input
                type="number"
                step="0.1"
                value={ccMaxLength}
                onChange={(e) => setCcMaxLength(e.target.value)}
                placeholder="e.g., 88.2"
                style={{
                  width: '100%',
                  padding: '12px',
                  backgroundColor: 'var(--color-background)',
                  border: '1px solid var(--color-border)',
                  borderRadius: '6px',
                  color: 'var(--color-text)',
                  fontSize: '14px',
                }}
              />
            </div>

            <div>
              <label
                style={{
                  display: 'block',
                  fontSize: '14px',
                  fontWeight: '500',
                  color: 'var(--color-text)',
                  marginBottom: '8px',
                }}
              >
                Width (cm)
              </label>
              <input
                type="number"
                step="0.1"
                value={ccWidth}
                onChange={(e) => setCcWidth(e.target.value)}
                placeholder="e.g., 75.3"
                style={{
                  width: '100%',
                  padding: '12px',
                  backgroundColor: 'var(--color-background)',
                  border: '1px solid var(--color-border)',
                  borderRadius: '6px',
                  color: 'var(--color-text)',
                  fontSize: '14px',
                }}
              />
            </div>
          </div>
        </Card>

        {/* Injuries */}
        <Card style={{ marginBottom: '24px' }} title="Injuries">
          <div style={{ marginBottom: '16px' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={hasInjuries}
                onChange={(e) => setHasInjuries(e.target.checked)}
                style={{ width: '16px', height: '16px' }}
              />
              <span style={{ fontSize: '14px', fontWeight: '500' }}>Turtle has injuries</span>
            </label>
          </div>

          {hasInjuries && (
            <>
              <div style={{ marginBottom: '16px' }}>
                <label
                  style={{
                    display: 'block',
                    fontSize: '14px',
                    fontWeight: '500',
                    marginBottom: '8px',
                  }}
                >
                  Injury Locations
                </label>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                  {['Head', 'Neck', 'Front Left Flipper', 'Front Right Flipper', 'Rear Left Flipper', 'Rear Right Flipper', 'Carapace', 'Plastron', 'Tail'].map((location) => (
                    <label
                      key={location}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '6px',
                        padding: '8px 12px',
                        backgroundColor: injuryLocations.includes(location)
                          ? 'var(--color-primary)'
                          : 'var(--color-surface)',
                        border: '1px solid var(--color-border)',
                        borderRadius: '6px',
                        cursor: 'pointer',
                        fontSize: '13px',
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={injuryLocations.includes(location)}
                        onChange={() => toggleInjuryLocation(location)}
                        style={{ width: '14px', height: '14px' }}
                      />
                      {location}
                    </label>
                  ))}
                </div>
              </div>

              <div>
                <label
                  style={{
                    display: 'block',
                    fontSize: '14px',
                    fontWeight: '500',
                    marginBottom: '8px',
                  }}
                >
                  Injury Notes
                </label>
                <textarea
                  value={injuryNotes}
                  onChange={(e) => setInjuryNotes(e.target.value)}
                  placeholder="Describe injuries in detail..."
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
            </>
          )}
        </Card>

        {/* Samples */}
        <Card style={{ marginBottom: '24px' }} title="Samples Collected">
          <div style={{ marginBottom: '16px' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={hasSamples}
                onChange={(e) => setHasSamples(e.target.checked)}
                style={{ width: '16px', height: '16px' }}
              />
              <span style={{ fontSize: '14px', fontWeight: '500' }}>Samples were collected</span>
            </label>
          </div>

          {hasSamples && (
            <>
              <div style={{ marginBottom: '16px' }}>
                <label
                  style={{
                    display: 'block',
                    fontSize: '14px',
                    fontWeight: '500',
                    marginBottom: '8px',
                  }}
                >
                  Sample Types
                </label>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                  {['Blood', 'Tissue', 'Carapace Scute', 'Skin', 'DNA', 'Other'].map((type) => (
                    <label
                      key={type}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '6px',
                        padding: '8px 12px',
                        backgroundColor: sampleTypes.includes(type)
                          ? 'var(--color-primary)'
                          : 'var(--color-surface)',
                        border: '1px solid var(--color-border)',
                        borderRadius: '6px',
                        cursor: 'pointer',
                        fontSize: '13px',
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={sampleTypes.includes(type)}
                        onChange={() => toggleSampleType(type)}
                        style={{ width: '14px', height: '14px' }}
                      />
                      {type}
                    </label>
                  ))}
                </div>
              </div>

              <div>
                <label
                  style={{
                    display: 'block',
                    fontSize: '14px',
                    fontWeight: '500',
                    marginBottom: '8px',
                  }}
                >
                  Sample Notes
                </label>
                <textarea
                  value={sampleNotes}
                  onChange={(e) => setSampleNotes(e.target.value)}
                  placeholder="Sample collection details..."
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
                  }}
                />
              </div>
            </>
          )}
        </Card>

        {/* Additional Photos */}
        <Card style={{ marginBottom: '24px' }} title="Additional Photos (Optional)">
          <div style={{ display: 'grid', gap: '20px' }}>
            <div>
              <label
                style={{
                  display: 'block',
                  fontSize: '14px',
                  fontWeight: '500',
                  marginBottom: '8px',
                }}
              >
                Injury Photos
              </label>
              <input
                type="file"
                accept="image/*"
                multiple
                onChange={(e) => setInjuryPhotos(Array.from(e.target.files || []))}
                style={{
                  width: '100%',
                  padding: '12px',
                  backgroundColor: 'var(--color-background)',
                  border: '1px solid var(--color-border)',
                  borderRadius: '6px',
                  color: 'var(--color-text)',
                  fontSize: '14px',
                }}
              />
              {injuryPhotos.length > 0 && (
                <div style={{ marginTop: '8px', fontSize: '13px', color: 'var(--color-text-secondary)' }}>
                  {injuryPhotos.length} photo{injuryPhotos.length !== 1 ? 's' : ''} selected
                </div>
              )}
            </div>

            <div>
              <label
                style={{
                  display: 'block',
                  fontSize: '14px',
                  fontWeight: '500',
                  marginBottom: '8px',
                }}
              >
                Tag Photos
              </label>
              <input
                type="file"
                accept="image/*"
                multiple
                onChange={(e) => setTagPhotos(Array.from(e.target.files || []))}
                style={{
                  width: '100%',
                  padding: '12px',
                  backgroundColor: 'var(--color-background)',
                  border: '1px solid var(--color-border)',
                  borderRadius: '6px',
                  color: 'var(--color-text)',
                  fontSize: '14px',
                }}
              />
              {tagPhotos.length > 0 && (
                <div style={{ marginTop: '8px', fontSize: '13px', color: 'var(--color-text-secondary)' }}>
                  {tagPhotos.length} photo{tagPhotos.length !== 1 ? 's' : ''} selected
                </div>
              )}
            </div>

            <div>
              <label
                style={{
                  display: 'block',
                  fontSize: '14px',
                  fontWeight: '500',
                  marginBottom: '8px',
                }}
              >
                Turtle Photos
              </label>
              <input
                type="file"
                accept="image/*"
                multiple
                onChange={(e) => setTurtlePhotos(Array.from(e.target.files || []))}
                style={{
                  width: '100%',
                  padding: '12px',
                  backgroundColor: 'var(--color-background)',
                  border: '1px solid var(--color-border)',
                  borderRadius: '6px',
                  color: 'var(--color-text)',
                  fontSize: '14px',
                }}
              />
              {turtlePhotos.length > 0 && (
                <div style={{ marginTop: '8px', fontSize: '13px', color: 'var(--color-text-secondary)' }}>
                  {turtlePhotos.length} photo{turtlePhotos.length !== 1 ? 's' : ''} selected
                </div>
              )}
            </div>

            <div>
              <label
                style={{
                  display: 'block',
                  fontSize: '14px',
                  fontWeight: '500',
                  marginBottom: '8px',
                }}
              >
                Other Photos
              </label>
              <input
                type="file"
                accept="image/*"
                multiple
                onChange={(e) => setOtherPhotos(Array.from(e.target.files || []))}
                style={{
                  width: '100%',
                  padding: '12px',
                  backgroundColor: 'var(--color-background)',
                  border: '1px solid var(--color-border)',
                  borderRadius: '6px',
                  color: 'var(--color-text)',
                  fontSize: '14px',
                }}
              />
              {otherPhotos.length > 0 && (
                <div style={{ marginTop: '8px', fontSize: '13px', color: 'var(--color-text-secondary)' }}>
                  {otherPhotos.length} photo{otherPhotos.length !== 1 ? 's' : ''} selected
                </div>
              )}
            </div>
          </div>
        </Card>

        {/* Comments */}
        <Card style={{ marginBottom: '24px' }} title="Comments">
          <textarea
            value={comments}
            onChange={(e) => setComments(e.target.value)}
            placeholder="Additional notes or observations..."
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
        </Card>

        {/* Form Actions */}
        <div
          style={{
            display: 'flex',
            gap: '12px',
            justifyContent: 'flex-end',
            marginTop: '32px',
          }}
        >
          <Button
            type="button"
            variant="secondary"
            onClick={() => router.push('/dashboard/observations')}
          >
            Cancel
          </Button>
          <Button type="submit">Save Historical Observation</Button>
        </div>
      </form>
    </div>
  );
}
