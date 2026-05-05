/**
 * /clownsay slash command — Cloudflare Worker
 *
 * Setup:
 *   1. npm create cloudflare@latest clownsay     (pick "Hello World" Worker, no framework)
 *   2. Replace src/index.js with this file
 *   3. npx wrangler secret put SLACK_SIGNING_SECRET   (paste from Slack app's Basic Information)
 *   4. npx wrangler deploy
 *   5. Use the deployed URL as the Request URL in your Slack slash command config.
 *
 * Adding more workspaces:
 *   Each Slack workspace gets its own Slack app (and therefore its own signing
 *   secret). Add additional secrets with any name starting with
 *   SLACK_SIGNING_SECRET, e.g.:
 *     npx wrangler secret put SLACK_SIGNING_SECRET_2
 *     npx wrangler secret put SLACK_SIGNING_SECRET_3
 *   then redeploy. The Worker will accept any request signed with any of them.
 */

export default {
  async fetch(request, env) {
    if (request.method !== "POST") {
      return new Response("Method not allowed", { status: 405 });
    }

    // Read the raw body once — we need the exact bytes Slack signed.
    const body = await request.text();

    // 1. Verify the request actually came from Slack.
    const timestamp = request.headers.get("X-Slack-Request-Timestamp");
    const signature = request.headers.get("X-Slack-Signature");
    if (!timestamp || !signature) {
      return new Response("Missing signature headers", { status: 401 });
    }

    // Replay protection: reject anything older than 5 minutes.
    const now = Math.floor(Date.now() / 1000);
    if (Math.abs(now - parseInt(timestamp, 10)) > 60 * 5) {
      return new Response("Request too old", { status: 401 });
    }

    // Collect every configured signing secret. Any env var whose name starts
    // with SLACK_SIGNING_SECRET counts — one per workspace's Slack app.
    const secrets = Object.entries(env)
      .filter(
        ([k, v]) =>
          k.startsWith("SLACK_SIGNING_SECRET") &&
          typeof v === "string" &&
          v.length > 0,
      )
      .map(([, v]) => v);

    if (secrets.length === 0) {
      return new Response("Server misconfigured: no signing secrets", {
        status: 500,
      });
    }

    let ok = false;
    for (const secret of secrets) {
      if (await verifySlackSignature(secret, timestamp, body, signature)) {
        ok = true;
        break;
      }
    }
    if (!ok) {
      return new Response("Invalid signature", { status: 401 });
    }

    // 2. Parse the form-encoded payload Slack sent.
    const params = new URLSearchParams(body);
    const text = params.get("text") || "";

    // 3. Transform: each word becomes :fat_left_clown:<letters>:fat_right_clown:,
    //    where <letters> is :mc<letter>: per a–z. Non-letters inside a word are
    //    dropped; words with no surviving letters are dropped entirely.
    const output = text
      .toLowerCase()
      .split(/\s+/)
      .map((word) => {
        const letters = [...word]
          .map((ch) => (ch >= "a" && ch <= "z" ? `:mc${ch}:` : ""))
          .join("");
        return letters ? `:fat_left_clown:${letters}:fat_right_clown:` : "";
      })
      .filter((w) => w.length > 0)
      .join(" ");

    // response_type "in_channel" means everyone in the channel sees it.
    // Switch to "ephemeral" if you'd rather only the invoker sees it.
    return Response.json({
      response_type: "in_channel",
      text: output,
    });
  },
};

async function verifySlackSignature(secret, timestamp, body, signature) {
  const baseString = `v0:${timestamp}:${body}`;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sigBytes = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(baseString),
  );
  const hex = [...new Uint8Array(sigBytes)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  const expected = `v0=${hex}`;

  // Constant-time comparison to avoid timing attacks.
  if (expected.length !== signature.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) {
    diff |= expected.charCodeAt(i) ^ signature.charCodeAt(i);
  }
  return diff === 0;
}
