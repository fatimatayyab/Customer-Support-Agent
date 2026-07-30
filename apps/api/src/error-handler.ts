import type { FastifyError, FastifyReply, FastifyRequest } from "fastify";
import { ZodError } from "zod";
import { AppError } from "./errors.js";

// Central place error responses are shaped. No route handler should ever
// send a raw error message to the client - this is the only place that
// decides what's safe to expose.
export function errorHandler(error: FastifyError | Error, request: FastifyRequest, reply: FastifyReply): void {
  if (error instanceof ZodError) {
    reply.code(400).send({ error: "Invalid request.", issues: error.issues });
    return;
  }

  if (error instanceof AppError) {
    reply.code(error.statusCode).send({ error: error.message });
    return;
  }

  request.log.error(error);
  reply.code(500).send({ error: "Something went wrong." });
}
