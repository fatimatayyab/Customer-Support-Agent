-- Custom SQL migration file, put your code below! --

-- Extends platform_operator (see 0020/0021 and platform-operator-client.ts)
-- for the Platform Owner Dashboard's usage/health view, widget-key
-- visibility+revoke, and plan/billing-notes metadata. Every grant here
-- follows the same narrow, column-level discipline already established -
-- most notably, there is DELIBERATELY NO grant of any kind on `messages`.
-- That decision was made explicitly (not by default caution): the one
-- thing message-level access would add over conversation-level data is a
-- true last-message timestamp and a raw message count, and neither
-- justified giving this role a foothold in the one table that holds
-- actual customer-conversation content. `conversations.status` +
-- `created_at` already gives a materially more useful operational health
-- signal (stuck/escalated counts) than a raw message tally would, and the
-- one message-level metric that WOULD be worth the exposure - AI token
-- usage/cost - lives in messages.metadata, which was excluded from
-- consideration for the same reason. Zero tables touched is a boundary a
-- future reviewer can verify in one line and can't accidentally erode by
-- adding "just one more column" later; a narrow-but-nonzero grant would
-- invite exactly that erosion over time.

-- conversations: status breakdown + last-activity proxy, nothing else.
GRANT SELECT (id, workspace_id, status, created_at) ON conversations TO platform_operator;

-- knowledge_sources: count only, never title/content - a knowledge
-- base's own text is the workspace's business content.
GRANT SELECT (id, workspace_id) ON knowledge_sources TO platform_operator;

-- integrations: which providers are connected and their status, never
-- credentials or config.
GRANT SELECT (id, workspace_id, provider, status) ON integrations TO platform_operator;

-- workspace_api_keys: full non-secret metadata for the detail page's key
-- list, plus the narrow ability to revoke a key (a real operational
-- security action - a leaked/abused key shouldn't require waiting on the
-- client to notice) - never key_hash, and never an INSERT grant (the
-- platform owner creates a signup link, never a widget key itself).
GRANT SELECT (id, workspace_id, name, key_prefix, last_used_at, revoked_at, created_at) ON workspace_api_keys TO platform_operator;
GRANT UPDATE (revoked_at) ON workspace_api_keys TO platform_operator;

-- workspace_platform_meta: this role's own table, full read/write. INSERT
-- lists every column (including updated_at, defaulted) because, like the
-- workspace_signup_invites INSERT gap fixed in 0021, Postgres requires
-- INSERT privilege on every column in the generated column list, not
-- just the ones the application actually sets.
GRANT SELECT (workspace_id, plan, billing_notes, updated_at) ON workspace_platform_meta TO platform_operator;
GRANT INSERT (workspace_id, plan, billing_notes, updated_at) ON workspace_platform_meta TO platform_operator;
GRANT UPDATE (plan, billing_notes, updated_at) ON workspace_platform_meta TO platform_operator;
