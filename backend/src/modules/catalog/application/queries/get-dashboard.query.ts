import { Injectable } from '@nestjs/common';
import { UserId } from 'src/shared/domain/user-id';
import { DashboardReadModel, DashboardSnapshot } from '../ports/dashboard.read-model';

@Injectable()
export class GetDashboardQuery {
  constructor(private readonly readModel: DashboardReadModel) {}

  execute(owner: UserId): Promise<DashboardSnapshot> {
    return this.readModel.load(owner);
  }
}
