import { SetMetadata } from '@nestjs/common';

/**
 * Metadata key read by the envelope interceptor (src/common/interceptors/
 * envelope.interceptor.ts). Any handler decorated with `@SkipEnvelope()`
 * (or `@SkipEnvelope('reason')`) returns its raw payload — the interceptor
 * passes it through untouched.
 *
 * Spec §4 — opt-out mechanism for streams / buffers / file responses.
 */
export const SKIP_ENVELOPE_KEY = 'skipEnvelope';

/**
 * `@SkipEnvelope()` decorator — opt a handler out of the response envelope.
 *
 * Use on endpoints that stream a binary (file downloads, SSE, PDFs, raw
 * buffers) where wrapping the response in `{ data, meta }` would corrupt
 * the payload.
 *
 * Apply at the handler level:
 *
 *   @Get('download/:id')
 *   @SkipEnvelope()
 *   download(@Param('id') id: string, @Res() res: Response) {
 *     return this.files.stream(id, res);
 *   }
 *
 * Spec §4 (Envelope Interceptor) — opt-out path.
 */
export const SkipEnvelope = (reason?: string) =>
  SetMetadata(SKIP_ENVELOPE_KEY, reason ?? true);
