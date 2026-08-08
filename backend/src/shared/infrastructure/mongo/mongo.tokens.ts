/**
 * Jetons d'injection pour les objets du driver MongoDB.
 *
 * `Db` et `MongoClient` sont des classes tierces : on ne peut pas les utiliser
 * directement comme jeton (le conteneur ne saurait pas les construire). D'où ces
 * symboles, à utiliser avec @Inject(MONGO_DB).
 */
export const MONGO_CLIENT = Symbol('MONGO_CLIENT');
export const MONGO_DB = Symbol('MONGO_DB');
