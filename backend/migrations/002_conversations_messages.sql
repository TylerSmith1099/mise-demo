-- =============================================================================
-- Migration 002 — Conversations & messages
-- =============================================================================

-- ---------------------------------------------------------------------------
-- UP
-- ---------------------------------------------------------------------------
SET timezone = 'UTC';

-- conversations — a single chat thread between a staff member and the assistant.
CREATE TABLE conversations (
    conversation_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    client_id       UUID NOT NULL REFERENCES clients (client_id),
    venue_id        UUID NOT NULL,
    staff_id        UUID NOT NULL,
    session_id      UUID NOT NULL,
    started_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    ended_at        TIMESTAMPTZ,
    deleted_at      TIMESTAMPTZ,
    FOREIGN KEY (client_id, venue_id)   REFERENCES venues (client_id, venue_id),
    FOREIGN KEY (client_id, staff_id)   REFERENCES staff (client_id, staff_id),
    FOREIGN KEY (client_id, session_id) REFERENCES sessions (client_id, session_id),
    UNIQUE (client_id, conversation_id)
);
CREATE INDEX idx_conversations_client ON conversations (client_id);
CREATE INDEX idx_conversations_session ON conversations (client_id, session_id);

-- messages — one turn in a conversation. confidence_score is set by the
-- Knowledge Agent for assistant turns; NULL for user turns.
CREATE TABLE messages (
    message_id       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    conversation_id  UUID NOT NULL,
    client_id        UUID NOT NULL REFERENCES clients (client_id),
    role             TEXT NOT NULL CHECK (role IN ('user','assistant')),
    content          TEXT NOT NULL,
    confidence_score NUMERIC(3,2) CHECK (confidence_score BETWEEN 0.00 AND 1.00),
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at       TIMESTAMPTZ,
    FOREIGN KEY (client_id, conversation_id)
        REFERENCES conversations (client_id, conversation_id)
);
CREATE INDEX idx_messages_client ON messages (client_id);
CREATE INDEX idx_messages_conversation ON messages (client_id, conversation_id);

-- ---------------------------------------------------------------------------
-- DOWN (rollback)
-- ---------------------------------------------------------------------------
-- DROP TABLE IF EXISTS messages;
-- DROP TABLE IF EXISTS conversations;
