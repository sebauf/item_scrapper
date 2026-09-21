import { ArgumentsHost, Logger } from '@nestjs/common';
import {
  ConflictError,
  DomainError,
  InvalidInputError,
  ResourceNotFoundError,
} from 'src/shared/domain/domain-error';
import { DomainExceptionFilter } from './domain-exception.filter';

/**
 * Unique traduction erreur métier → HTTP. Un statut faux ici se voit sur tout
 * le site à la fois : le frontend décide quoi afficher à partir du statut
 * (`getProduct` transforme 404 et 400 en page « produit inconnu »).
 */
class SaisieInvalide extends InvalidInputError {
  readonly code = 'SAISIE_INVALIDE';
}
class DejaExistant extends ConflictError {
  readonly code = 'DEJA_EXISTANT';
}
class Introuvable extends ResourceNotFoundError {
  readonly code = 'INTROUVABLE';
}
/** Erreur métier qui n'hérite d'aucune des trois familles — cas non prévu. */
class ErreurOrpheline extends DomainError {
  readonly code = 'ORPHELINE';
}

describe('DomainExceptionFilter', () => {
  const filter = new DomainExceptionFilter();
  let send: jest.Mock;
  let status: jest.Mock;
  let host: ArgumentsHost;

  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    send = jest.fn();
    status = jest.fn().mockReturnValue({ send });
    host = {
      switchToHttp: () => ({
        getRequest: () => ({ method: 'GET', url: '/api/v1/products/xxx' }),
        getResponse: () => ({ status }),
      }),
    } as unknown as ArgumentsHost;
  });

  afterEach(() => jest.restoreAllMocks());

  it.each([
    ['une saisie invalide', new SaisieInvalide('nom vide'), 400],
    ['un conflit', new DejaExistant('déjà suivi'), 409],
    ['une ressource absente', new Introuvable('inconnu'), 404],
  ])('traduit %s', (_label, error, expected) => {
    filter.catch(error, host);

    expect(status).toHaveBeenCalledWith(expected);
  });

  it('retombe sur 500 pour une erreur métier hors nomenclature', () => {
    // Comportement voulu : une erreur qui n'hérite d'aucune des trois familles
    // est un bug non anticipé, pas un refus à présenter à l'utilisateur.
    filter.catch(new ErreurOrpheline('cas non prévu'), host);

    expect(status).toHaveBeenCalledWith(500);
  });

  it('renvoie un corps exploitable par le client', () => {
    filter.catch(new SaisieInvalide('le nom est vide'), host);

    expect(send).toHaveBeenCalledWith({
      statusCode: 400,
      code: 'SAISIE_INVALIDE',
      message: 'le nom est vide',
    });
  });

  it('journalise la requête refusée', () => {
    const warn = jest.spyOn(Logger.prototype, 'warn');

    filter.catch(new Introuvable('produit inconnu'), host);

    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('GET /api/v1/products/xxx → 404 INTROUVABLE'),
    );
  });
});

describe('DomainError', () => {
  it('porte le nom de sa sous-classe, utile en log et en trace', () => {
    expect(new SaisieInvalide('x').name).toBe('SaisieInvalide');
    expect(new SaisieInvalide('x')).toBeInstanceOf(Error);
  });
});
