import type { ApolloServerPlugin } from '@apollo/server';
import { GraphQLError, type DocumentNode, type GraphQLSchema } from 'graphql';
import { getComplexity, fieldExtensionsEstimator, simpleEstimator } from 'graphql-query-complexity';

export function assertQueryComplexity(
  schema: GraphQLSchema,
  document: DocumentNode,
  variables: Record<string, unknown> = {},
  operationName?: string,
): void {
  const complexity = getComplexity({
    schema,
    query: document,
    variables,
    operationName,
    estimators: [fieldExtensionsEstimator(), simpleEstimator({ defaultComplexity: 1 })],
  });
  if (complexity > 1000) {
    throw new GraphQLError('Query exceeds the maximum complexity of 1000', {
      extensions: { code: 'GRAPHQL_VALIDATION_FAILED' },
    });
  }
}

// Validation rules do not receive request variables. Evaluate complexity after
// operation resolution so required variables work and each request is checked.
export const queryComplexityPlugin: ApolloServerPlugin = {
  async requestDidStart() {
    return {
      async didResolveOperation({ schema, document, request, operationName }) {
        assertQueryComplexity(schema, document, request.variables, operationName ?? undefined);
      },
    };
  },
};
