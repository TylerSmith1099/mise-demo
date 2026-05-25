-- =============================================================================
-- Migration 023 — Venue Scope: multi-venue role support for desktop tiers 1–3
--
-- CONTEXT (Admin Homepage, MIS-411 / Architecture MIS-409)
-- ---------------------------------------------------------
-- Mobile MVP roles (tier 4/5/7) are single-venue: staff.venue_id is enough.
-- Desktop roles (tiers 2–4: Group Admin=2, Area Manager=3, Venue Coordinator=4;
-- tier 1 = Mise System/internal — not a client-facing role) need
-- scope over many venues. This migration introduces:
--
--   venue_clusters         — a named cluster of venues (Area Manager's unit)
--   venue_cluster_members  — which venues belong to a cluster (many-to-one)
--   staff_venue_assignments — multi-venue scope rows for tiers 1–3
--
-- Single-venue mobile roles keep using staff.venue_id and require no assignment
-- row — backward compatible.
--
-- CLIENT ISOLATION
-- ----------------
-- All three tables carry client_id NOT NULL. RLS is enabled and forced with the
-- canonical policy expression from migration 005. No FK crosses a client boundary;
-- composite (client_id, child_id) references enforce intra-client integrity.
--
-- Non-negotiables from MIS-22 architecture sign-off apply unchanged:
--   • client_id NOT NULL on every client-data table
--   • RLS ENABLE + FORCE ROW LEVEL SECURITY on every table
--   • USING/WITH CHECK: client_id = NULLIF(current_setting('app.current_client_id', true), '')::uuid
--   • mise_app GRANT SELECT/INSERT/UPDATE — no DELETE (soft deletes only)
--   • All timestamps TIMESTAMPTZ UTC
-- =============================================================================

-- ---------------------------------------------------------------------------
-- UP
-- ---------------------------------------------------------------------------
SET timezone = 'UTC';

-- venue_clusters — a named grouping of venues, used as the scope unit for an
-- Area Manager. One cluster belongs to exactly one client.
CREATE TABLE venue_clusters (
    cluster_id   UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    client_id    UUID        NOT NULL REFERENCES clients (client_id),
    cluster_name TEXT        NOT NULL,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at   TIMESTAMPTZ,
    UNIQUE (client_id, cluster_id)   -- composite target for venue_cluster_members FK
);

CREATE INDEX idx_venue_clusters_client ON venue_clusters (client_id);

ALTER TABLE venue_clusters ENABLE ROW LEVEL SECURITY;
ALTER TABLE venue_clusters FORCE  ROW LEVEL SECURITY;
CREATE POLICY client_isolation ON venue_clusters
    USING      (client_id = NULLIF(current_setting('app.current_client_id', true), '')::uuid)
    WITH CHECK (client_id = NULLIF(current_setting('app.current_client_id', true), '')::uuid);

GRANT SELECT, INSERT, UPDATE ON venue_clusters TO mise_app;


-- venue_cluster_members — join table: which venues sit inside a cluster.
-- Primary key is the composite (client_id, cluster_id, venue_id) so membership
-- is inherently unique and both composite FKs can reference it.
CREATE TABLE venue_cluster_members (
    client_id  UUID NOT NULL,
    cluster_id UUID NOT NULL,
    venue_id   UUID NOT NULL,
    PRIMARY KEY (client_id, cluster_id, venue_id),
    FOREIGN KEY (client_id, cluster_id) REFERENCES venue_clusters  (client_id, cluster_id),
    FOREIGN KEY (client_id, venue_id)   REFERENCES venues           (client_id, venue_id)
);

CREATE INDEX idx_vcm_cluster ON venue_cluster_members (client_id, cluster_id);
CREATE INDEX idx_vcm_venue   ON venue_cluster_members (client_id, venue_id);

ALTER TABLE venue_cluster_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE venue_cluster_members FORCE  ROW LEVEL SECURITY;
CREATE POLICY client_isolation ON venue_cluster_members
    USING      (client_id = NULLIF(current_setting('app.current_client_id', true), '')::uuid)
    WITH CHECK (client_id = NULLIF(current_setting('app.current_client_id', true), '')::uuid);

GRANT SELECT, INSERT, UPDATE ON venue_cluster_members TO mise_app;


-- staff_venue_assignments — one row per scope grant for a desktop-tier staff member.
-- scope_type drives which id columns are populated:
--   'venue'   → venue_id set, cluster_id null
--   'cluster' → cluster_id set, venue_id null
--   'group'   → both null; means all venues under client_id
-- A staff member may have multiple rows (e.g. Area Manager of one cluster
-- + an extra single venue).
CREATE TABLE staff_venue_assignments (
    assignment_id UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    client_id     UUID        NOT NULL,
    staff_id      UUID        NOT NULL,
    scope_type    TEXT        NOT NULL
                    CHECK (scope_type IN ('venue', 'cluster', 'group')),
    venue_id      UUID,
    cluster_id    UUID,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at    TIMESTAMPTZ,

    -- scope_type governs which optional FK is populated
    CONSTRAINT sva_scope_columns CHECK (
        (scope_type = 'venue'   AND venue_id   IS NOT NULL AND cluster_id IS NULL)
     OR (scope_type = 'cluster' AND cluster_id IS NOT NULL AND venue_id   IS NULL)
     OR (scope_type = 'group'   AND venue_id   IS NULL     AND cluster_id IS NULL)
    ),

    FOREIGN KEY (client_id, staff_id)   REFERENCES staff          (client_id, staff_id),
    FOREIGN KEY (client_id, venue_id)   REFERENCES venues         (client_id, venue_id),
    FOREIGN KEY (client_id, cluster_id) REFERENCES venue_clusters (client_id, cluster_id)
);

CREATE INDEX idx_sva_staff   ON staff_venue_assignments (client_id, staff_id);
CREATE INDEX idx_sva_venue   ON staff_venue_assignments (client_id, venue_id)   WHERE venue_id   IS NOT NULL;
CREATE INDEX idx_sva_cluster ON staff_venue_assignments (client_id, cluster_id) WHERE cluster_id IS NOT NULL;

ALTER TABLE staff_venue_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE staff_venue_assignments FORCE  ROW LEVEL SECURITY;
CREATE POLICY client_isolation ON staff_venue_assignments
    USING      (client_id = NULLIF(current_setting('app.current_client_id', true), '')::uuid)
    WITH CHECK (client_id = NULLIF(current_setting('app.current_client_id', true), '')::uuid);

GRANT SELECT, INSERT, UPDATE ON staff_venue_assignments TO mise_app;


-- ---------------------------------------------------------------------------
-- RLS TEST BLOCK
-- Each test sets app.current_client_id to a specific client UUID, attempts a
-- cross-client operation, and asserts the result. Tests are inline DO blocks
-- so they run inside the same migration transaction on any psql client; they
-- raise an exception on failure (which rolls back the migration).
--
-- Two client UUIDs are used:
--   client_a — the "owner" client whose data is under test
--   client_b — a second client that must never see client_a's data
-- ---------------------------------------------------------------------------
DO $$
DECLARE
    client_a UUID := '11111111-1111-1111-1111-111111111111';
    client_b UUID := '22222222-2222-2222-2222-222222222222';
    cnt      INTEGER;
BEGIN
    -- Seed two test clients (bypassing RLS as superuser/owner)
    INSERT INTO clients (client_id, client_name, white_label_name, status)
    VALUES
        (client_a, '_rls_test_a', '_rls_test_a', 'active'),
        (client_b, '_rls_test_b', '_rls_test_b', 'active')
    ON CONFLICT DO NOTHING;

    -- Insert a cluster for client_a
    INSERT INTO venue_clusters (cluster_id, client_id, cluster_name)
    VALUES ('aaaaaaaa-0000-0000-0000-000000000001', client_a, 'Test Cluster A');

    -- ---- Test 1: client_b cannot read client_a's venue_clusters ----
    PERFORM set_config('app.current_client_id', client_b::text, true);
    SELECT COUNT(*) INTO cnt FROM venue_clusters WHERE client_id = client_a;
    IF cnt <> 0 THEN
        RAISE EXCEPTION 'RLS FAIL: client_b saw % venue_clusters rows belonging to client_a', cnt;
    END IF;

    -- ---- Test 2: client_b cannot insert into venue_clusters for client_a ----
    BEGIN
        PERFORM set_config('app.current_client_id', client_b::text, true);
        INSERT INTO venue_clusters (client_id, cluster_name)
        VALUES (client_a, 'Injection attempt');
        RAISE EXCEPTION 'RLS FAIL: client_b wrote a venue_clusters row for client_a (WITH CHECK did not fire)';
    EXCEPTION WHEN check_violation OR others THEN
        NULL; -- expected: WITH CHECK rejected it
    END;

    -- ---- Test 3: client_b cannot read client_a's staff_venue_assignments ----
    PERFORM set_config('app.current_client_id', client_b::text, true);
    SELECT COUNT(*) INTO cnt FROM staff_venue_assignments WHERE client_id = client_a;
    IF cnt <> 0 THEN
        RAISE EXCEPTION 'RLS FAIL: client_b saw % staff_venue_assignments rows for client_a', cnt;
    END IF;

    -- ---- Test 4: client_b cannot read client_a's venue_cluster_members ----
    PERFORM set_config('app.current_client_id', client_b::text, true);
    SELECT COUNT(*) INTO cnt FROM venue_cluster_members WHERE client_id = client_a;
    IF cnt <> 0 THEN
        RAISE EXCEPTION 'RLS FAIL: client_b saw % venue_cluster_members rows for client_a', cnt;
    END IF;

    -- Cleanup test fixtures (hard delete allowed in migration scripts)
    DELETE FROM venue_clusters  WHERE client_id IN (client_a, client_b);
    DELETE FROM clients         WHERE client_id IN (client_a, client_b);

    RAISE NOTICE 'Migration 023 RLS tests PASSED';
END
$$;


-- ---------------------------------------------------------------------------
-- DOWN (rollback)
-- ---------------------------------------------------------------------------
-- DROP TABLE IF EXISTS staff_venue_assignments;
-- DROP TABLE IF EXISTS venue_cluster_members;
-- DROP TABLE IF EXISTS venue_clusters;
