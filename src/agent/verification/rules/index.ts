import { VerificationRule } from '../rule-verifier.js';
import { VerificationResult } from '../verifier.js';

const fail = (
  rule: string,
  feedback: string,
  rating: 'NEEDS_FIX' | 'REDO' = 'NEEDS_FIX',
): VerificationResult => ({
  passed: false,
  rating,
  feedback,
  confidence: 1.0,
});

export const completenessRule: VerificationRule = {
  name: 'completeness',
  check(_request: string, response: string): VerificationResult | null {
    if (!response || response.trim().length === 0) {
      return fail('completeness', 'Response is empty', 'REDO');
    }
    const refusalPatterns = [
      /^I('m| am) (sorry|afraid|unable)/i,
      /^I can('t|not) (help|assist|do)/i,
    ];
    for (const pattern of refusalPatterns) {
      if (pattern.test(response.trim())) {
        return fail('completeness', 'Response appears to be a refusal');
      }
    }
    if (response.length > 100 && !response.trimEnd().match(/[.!?\n`")\]]$/)) {
      return fail('completeness', 'Response appears truncated mid-sentence');
    }
    return null;
  },
};

export const codeQualityRule: VerificationRule = {
  name: 'code-quality',
  check(request: string, response: string): VerificationResult | null {
    const codeKeywords =
      /\b(write|create|implement|code|function|class|script|program)\b/i;
    if (codeKeywords.test(request) && !response.includes('```')) {
      return fail(
        'code-quality',
        'User asked for code but response contains no code block',
      );
    }
    return null;
  },
};

export const directAnswerRule: VerificationRule = {
  name: 'direct-answer',
  check(request: string, response: string): VerificationResult | null {
    const isQuestion = request.trim().endsWith('?');
    if (isQuestion && response.trim().length < 10) {
      return fail(
        'direct-answer',
        'Response is too short for a question that deserves a substantive answer',
      );
    }
    return null;
  },
};

export function getBuiltinRules(): VerificationRule[] {
  return [completenessRule, codeQualityRule, directAnswerRule];
}
