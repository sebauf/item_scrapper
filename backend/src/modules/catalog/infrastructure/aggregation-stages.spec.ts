import { Document } from 'mongodb';
import { DEAL_SCORE_THRESHOLD } from '../domain/deal-policy';
import { escapeRegex, latestPerUrlStages, withDealScoreStages } from './aggregation-stages';

/**
 * Ces étages sont exécutés par Mongo, pas par nous : les tester revient à
 * décrire la *forme* du pipeline envoyé. C'est volontairement structurel —
 * vérifier le résultat d'une agrégation demanderait un vrai serveur, alors que
 * ce qu'on veut figer ici tient en trois points qui ont chacun cassé une page
 * par le passé : l'ordre tri → regroupement, la jointure à gauche sur les
 * scores, et le seuil « bonne affaire » lu depuis le domaine.
 *
 * `escapeRegex`, lui, est du vrai code et se teste sur son comportement.
 */
describe('latestPerUrlStages', () => {
  const stages = latestPerUrlStages({ keyword: 'lessive' });

  it('place le filtre en premier, pour que Mongo puisse utiliser un index', () => {
    expect(stages[0]).toEqual({ $match: { keyword: 'lessive' } });
  });

  it('trie avant de regrouper — sinon « le dernier relevé » est arbitraire', () => {
    const sortIndex = stages.findIndex((stage) => '$sort' in stage);
    const groupIndex = stages.findIndex((stage) => '$group' in stage);

    expect(sortIndex).toBeLessThan(groupIndex);
    expect(stages[sortIndex]).toEqual({ $sort: { day: -1, scrapedAt: -1 } });
  });

  it('départage deux scrapes du même jour par scrapedAt', () => {
    // Sans ce second critère, deux documents du même jour se classent au
    // hasard et un même produit peut apparaître sur deux pages successives.
    const sort = stages.find((stage) => '$sort' in stage) as Document;

    expect(Object.keys(sort.$sort)).toEqual(['day', 'scrapedAt']);
  });

  it('réduit à un document par URL', () => {
    expect(stages).toContainEqual({
      $group: { _id: '$url', doc: { $first: '$$ROOT' } },
    });
    expect(stages).toContainEqual({ $replaceRoot: { newRoot: '$doc' } });
  });

  it('écarte en dernier les produits inexploitables', () => {
    expect(stages[stages.length - 1]).toEqual({
      $match: { title: { $ne: '' }, price: { $ne: null } },
    });
  });
});

describe('withDealScoreStages', () => {
  const stages = withDealScoreStages();
  const lookup = stages.find((stage) => '$lookup' in stage) as Document;
  const computed = stages.filter((stage) => '$addFields' in stage).at(-1) as Document;

  it('joint deal_scores sur l’URL', () => {
    expect(lookup.$lookup).toEqual({
      from: 'deal_scores',
      localField: 'url',
      foreignField: '_id',
      as: 'scoreDoc',
    });
  });

  it('garde les produits sans score — la jointure est à gauche', () => {
    // $first sur le tableau du $lookup, jamais $unwind : un $unwind supprimerait
    // tout produit pas encore scoré, c'est-à-dire tous les nouveaux produits.
    expect(stages).toContainEqual({ $addFields: { scoreDoc: { $first: '$scoreDoc' } } });
    expect(stages.some((stage) => '$unwind' in stage)).toBe(false);
  });

  it('applique le seuil du domaine, sans le recopier', () => {
    expect(computed.$addFields.isDeal).toEqual({
      $gte: [{ $ifNull: ['$scoreDoc.score', -1] }, DEAL_SCORE_THRESHOLD],
    });
  });

  it('range les produits non scorés après les autres', () => {
    // -1 et non 0 : un produit au score nul reste au-dessus d'un produit sans
    // score, ce qui est le classement voulu.
    expect(computed.$addFields.sortScore).toEqual({ $ifNull: ['$scoreDoc.score', -1] });
  });

  it('calcule la remise seulement quand les deux prix sont exploitables', () => {
    expect(computed.$addFields.discountRatio.$cond[0]).toEqual({
      $and: [{ $gt: ['$crossedOutPrice.amount', 0] }, { $gt: ['$price.amount', 0] }],
    });
    expect(computed.$addFields.discountRatio.$cond[2]).toBe(0);
  });

  it('ne laisse pas fuiter le document de score dans la réponse', () => {
    expect(stages.at(-1)).toEqual({ $project: { scoreDoc: 0 } });
  });
});

describe('escapeRegex', () => {
  it('laisse une saisie ordinaire intacte', () => {
    expect(escapeRegex('lessive liquide')).toBe('lessive liquide');
  });

  it.each([
    ['.', '\\.'],
    ['*', '\\*'],
    ['+', '\\+'],
    ['?', '\\?'],
    ['^', '\\^'],
    ['$', '\\$'],
    ['{', '\\{'],
    ['}', '\\}'],
    ['(', '\\('],
    [')', '\\)'],
    ['|', '\\|'],
    ['[', '\\['],
    [']', '\\]'],
    ['\\', '\\\\'],
  ])('échappe %s', (input, expected) => {
    expect(escapeRegex(input)).toBe(expected);
  });

  it('neutralise une saisie qui tenterait de piloter le moteur de regex', () => {
    const escaped = escapeRegex('(a+)+$');

    // La saisie ne doit plus valoir que pour elle-même, littéralement.
    expect(new RegExp(escaped).test('(a+)+$')).toBe(true);
    expect(new RegExp(escaped).test('aaaa')).toBe(false);
  });

  it('produit toujours une expression compilable', () => {
    expect(() => new RegExp(escapeRegex('['))).not.toThrow();
    expect(() => new RegExp(escapeRegex('\\'))).not.toThrow();
  });
});
