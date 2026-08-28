import type { FastifyReply } from 'fastify';
import { ZodError } from 'zod';

export class ApiException extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApiException';
  }
}

export const notFound = (message = '대상을 찾을 수 없습니다') =>
  new ApiException(404, 'NOT_FOUND', message);
export const conflict = (message: string) => new ApiException(409, 'CONFLICT', message);
export const badRequest = (message: string, details?: unknown) =>
  new ApiException(400, 'BAD_REQUEST', message, details);

export function sendError(reply: FastifyReply, error: unknown): FastifyReply {
  if (error instanceof ApiException) {
    return reply
      .status(error.statusCode)
      .send({ error: { code: error.code, message: error.message, details: error.details } });
  }
  if (error instanceof ZodError) {
    return reply.status(400).send({
      error: {
        code: 'VALIDATION_ERROR',
        message: '요청 형식이 올바르지 않습니다',
        details: error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      },
    });
  }
  const message = error instanceof Error ? error.message : String(error);
  return reply.status(500).send({ error: { code: 'INTERNAL_ERROR', message } });
}
