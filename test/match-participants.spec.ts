import {BadRequestException} from '@nestjs/common';
import {MatchesService} from '../src/matches/matches.service';
import {AuthService} from '../src/auth/auth.service';
import {plainToInstance} from 'class-transformer';
import {validate} from 'class-validator';
import {CreateMatchInput} from '../src/common/inputs';

describe('match participant creation',()=>{
 it('creates members and trimmed guests in one atomic nested write',async()=>{const db:any={match:{create:jest.fn().mockResolvedValue({id:'match'})}};await new MatchesService(db).create('owner',{memberIds:['owner','member'],guestNames:[' Taylor ']});expect(db.match.create).toHaveBeenCalledWith(expect.objectContaining({data:{createdById:'owner',participants:{create:[{userId:'owner'},{userId:'member'},{guestName:'Taylor'}]}}}))});
 it.each([{memberIds:['same','same']},{guestNames:['   ']},{guestNames:Array(51).fill('Guest')}])('rejects invalid rosters before writing',async input=>{const db:any={match:{create:jest.fn()}};await expect(new MatchesService(db).create('owner',input)).rejects.toBeInstanceOf(BadRequestException);expect(db.match.create).not.toHaveBeenCalled()});
 it('validates participant input shape and UUIDs',async()=>{const errors=await validate(plainToInstance(CreateMatchInput,{memberIds:['bad-id'],guestNames:[123]}));expect(errors.map(e=>e.property)).toEqual(expect.arrayContaining(['memberIds','guestNames']))});
});
describe('authenticated member search',()=>{
 it('returns username and ID only, with a bounded search',async()=>{const db:any={user:{findMany:jest.fn().mockResolvedValue([{id:'other',username:'Taylor'}])}};const service=new AuthService(db,{}as any);await service.members('me',' Tay ');expect(db.user.findMany).toHaveBeenCalledWith({where:{id:{not:'me'},username:{contains:'Tay',mode:'insensitive'}},select:{id:true,username:true},orderBy:{username:'asc'},take:10})});
 it('does not list the directory for short searches',async()=>{const db:any={user:{findMany:jest.fn()}};expect(await new AuthService(db,{}as any).members('me','a')).toEqual([]);expect(db.user.findMany).not.toHaveBeenCalled()});
});

describe('team rosters at creation',()=>{
 it('creates teams before assigning registered and guest participants in the transaction',async()=>{
  const tx:any={match:{create:jest.fn().mockResolvedValue({id:'m'}),findUniqueOrThrow:jest.fn().mockResolvedValue({id:'m'})},matchTeam:{create:jest.fn().mockResolvedValueOnce({id:'t1'}).mockResolvedValueOnce({id:'t2'})},matchParticipant:{createMany:jest.fn()}};
  const db:any={$transaction:jest.fn(fn=>fn(tx))};
  await new MatchesService(db).create('owner',{memberIds:['unassigned'],teams:[{name:' Sand ',score:0,memberIds:['owner']},{name:'Sea',score:21,guestNames:[' Taylor ']}]});
  expect(tx.matchTeam.create).toHaveBeenNthCalledWith(1,{data:{matchId:'m',teamNumber:1,name:'Sand',score:0}});
  expect(tx.matchTeam.create).toHaveBeenNthCalledWith(2,{data:{matchId:'m',teamNumber:2,name:'Sea',score:21}});
  expect(tx.matchParticipant.createMany).toHaveBeenCalledWith({data:[{matchId:'m',userId:'unassigned'},{matchId:'m',teamId:'t1',userId:'owner'},{matchId:'m',teamId:'t2',guestName:'Taylor'}]});
 });
 it('rejects a player repeated across teams before any writes',async()=>{const db:any={$transaction:jest.fn()};await expect(new MatchesService(db).create('owner',{teams:[{memberIds:['same']},{memberIds:['same']}]})).rejects.toBeInstanceOf(BadRequestException);expect(db.$transaction).not.toHaveBeenCalled()});
 it('validates nested team inputs',async()=>{const errors=await validate(plainToInstance(CreateMatchInput,{teams:[{name:'x'.repeat(101),memberIds:['bad-id']}]}));expect(errors.some(error=>error.property==='teams')).toBe(true)});
});

describe('scores at match creation',()=>{
 it.each([-1, 1.5, 2147483648])('rejects invalid scores before writing: %s',async score=>{
  const db:any={$transaction:jest.fn()};
  await expect(new MatchesService(db).create('owner',{teams:[{score}]})).rejects.toBeInstanceOf(BadRequestException);
  expect(db.$transaction).not.toHaveBeenCalled();
 });
 it.each([-1, 1.5, 2147483648])('validates nested score input: %s',async score=>{
  const errors=await validate(plainToInstance(CreateMatchInput,{teams:[{score}]}));
  expect(errors.some(error=>error.property==='teams')).toBe(true);
 });
});
