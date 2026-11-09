import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { matchDateFilter } from './match-date-filter';
import { isUUID } from 'class-validator';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service'; import { AddGuestParticipantInput,AddParticipantInput,CreateMatchInput,CreateTeamInput,UpdateMatchInput,UpdateTeamInput } from '../common/inputs';
@Injectable() export class MatchesService {
 constructor(private db:PrismaService){} private include={teams:true,participants:{include:{user:{select:{id:true,username:true}}}}} as const;
 async create(userId:string,input:CreateMatchInput={}){
  const {memberIds:members,guestNames:guests,teams:requestedTeams,...match}=input;
  const unassigned={memberIds:members??[],guestNames:(guests??[]).map(name=>name.trim())};
  const teams=(requestedTeams??[]).map(team=>({name:team.name?.trim()||undefined,score:team.score,memberIds:team.memberIds??[],guestNames:(team.guestNames??[]).map(name=>name.trim())}));
  const rosters=[unassigned,...teams];const memberIds=rosters.flatMap(roster=>roster.memberIds);const guestNames=rosters.flatMap(roster=>roster.guestNames);
  if(new Set(memberIds).size!==memberIds.length)throw new BadRequestException('A member can only be added once across all teams');
  if(memberIds.length+guestNames.length>50)throw new BadRequestException('A match supports at most 50 participants');
  if(teams.some(team=>team.score!=null&&(!Number.isInteger(team.score)||team.score<0||team.score>2147483647)))throw new BadRequestException('Scores must be non-negative whole numbers');
  if(teams.length>50)throw new BadRequestException('A match supports at most 50 teams');
  if(teams.some(team=>team.name&&team.name.length>100))throw new BadRequestException('Team names must contain at most 100 characters');
  if(guestNames.some(name=>!name||name.length>100))throw new BadRequestException('Guest names must contain 1–100 characters');
  try{
   if(!teams.length){const participants=[...memberIds.map(userId=>({userId})),...guestNames.map(guestName=>({guestName}))];return await this.db.match.create({data:{createdById:userId,...match,...(participants.length?{participants:{create:participants}}:{})},include:this.include})}
   return await this.db.$transaction(async tx=>{
    const created=await tx.match.create({data:{createdById:userId,...match}});
    const participants:{matchId:string;teamId?:string;userId?:string;guestName?:string}[]=[...unassigned.memberIds.map(userId=>({matchId:created.id,userId})),...unassigned.guestNames.map(guestName=>({matchId:created.id,guestName}))];
    for(const [index,team] of teams.entries()){
     const saved=await tx.matchTeam.create({data:{matchId:created.id,teamNumber:index+1,name:team.name,score:team.score}});
     participants.push(...team.memberIds.map(userId=>({matchId:created.id,teamId:saved.id,userId})),...team.guestNames.map(guestName=>({matchId:created.id,teamId:saved.id,guestName})));
    }
    if(participants.length)await tx.matchParticipant.createMany({data:participants});
    return tx.match.findUniqueOrThrow({where:{id:created.id},include:this.include});
   });
  }catch(error){if(error instanceof Prisma.PrismaClientKnownRequestError&&error.code==='P2003')throw new BadRequestException('A selected member or sport is no longer available');throw error}
 }
 async owned(id:string,userId:string){const match=await this.db.match.findUnique({where:{id}});if(!match)throw new NotFoundException('Match not found');if(match.createdById!==userId)throw new ForbiddenException('Only the organizer can modify this match');return match}
 async update(userId:string,input:UpdateMatchInput){await this.owned(input.id,userId);const {id,...data}=input;return this.db.match.update({where:{id},data,include:this.include})}
 async delete(userId:string,id:string){await this.owned(id,userId);return this.db.match.delete({where:{id},include:this.include})}
 async get(id:string,userId:string){const match=await this.db.match.findUnique({where:{id},include:this.include});if(!match)return null;if(match.createdById!==userId&&!match.participants.some(p=>p.userId===userId))throw new ForbiddenException('Match details are limited to organizers and participants');return match}
 list(userId:string,cursor?:string,playedFrom?:Date,playedBefore?:Date){return this.db.match.findMany({where:{...matchDateFilter(playedFrom,playedBefore),OR:[{createdById:userId},{participants:{some:{userId}}}]},include:this.include,take:11,...cursor?{cursor:{id:cursor},skip:1}:{},orderBy:[{createdAt:'desc'},{id:'desc'}]})}
 async publicHistory(userId:string,cursor?:string,playedFrom?:Date,playedBefore?:Date){
  if(!isUUID(userId)||cursor&&!isUUID(cursor))throw new BadRequestException('Invalid player ID or match cursor');
  const player=await this.db.user.findUnique({where:{id:userId},select:{isPublic:true}});
  if(!player)throw new NotFoundException('Player not found');
  if(!player.isPublic)throw new ForbiddenException('This account is private');
  // Recheck visibility in the data query so a privacy change cannot bypass the gate.
  return this.db.match.findMany({where:{...matchDateFilter(playedFrom,playedBefore),OR:[
   {createdBy:{id:userId,isPublic:true}},
   {participants:{some:{user:{id:userId,isPublic:true}}}},
  ]},include:this.include,take:11,...cursor?{cursor:{id:cursor},skip:1}:{},orderBy:[{createdAt:'desc'},{id:'desc'}]});
 }
 async createTeam(userId:string,input:CreateTeamInput){await this.owned(input.matchId,userId);return this.db.$transaction(async tx=>{let n=input.teamNumber;if(!n){const agg=await tx.matchTeam.aggregate({where:{matchId:input.matchId},_max:{teamNumber:true}});n=(agg._max.teamNumber??0)+1}return tx.matchTeam.create({data:{...input,teamNumber:n}})})}
 async updateTeam(userId:string,input:UpdateTeamInput){const t=await this.db.matchTeam.findUnique({where:{id:input.id}});if(!t)throw new NotFoundException();await this.owned(t.matchId,userId);const {id,...data}=input;return this.db.matchTeam.update({where:{id},data})}
 async removeTeam(userId:string,id:string){const t=await this.db.matchTeam.findUnique({where:{id}});if(!t)throw new NotFoundException();await this.owned(t.matchId,userId);await this.db.matchParticipant.updateMany({where:{teamId:id},data:{teamId:null}});return this.db.matchTeam.delete({where:{id}})}
 async addParticipant(actor:string,input:AddParticipantInput|AddGuestParticipantInput){await this.owned(input.matchId,actor);if(input.teamId){const team=await this.db.matchTeam.findFirst({where:{id:input.teamId,matchId:input.matchId}});if(!team)throw new BadRequestException('Team does not belong to match')}const data='userId'in input?{matchId:input.matchId,userId:input.userId,teamId:input.teamId}:{matchId:input.matchId,guestName:input.guestName.trim(),teamId:input.teamId};return this.db.matchParticipant.create({data})}
 async assign(actor:string,participantId:string,teamId?:string){const p=await this.db.matchParticipant.findUnique({where:{id:participantId}});if(!p)throw new NotFoundException();await this.owned(p.matchId,actor);if(teamId&&!await this.db.matchTeam.findFirst({where:{id:teamId,matchId:p.matchId}}))throw new BadRequestException('Team does not belong to match');return this.db.matchParticipant.update({where:{id:participantId},data:{teamId:teamId??null}})}
 async removeParticipant(actor:string,id:string){const p=await this.db.matchParticipant.findUnique({where:{id}});if(!p)throw new NotFoundException();await this.owned(p.matchId,actor);return this.db.matchParticipant.delete({where:{id}})}
 async score(actor:string,teamId:string,score:number|null){const t=await this.db.matchTeam.findUnique({where:{id:teamId}});if(!t)throw new NotFoundException();await this.owned(t.matchId,actor);if(score!==null&&score<0)throw new BadRequestException();return this.db.matchTeam.update({where:{id:teamId},data:{score}})}
}
