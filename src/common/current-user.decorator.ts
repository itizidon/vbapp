import {createParamDecorator,ExecutionContext}from'@nestjs/common';
import {GqlExecutionContext}from'@nestjs/graphql';
export type AuthUser={id:string;clerkUserId:string;username?:string;onboardingComplete?:boolean};
export const CurrentUser=createParamDecorator((_:unknown,ctx:ExecutionContext):AuthUser|undefined=>GqlExecutionContext.create(ctx).getContext().req.user);
