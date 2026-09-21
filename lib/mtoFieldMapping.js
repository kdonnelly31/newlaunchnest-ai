// Matches a buyer's personalization answer to one of LaunchNestAI's 5 known
// made-to-order questions. question_id (Etsy's stable ID for a listing's
// personalization question) is authoritative and checked first;
// formatted_name (the seller-configured label shown to the buyer) is a
// fallback for questions not yet added to QUESTION_ID_MAP below.
export const MAPPING_VERSION = 1;

// Etsy's personalization question_id for each of the 5 fields, once known.
// Empty until the real listing's question IDs are recorded here (Kim: fill
// these in as each question goes live on the listing) -- until then, every
// answer falls through to the label match below.
export const QUESTION_ID_MAP = {};

const LABEL_FALLBACK = [
  { field: 'product_url', pattern: /which .*product.* (should|does) this .*promote/i },
  { field: 'target_customer', pattern: /who (usually )?buys/i },
  { field: 'messaging', pattern: /what should shoppers understand/i },
  { field: 'traffic_source', pattern: /where will you share/i },
  { field: 'assets', pattern: /upload your (product photos|brand assets)/i },
];

export function mapAnswer({ questionId, formattedName }, { questionIdMap = QUESTION_ID_MAP } = {}) {
  if (questionId != null && questionIdMap[String(questionId)]) {
    return questionIdMap[String(questionId)];
  }
  const label = formattedName ?? '';
  const match = LABEL_FALLBACK.find(({ pattern }) => pattern.test(label));
  return match ? match.field : 'unmapped';
}
