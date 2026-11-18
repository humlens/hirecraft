/**
 * Redaction and protected-attribute handling.
 *
 *  - `redactForLog`: what is stored in AIRequestLog (no emails, phones, URLs,
 *    long digit runs).
 *  - `scrubProtectedText`: removes protected attributes from free text before
 *    it is sent to a model (age, gender, religion, ethnicity / caste, marital
 *    status, disability, photos). Used for candidate data in matching,
 *    search and embeddings.
 */
export const redactForLog = (text: string, max = 6000) =>
  text
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, '[email]')
    .replace(/https?:\/\/\S+/gi, '[url]')
    .replace(/\+?\d[\d\s().-]{7,}\d/g, '[number]')
    .slice(0, max);

/** Splits into lines, then into sentences (a dot inside "Node.js" is not a sentence end). */
const sentences = (text: string) =>
  text
    .split(/\n+/)
    .flatMap((line) => line.split(/(?<=[.!?])\s+/))
    .filter((s) => s.trim());

const PROTECTED_PATTERNS: RegExp[] = [
  // age / date of birth
  /\b(\d{1,2})\s*(?:years?|yrs?)[\s-]*old\b/i,
  /\bage\s*[:\-]?\s*\d{2}\b/i,
  /\baged\s+\d{2}\b/i,
  /\b(?:dob|date of birth|born (?:on|in)|birth ?date)\b/i,
  // gender / sex
  /\b(?:gender|sex)\s*[:\-]/i,
  /\b(?:male|female|non-binary|transgender|man|woman|boy|girl|lady|gentleman)\b/i,
  // marital status / family
  /\b(?:married|unmarried|divorced|widowed|marital|spouse|wife|husband|pregnan\w*|maternity|paternity)\b/i,
  // religion
  /\b(?:hindu|muslim|islam\w*|christian|catholic|protestant|sikh|jewish|judaism|buddhist|jain|parsi|atheist|religion|religious)\b/i,
  // ethnicity / caste / race / nationality markers
  /\b(?:caste|race|racial|ethnic\w*|tribe|tribal|nationality|citizenship|dalit|brahmin|obc|sc\/st)\b/i,
  // disability / health
  /\b(?:disabled|disability|handicap\w*|wheelchair|blind|deaf|autis\w*|adhd|chronic illness)\b/i,
  // photo
  /\b(?:photo|photograph|passport[- ]size|headshot|profile picture)\b/i,
];

const PRONOUNS: [RegExp, string][] = [
  [/\bhe\b/gi, 'they'],
  [/\bshe\b/gi, 'they'],
  [/\bhis\b/gi, 'their'],
  [/\bher\b/gi, 'their'],
  [/\bhim\b/gi, 'them'],
  [/\bhers\b/gi, 'theirs'],
  [/\bhimself\b/gi, 'themselves'],
  [/\bherself\b/gi, 'themselves'],
  [/\b(?:mr|mrs|ms|miss|mx)\.?\s/gi, ''],
];

/** Drops sentences that mention a protected attribute and neutralises pronouns. */
export function scrubProtectedText(text: string | null | undefined): string {
  if (!text) {
    return '';
  }

  const kept = sentences(text).filter(
    (sentence) => !PROTECTED_PATTERNS.some((p) => p.test(sentence))
  );

  return PRONOUNS.reduce((t, [re, to]) => t.replace(re, to), kept.join(' '))
    .replace(/\s+/g, ' ')
    .trim();
}

export const containsProtectedAttribute = (text: string) =>
  PROTECTED_PATTERNS.some((p) => p.test(text));
