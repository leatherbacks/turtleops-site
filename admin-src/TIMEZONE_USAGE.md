# Using Project Timezone in the Admin Console

## Overview

The project timezone is configured in **Project Configuration** but needs to be actively used when displaying dates. This ensures all users see times in the project's local timezone, regardless of where they are.

## Getting Project Timezone

### In Components

```typescript
import { useAuth } from '@/components/auth/AuthProvider';

function MyComponent() {
  const { organization } = useAuth();

  // Get timezone from organization config
  const timezone = organization?.timezone || 'America/New_York';

  // Use it with datetime utilities
  const formatted = formatDateTimeWithTimezone(observation.encounter_date, timezone);
}
```

### Fetch from Database

```typescript
const { data: projectConfig } = await supabase
  .from('project_config')
  .select('timezone')
  .eq('org_id', orgId)
  .single();

const timezone = projectConfig?.timezone || 'America/New_York';
```

## Using Datetime Utilities

### Import the Utilities

```typescript
import {
  formatDateWithTimezone,
  formatDateTimeWithTimezone,
  formatTimeWithTimezone,
  getTimezoneAbbreviation,
  formatDateRange,
  isNestingHours,
  formatRelativeTime,
} from '@/lib/utils/datetime';
```

### Format Full Date and Time

```typescript
// Input: 2025-01-15T02:30:00Z (stored in database as UTC)
// Output: "Jan 15, 2025, 9:30 PM EST"

const formatted = formatDateTimeWithTimezone(
  observation.encounter_date,
  timezone
);
```

### Format Just the Date

```typescript
// Input: 2025-01-15T02:30:00Z
// Output: "Jan 15, 2025"

const formatted = formatDateWithTimezone(
  observation.encounter_date,
  timezone
);
```

### Format Just the Time

```typescript
// Input: 2025-01-15T02:30:00Z
// Output: "9:30 PM EST"

const formatted = formatTimeWithTimezone(
  observation.encounter_date,
  timezone
);
```

### Get Timezone Abbreviation

```typescript
// Returns "EST" or "EDT" depending on date
const abbr = getTimezoneAbbreviation(timezone);
// Use in UI: `Times shown in ${abbr}`
```

### Check if During Nesting Hours

```typescript
// Turtle nesting typically happens 7 PM - 6 AM
if (isNestingHours(observation.encounter_date, timezone)) {
  console.log('Observation during typical nesting hours');
}
```

### Format Relative Time

```typescript
// Recent: "2 hours ago", "yesterday"
// Older: "Jan 15, 2025"

const formatted = formatRelativeTime(
  observation.created_at,
  timezone
);
```

## Example: Update Observations Page

**Before:**
```typescript
// observations/page.tsx
const formatDate = (date: Date | string) => {
  const d = typeof date === 'string' ? new Date(date) : date;
  return d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
};
```

**After:**
```typescript
import { formatDateTimeWithTimezone } from '@/lib/utils/datetime';
import { useAuth } from '@/components/auth/AuthProvider';

function ObservationsPage() {
  const { organization } = useAuth();
  const timezone = organization?.timezone || 'America/New_York';

  const formatDate = (date: Date | string) => {
    return formatDateTimeWithTimezone(date, timezone);
  };

  // In JSX:
  <div>{formatDate(obs.encounter_date)}</div>
  // Shows: "Jan 15, 2025, 9:30 PM EST"
}
```

## Example: Historical Observation Form

When displaying entered datetime back to user:

```typescript
// new-historical/page.tsx
import { formatDateTimeWithTimezone } from '@/lib/utils/datetime';

// In form submission or preview:
const previewDate = formatDateTimeWithTimezone(
  new Date(encounterDateTime),
  projectConfig.timezone
);

console.log(`Saving observation for ${previewDate}`);
// Output: "Saving observation for Jan 15, 2025, 9:30 PM EST"
```

## Why This Matters

### Without Timezone Handling
```typescript
// User in California viewing Florida data
const date = new Date('2025-01-15T02:30:00Z');
console.log(date.toLocaleString());
// Shows: "Jan 14, 2025, 6:30 PM PST" ❌ Wrong! Shifted 3 hours
```

### With Timezone Handling
```typescript
const date = new Date('2025-01-15T02:30:00Z');
console.log(formatDateTimeWithTimezone(date, 'America/New_York'));
// Shows: "Jan 15, 2025, 9:30 PM EST" ✓ Correct!
```

## Best Practices

1. **Always use project timezone for observation dates**
   - Observations happen in the field at the project location
   - Display should match what happened on the ground

2. **Use browser timezone for system timestamps**
   - User actions (logins, edits) can use browser timezone
   - Makes sense to show "You logged in 2 hours ago"

3. **Show timezone abbreviation in UI**
   ```typescript
   <div>All times shown in {getTimezoneAbbreviation(timezone)}</div>
   ```

4. **Handle DST transitions**
   - Use IANA timezone names (e.g., "America/New_York")
   - JavaScript automatically handles EST ↔ EDT transitions
   - Don't hardcode "EST" - use timezone abbreviation helper

5. **Test across timezones**
   - Open browser DevTools → Console
   - Temporarily set different timezone:
     ```javascript
     // Won't actually change system, but can test formatting
     Intl.DateTimeFormat().resolvedOptions().timeZone
     ```

## Configuration Status

| System | Has Config | Has UI | Uses in Display |
|--------|-----------|---------|-----------------|
| Mobile App | ✅ Yes | ✅ Yes | ⚠️ Partial |
| Admin Console | ✅ Yes | ✅ Yes | ⚠️ **Needs Update** |
| Database | ✅ Yes (UTC) | N/A | N/A |

## Next Steps

1. **Update observations page** to use `formatDateTimeWithTimezone()`
2. **Update historical form** to show preview with timezone
3. **Add timezone indicator** to observation list header
4. **Test** with observations across different seasons (EST vs EDT)

## Migration from Old Code

Search for these patterns and replace:

```typescript
// ❌ Old way
date.toLocaleDateString()
date.toLocaleString()
new Date().toString()

// ✅ New way
formatDateWithTimezone(date, timezone)
formatDateTimeWithTimezone(date, timezone)
formatTimeWithTimezone(date, timezone)
```

Keep the imports at the top:
```typescript
import { formatDateTimeWithTimezone } from '@/lib/utils/datetime';
import { useAuth } from '@/components/auth/AuthProvider';

const { organization } = useAuth();
const timezone = organization?.timezone || 'America/New_York';
```
