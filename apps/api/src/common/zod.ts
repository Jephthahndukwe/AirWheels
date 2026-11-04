import { BadRequestException, type PipeTransform, applyDecorators } from '@nestjs/common';
import { ApiBody } from '@nestjs/swagger';
import type { ZodTypeAny, z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';

/** Validates a request body against a shared Zod schema from @airwheels/types. */
export class ZodPipe<T extends ZodTypeAny> implements PipeTransform<unknown, z.infer<T>> {
  constructor(private readonly schema: T) {}

  transform(value: unknown): z.infer<T> {
    const result = this.schema.safeParse(value);
    if (!result.success) {
      throw new BadRequestException({
        code: 'VALIDATION_FAILED',
        message: 'The request body is not valid.',
        issues: result.error.issues,
      });
    }
    return result.data;
  }
}

/** Converts a Zod schema to an OpenAPI schema object. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const toOpenApi = (schema: ZodTypeAny): any =>
  zodToJsonSchema(schema as never, { target: 'openApi3', $refStrategy: 'none' });

/** Documents a Zod-validated body in the OpenAPI spec. */
export const ApiZodBody = (schema: ZodTypeAny, description?: string) =>
  applyDecorators(ApiBody({ schema: toOpenApi(schema), description }));
