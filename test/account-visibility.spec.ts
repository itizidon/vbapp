import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { AuthService } from '../src/auth/auth.service';
import { MatchesService } from '../src/matches/matches.service';
const id='11111111-1111-4111-8111-111111111111';
describe('account visibility and player directory',()=>{
 it('only updates the authenticated account visibility',async()=>{
  const db:any={user:{update:jest.fn().mockResolvedValue({id,isPublic:true})}};
  await new AuthService(db,{} as any).updateVisibility(id,true);
  expect(db.user.update).toHaveBeenCalledWith({where:{id},data:{isPublic:true}});
 });
 it('searches both private and public players without exposing personal details',async()=>{
  const db:any={user:{findMany:jest.fn().mockResolvedValue([])}};
  await new AuthService(db,{} as any).searchPlayers(' Taylor ');
  expect(db.user.findMany).toHaveBeenCalledWith({where:{username:{contains:'Taylor',mode:'insensitive'}},select:{id:true,username:true,isPublic:true},orderBy:[{username:'asc'},{id:'asc'}],take:51});
 });
 it('supports browsing all players and paginates without excluding private accounts',async()=>{
  const db:any={user:{findMany:jest.fn().mockResolvedValue([])}};
  await new AuthService(db,{} as any).searchPlayers('',id);
  expect(db.user.findMany).toHaveBeenCalledWith(expect.objectContaining({where:{},cursor:{id},skip:1,take:51}));
 });
 it('rejects malformed input before querying',async()=>{
  const db:any={user:{findMany:jest.fn(),findUnique:jest.fn()}};
  const service=new AuthService(db,{} as any);
  await expect(service.searchPlayers('a'.repeat(41))).rejects.toBeInstanceOf(BadRequestException);
  await expect(service.searchPlayers('','invalid')).rejects.toBeInstanceOf(BadRequestException);
  await expect(service.playerProfile('invalid')).rejects.toBeInstanceOf(BadRequestException);
  expect(db.user.findMany).not.toHaveBeenCalled();expect(db.user.findUnique).not.toHaveBeenCalled();
 });
 it('returns only directory fields for private profile headers',async()=>{
  const db:any={user:{findUnique:jest.fn().mockResolvedValue({id,username:'Taylor',isPublic:false})}};
  await expect(new AuthService(db,{} as any).playerProfile(id)).resolves.toMatchObject({isPublic:false});
  expect(db.user.findUnique).toHaveBeenCalledWith({where:{id},select:{id:true,username:true,isPublic:true}});
 });
});
describe('public match history access',()=>{
 it('rejects private history before loading any matches',async()=>{
  const db:any={user:{findUnique:jest.fn().mockResolvedValue({isPublic:false})},match:{findMany:jest.fn()}};
  await expect(new MatchesService(db).publicHistory(id)).rejects.toBeInstanceOf(ForbiddenException);
  expect(db.match.findMany).not.toHaveBeenCalled();
 });
 it('rejects missing players',async()=>{
  const db:any={user:{findUnique:jest.fn().mockResolvedValue(null)}};
  await expect(new MatchesService(db).publicHistory(id)).rejects.toBeInstanceOf(NotFoundException);
 });
 it('rechecks public visibility in the match query and includes only match data',async()=>{
  const db:any={user:{findUnique:jest.fn().mockResolvedValue({isPublic:true})},match:{findMany:jest.fn().mockResolvedValue([])}};
  await new MatchesService(db).publicHistory(id,id);
  expect(db.match.findMany).toHaveBeenCalledWith({where:{OR:[{createdBy:{id,isPublic:true}},{participants:{some:{user:{id,isPublic:true}}}}]},include:{teams:true,participants:{include:{user:{select:{id:true,username:true}}}}},take:11,cursor:{id},skip:1,orderBy:[{createdAt:'desc'},{id:'desc'}]});
 });
 it('does not grant public viewers match-editing rights',async()=>{
  const db:any={match:{findUnique:jest.fn().mockResolvedValue({createdById:'owner'}),update:jest.fn()}};
  await expect(new MatchesService(db).update('viewer',{id,description:'Changed'})).rejects.toBeInstanceOf(ForbiddenException);
  expect(db.match.update).not.toHaveBeenCalled();
 });
});
