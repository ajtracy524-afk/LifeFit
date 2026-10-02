import { useState } from 'react';
import { getFood } from '../../data/foods';
import type { ISODate, Product } from '../../domain/types';
import { formatGrams } from '../../lib/format';
import { applyWithUndo } from '../../lib/undo';
import { saveProduct } from '../../store/actions';
import { getState } from '../../store/store';
import { productViolates } from '../../domain/week/pantryOnboarding';
import { showToast } from '../../lib/toast';
import { Button } from '../../components/ui/Button';
import { Sheet } from '../../components/ui/Sheet';
import { BarcodeLookup } from '../nutrition/BarcodeLookup';
import { ProductConfirm } from '../nutrition/ProductConfirm';

/**
 * Bought → pantry (eaten → log, elsewhere). A scanned purchase goes through
 * the same cascade as ticking off the list: pantry up, list item done. Only
 * with a catalog food – otherwise the planner could not use it anyway.
 * Prices are not taken from the product database (it has none).
 */
export function ProductPurchaseSheet({ week, open, onClose }: { week: ISODate; open: boolean; onClose: () => void }) {
  const [product, setProduct] = useState<Product | null>(null);
  const close = () => {
    setProduct(null);
    onClose();
  };

  return (
    <Sheet open={open} onClose={close} title={product ? 'Gekauft – in den Vorrat' : 'Gekauftes Produkt scannen'} subtitle="Vorrat & Einkaufsliste werden aktualisiert">
      {open &&
        (product ? (
          <ProductConfirm
            product={product}
            purpose="purchase"
            onComplete={() => undefined}
            footer={(choice) => (
              <>
                <Button variant="secondary" onClick={() => setProduct(null)}>
                  Zurück
                </Button>
                <Button
                  block
                  icon="check"
                  disabled={!choice?.foodId}
                  onClick={() => {
                    if (!choice?.foodId) return;
                    saveProduct({ ...product, foodId: choice.foodId, ...(choice.price ? { price: { ...choice.price, at: new Date().toISOString() } } : {}) });
                    // Against a hard exclusion (Prompt 6): kept and marked, but never stock for the plan.
                    if (productViolates({ ...product, foodId: choice.foodId }, getState().nutritionProfile)) {
                      showToast('Gespeichert – passt nicht zu deinen Ausschlüssen und wird nie eingeplant.');
                      return close();
                    }
                    if (applyWithUndo({ type: 'purchase', week, foodId: choice.foodId, grams: Math.round(choice.amount) })) close();
                  }}
                >
                  {choice?.foodId ? `${formatGrams(choice.amount)} ${getFood(choice.foodId)?.name ?? ''} in den Vorrat` : 'Lebensmittel wählen'}
                </Button>
              </>
            )}
          />
        ) : (
          <BarcodeLookup onFound={setProduct} onManual={close} />
        ))}
    </Sheet>
  );
}
