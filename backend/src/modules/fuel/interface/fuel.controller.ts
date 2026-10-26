import { Controller, Get, Query } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { SearchFuelStationsQuery } from '../application/queries/search-fuel-stations.query';
import { FuelStationSearchQueryDto } from './dto/fuel-station-search.query';
import { FuelStationSearchResponse } from './dto/fuel-station.response';

@ApiTags('fuel')
@Controller('fuel-stations')
export class FuelStationController {
  constructor(private readonly searchStations: SearchFuelStationsQuery) {}

  @Get()
  @ApiOperation({ summary: 'Stations-service autour d’un point, avec carburants et prix' })
  @ApiResponse({ status: 200, type: FuelStationSearchResponse })
  @ApiResponse({ status: 400, description: 'Position, rayon, carburant ou tri invalide' })
  search(@Query() query: FuelStationSearchQueryDto): Promise<FuelStationSearchResponse> {
    return this.searchStations.execute(query);
  }
}
