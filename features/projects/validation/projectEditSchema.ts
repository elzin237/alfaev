import { z } from "zod";

import { projectEditableStatuses } from "../projectStatus";
import {
  projectDetailsSchema,
  validateProjectDateOrder,
} from "./projectCreateSchema";

export const projectEditSchema = projectDetailsSchema.extend({
  status: z.enum(projectEditableStatuses),
}).superRefine(validateProjectDateOrder);

export type ProjectEditFormInput = z.input<typeof projectEditSchema>;
export type ProjectEditValues = z.output<typeof projectEditSchema>;
