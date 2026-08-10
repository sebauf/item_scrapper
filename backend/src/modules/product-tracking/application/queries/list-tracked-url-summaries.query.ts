import { Injectable } from '@nestjs/common';
import {
  TrackedUrlSummary,
  TrackedUrlSummaryReadModel,
} from '../ports/tracked-url-summary.read-model';

/** Requête — miroir de ListKeywordSummariesQuery. */
@Injectable()
export class ListTrackedUrlSummariesQuery {
  constructor(private readonly readModel: TrackedUrlSummaryReadModel) {}

  execute(): Promise<TrackedUrlSummary[]> {
    return this.readModel.listTracked();
  }
}
