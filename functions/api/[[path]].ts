// Cloudflare Pages Function: every /api/... request. The logic lives in api/src/handler.ts (shared with the local Node server).
// Bindings and variables are set in the Pages project (see api/README.md): CONFLUX_KV (KV namespace), OWNER_CODE (secret), OWNER_NAMES.
import { createApi, type ApiEnv } from '../../api/src/handler.ts';
import { KvStore, type KvNamespaceLike } from '../../api/src/store.ts';

interface Env extends ApiEnv {
  CONFLUX_KV?: KvNamespaceLike;
}

export const onRequest = (ctx: { request: Request; env: Env }): Promise<Response> => {
  const { env } = ctx;
  return createApi({ store: env.CONFLUX_KV ? new KvStore(env.CONFLUX_KV) : null, env })(ctx.request);
};
