import { Injectable } from '@nestjs/common';
import { UserId } from 'src/shared/domain/user-id';
import {
  TrackedUrlSummary,
  TrackedUrlSummaryReadModel,
} from '../ports/tracked-url-summary.read-model';

/** Requête — miroir de ListKeywordSummariesQuery. */
@Injectable()
export class ListTrackedUrlSummariesQuery {
  constructor(private readonly readModel: TrackedUrlSummaryReadModel) {}

  execute(owner: UserId): Promise<TrackedUrlSummary[]> {
    return this.readModel.listTracked(owner);
  }
}
