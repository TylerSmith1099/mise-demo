-- 021_venue_address.sql
-- Adds a physical street address to venues for pre-filling emergency call
-- dispatcher scripts (first-aid gate, MIS-391). Nullable — existing venues
-- that have not yet supplied an address will show a fallback prompt.
--
-- DOWN: ALTER TABLE venues DROP COLUMN IF EXISTS venue_address;

-- UP
ALTER TABLE venues ADD COLUMN IF NOT EXISTS venue_address TEXT;
