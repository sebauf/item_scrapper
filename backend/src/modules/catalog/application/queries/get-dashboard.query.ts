import { Injectable } from '@nestjs/common';
import { DashboardReadModel, DashboardSnapshot } from '../ports/dashboard.read-model';

/**
 * Remplace frontend/src/lib/queries.ts:fetchDashboardData.
 */
@Injectable()
export class GetDashboardQuery {
  constructor(private readonly readModel: DashboardReadModel) {}

  execute(): Promise<DashboardSnapshot> {
    return this.readModel.load();
  }
}
