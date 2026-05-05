# clownsay

A Slack `/clownsay` slash command. Turns text into a clown-bookended emoji banner.

```
/clownsay hey there
→ :fat_left_clown::mch::mce::mcy::middle_clown::mct::mch::mce::mcr::mce::fat_right_clown:
```

A single banner wraps the whole phrase. Letters become `:mc<letter>:` emojis (lowercase a–z), non-letters are dropped, and `:middle_clown:` separates words.

## Stack

A single-file Cloudflare Worker at `src/index.js`. No framework, no build step. One Worker serves multiple Slack workspaces — each workspace has its own Slack app, and the Worker accepts requests signed by any configured signing secret.

## Initial deploy

Requires a Cloudflare account and Node.js.

```bash
npx wrangler login                                # one-time
npx wrangler secret put SLACK_SIGNING_SECRET      # paste from Slack app's Basic Information
npx wrangler deploy
```

`wrangler deploy` prints the Worker URL. Paste it into the Slack app's slash command Request URL field, then install the app to the workspace.

## Adding another workspace

1. Create a new Slack app at https://api.slack.com/apps (From scratch).
2. Add a `/clownsay` slash command pointing at the same Worker URL.
3. Copy the new app's Signing Secret.
4. ```bash
   npx wrangler secret put SLACK_SIGNING_SECRET_2
   npx wrangler deploy
   ```
   Any suffix works — the Worker auto-discovers any env var starting with `SLACK_SIGNING_SECRET`.
5. Install the app to the new workspace.
6. Upload the emoji pack (see below).

## Required emoji pack

Each workspace needs these custom emoji uploaded:

- `:fat_left_clown:` — left bookend
- `:fat_right_clown:` — right bookend
- `:middle_clown:` — separator between words
- `:mca:` through `:mcz:` — one per letter

Without them, output renders as literal `:mca:` text instead of images.

## Iterating

```bash
# Edit src/index.js, then:
npx wrangler deploy

# Stream live logs:
npx wrangler tail
```

Deploys take a few seconds and go global immediately.
