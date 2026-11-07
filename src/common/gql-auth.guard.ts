import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { GqlExecutionContext } from '@nestjs/graphql';
@Injectable()
export class GqlAuthGuard implements CanActivate {
  constructor(private readonly jwt:JwtService){}
  async canActivate(context:ExecutionContext){
    const req=GqlExecutionContext.create(context).getContext().req;
    const value=req.headers?.authorization as string|undefined;
    if(!value?.startsWith('Bearer ')) throw new UnauthorizedException();
    try { req.user=await this.jwt.verifyAsync(value.slice(7)); return true; } catch { throw new UnauthorizedException('Invalid or expired token'); }
  }
}
