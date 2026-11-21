import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { SelfAssessmentsResolver } from "./self-assessments.resolver";
// AuthModule exports the singleton metadata/history service used by guards and resolvers.
@Module({ imports: [AuthModule], providers: [SelfAssessmentsResolver] })
export class SelfAssessmentsModule {}
