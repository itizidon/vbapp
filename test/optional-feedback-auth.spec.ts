import {UnauthorizedException} from '@nestjs/common';
import {GqlExecutionContext} from '@nestjs/graphql';
import {OptionalGqlAuthGuard} from '../src/common/optional-gql-auth.guard';
const context={} as any;
afterEach(()=>jest.restoreAllMocks());
it('permits anonymous invitation submissions without assigning a submitter',async()=>{
 const req:any={headers:{}};jest.spyOn(GqlExecutionContext,'create').mockReturnValue({getContext:()=>({req})} as any);
 const jwt:any={verifyAsync:jest.fn()};expect(await new OptionalGqlAuthGuard(jwt).canActivate(context)).toBe(true);expect(req.user).toBeUndefined();expect(jwt.verifyAsync).not.toHaveBeenCalled();
});
it('captures a verified session for the actual submitter',async()=>{
 const req:any={headers:{authorization:'Bearer verified'}};jest.spyOn(GqlExecutionContext,'create').mockReturnValue({getContext:()=>({req})} as any);
 const jwt:any={verifyAsync:jest.fn().mockResolvedValue({id:'actual-submitter'})};await new OptionalGqlAuthGuard(jwt).canActivate(context);expect(req.user.id).toBe('actual-submitter');
});
it('does not treat an expired session as identity or block a valid anonymous invitation',async()=>{
 const req:any={headers:{authorization:'Bearer expired'}};jest.spyOn(GqlExecutionContext,'create').mockReturnValue({getContext:()=>({req})} as any);
 const jwt:any={verifyAsync:jest.fn().mockRejectedValue(new UnauthorizedException())};expect(await new OptionalGqlAuthGuard(jwt).canActivate(context)).toBe(true);expect(req.user).toBeUndefined();
});
