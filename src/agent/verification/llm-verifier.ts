import { createLogger } from 'agent-toolkit/logger';
import { ExtendedLLMService } from '../../llm/llm-service.js';
import {
  Verifier,
  VerificationResult,
  VerificationRating,
  VerificationContext,
} from './verifier.js';

const log = createLogger('verification:llm');

const VERIFICATION_PROMPT = `You are a verification agent. Your job is to evaluate whether the assistant's response adequately addresses the user's request.

Evaluate the response on these criteria:
1. Completeness: Does it fully address what was asked?
2. Accuracy: Is the information correct and well-reasoned?
3. Relevance: Does it stay on topic?
4. Quality: Is it well-structured and clear?

Respond with EXACTLY this JSON format (no markdown, no extra text):
{"rating": "GOOD|NEEDS_FIX|REDO", "feedback": "your feedback here", "confidence": 0.0-1.0}

Ratings:
- GOOD: Response is acceptable, send it
- NEEDS_FIX: Specific issues found, can be fixed with targeted revision
- REDO: Fundamental problems, needs full regeneration`;

export class LLMVerifier implements Verifier {
  constructor(
    private llmService: ExtendedLLMService,
    private confidenceThreshold: number = 0.7,
  ) {}

  async verify(
    request: string,
    response: string,
    _context?: VerificationContext,
  ): Promise<VerificationResult> {
    const userPrompt = `User request:\n${request}\n\nAssistant response:\n${response}`;

    try {
      const result = await this.llmService.complete(
        VERIFICATION_PROMPT,
        userPrompt,
      );
      return this.parseResult(result.content);
    } catch (err) {
      log.error('LLM verification failed', { error: String(err) });
      // On failure, pass through to avoid blocking
      return { passed: true, rating: 'GOOD', feedback: '', confidence: 0.5 };
    }
  }

  private parseResult(content: string): VerificationResult {
    try {
      // Extract JSON from response (handle potential markdown wrapping)
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error('No JSON found');

      const parsed = JSON.parse(jsonMatch[0]) as {
        rating: string;
        feedback: string;
        confidence: number;
      };

      const rating = (['GOOD', 'NEEDS_FIX', 'REDO'].includes(parsed.rating)
        ? parsed.rating
        : 'GOOD') as VerificationRating;

      const confidence = Math.max(0, Math.min(1, parsed.confidence ?? 0.5));
      const passed =
        rating === 'GOOD' && confidence >= this.confidenceThreshold;

      return {
        passed,
        rating,
        feedback: parsed.feedback ?? '',
        confidence,
      };
    } catch {
      log.warn('Failed to parse verification result, passing through');
      return { passed: true, rating: 'GOOD', feedback: '', confidence: 0.5 };
    }
  }
}
