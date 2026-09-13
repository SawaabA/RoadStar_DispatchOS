// Supabase magic links return on the implicit flow, so the session arrives as
// `#access_token=...` (or `#error_description=...`). auth-js parses that hash
// asynchronously at startup, which means anything that rewrites the hash on
// mount can destroy the session before it is ever read.
const AUTH_PARAMS =
  /(?:^|&)(access_token|refresh_token|provider_token|error_description|error_code)=/;

export const isAuthCallbackHash = (hash: string): boolean =>
  AUTH_PARAMS.test(hash.replace(/^#/, ""));
