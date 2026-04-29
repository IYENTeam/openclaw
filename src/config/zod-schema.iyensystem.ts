import { z } from "zod";
import { sensitive } from "./zod-schema.sensitive.js";

export const IyenSystemPrReviewTriggerSchema = z
  .object({
    enabled: z.boolean().optional(),
    githubTokenEnv: z.string().trim().min(1).optional().register(sensitive),
    reviewLabel: z.string().trim().min(1).optional(),
    includeDrafts: z.boolean().optional(),
    minChangedFiles: z.number().int().nonnegative().optional(),
    minTotalChanges: z.number().int().nonnegative().optional(),
  })
  .strict()
  .optional();

export const IyenSystemSchema = z
  .object({
    enabled: z.boolean().optional(),
    prReviewTrigger: IyenSystemPrReviewTriggerSchema,
  })
  .strict()
  .optional();
