/**
 * The public GraphQL endpoint.
 *
 * ## Authentication
 *
 * This route is authenticated by the API token **and nothing else**. There is no
 * session-cookie path and no query-string token — the only accepted credential
 * is an `Authorization: Bearer <token>` header. A request without a valid token
 * is rejected with a typed `UNAUTHENTICATED` error (HTTP 401) before the document
 * is parsed, so no resolver can run for an unauthenticated caller.
 *
 * ## Why CORS is open
 *
 * A third-party client may run in a browser. Because the credential travels in
 * the `Authorization` header and never in a cookie, `Access-Control-Allow-Origin:
 * *` cannot be abused by a hostile page the way a credentialed request could:
 * the browser does not attach the caller's token to someone else's request. No
 * `Access-Control-Allow-Credentials` is sent, which keeps the two apart.
 *
 * ## Status codes
 *
 * A GraphQL response is normally HTTP 200 even when it carries errors. The one
 * exception is authentication/authorisation, which the transport should express:
 * missing or bad token -> 401, a valid token hitting a forbidden action -> 403,
 * invalid input -> 422. Everything else is 200 with the error in the envelope.
 */
import { NextResponse, type NextRequest } from 'next/server';
import { executeGraphQL } from '@/server/graphql/execute';
import { buildGraphQLContext } from '@/server/graphql/context';
import { unauthenticated } from '@/server/graphql/errors';
import type { GraphQLError } from 'graphql';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_BODY_BYTES = 2_000_000;

const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type',
  'Access-Control-Max-Age': '86400',
};

function json(body: unknown, status: number): NextResponse {
  return NextResponse.json(body, {
    status,
    headers: { ...CORS_HEADERS, 'Cache-Control': 'no-store, private', Vary: 'Authorization' },
  });
}

/** Reads the bearer token from the Authorization header, if present. */
function bearerToken(req: NextRequest): string | null {
  const header = req.headers.get('authorization');
  if (!header) return null;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match ? match[1].trim() : null;
}

/** The HTTP status implied by the first GraphQL error's code. */
function statusFor(errors: readonly GraphQLError[] | undefined): number {
  const code = errors?.[0]?.extensions?.code;
  if (code === 'UNAUTHENTICATED') return 401;
  if (code === 'FORBIDDEN') return 403;
  if (code === 'BAD_USER_INPUT') return 422;
  return 200;
}

interface GraphQLRequest {
  query?: unknown;
  variables?: unknown;
  operationName?: unknown;
}

async function handle(req: NextRequest): Promise<NextResponse> {
  const token = bearerToken(req);
  if (!token) return json({ errors: [unauthenticated()] }, 401);

  const context = await buildGraphQLContext(token);
  if (!context) return json({ errors: [unauthenticated('The API token is not valid.')] }, 401);

  let request: GraphQLRequest;
  if (req.method === 'GET') {
    const params = req.nextUrl.searchParams;
    let variables: unknown;
    const rawVariables = params.get('variables');
    if (rawVariables) {
      try {
        variables = JSON.parse(rawVariables);
      } catch {
        return json({ errors: [{ message: 'The variables parameter is not valid JSON.', extensions: { code: 'BAD_USER_INPUT' } }] }, 422);
      }
    }
    request = { query: params.get('query'), variables, operationName: params.get('operationName') };
  } else {
    const raw = await req.text();
    if (raw.length > MAX_BODY_BYTES) {
      return json({ errors: [{ message: 'The request body is too large.', extensions: { code: 'BAD_USER_INPUT' } }] }, 413);
    }
    try {
      request = raw ? (JSON.parse(raw) as GraphQLRequest) : {};
    } catch {
      return json({ errors: [{ message: 'The request body is not valid JSON.', extensions: { code: 'BAD_USER_INPUT' } }] }, 400);
    }
  }

  if (typeof request.query !== 'string' || request.query.trim() === '') {
    return json({ errors: [{ message: 'A GraphQL query is required.', extensions: { code: 'BAD_USER_INPUT' } }] }, 422);
  }

  const variables =
    request.variables && typeof request.variables === 'object'
      ? (request.variables as Record<string, unknown>)
      : undefined;
  const operationName = typeof request.operationName === 'string' ? request.operationName : undefined;

  const result = await executeGraphQL({ source: request.query, variableValues: variables, operationName, context });

  // A resolver that throws a non-GraphQL error is a bug; execute() surfaces it
  // as an INTERNAL error already, so it is logged here once and returned typed.
  if (result.errors?.some((error) => !error.extensions?.code)) {
    console.error('[graphql] untyped error:', result.errors);
  }

  return json(result, statusFor(result.errors));
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  return handle(req);
}

/** GET is supported so a simple query can be shared as a URL. Mutations must POST. */
export async function GET(req: NextRequest): Promise<NextResponse> {
  return handle(req);
}

export async function OPTIONS(): Promise<NextResponse> {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}
