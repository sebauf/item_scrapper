import { ArgumentsHost, Catch, ExceptionFilter, HttpStatus, Logger } from '@nestjs/common';
import { FastifyReply } from 'fastify';
import {
  ConflictError,
  DomainError,
  InvalidInputError,
  ResourceNotFoundError,
} from 'src/shared/domain/domain-error';

/**
 * Unique point de traduction erreur métier → réponse HTTP.
 *
 * Grâce à ça, ni le domaine ni les use cases n'importent quoi que ce soit de
 * @nestjs/common : ils restent testables sans framework.
 */
@Catch(DomainError)
export class DomainExceptionFilter implements ExceptionFilter<DomainError> {
  private readonly logger = new Logger(DomainExceptionFilter.name);

  catch(error: DomainError, host: ArgumentsHost): void {
    const status = DomainExceptionFilter.statusFor(error);
    const request = host.switchToHttp().getRequest<{ method: string; url: string }>();

    this.logger.warn(`${request.method} ${request.url} → ${status} ${error.code}: ${error.message}`);

    host.switchToHttp().getResponse<FastifyReply>().status(status).send({
      statusCode: status,
      code: error.code,
      message: error.message,
    });
  }

  private static statusFor(error: DomainError): number {
    if (error instanceof InvalidInputError) return HttpStatus.BAD_REQUEST;
    if (error instanceof ConflictError) return HttpStatus.CONFLICT;
    if (error instanceof ResourceNotFoundError) return HttpStatus.NOT_FOUND;
    return HttpStatus.INTERNAL_SERVER_ERROR;
  }
}
