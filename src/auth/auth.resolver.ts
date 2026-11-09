import { Args, ID, Mutation, Query, Resolver } from '@nestjs/graphql';
import { UseGuards } from '@nestjs/common';
import { AuthService } from './auth.service'; import { AuthPayload,UserModel,MemberModel,PlayerDirectoryModel } from '../common/models'; import { LoginInput,RegisterInput } from '../common/inputs'; import { GqlAuthGuard } from '../common/gql-auth.guard'; import { AuthUser,CurrentUser } from '../common/current-user.decorator';
@Resolver() export class AuthResolver { constructor(private service:AuthService){} @Mutation(()=>AuthPayload) register(@Args('input') i:RegisterInput){return this.service.register(i)} @Mutation(()=>AuthPayload) login(@Args('input') i:LoginInput){return this.service.login(i)} @UseGuards(GqlAuthGuard) @Query(()=>[MemberModel]) members(@CurrentUser() u:AuthUser,@Args('search') search:string){return this.service.members(u.id,search)} @UseGuards(GqlAuthGuard) @Query(()=>UserModel) me(@CurrentUser() u:AuthUser){return this.service.me(u.id)} }

@Resolver() export class PlayerDirectoryResolver {
 constructor(private service:AuthService){}
 @UseGuards(GqlAuthGuard) @Query(()=>[PlayerDirectoryModel]) playerSuggestions(@Args('search')search:string){return this.service.playerSuggestions(search)}
 @Query(()=>[PlayerDirectoryModel]) searchPlayers(@Args('search',{defaultValue:''}) search:string,@Args('cursor',{nullable:true})cursor?:string){return this.service.searchPlayers(search,cursor)}
 @Query(()=>PlayerDirectoryModel) playerProfile(@Args('id',{type:()=>ID})id:string){return this.service.playerProfile(id)}
 @UseGuards(GqlAuthGuard) @Mutation(()=>UserModel) updateAccountVisibility(@CurrentUser()u:AuthUser,@Args('isPublic')isPublic:boolean){return this.service.updateVisibility(u.id,isPublic)}
}
