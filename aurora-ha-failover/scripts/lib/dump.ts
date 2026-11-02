import { z } from 'zod';
import { SampleSchema, VerifySchema } from '../../src/shared/samples.js';

// One scenario run as written to results/ (spec section 7, step 4). Everything the summary needs
// is in here, so a run can be summarised again later without AWS access.

export const SCENARIOS = ['s1', 's2', 's3', 's4'] as const;
export type Scenario = (typeof SCENARIOS)[number];

export const RdsEventSchema = z.object({
  date: z.number(),
  source: z.string(),
  message: z.string(),
});

export type RdsEvent = z.infer<typeof RdsEventSchema>;

export const DumpSchema = z.object({
  scenario: z.enum(SCENARIOS),
  label: z.string(),
  runId: z.string(),
  action: z.object({ kind: z.string(), target: z.string() }),
  writerBefore: z.string(),
  writerAfter: z.string().nullable(),
  triggeredAt: z.number(),
  finishedAt: z.number(),
  timedOut: z.boolean(),
  samples: z.array(SampleSchema),
  events: z.array(RdsEventSchema),
  verify: VerifySchema.nullable(),
});

export type Dump = z.infer<typeof DumpSchema>;
