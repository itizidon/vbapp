import { DashboardService } from './dashboard.service';
import { DashboardResolver } from './dashboard.resolver';
import{Module}from'@nestjs/common';import{AuthModule}from'../auth/auth.module';import{AnalyticsResolver}from'./analytics.resolver';@Module({imports:[AuthModule],providers:[AnalyticsResolver,DashboardService,DashboardResolver]})export class AnalyticsModule{}
