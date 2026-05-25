-- Migration 022 — Add unique constraint on incident_notifications (incident_id, notification_role)
--
-- Ensures fireNotifications() is idempotent: a role is notified at most once per
-- incident. ON CONFLICT DO NOTHING in the API is now backed by a real constraint.
--
-- DOWN: DROP CONSTRAINT IF EXISTS uq_incident_notification_role ON incident_notifications;

ALTER TABLE incident_notifications
  ADD CONSTRAINT uq_incident_notification_role
  UNIQUE (incident_id, notification_role);
