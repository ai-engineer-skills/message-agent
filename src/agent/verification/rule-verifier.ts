import { createLogger } from 'agent-toolkit/logger';
import {
  Verifier,
  VerificationResult,
  VerificationContext,
  VerificationRating,
} from './verifier.js';

const log = createLogger('verification:rules');

export interface VerificationRule {
  name: string;
  check(request: string, response: string): VerificationResult | null;
}

export class RuleVerifier implements Verifier {
  private rules: VerificationRule[] = [];

  addRule(rule: VerificationRule): void {
    this.rules.push(rule);
  }

  async verify(
    request: string,
    response: string,
    _context?: VerificationContext,
  ): Promise<VerificationResult> {
    for (const rule of this.rules) {
      const result = rule.check(request, response);
      if (result && !result.passed) {
        log.info('Rule check failed', {
          rule: rule.name,
          rating: result.rating,
        });
        return result;
      }
    }
    return { passed: true, rating: 'GOOD', feedback: '', confidence: 1.0 };
  }
}
