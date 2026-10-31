import {
  CanActivate,
  createParamDecorator,
  ExecutionContext,
  Logger,
  SetMetadata,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { UserId } from 'src/shared/domain/user-id';
import {
  InvalidInternalToken,
  verifyInternalToken,
} from 'src/shared/infrastructure/auth/internal-token';

const IS_PUBLIC = 'auth:isPublic';

/**
 * Exempte une route (ou un contrôleur) d'authentification. Réservé aux sondes
 * Kubernetes : le kubelet n'a pas de jeton, et une sonde n'expose rien.
 */
export const Public = (): MethodDecorator & ClassDecorator => SetMetadata(IS_PUBLIC, true);

interface AuthenticatedRequest {
  headers: Record<string, string | string[] | undefined>;
  method: string;
  url: string;
  user?: UserId;
}

/**
 * Garde globale : **toute** route est authentifiée, sauf `@Public()`.
 *
 * Le choix inverse (marquer les routes protégées) ferait d'un oubli une route
 * ouverte ; ici un oubli donne un 401, qui se voit tout de suite.
 *
 * Posée par `configureApp`, donc traversée aussi par les tests d'API.
 */
export class AuthGuard implements CanActivate {
  private readonly logger = new Logger(AuthGuard.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly secret: string,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const header = request.headers.authorization;
    const token =
      typeof header === 'string' && header.startsWith('Bearer ') ? header.slice(7).trim() : '';

    if (!token) throw new UnauthorizedException('Authentification requise.');

    try {
      request.user = verifyInternalToken(token, this.secret).userId;
      return true;
    } catch (error) {
      if (!(error instanceof InvalidInternalToken)) throw error;
      // Le motif précis reste dans les journaux : le renvoyer aiderait surtout
      // quelqu'un qui cherche à forger un jeton.
      this.logger.warn(`${request.method} ${request.url} → 401 (${error.message})`);
      throw new UnauthorizedException('Authentification requise.');
    }
  }
}

/**
 * Injecte l'utilisateur authentifié dans un paramètre de contrôleur :
 *
 *     list(@CurrentUser() user: UserId)
 *
 * Le contrôleur le passe ensuite explicitement aux commandes et requêtes,
 * plutôt que de rendre les services « request-scoped » : la couche application
 * reste testable sans contexte HTTP, et l'on voit à la signature qu'une
 * opération porte sur les données d'un utilisateur.
 */
export const CurrentUser = createParamDecorator((_data: unknown, context: ExecutionContext) => {
  const user = context.switchToHttp().getRequest<AuthenticatedRequest>().user;
  // Ne peut arriver que sur une route @Public() qui demanderait un utilisateur :
  // une erreur de programmation, pas une requête à refuser poliment.
  if (!user) throw new Error('@CurrentUser() utilisé sur une route sans authentification.');
  return user;
});
