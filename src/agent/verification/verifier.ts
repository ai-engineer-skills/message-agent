export type VerificationRating = 'GOOD' | 'NEEDS_FIX' | 'REDO';

export interface VerificationResult {
  passed: boolean;
  rating: VerificationRating;
  feedback: string;
  confidence: number;
}

export interface Verifier {
  verify(
    request: string,
    response: string,
    context?: VerificationContext,
  ): Promise<VerificationResult>;
}

export interface VerificationContext {
  conversationHistory?: string[];
  skillName?: string;
  attempt?: number;
}

export class CompositeVerifier implements Verifier {
  constructor(private verifiers: Verifier[]) {}

  async verify(
    request: string,
    response: string,
    context?: VerificationContext,
  ): Promise<VerificationResult> {
    for (const v of this.verifiers) {
      const result = await v.verify(request, response, context);
      if (!result.passed) return result;
    }
    return { passed: true, rating: 'GOOD', feedback: '', confidence: 1.0 };
  }
}
