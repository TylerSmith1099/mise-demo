-- =============================================================================
-- Migration 027 — Admin Homepage: mv_venue_daily_summary materialized view
--
-- CONTEXT (Admin Homepage, MIS-411 / Architecture MIS-409 §4.4)
-- -------------------------------------------------------------
-- Group Admin and Area Manager callers span many venues. Aggregating revenue,
-- labour, incidents, and compliance across all their venues on every request
-- would fan out across base tables. Instead, this materialized view pre-aggregates
-- per (client_id, venue_id, business_date); the homepage API sums over the
-- caller's resolved venue set.
--
-- COLUMNS
-- -------
-- Revenue (from revenue_daily):
--   net_revenue_cents, gross_revenue_cents, transaction_count,
--   forecast_revenue_cents, variance_cents, revenue_is_stale
-- Labour (from labour_actuals_daily):
--   worked_hours, labour_cost_cents, budgeted_hours, budgeted_cost_cents,
--   labour_is_stale
-- Counts (current per venue, same on every date row for that venue):
--   open_incident_count      — incidents with status IN ('draft','submitted')
--   unack_compliance_count   — compliance_events with acknowledged_at IS NULL
--
-- REFRESH
--   refresh_venue_daily_summary() is called by the sync scheduler at the end
--   of each connector run (revenue every 15 min + EOD; labour hourly).
--   REFRESH CONCURRENTLY is used so reads are not blocked. The unique index
--   on (client_id, venue_id, business_date) is a hard prerequisite.
--
-- RLS NOTE
--   Materialized views cannot carry RLS policies. Client isolation for this MV
--   is enforced at the API layer: every query MUST include:
--     WHERE client_id = $clientId AND venue_id = ANY($scopeVenueIds)
--   The underlying base tables remain RLS-protected. The MV is read-only and
--   accessible only via API routes that run after authenticate() + resolveScope().
--
-- GRANT: mise_app SELECT only — all writes go to base tables.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- UP
-- ---------------------------------------------------------------------------
SET timezone = 'UTC';

CREATE MATERIALIZED VIEW mv_venue_daily_summary AS
WITH
-- All (client, venue, date) combinations that appear in either daily table
scope AS (
    SELECT client_id, venue_id, business_date
    FROM revenue_daily
    WHERE deleted_at IS NULL
    UNION
    SELECT client_id, venue_id, business_date
    FROM labour_actuals_daily
    WHERE deleted_at IS NULL
),

-- Revenue rolled up per (client, venue, date)
rev AS (
    SELECT
        client_id,
        venue_id,
        business_date,
        SUM(net_revenue_cents)      AS net_revenue_cents,
        SUM(gross_revenue_cents)    AS gross_revenue_cents,
        SUM(transaction_count)      AS transaction_count,
        SUM(forecast_revenue_cents) AS forecast_revenue_cents,
        SUM(variance_cents)         AS variance_cents,
        BOOL_OR(is_stale)           AS revenue_is_stale
    FROM revenue_daily
    WHERE deleted_at IS NULL
    GROUP BY client_id, venue_id, business_date
),

-- Labour rolled up per (client, venue, date)
lab AS (
    SELECT
        client_id,
        venue_id,
        business_date,
        SUM(worked_hours)           AS worked_hours,
        SUM(labour_cost_cents)      AS labour_cost_cents,
        SUM(budgeted_hours)         AS budgeted_hours,
        SUM(budgeted_cost_cents)    AS budgeted_cost_cents,
        BOOL_OR(is_stale)           AS labour_is_stale
    FROM labour_actuals_daily
    WHERE deleted_at IS NULL
    GROUP BY client_id, venue_id, business_date
)

SELECT
    s.client_id,
    s.venue_id,
    s.business_date,

    -- Revenue (zero when no revenue row for this date)
    COALESCE(r.net_revenue_cents,    0) AS net_revenue_cents,
    COALESCE(r.gross_revenue_cents,  0) AS gross_revenue_cents,
    COALESCE(r.transaction_count,    0) AS transaction_count,
    r.forecast_revenue_cents,             -- nullable: NULL = no forecast loaded
    r.variance_cents,                     -- nullable: NULL = no forecast loaded
    COALESCE(r.revenue_is_stale, false) AS revenue_is_stale,

    -- Labour (zero when no labour row for this date)
    COALESCE(l.worked_hours,         0) AS worked_hours,
    COALESCE(l.labour_cost_cents,    0) AS labour_cost_cents,
    l.budgeted_hours,                     -- nullable: NULL = no budget loaded
    l.budgeted_cost_cents,                -- nullable
    COALESCE(l.labour_is_stale, false)  AS labour_is_stale,

    -- Open incident count: draft + submitted, not yet acknowledged, for this venue.
    -- Not scoped to business_date (incidents don't carry a trading-date column;
    -- this is the live unresolved count per venue, same across all date rows).
    (
        SELECT COUNT(*)
        FROM incident_reports ir
        WHERE ir.client_id  = s.client_id
          AND ir.venue_id   = s.venue_id
          AND ir.deleted_at IS NULL
          AND ir.status     IN ('draft', 'submitted')
    )::BIGINT AS open_incident_count,

    -- Unacknowledged compliance events per venue (same logic as incidents).
    (
        SELECT COUNT(*)
        FROM compliance_events ce
        WHERE ce.client_id       = s.client_id
          AND ce.venue_id        = s.venue_id
          AND ce.acknowledged_at IS NULL
          AND ce.deleted_at      IS NULL
    )::BIGINT AS unack_compliance_count

FROM scope s
LEFT JOIN rev r ON r.client_id = s.client_id AND r.venue_id = s.venue_id AND r.business_date = s.business_date
LEFT JOIN lab l ON l.client_id = s.client_id AND l.venue_id = s.venue_id AND l.business_date = s.business_date

WITH NO DATA;  -- populated on first REFRESH, not at migration time


-- Unique index required for REFRESH CONCURRENTLY (non-blocking refresh)
CREATE UNIQUE INDEX idx_mv_vds_pk
    ON mv_venue_daily_summary (client_id, venue_id, business_date);

-- Secondary index for "last N days across a venue list" — the common homepage query
CREATE INDEX idx_mv_vds_client_date
    ON mv_venue_daily_summary (client_id, business_date DESC);


-- Refresh function called by the sync scheduler at the end of each connector run.
-- CONCURRENTLY means active homepage readers are not blocked during refresh.
CREATE OR REPLACE FUNCTION refresh_venue_daily_summary()
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
    REFRESH MATERIALIZED VIEW CONCURRENTLY mv_venue_daily_summary;
END;
$$;

GRANT EXECUTE ON FUNCTION refresh_venue_daily_summary() TO mise_app;
GRANT SELECT ON mv_venue_daily_summary TO mise_app;


-- ---------------------------------------------------------------------------
-- DOWN (rollback)
-- ---------------------------------------------------------------------------
-- DROP FUNCTION  IF EXISTS refresh_venue_daily_summary();
-- DROP MATERIALIZED VIEW IF EXISTS mv_venue_daily_summary;
