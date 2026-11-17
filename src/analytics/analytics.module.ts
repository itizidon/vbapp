import { FeedbackProfileWorker } from "../feedback-analysis/profile-worker";
import { FeedbackAnalysisService } from "../feedback-analysis/service";
import { FeedbackAnalysisResolver } from "../feedback-analysis/resolver";
import { DashboardService } from './dashboard.service';
import { DashboardResolver } from './dashboard.resolver';
import{Module}from'@nestjs/common';import{AuthModule}from'../auth/auth.module';import{AnalyticsResolver}from'./analytics.resolver';@Module({imports:[AuthModule],exports:[FeedbackAnalysisService],providers:[FeedbackProfileWorker,FeedbackAnalysisService,FeedbackAnalysisResolver,AnalyticsResolver,DashboardService,DashboardResolver]})export class AnalyticsModule{}
