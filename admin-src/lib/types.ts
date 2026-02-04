// TypeScript types for TurtleOps Admin Console
// Ported from mobile app lib/supabase.ts

export interface Organization {
  id: string;
  name: string;
  slug: string;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface OrgInviteCode {
  id: string;
  org_id: string;
  code: string;
  role: 'volunteer' | 'coordinator' | 'admin';
  uses_remaining: number | null;
  expires_at: string | null;
  created_by: string | null;
  created_at: string;
}

export interface Profile {
  id: string;
  full_name: string;
  role: 'volunteer' | 'coordinator' | 'admin';
  is_subscriber: boolean;
  org_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface StoredWeatherConditions {
  atvComfortScore: number;
  buggyIndex: number;
  temperature: number;
  windSpeed: string;
  windDirection: string;
  waveHeight: number | null;
  tideStatus: string | null;
  moonPhase: string;
  moonIllumination: number;
  summary: string;
  recommendation: string;
  timestamp: number;
}

export interface ObservationWeatherConditions {
  temperature: number;
  conditions: string;
  windSpeed: string;
  windDirection: string;
  waveHeight: number | null;
  waveHeightMeters: number | null;
  wavePeriod: number | null;
  waveDirection: string | null;
  tideStatus: string | null;
  tideNextType: string | null;
  tideNextTime: string | null;
  tideNextHeight: number | null;
  moonPhase: string | null;
  moonIllumination: number | null;
  moonAltitude: number | null;
  moonIsVisible: boolean | null;
  timestamp: number;
  collectionStatus: 'success' | 'partial' | 'failed';
  errors?: string[];
}

export interface SurveySession {
  id: string;
  org_id: string;
  surveyor_id: string | null;
  surveyor_name: string;
  check_in_time: string;
  check_out_time: string | null;
  duration_minutes: number | null;
  location_lat: number | null;
  location_lon: number | null;
  notes: string | null;
  weather_conditions: string | null;
  created_at: string;
}

export interface SurveyorNote {
  id: string;
  org_id: string;
  created_at: string;
  created_by: string | null;
  created_by_name: string;
  message: string;
  priority: 'normal' | 'important' | 'urgent';
  acknowledged_by: string[];
  expires_at: string | null;
  is_active: boolean;
  session_id: string | null;
  updated_at: string;
}

export interface Turtle {
  id: string;
  org_id: string;
  name: string;
  species: string | null;
  lrf: string | null;
  rrf: string | null;
  rff: string | null;
  lff: string | null;
  suggested_name: string | null;
  suggested_by: string | null;
  suggested_by_name: string | null;
  suggested_at: string | null;
  needs_research: boolean | null;
  research_flagged_by: string | null;
  research_flagged_by_name: string | null;
  research_flagged_at: string | null;
  research_notes: string | null;
  research_resolved_at: string | null;
  research_resolved_by: string | null;
  first_encountered_at: string;
  last_encountered_at: string;
  encounter_count: number;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface Observation {
  id: string;
  org_id: string;
  turtle_id: string;
  turtle_name: string | null;
  encounter_date: string;
  observer: string | null;
  observer_name: string;
  latitude: number | null;
  longitude: number | null;
  location_accuracy: number | null;
  beach_sector: string | null;
  weather: string | null;
  temperature: number | null;
  tide_stage: string | null;
  did_she_nest: boolean | null;
  egg_count: number | null;
  chamber_depth: number | null;
  tag_lrf: string | null;
  tag_rrf: string | null;
  tag_rff: string | null;
  tag_lff: string | null;
  is_recapture: boolean;
  comments: string | null;
  session_id: string | null;
  sync_status: 'local' | 'synced' | 'conflict';
  weather_conditions: string | null;
  created_at: string;
  updated_at: string;
}

export interface Photo {
  id: string;
  org_id: string;
  observation_id: string;
  photo_type: 'injury' | 'datasheet' | 'tags' | 'turtle' | 'other' | null;
  local_uri: string | null;
  remote_url: string | null;
  caption: string | null;
  sync_status: 'local' | 'synced' | 'uploading' | 'failed';
  created_at: string;
  uploaded_at: string | null;
}

export interface Injury {
  id: string;
  org_id: string;
  observation_id: string;
  turtle_id: string;
  injury_type:
    | 'propeller'
    | 'boat_strike'
    | 'shark_bite'
    | 'fishing_line'
    | 'fishing_hook'
    | 'net_entanglement'
    | 'missing_flipper'
    | 'carapace_damage'
    | 'fibropapilloma'
    | 'barnacle_infestation'
    | 'other';
  body_location:
    | 'head'
    | 'neck'
    | 'carapace_anterior'
    | 'carapace_posterior'
    | 'carapace_left'
    | 'carapace_right'
    | 'plastron'
    | 'left_front_flipper'
    | 'right_front_flipper'
    | 'left_rear_flipper'
    | 'right_rear_flipper'
    | 'tail'
    | 'multiple'
    | null;
  severity: 'minor' | 'moderate' | 'severe' | 'critical';
  healing_status: 'fresh' | 'healing' | 'healed' | 'old_scar' | 'infected';
  description: string | null;
  length_cm: number | null;
  width_cm: number | null;
  depth_cm: number | null;
  created_at: string;
  updated_at: string;
}

export interface TagHistory {
  id: string;
  org_id: string;
  turtle_id: string;
  observation_id: string;
  encounter_date: string;
  lrf: string | null;
  rrf: string | null;
  rff: string | null;
  lff: string | null;
  observer_id: string | null;
  observer_name: string;
  notes: string | null;
  created_at: string;
}

export interface TurtleAlert {
  id: string;
  org_id: string;
  turtle_id: string;
  alert_type: 'named_by' | 'health_note' | 'custom';
  priority: 'low' | 'normal' | 'high';
  message: string;
  is_active: boolean;
  created_by: string | null;
  created_by_name: string | null;
  created_at: string;
  updated_at: string;
}

export interface ProjectConfig {
  id: string;
  org_id: string;
  organization_name: string;
  coordinator_name: string;
  coordinator_email: string;
  coordinator_phone: string;
  emergency_contact: string | null;
  beach_name: string;
  beach_latitude: string | null;
  beach_longitude: string | null;
  timezone: string;
  primary_species: string;
  active_species: string[];
  season_start_month: number;
  season_start_day: number;
  season_end_month: number;
  season_end_day: number;
  current_season_year: number;
  required_photo_types: string[];
  require_measurements: boolean;
  injury_diagram_type: 'leatherback' | 'hardshell';
  pit_tag_pattern: string;
  created_at: string;
  updated_at: string;
}

// Database interface for Supabase TypeScript support
export interface Database {
  public: {
    Tables: {
      organizations: {
        Row: Organization;
        Insert: {
          name: string;
          slug: string;
          created_by?: string | null;
        };
        Update: Partial<Omit<Organization, 'id' | 'created_at'>>;
      };
      org_invite_codes: {
        Row: OrgInviteCode;
        Insert: {
          org_id: string;
          code: string;
          role?: 'volunteer' | 'coordinator' | 'admin';
          uses_remaining?: number | null;
          expires_at?: string | null;
          created_by?: string | null;
        };
        Update: Partial<Omit<OrgInviteCode, 'id' | 'created_at'>>;
      };
      profiles: {
        Row: Profile;
        Insert: {
          id: string;
          full_name: string;
          role: 'volunteer' | 'coordinator' | 'admin';
          is_subscriber?: boolean;
          org_id?: string | null;
        };
        Update: Partial<Omit<Profile, 'id' | 'created_at'>>;
      };
      survey_sessions: {
        Row: SurveySession;
        Insert: {
          org_id: string;
          surveyor_name: string;
          check_in_time: string;
          surveyor_id?: string | null;
          check_out_time?: string | null;
          duration_minutes?: number | null;
          location_lat?: number | null;
          location_lon?: number | null;
          notes?: string | null;
          weather_conditions?: string | null;
        };
        Update: Partial<Omit<SurveySession, 'id' | 'created_at'>>;
      };
      surveyor_notes: {
        Row: SurveyorNote;
        Insert: {
          org_id: string;
          created_by_name: string;
          message: string;
          priority: 'normal' | 'important' | 'urgent';
          is_active: boolean;
          created_by?: string | null;
          acknowledged_by?: string[];
          expires_at?: string | null;
          session_id?: string | null;
        };
        Update: Partial<Omit<SurveyorNote, 'id' | 'created_at'>>;
      };
      turtles: {
        Row: Turtle;
        Insert: {
          org_id: string;
          name: string;
          first_encountered_at: string;
          last_encountered_at: string;
          lrf?: string | null;
          rrf?: string | null;
          rff?: string | null;
          lff?: string | null;
          suggested_name?: string | null;
          suggested_by?: string | null;
          suggested_by_name?: string | null;
          suggested_at?: string | null;
          encounter_count?: number;
          created_by?: string | null;
        };
        Update: Partial<Omit<Turtle, 'id' | 'created_at'>>;
      };
      observations: {
        Row: Observation;
        Insert: {
          org_id: string;
          turtle_id: string;
          turtle_name?: string | null;
          encounter_date: string;
          observer_name: string;
          observer?: string | null;
          latitude?: number | null;
          longitude?: number | null;
          location_accuracy?: number | null;
          beach_sector?: string | null;
          weather?: string | null;
          temperature?: number | null;
          tide_stage?: string | null;
          weather_conditions?: string | null;
          did_she_nest?: boolean | null;
          egg_count?: number | null;
          chamber_depth?: number | null;
          tag_lrf?: string | null;
          tag_rrf?: string | null;
          tag_rff?: string | null;
          tag_lff?: string | null;
          is_recapture?: boolean;
          is_submitted?: boolean;
          submitted_at?: string | null;
          comments?: string | null;
          session_id?: string | null;
          sync_status?: 'local' | 'synced' | 'conflict';
        };
        Update: Partial<Omit<Observation, 'id' | 'created_at'>>;
      };
      photos: {
        Row: Photo;
        Insert: {
          org_id: string;
          observation_id: string;
          photo_type?: 'injury' | 'datasheet' | 'tags' | 'turtle' | 'other' | null;
          local_uri?: string | null;
          remote_url?: string | null;
          caption?: string | null;
          sync_status?: 'local' | 'synced' | 'uploading' | 'failed';
        };
        Update: Partial<Omit<Photo, 'id' | 'created_at'>>;
      };
      injuries: {
        Row: Injury;
        Insert: {
          org_id: string;
          observation_id: string;
          turtle_id: string;
          injury_type: Injury['injury_type'];
          severity: 'minor' | 'moderate' | 'severe' | 'critical';
          healing_status: 'fresh' | 'healing' | 'healed' | 'old_scar' | 'infected';
          body_location?: Injury['body_location'];
          description?: string | null;
          length_cm?: number | null;
          width_cm?: number | null;
          depth_cm?: number | null;
        };
        Update: Partial<Omit<Injury, 'id' | 'created_at'>>;
      };
      tag_history: {
        Row: TagHistory;
        Insert: {
          org_id: string;
          turtle_id: string;
          observation_id: string;
          encounter_date: string;
          observer_name: string;
          lrf?: string | null;
          rrf?: string | null;
          rff?: string | null;
          lff?: string | null;
          observer_id?: string | null;
          notes?: string | null;
        };
        Update: Partial<Omit<TagHistory, 'id' | 'created_at'>>;
      };
    };
    Functions: {
      acknowledge_note: {
        Args: { note_id: string; user_id: string };
        Returns: boolean;
      };
      get_active_notes: {
        Args: Record<string, never>;
        Returns: {
          id: string;
          created_at: string;
          created_by_name: string;
          message: string;
          priority: string;
          acknowledged_count: number;
          expires_at: string | null;
          is_acknowledged_by_me: boolean;
        }[];
      };
      find_turtle_by_tag: {
        Args: { tag: string };
        Returns: {
          id: string;
          name: string;
          lrf: string | null;
          rrf: string | null;
          rff: string | null;
          lff: string | null;
          encounter_count: number;
        }[];
      };
      get_turtle_encounters: {
        Args: { turtle_uuid: string };
        Returns: {
          id: string;
          encounter_date: string;
          observer_name: string;
          did_she_nest: boolean | null;
          egg_count: number | null;
          beach_sector: string | null;
          comments: string | null;
        }[];
      };
      get_recent_observations: {
        Args: { limit_count?: number };
        Returns: {
          id: string;
          turtle_name: string;
          encounter_date: string;
          observer_name: string;
          did_she_nest: boolean | null;
          is_recapture: boolean;
          beach_sector: string | null;
        }[];
      };
      get_turtle_stats: {
        Args: Record<string, never>;
        Returns: {
          total_turtles: number;
          total_observations: number;
          turtles_this_year: number;
          observations_last_24h: number;
          nesting_count: number;
        }[];
      };
      create_organization: {
        Args: { org_name: string; org_slug: string };
        Returns: {
          success: boolean;
          organization_id: string | null;
          error_message: string | null;
        }[];
      };
      join_organization: {
        Args: { invite_code: string };
        Returns: {
          success: boolean;
          organization_id: string | null;
          org_name: string | null;
          error_message: string | null;
        }[];
      };
      use_invite_code: {
        Args: { invite_code: string };
        Returns: {
          success: boolean;
          organization_id: string | null;
          org_name: string | null;
          assigned_role: string | null;
          error_message: string | null;
        }[];
      };
      get_my_org_id: {
        Args: Record<string, never>;
        Returns: string | null;
      };
    };
  };
}
