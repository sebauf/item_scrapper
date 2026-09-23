import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { createHash, timingSafeEqual } from 'node:crypto';
import { AppConfig } from 'src/config/app-config';

/**
 * Protège les routes d'administration par `Authorization: Bearer <ADMIN_TOKEN>`.
 *
 * Nécessaire alors même que le backend n'a pas d'Ingress : le frontend, lui,
 * est ouvert à tout le réseau et relaie la demande. C'est donc le backend qui
 * vérifie le jeton saisi par l'utilisateur — le frontend ne le connaît pas.
 *
 * L'authentification est une affaire HTTP, pas une règle métier : elle vit
 * ici, dans l'adaptateur, et non dans le domaine.
 */
@Injectable()
export class AdminTokenGuard implements CanActivate {
  constructor(private readonly config: AppConfig) {}

  canActivate(context: ExecutionContext): boolean {
    if (this.config.adminToken === null) {
      throw new ForbiddenException({
        statusCode: 403,
        code: 'ADMIN_DISABLED',
        message: "ADMIN_TOKEN n'est pas configuré : les mises à jour depuis l'interface sont désactivées.",
      });
    }

    const header = context.switchToHttp().getRequest<{ headers: Record<string, string | undefined> }>()
      .headers.authorization;
    const provided = /^Bearer\s+(.+)$/i.exec(header ?? '')?.[1];

    if (provided === undefined || !sameSecret(provided, this.config.adminToken)) {
      throw new UnauthorizedException({
        statusCode: 401,
        code: 'INVALID_ADMIN_TOKEN',
        message: 'Jeton administrateur invalide.',
      });
    }
    return true;
  }
}

/**
 * Comparaison à temps constant, sur des empreintes de même longueur : un `===`
 * s'arrête au premier octet différent, et le temps de réponse révélerait alors
 * le jeton octet par octet ; comparer les longueurs d'abord en révélerait la
 * taille.
 */
function sameSecret(provided: string, expected: string): boolean {
  const digest = (value: string) => createHash('sha256').update(value).digest();
  return timingSafeEqual(digest(provided), digest(expected));
}
