# CLAUDE.md

A Cloudflare Worker that powers the `/clownsay` Slack slash command. It transforms input text like `claw` into a string of custom Slack emoji — `:fat_left_clown::mcc::mcl::mca::mcw::fat_right_clown:` — which renders in Slack as a clown-bookended banner of letter-emoji.

## Architecture

Single-file Cloudflare Worker. No framework, no build step. The whole thing lives in `src/index.js`.

One deployed Worker serves many Slack workspaces. Each workspace has its own Slack app (and therefore its own signing secret); the Worker accepts requests signed by any of its configured signing secrets. This avoids OAuth and public app distribution.

Request flow:

1. User runs `/clownsay <text>` in Slack
2. Slack POSTs a form-encoded payload to the Worker's URL
3. Worker verifies the HMAC-SHA256 signature against each configured signing secret until one matches
4. Worker transforms `text` per the rules below
5. Worker acks Slack with an empty `200` and POSTs the actual response to the `response_url` from the payload

Step 5 is intentional. Replying inline with `{response_type: "in_channel"}` causes Slack to echo the user's `/clownsay <text>` invocation in the channel above the response. Posting via `response_url` avoids that echo.

## Transform rules

- Input is lowercased
- Split on whitespace (any run of whitespace collapses to one separator)
- For each word: each `a–z` character becomes `:mc<letter>:`, non-letters are dropped
- Each word wraps with `:fat_left_clown:` … `:fat_right_clown:`
- Words that have zero letters after filtering are dropped entirely (so `!!!` doesn't produce empty bookends)
- Words rejoin with single spaces

Example: `Hello, World!` → `:fat_left_clown::mch::mce::mcl::mcl::mco::fat_right_clown: :fat_left_clown::mcw::mco::mcr::mcl::mcd::fat_right_clown:`

## Required emoji pack

Each workspace's emoji library must contain:

- `:fat_left_clown:` — left bookend
- `:fat_right_clown:` — right bookend
- `:mca:` through `:mcz:` — one per English letter

Emoji are workspace-scoped in Slack and there's no API to bulk-install them on Free/Pro/Business+ plans, so this is a manual step per workspace. Without the pack, Slack renders the literal `:mca:` text instead of images.

## Common commands

```bash
# Local dev (responds at http://localhost:8787)
npx wrangler dev

# Deploy to production
npx wrangler deploy

# Stream live logs from production
npx wrangler tail

# Add or rotate a signing secret
npx wrangler secret put SLACK_SIGNING_SECRET_<N>

# List configured secrets (names only; values are not retrievable)
npx wrangler secret list

# Remove a secret
npx wrangler secret delete SLACK_SIGNING_SECRET_<N>
```

## Adding a new Slack workspace

1. Create a new Slack app at https://api.slack.com/apps (From scratch, pick the new workspace).
2. Copy the **Signing Secret** from the app's Basic Information page.
3. Configure a Slash Command (`/clownsay`) with the Request URL pointing at the deployed Worker URL.
4. Add the secret to the Worker:
   ```
   npx wrangler secret put SLACK_SIGNING_SECRET_<N>
   ```
   `<N>` can be any suffix — the Worker accepts any env var whose name starts with `SLACK_SIGNING_SECRET`.
5. `npx wrangler deploy`
6. Install the Slack app to the workspace.
7. Upload the required emoji pack to that workspace.

## Conventions and gotchas

- **Signing secret discovery**: any env var starting with `SLACK_SIGNING_SECRET` is auto-discovered at request time and tried in turn. To rotate, add the new one, deploy, then delete the old one — the Worker keeps working through the rotation because both are valid simultaneously.
- **Request signature verification** uses HMAC-SHA256 via `crypto.subtle`, with a constant-time comparison to avoid timing leaks on the signature value itself.
- **Replay protection**: requests whose `X-Slack-Request-Timestamp` is more than 5 minutes off from current time are rejected.
- **No persistent state**: the Worker is fully stateless. Adding state would mean introducing Workers KV, D1, or a Durable Object.
- **No build step**: Wrangler bundles `src/index.js` directly. There's no transpiler or bundler config to maintain.
- **3-second budget**: Slack times out the slash command if we don't respond within 3 seconds. The transform is microseconds and the `response_url` POST is fast, so this is a non-issue today, but if anything slow gets added (a network call, etc.), switch the response-url POST to `ctx.waitUntil(...)` so the Worker acks immediately and posts in the background.

## Common tweaks

- **Make output private** (only the invoker sees it): change `response_type: "in_channel"` to `"ephemeral"` in the `response_url` POST. Note that ephemeral messages do not persist in channel history.
- **Pass non-letter characters through literally** (so `don't` keeps the apostrophe between emoji): change `return ""` to `return ch` in the per-character transform.
- **Disable case-folding**: remove the `.toLowerCase()` call. Only useful if you also upload uppercase emoji variants like `:mcA:`.
- **Change which workspaces the command bookends per word vs. per phrase**: the per-word bookending is in the `.split(/\s+/).map(...)` block; collapsing to a single bookend pair around the whole text means joining all letters first and wrapping once.

## What's intentionally not here

- **No tests.** The transform is simple enough that the cost of a test setup currently outweighs the value. If logic grows, [vitest + @cloudflare/vitest-pool-workers](https://developers.cloudflare.com/workers/testing/vitest-integration/) is the standard combination.
- **No CI/CD.** Deploys are manual. A `wrangler deploy` step in GitHub Actions on push-to-main is straightforward to add when wanted.
- **No OAuth / public distribution.** Per-workspace apps + multi-secret support replaces this. To make a single app installable across arbitrary workspaces, the Worker would need to handle an OAuth redirect callback (Slack still requires the OAuth dance to install in a new workspace, even if the resulting bot token is unused).
