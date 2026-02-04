#!/bin/bash
# Fix snake_case properties in observations pages

# List of replacements (camelCase -> snake_case)
sed -i '
s/\.turtleName/\.turtle_name/g
s/\.encounterDate/\.encounter_date/g
s/\.observerName/\.observer_name/g
s/\.beachSector/\.beach_sector/g
s/\.didSheNest/\.did_she_nest/g
s/\.eggCount/\.egg_count/g
s/\.chamberDepth/\.chamber_depth/g
s/\.tagLrf/\.tag_lrf/g
s/\.tagRrf/\.tag_rrf/g
s/\.tagRff/\.tag_rff/g
s/\.tagLff/\.tag_lff/g
s/\.isRecapture/\.is_recapture/g
s/\.syncStatus/\.sync_status/g
s/\.tideStage/\.tide_stage/g
s/\.locationAccuracy/\.location_accuracy/g
s/\.createdAt/\.created_at/g
s/\.updatedAt/\.updated_at/g
s/\.sessionId/\.session_id/g
' app/dashboard/observations/page.tsx app/dashboard/observations/[id]/page.tsx
