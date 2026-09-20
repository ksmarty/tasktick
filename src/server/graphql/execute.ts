/**
 * Schema construction and execution.
 *
 * ## Hand-written around `graphql()`, not a server framework
 *
 * The requirement is one POST endpoint with token auth. `graphql-yoga` and
 * `apollo-server` both bring a request pipeline, a plugin system, a landing page
 * and (in Apollo's case) a caching layer — none of which this API needs, and all
 * of which are more surface to keep patched on a self-hosted instance. The
 * `graphql` package alone gives parse, validate and execute; the route in
 * `src/app/api/graphql/route.ts` is the ~80 lines of HTTP around it. That is the
 * smaller footprint, so that is what is used.
 *
 * ## Depth limit
 *
 * A public endpoint can be asked for arbitrarily nested selections. The schema
 * itself is shallow (nothing recurses), but a depth cap is cheap and removes the
 * whole class of query: a document deeper than {@link MAX_DEPTH} is rejected
 * before execution with a typed `QUERY_TOO_DEEP` error. Introspection fields are
 * exempt because they are a fixed shape, not a data expansion. The other DoS
 * vector — a wide recurrence window — is capped in the `calendarItems` resolver
 * at 400 days, exactly like the REST endpoint.
 */
import {
  buildSchema,
  execute,
  Kind,
  parse,
  specifiedRules,
  validate,
  type DocumentNode,
  type ExecutionResult,
  type FragmentDefinitionNode,
  type GraphQLObjectType,
  type GraphQLSchema,
  type SelectionSetNode,
} from 'graphql';
import { typeDefs } from './schema';
import { resolvers } from './resolvers';
import { gqlError } from './errors';
import type { GraphQLContext } from './context';

/** Maximum field nesting depth for a single operation. */
export const MAX_DEPTH = 12;

let cached: GraphQLSchema | null = null;

/** The schema, built once per process and with the resolver table attached. */
export function getSchema(): GraphQLSchema {
  if (cached) return cached;

  const schema = buildSchema(typeDefs);

  for (const [typeName, fields] of Object.entries(resolvers)) {
    const type = schema.getType(typeName);
    if (!type || !('getFields' in type)) continue;
    const fieldMap = (type as GraphQLObjectType).getFields();
    for (const [fieldName, resolver] of Object.entries(fields)) {
      const field = fieldMap[fieldName];
      // A typo in the resolver table is a programming error, not a runtime one.
      if (!field) throw new Error(`GraphQL resolver for unknown field ${typeName}.${fieldName}`);
      field.resolve = resolver as never;
    }
  }

  cached = schema;
  return schema;
}

/** Maximum field depth of one selection set, following fragment spreads. */
function selectionDepth(
  selectionSet: SelectionSetNode,
  fragments: Record<string, FragmentDefinitionNode>,
  active: Set<string>,
): number {
  let max = 0;
  for (const selection of selectionSet.selections) {
    if (selection.kind === Kind.FIELD) {
      // Introspection is a fixed shape and cannot expand user data.
      if (selection.name.value.startsWith('__')) continue;
      const depth = 1 + (selection.selectionSet ? selectionDepth(selection.selectionSet, fragments, active) : 0);
      if (depth > max) max = depth;
    } else if (selection.kind === Kind.INLINE_FRAGMENT) {
      const depth = selectionDepth(selection.selectionSet, fragments, active);
      if (depth > max) max = depth;
    } else if (selection.kind === Kind.FRAGMENT_SPREAD) {
      const name = selection.name.value;
      const fragment = fragments[name];
      // `active` breaks a fragment cycle instead of recursing forever.
      if (!fragment || active.has(name)) continue;
      active.add(name);
      const depth = selectionDepth(fragment.selectionSet, fragments, active);
      active.delete(name);
      if (depth > max) max = depth;
    }
  }
  return max;
}

function documentDepth(document: DocumentNode): number {
  const fragments: Record<string, FragmentDefinitionNode> = {};
  for (const definition of document.definitions) {
    if (definition.kind === Kind.FRAGMENT_DEFINITION) fragments[definition.name.value] = definition;
  }

  let max = 0;
  for (const definition of document.definitions) {
    if (definition.kind !== Kind.OPERATION_DEFINITION) continue;
    const depth = selectionDepth(definition.selectionSet, fragments, new Set());
    if (depth > max) max = depth;
  }
  return max;
}

export interface ExecuteGraphQLArgs {
  source: string;
  variableValues?: Record<string, unknown> | null;
  operationName?: string | null;
  context: GraphQLContext;
}

/**
 * Parses, depth-checks, validates and executes one document.
 *
 * Returns a GraphQL envelope; it never throws for a problem in the *document*
 * (syntax, depth, validation) — those become typed errors so the route can pick
 * a status without a try/catch. A thrown error from a resolver is handled by
 * `execute` and appears in `errors` with its `extensions.code`.
 */
export async function executeGraphQL(args: ExecuteGraphQLArgs): Promise<ExecutionResult> {
  const schema = getSchema();

  let document: DocumentNode;
  try {
    document = parse(args.source);
  } catch (error) {
    return { errors: [error as never] };
  }

  const depth = documentDepth(document);
  if (depth > MAX_DEPTH) {
    return {
      errors: [
        gqlError(
          `The query is ${depth} levels deep; the maximum is ${MAX_DEPTH}.`,
          'QUERY_TOO_DEEP',
          { depth, maxDepth: MAX_DEPTH },
        ),
      ],
    };
  }

  const validationErrors = validate(schema, document, specifiedRules);
  if (validationErrors.length > 0) return { errors: validationErrors };

  const result = await execute({
    schema,
    document,
    contextValue: args.context,
    variableValues: args.variableValues ?? undefined,
    operationName: args.operationName ?? undefined,
  });

  if (result && typeof (result as { [Symbol.asyncIterator]?: unknown })[Symbol.asyncIterator] === 'function') {
    throw new Error('Subscriptions are not supported by this endpoint.');
  }

  return result;
}
