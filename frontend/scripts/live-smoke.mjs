// Read-only local smoke check. Accounts must be created through Clerk, never PostgreSQL.
import assert from 'node:assert/strict';
const endpoint=new URL(process.env.GRAPHQL_API_URL??'http://localhost:3000/graphql');
if(!['localhost','127.0.0.1','[::1]'].includes(endpoint.hostname))throw Error('This smoke check is local-only');
const token=process.env.CLERK_SMOKE_SESSION_TOKEN;
async function gql(query){const response=await fetch(endpoint,{method:'POST',redirect:'error',headers:{'Content-Type':'application/json',...(token?{Authorization:`Bearer ${token}`}:{})},body:JSON.stringify({query})});const body=await response.json();assert.equal(response.ok,true);assert.equal(body.errors,undefined,JSON.stringify(body.errors));return body.data;}
const catalog=await gql('{sports{id slug skills{id name active}}}');assert(catalog.sports.some(s=>s.slug==='beach-volleyball'));console.log('Local catalog is available.');
if(token){const data=await gql('{me{id onboardingComplete emailVerified}}');assert.match(data.me.id,/^user_/);assert.equal(data.me.emailVerified,true);console.log('Verified Clerk account is available; onboarding complete:',data.me.onboardingComplete);}else console.log('Set CLERK_SMOKE_SESSION_TOKEN privately to test a live Clerk session. No accounts or activity were created.');
