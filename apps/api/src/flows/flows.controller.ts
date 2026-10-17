import { Controller, Delete, Get, Headers, HttpCode, Param, Post, Put, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { JsonBody } from '../http/json-body.js';
import type { FlowResource, FlowSummary, Page, VersionResource, VersionSummary } from './flow-resources.js';
import { FlowsService, type FlowValidationResponse } from './flows.service.js';
import { etagOf } from './if-match.js';
import { parseListQuery } from './list-query.js';

/** Las rutas específicas (`validate`) se declaran antes que las de parámetro. */
@Controller('flows')
export class FlowsController {
  constructor(private readonly flowsService: FlowsService) {}

  /** Valida un flujo contra la spec sin guardarlo. Siempre 200 con el veredicto: no necesita la base de datos. */
  @Post('validate')
  @HttpCode(200)
  validate(@JsonBody() flow: unknown): FlowValidationResponse {
    return this.flowsService.validate(flow);
  }

  /** Crea un flujo: 201 con `Location` y `ETag`. */
  @Post()
  async create(@JsonBody() flow: unknown, @Res({ passthrough: true }) response: Response): Promise<FlowResource> {
    const resource = await this.flowsService.create(flow);
    response.setHeader('Location', `/flows/${resource.id}`);
    response.setHeader('ETag', etagOf(resource.revision));
    return resource;
  }

  @Get()
  list(@Query() query: Record<string, unknown>): Promise<Page<FlowSummary>> {
    return this.flowsService.list(parseListQuery(query));
  }

  @Get(':flowId')
  async get(@Param('flowId') flowId: string, @Res({ passthrough: true }) response: Response): Promise<FlowResource> {
    const resource = await this.flowsService.get(flowId);
    response.setHeader('ETag', etagOf(resource.revision));
    return resource;
  }

  /** Sustituye el borrador. `If-Match` obligatorio. */
  @Put(':flowId')
  async update(
    @Param('flowId') flowId: string,
    @Headers('if-match') ifMatch: string | undefined,
    @JsonBody() flow: unknown,
    @Res({ passthrough: true }) response: Response,
  ): Promise<FlowResource> {
    const resource = await this.flowsService.update(flowId, ifMatch, flow);
    response.setHeader('ETag', etagOf(resource.revision));
    return resource;
  }

  /** Borrado lógico: 204. `If-Match` opcional. */
  @Delete(':flowId')
  @HttpCode(204)
  async remove(@Param('flowId') flowId: string, @Headers('if-match') ifMatch: string | undefined): Promise<void> {
    await this.flowsService.remove(flowId, ifMatch);
  }

  /** Publica el borrador: 201 con la versión nueva o 200 con la última si no hay cambios. `If-Match` opcional. */
  @Post(':flowId/versions')
  async publish(
    @Param('flowId') flowId: string,
    @Headers('if-match') ifMatch: string | undefined,
    @Res({ passthrough: true }) response: Response,
  ): Promise<VersionResource> {
    const { resource, created } = await this.flowsService.publish(flowId, ifMatch);
    response.status(created ? 201 : 200);
    if (created) response.setHeader('Location', `/flows/${resource.flowId}/versions/${resource.version}`);
    return resource;
  }

  @Get(':flowId/versions')
  listVersions(@Param('flowId') flowId: string, @Query() query: Record<string, unknown>): Promise<Page<VersionSummary>> {
    return this.flowsService.listVersions(flowId, parseListQuery(query));
  }

  @Get(':flowId/versions/:version')
  getVersion(@Param('flowId') flowId: string, @Param('version') version: string): Promise<VersionResource> {
    return this.flowsService.getVersion(flowId, version);
  }
}
