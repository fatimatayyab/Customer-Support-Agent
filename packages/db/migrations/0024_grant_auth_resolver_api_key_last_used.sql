-- Custom SQL migration file, put your code below! --

-- Fixes a pre-existing gap, not new functionality: workspace_api_keys.
-- last_used_at has existed and been displayed in the dashboard since
-- Phase 0, but nothing has ever written to it - requireApiKey only ever
-- SELECTed the key, never touched this column. Every key has always
-- shown "never used" regardless of real traffic. touchApiKeyLastUsed
-- (auth-resolver-client.ts) closes this, fired un-awaited from
-- requireApiKey so it never adds latency to a widget request.
GRANT UPDATE (last_used_at) ON workspace_api_keys TO auth_resolver;
