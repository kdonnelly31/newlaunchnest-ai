const MAX_TEXT_LENGTH = 2000;

// Section-level and item-level fields a buyer is allowed to fix typos in.
// Anything not listed here (type, imageId, item.imageId, and the sections/
// items array shape itself) is structural -- it's what the AI actually
// decided about composition and photo placement, and this feature is only
// meant to let buyers correct wording, not redesign the page.
const TEXT_FIELDS = ['eyebrow', 'headline', 'subheadline', 'body', 'ctaText', 'trustIndicators', 'supportingFacts', 'occasions', 'supportingText'];
const ITEM_TEXT_FIELDS = ['heading', 'body', 'caption', 'label', 'value'];

// Merges one field's edited value onto its original, dispatching on the
// ORIGINAL value's shape (null / string / array-of-strings) so a malformed
// or missing edit falls back to the original rather than corrupting stored
// data -- only a structural mismatch (handled by the caller, not here) is
// worth a hard failure.
function mergeTextField(original, edited) {
  if (original === null) {
    if (typeof edited !== 'string') return null;
    const trimmed = edited.trim().slice(0, MAX_TEXT_LENGTH);
    return trimmed || null;
  }

  if (Array.isArray(original)) {
    if (!Array.isArray(edited) || edited.length !== original.length) return original;
    return edited.map((value, i) => {
      if (typeof value !== 'string') return original[i];
      const trimmed = value.trim().slice(0, MAX_TEXT_LENGTH);
      return trimmed || original[i];
    });
  }

  if (typeof edited !== 'string') return original;
  const trimmed = edited.trim().slice(0, MAX_TEXT_LENGTH);
  return trimmed || original;
}

// Applies buyer-submitted text corrections onto a stored pagePlan, rejecting
// anything that isn't a pure wording change. `editedSections` is whatever
// the client posts back -- untrusted input, so every structural invariant
// (section count/type/order, image placement, item count) is checked
// against the ALREADY-VALIDATED stored plan rather than trusted from the
// request. Returns a new pagePlan; never mutates `storedPagePlan`.
export function applyTextEdits(storedPagePlan, editedSections) {
  const { sections } = storedPagePlan;
  if (!Array.isArray(editedSections) || editedSections.length !== sections.length) {
    throw new Error('Edited page must have the same number of sections as the original.');
  }

  const newSections = sections.map((original, i) => {
    const edited = editedSections[i] ?? {};
    if (edited.type !== original.type) {
      throw new Error(`Section ${i} ("${original.type}") type cannot be changed.`);
    }
    if ((edited.imageId ?? null) !== (original.imageId ?? null)) {
      throw new Error(`Section ${i} ("${original.type}") image cannot be changed.`);
    }

    const editedItems = Array.isArray(edited.items) ? edited.items : [];
    if (editedItems.length !== original.items.length) {
      throw new Error(`Section ${i} ("${original.type}") item count cannot be changed.`);
    }

    const newItems = original.items.map((originalItem, j) => {
      const editedItem = editedItems[j] ?? {};
      if ((editedItem.imageId ?? null) !== (originalItem.imageId ?? null)) {
        throw new Error(`Section ${i} ("${original.type}") item ${j} image cannot be changed.`);
      }
      const newItem = { ...originalItem };
      for (const field of ITEM_TEXT_FIELDS) {
        newItem[field] = mergeTextField(originalItem[field], editedItem[field]);
      }
      return newItem;
    });

    const newSection = { ...original, items: newItems };
    for (const field of TEXT_FIELDS) {
      newSection[field] = mergeTextField(original[field], edited[field]);
    }
    return newSection;
  });

  return { ...storedPagePlan, sections: newSections };
}
