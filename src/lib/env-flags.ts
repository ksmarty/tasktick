/**
 * One definition of "on".
 *
 * Three places in this app turn a string into a boolean: the environment schema
 * (`src/lib/env.ts`), query parameters (`searchParamBool` in
 * `src/server/http.ts`), and the preview sign-in switch
 * (`src/lib/preview-auth.ts`). They used to carry three copies of the same list,
 * which is one copy too many: a value accepted by one and refused by another
 * looks like a bug in the feature rather than a typo in the value.
 *
 * The accepted spellings are the ones a person actually types into a compose
 * file or an `.env`: `1`, `true`, `yes`, `on`, in any case. Anything else is
 * false — including `0`, `off`, `false` and the empty string — so a variable set
 * to a value the author did not intend fails closed, which for a feature switch
 * is the direction that cannot hurt.
 */
export function isTruthyEnvFlag(value: string | undefined | null): boolean {
  if (!value) return false;
  return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase());
}
