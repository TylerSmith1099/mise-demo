-- =============================================================================
-- Migration 039 — RLS policies for run sheet rebuild tables (MIS-639)
--
-- Applies row-level security to all tables added in migration 038.
-- Policy pattern matches existing tables: SELECT/INSERT/UPDATE for mise_app,
-- scoped by app.current_client_id.
-- =============================================================================

SET timezone = 'UTC';

DO $$
DECLARE
  tables TEXT[] := ARRAY[
    'venue_calendar',
    'weather_cache',
    'compliance_acknowledgements',
    'sports_events',
    'venue_screens',
    'chef_specials',
    'eighty_six_items',
    'shift_incentives',
    'incentive_scores',
    'roster_breaks',
    'shift_priorities',
    'shift_handover_notes',
    'venue_roles',
    'revenue_daily_budgets'
  ];
  tbl TEXT;
BEGIN
  FOREACH tbl IN ARRAY tables LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', tbl);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', tbl);

    EXECUTE format(
      $pol$
      CREATE POLICY %I ON %I
        FOR SELECT TO mise_app
        USING (client_id = current_setting('app.current_client_id', true)::uuid)
      $pol$,
      tbl || '_select', tbl
    );

    EXECUTE format(
      $pol$
      CREATE POLICY %I ON %I
        FOR INSERT TO mise_app
        WITH CHECK (client_id = current_setting('app.current_client_id', true)::uuid)
      $pol$,
      tbl || '_insert', tbl
    );

    EXECUTE format(
      $pol$
      CREATE POLICY %I ON %I
        FOR UPDATE TO mise_app
        USING (client_id = current_setting('app.current_client_id', true)::uuid)
      $pol$,
      tbl || '_update', tbl
    );
  END LOOP;
END;
$$;

DO $$
DECLARE
  tables TEXT[] := ARRAY[
    'venue_calendar',
    'weather_cache',
    'compliance_acknowledgements',
    'sports_events',
    'venue_screens',
    'chef_specials',
    'eighty_six_items',
    'shift_incentives',
    'incentive_scores',
    'roster_breaks',
    'shift_priorities',
    'shift_handover_notes',
    'venue_roles',
    'revenue_daily_budgets'
  ];
  tbl TEXT;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'mise_app') THEN
    FOREACH tbl IN ARRAY tables LOOP
      EXECUTE format('GRANT SELECT, INSERT, UPDATE ON %I TO mise_app', tbl);
    END LOOP;
  END IF;
END;
$$;

-- =============================================================================
-- ROLLBACK
-- -----------------------------------------------------------------------------
-- BEGIN;
-- -- DROP POLICY IF EXISTS venue_calendar_select ON venue_calendar; (repeat for all)
-- -- ALTER TABLE venue_calendar DISABLE ROW LEVEL SECURITY; (repeat for all)
-- COMMIT;
-- =============================================================================
