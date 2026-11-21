-- Remove private whisper content once it can no longer be opened or retried.
-- Pending and ambiguous opening rows are retained to avoid losing undelivered content.
UPDATE whispers
SET body = ''
WHERE status IN ('opened', 'failed');
