// Cloudflare Worker entry for the live site: /api/... runs the accounts handler (api/src/handler.ts), everything else is the static game build.
// Having a script is what lets the Worker take bindings and secrets (CONFLUX_KV, OWNER_CODE, OWNER_NAMES; see api/README.md).
import { createApi, type ApiEnv } from '../api/src/handler.ts';
import { KvStore, type KvNamespaceLike } from '../api/src/store.ts';

export interface Env extends ApiEnv {
  CONFLUX_KV?: KvNamespaceLike;
  ASSETS: { fetch(request: Request): Promise<Response> };
}

export default {
  fetch(request: Request, env: Env): Promise<Response> {
    const { pathname } = new URL(request.url);
    if (pathname === '/api' || pathname.startsWith('/api/')) {
      return createApi({ store: env.CONFLUX_KV ? new KvStore(env.CONFLUX_KV) : null, env })(request);
    }
    return env.ASSETS.fetch(request);
  },
};
