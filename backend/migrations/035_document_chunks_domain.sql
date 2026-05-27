-- ============================================================================
-- Mise — document_chunks: domain dimension (migration 035)
-- MIS-590: Add domain column for RSA/RSG domain-aware retrieval.
-- Fixes RSA/RSG conflation confirmed in MIS-589 audit.
--
-- Domain vocab: liquor_rsa | gambling_rsg | wphs | employment |
--               incident_reporting | conflict_mgmt | emergency | general
--
-- Reversible: rollback section at end of file.
-- ============================================================================

BEGIN;

-- 1. Add domain column. Default 'general' keeps existing rows valid before backfill.
ALTER TABLE document_chunks
    ADD COLUMN IF NOT EXISTS domain TEXT NOT NULL DEFAULT 'general'
    CHECK (domain IN (
        'liquor_rsa', 'gambling_rsg', 'wphs', 'employment',
        'incident_reporting', 'conflict_mgmt', 'emergency', 'general'
    ));

-- 2. Backfill by source. Ordered from most-specific to most-general so a more
--    specific rule applied later wins (UPDATE is idempotent; last write wins).

-- General (anything that doesn't match a specific domain below stays 'general')

-- Employment / HR
UPDATE document_chunks SET domain = 'employment'
 WHERE source ILIKE '%Fair Work%'
    OR source ILIKE '%Hospitality Industry%Award%'
    OR source ILIKE '%Hospitality Industry%Award%'
    OR source ILIKE '%Labour Benchmark%'
    OR source ILIKE '%Pay Rates Reference%'
    OR source ILIKE '%HR and Payroll%'
    OR source ILIKE '%Modern Slavery%'
    OR source ILIKE '%Values and Behaviours%'
    OR source ILIKE '%Code of Conduct%';

-- WHS
UPDATE document_chunks SET domain = 'wphs'
 WHERE source ILIKE '%Work Health and Safety%'
    OR source ILIKE '%WHS%';

-- Incident reporting / AML
UPDATE document_chunks SET domain = 'incident_reporting'
 WHERE source ILIKE '%Incident Report%'
    OR source ILIKE '%AML%'
    OR source ILIKE '%AUSTRAC%'
    OR source ILIKE '%Anti-Money Laundering%'
    OR source ILIKE '%Reporting Obligation%'
    OR source ILIKE '%OLGR%Incident%'
    OR source ILIKE '%Mandatory Notification%';

-- Conflict / de-escalation
UPDATE document_chunks SET domain = 'conflict_mgmt'
 WHERE source ILIKE '%Conflict De-escalation%'
    OR source ILIKE '%Difficult Patron%'
    OR source ILIKE '%Interpersonal Coaching%'
    OR source ILIKE '%Aggressive Patron%'
    OR source ILIKE '%Removal%Barring%';

-- Emergency response
UPDATE document_chunks SET domain = 'emergency'
 WHERE source ILIKE '%Armed Robbery%'
    OR source ILIKE '%Threat and Extortion%'
    OR source ILIKE '%Welfare and Empathy%';

-- RSG — gambling / gaming
UPDATE document_chunks SET domain = 'gambling_rsg'
 WHERE source ILIKE '%Gaming Machine Act%'
    OR source ILIKE '%Responsible Gambling%'
    OR source ILIKE '%RSG%'
    OR source ILIKE '%Self-Exclusion%'
    OR source ILIKE '%Gaming Floor%'
    OR source ILIKE '%EGM Clearance%'
    OR source ILIKE '%Meter Read%'
    OR source ILIKE '%Harm Minimisation%'
    OR source ILIKE '%Problem Gambl%'
    OR source ILIKE '%Gaming Attendant%';

-- RSA — liquor / alcohol (more specific, applied AFTER RSG so RSA wins on shared terms)
UPDATE document_chunks SET domain = 'liquor_rsa'
 WHERE source ILIKE '%Liquor Act%'
    OR source ILIKE '%Responsible Service of Alcohol%'
    OR source ILIKE '%RSA%'
    OR source ILIKE '%Intoxication Assessment%'
    OR source ILIKE '%RSA Refusal%'
    OR source ILIKE '%SITHFAB021%';

-- Cross-domain: staff certification covers BOTH RSA and RSG — leave as 'general'
-- so it appears in both domains' filtered results.
UPDATE document_chunks SET domain = 'general'
 WHERE source ILIKE '%Staff Certification RSA and RSG%';

-- 3. Index for fast domain-scoped retrieval.
CREATE INDEX IF NOT EXISTS idx_document_chunks_domain
    ON document_chunks (domain)
    WHERE superseded_at IS NULL;

COMMIT;

-- ============================================================================
-- ROLLBACK (run manually to revert):
-- ============================================================================
-- BEGIN;
-- DROP INDEX IF EXISTS idx_document_chunks_domain;
-- ALTER TABLE document_chunks DROP COLUMN IF EXISTS domain;
-- COMMIT;
