import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { aFuelPrice, aFuelStation } from '@/testing/fixtures';
import { FuelStationList } from './FuelStationList';

/**
 * La liste est la seule vue des stations testable sans navigateur (la carte
 * Leaflet exige un vrai DOM de rendu). Ce qui doit s'y lire sans ambiguïté :
 * le prix du carburant choisi, les ruptures, et les prix anciens.
 */
const noTier = () => null;

function renderList(stations = [aFuelStation()], fuel: 'gazole' | null = 'gazole') {
  const onSelect = vi.fn();
  render(
    <FuelStationList stations={stations} fuel={fuel} tierOf={noTier} selectedId={null} onSelect={onSelect} />,
  );
  return { onSelect };
}

const text = (s: string) => s.replace(/\s/g, ' ');

describe('FuelStationList', () => {
  it('affiche enseigne, adresse, distance et prix du carburant choisi', () => {
    renderList();

    expect(screen.getByText('TotalEnergies')).toBeInTheDocument();
    expect(screen.getByText(/TotalEnergies Lyon Félix Faure/)).toBeInTheDocument();
    expect(screen.getByText('12 avenue Félix Faure')).toBeInTheDocument();
    expect(screen.getByText(/69003 Lyon · 1,2 km/)).toBeInTheDocument();
    // En gros à droite, et dans la pastille du carburant.
    expect(screen.getAllByText((_, el) => text(el?.textContent ?? '') === '1,689 €')).not.toHaveLength(0);
  });

  it('signale une rupture plutôt qu’un prix', () => {
    renderList([
      aFuelStation({
        fuels: [aFuelPrice({ available: false, price: null, shortageSince: '2026-10-24T09:00:00.000Z' })],
      }),
    ]);

    expect(screen.getByText('rupture')).toBeInTheDocument();
    expect(screen.queryByText(/€/)).not.toBeInTheDocument();
  });

  it('marque un prix ancien comme à vérifier', () => {
    renderList([aFuelStation({ fuels: [aFuelPrice({ isStale: true })] })]);

    expect(screen.getByLabelText('prix ancien, à vérifier')).toBeInTheDocument();
  });

  it('signale une station d’autoroute', () => {
    renderList([aFuelStation({ roadType: 'A' })]);

    expect(screen.getByText(/autoroute/)).toBeInTheDocument();
  });

  it('sélectionne une station au clic', async () => {
    const { onSelect } = renderList();

    await userEvent.click(screen.getByRole('button'));

    expect(onSelect).toHaveBeenCalledWith('69003001');
  });

  it('explique une liste vide', () => {
    renderList([], 'gazole');

    expect(screen.getByText(/Aucune station dans cette zone ne vend de Gazole/)).toBeInTheDocument();
  });
});
