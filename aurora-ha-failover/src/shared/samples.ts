import { z } from 'zod';

// One heartbeat tick and how it ended (spec section 5). The prober serves these, the scenario
// runner dumps them, and the summary reads them back, so the shape lives in one place.

export const MODES = ['naive', 'tuned', 'proxy'] as const;
export type Mode = (typeof MODES)[number];

export const SampleSchema = z.object({
  mode: z.enum(MODES),
  seq: z.number().int(),
  startedAt: z.number(),
  settledAt: z.number(),
  outcome: z.enum(['ok', 'error', 'timeout', 'skipped']),
  code: z.string().nullable(),
  // The error text for failed ticks, so the article can quote what the client saw. Dumps from
  // before it existed parse with null.
  message: z.string().nullable().default(null),
  writerInstance: z.string().nullable(),
});

export type Sample = z.infer<typeof SampleSchema>;
export type Outcome = Sample['outcome'];

export const TimelineSchema = z.object({
  runId: z.string(),
  now: z.number(),
  samples: z.array(SampleSchema),
});

export type Timeline = z.infer<typeof TimelineSchema>;

/** Spec section 8, lost writes: acknowledged ticks that are not in the table afterwards. */
export const VerifySchema = z.object({
  runId: z.string(),
  lanes: z.array(
    z.object({
      mode: z.enum(MODES),
      acknowledged: z.number().int(),
      missing: z.array(z.number().int()),
    }),
  ),
});

export type Verify = z.infer<typeof VerifySchema>;
