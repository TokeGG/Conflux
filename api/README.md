# Conflux accounts API

Accounts, sessions, the owner and dev access, and shared tuning. One module (`api/src/handler.ts`, Web standards only) runs as a
Cloudflare Worker (`worker/index.ts`, the live site's entry; `functions/api/[[path]].ts` is the same thing for a Pages project; same origin as the game, so no CORS) and as a local Node server (`server/dev.ts`).
The game works as a guest when `/api` does not answer.

## Set it up (Cloudflare dashboard, about five minutes)

1. **Create the KV namespace.** Cloudflare dashboard, Storage and databases, KV, Create a namespace, name it `conflux-accounts`.
2. **Bind it.** Copy the namespace ID, then in `wrangler.jsonc` uncomment `kv_namespaces` and put the ID in (the project is wrangler-managed, so the binding lives in the file, not the dashboard).
   On a Pages project instead: Settings, Bindings, Add, KV namespace, variable name `CONFLUX_KV`.
3. **Set the owner code.** Workers and Pages, the project, Settings, Variables and Secrets, Add, type **Secret**, name `OWNER_CODE`, value a long phrase only you know.
4. (Optional) add a plain variable `OWNER_NAMES` with the reserved names, comma separated. Default is `toke`.
5. **Redeploy** (Deployments, Retry, or push to `main`): bindings only apply to a new deployment.
6. **Become the owner.** Open the game, Sign in, Register, type a reserved name (e.g. `toke`), a password and the owner code. That account is
   the owner: it sees the Dev tools and the Admin tab. Nobody can register a reserved name without the code, and if `OWNER_CODE` is not set nobody can.

Check it: `https://<your-site>/api/health` answers `{"ok":true,"store":"cloudflare-kv"}`. `"store":"none"` means the binding is missing.

## Environment

| Name | Kind | Meaning |
| --- | --- | --- |
| `CONFLUX_KV` | KV binding | Where accounts, sessions, rate limits, the admin log and tuning live |
| `OWNER_CODE` | Secret | Needed to register a reserved name |
| `OWNER_NAMES` | Variable | Reserved names (default `toke`) |

No secret is stored in the repository or sent to the browser. Passwords are PBKDF2-SHA256 (100000 iterations, random salt); session tokens are
stored only as SHA-256 hashes.

## Rights

- **owner**: everything; the only one who grants or revokes.
- **dev** grant: the dev panel, and may publish tuning patches that every player's game applies (those runs never count toward unlocks).
- **admin** grant: stored for later; the Admin tab is owner only for now.

## Run it locally

```
OWNER_CODE=letmein npx tsx server/dev.ts     # API on :8788 with a JSON file store
npm run dev                                  # Vite proxies /api to it
```

## Limits worth knowing

KV is eventually consistent (a change can take up to a minute to show in another region) and has no atomic "create if absent", so two
simultaneous registrations of one name could both succeed, and rate limits are best effort. Fine for a small game; move the store to D1 if it grows.
