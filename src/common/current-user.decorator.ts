import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { GqlExecutionContext } from '@nestjs/graphql';
export interface AuthUser { id:string; username:string; }
export const CurrentUser=createParamDecorator((_d:unknown,ctx:ExecutionContext):AuthUser=>GqlExecutionContext.create(ctx).getContext().req.user);
