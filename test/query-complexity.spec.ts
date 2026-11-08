import { buildSchema, parse } from 'graphql';
import { assertQueryComplexity } from '../src/common/query-complexity.plugin';

const schema = buildSchema('type Query { skill(id: ID!): String }');
it('accepts required variables supplied with the request', () => {
  expect(() => assertQueryComplexity(schema, parse('query Skill($id: ID!) { skill(id: $id) }'), {id:'example'})).not.toThrow();
});
it('preserves the complexity ceiling', () => {
  const document = parse(`{ ${Array.from({length:1001}, (_,i) => `field${i}: skill(id:"example")`).join(' ')} }`);
  expect(() => assertQueryComplexity(schema, document)).toThrow('maximum complexity of 1000');
});
it('only evaluates the selected operation', () => {
  const document = parse('query One($id: ID!) { skill(id:$id) } query Two { skill(id:"two") }');
  expect(() => assertQueryComplexity(schema, document, {}, 'Two')).not.toThrow();
});
