import {UnauthorizedException,ForbiddenException}from'@nestjs/common';
import{GqlExecutionContext}from'@nestjs/graphql';
import{GqlAuthGuard}from'../src/common/gql-auth.guard';
import{OptionalGqlAuthGuard}from'../src/common/optional-gql-auth.guard';
const context={}as never;
afterEach(()=>jest.restoreAllMocks());
function setup(value?:string,result:any={id:'user_fixtureplayer111',clerkUserId:'user_fixtureplayer111',onboardingComplete:true}){const req:any={headers:value?{authorization:value}:{}};jest.spyOn(GqlExecutionContext,'create').mockReturnValue({getContext:()=>({req})}as never);const sessions:any={authenticate:jest.fn().mockResolvedValue(result)},assessments:any={reconcile:jest.fn()};return {req,sessions,assessments};}
it('permits anonymous invitation submissions without assigning an identity',async()=>{const s=setup();expect(await new OptionalGqlAuthGuard(s.sessions,s.assessments).canActivate(context)).toBe(true);expect(s.sessions.authenticate).not.toHaveBeenCalled();});
it('uses only the Clerk-verified identity for authenticated submitters',async()=>{const s=setup('Bearer clerk-session');await new OptionalGqlAuthGuard(s.sessions,s.assessments).canActivate(context);expect(s.req.user.id).toBe('user_fixtureplayer111');expect(s.req.clerkUserId).toBe('user_fixtureplayer111');});
it('allows anonymous invitation use with an expired session but clears submitter identity',async()=>{const s=setup('Bearer expired');s.req.user={id:'injected'};s.sessions.authenticate.mockRejectedValue(new UnauthorizedException());await new OptionalGqlAuthGuard(s.sessions,s.assessments).canActivate(context);expect(s.req.user).toBeUndefined();});
it('rejects invalid sessions on protected operations',async()=>{const s=setup('Bearer old-jwt');s.sessions.authenticate.mockRejectedValue(new UnauthorizedException());await expect(new GqlAuthGuard(s.sessions,s.assessments).canActivate(context)).rejects.toBeInstanceOf(UnauthorizedException);});
it('does not downgrade onboarding or email-verification failures into authenticated access',async()=>{const s=setup('Bearer pending',{id:'user_fixtureplayer111',onboardingComplete:false});await expect(new OptionalGqlAuthGuard(s.sessions,s.assessments).canActivate(context)).rejects.toBeInstanceOf(ForbiddenException);});
