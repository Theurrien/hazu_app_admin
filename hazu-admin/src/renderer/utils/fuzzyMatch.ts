// src/renderer/utils/fuzzyMatch.ts

export type MatchingMode = 'strict' | 'normal' | 'loose';

/**
 * Calculate Levenshtein distance between two strings
 */
function levenshteinDistance(a: string, b: string): number {
  const matrix: number[][] = [];

  for (let i = 0; i <= b.length; i++) {
    matrix[i] = [i];
  }
  for (let j = 0; j <= a.length; j++) {
    matrix[0][j] = j;
  }

  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1, // substitution
          matrix[i][j - 1] + 1,     // insertion
          matrix[i - 1][j] + 1      // deletion
        );
      }
    }
  }

  return matrix[b.length][a.length];
}

/**
 * Calculate similarity percentage between two strings (0-100)
 */
function similarity(a: string, b: string): number {
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 100;
  const distance = levenshteinDistance(a, b);
  return ((maxLen - distance) / maxLen) * 100;
}

/**
 * Normalize a string for comparison: lowercase, trim, collapse whitespace
 */
function normalize(str: string): string {
  return str.toLowerCase().trim().replace(/\s+/g, ' ');
}

/**
 * Extract tokens from a string (split by whitespace)
 */
function tokenize(str: string): string[] {
  return normalize(str).split(' ').filter(Boolean);
}

/**
 * Check if all tokens from shorter string are found in longer string
 */
function tokensMatch(a: string, b: string): boolean {
  const tokensA = tokenize(a);
  const tokensB = tokenize(b);
  const [shorter, longer] = tokensA.length <= tokensB.length
    ? [tokensA, tokensB]
    : [tokensB, tokensA];

  return shorter.every(token =>
    longer.some(t => t.includes(token) || token.includes(t))
  );
}

export interface MatchResult {
  matched: boolean;
  matchedValue: string | null;
  score: number;
}

/**
 * Find best match for a value in a list of candidates using specified mode
 */
export function findBestMatch(
  value: string,
  candidates: string[],
  mode: MatchingMode
): MatchResult {
  const normalizedValue = normalize(value);

  if (candidates.length === 0) {
    return { matched: false, matchedValue: null, score: 0 };
  }

  // Strict mode: exact case-insensitive match
  if (mode === 'strict') {
    const exactMatch = candidates.find(c => normalize(c) === normalizedValue);
    return {
      matched: !!exactMatch,
      matchedValue: exactMatch || null,
      score: exactMatch ? 100 : 0,
    };
  }

  // Find best match by similarity
  let bestMatch: string | null = null;
  let bestScore = 0;

  for (const candidate of candidates) {
    const normalizedCandidate = normalize(candidate);
    const score = similarity(normalizedValue, normalizedCandidate);

    if (score > bestScore) {
      bestScore = score;
      bestMatch = candidate;
    }
  }

  // Normal mode: similarity >= 85%
  if (mode === 'normal') {
    return {
      matched: bestScore >= 85,
      matchedValue: bestScore >= 85 ? bestMatch : null,
      score: bestScore,
    };
  }

  // Loose mode: similarity >= 60% OR all tokens match
  if (mode === 'loose') {
    const hasTokenMatch = bestMatch && tokensMatch(value, bestMatch);
    const matched = bestScore >= 60 || hasTokenMatch;
    return {
      matched,
      matchedValue: matched ? bestMatch : null,
      score: bestScore,
    };
  }

  return { matched: false, matchedValue: null, score: 0 };
}

/**
 * Build a mapping from Excel room names to Hazu room names
 */
export function buildRoomMapping(
  excelRoomNames: string[],
  hazuRoomNames: string[],
  mode: MatchingMode
): Map<string, string | null> {
  const mapping = new Map<string, string | null>();

  for (const excelName of excelRoomNames) {
    const result = findBestMatch(excelName, hazuRoomNames, mode);
    mapping.set(excelName, result.matchedValue);
  }

  return mapping;
}
