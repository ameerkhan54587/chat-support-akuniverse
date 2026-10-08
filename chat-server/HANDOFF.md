# Telegram support handoff

When an operator successfully sends a reply from the console, the server POSTs `{ "chat_id": "…" }` to the fixed backend endpoint for that site:

- SMSOTPS: `https://api.smsotps.com/api/support/handoff`
- SMS Activate: `https://api.smsactivate.uk/api/support/handoff`

The console sends its existing site bearer key in `Authorization: Bearer …`, plus `X-Handoff-Timestamp` (Unix seconds) and `X-Handoff-Signature` (lowercase hex HMAC-SHA256 over `timestamp + "." + exact raw JSON body`) using a separate per-site handoff secret. The endpoint is allowlisted in code; site metadata cannot select an arbitrary destination. The site backend checks HTTPS, timestamp freshness (300 seconds), and HMAC with constant-time comparison. No nonce store, queue, or cron is used.

The Laravel endpoint updates that chat's `support_conversations.handoff_until` to five minutes after receipt. Support AI checks the field before responding. Messages received during the window are stored but receive no automated response; the next message after expiry follows the existing AI path.

Set secrets only in the deployment environment and the site's `.env`, from the vault:

- Console Render `SITE_HANDOFF_SECRET_SMSOTPS` matches SMSOTPS `.env` `HANDOFF_SECRET`.
- Console Render `SITE_HANDOFF_SECRET_SMSACTIVATE` matches SMS Activate `.env` `HANDOFF_SECRET`.

Do not put either secret in this repository, site JSON, logs, or chat. The Console site bearer API key remains its existing `SITE_API_KEY_<SITE>` key.
