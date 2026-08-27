import type { FastifyError, FastifyReply, FastifyRequest } from "fastify";
import { ZodError } from "zod";
import { AppError } from "./errors.js";
import { captureError } from "./error-tracking.js";

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

  // Only Fastify's own framework errors (body/content-type parsing, etc.)
  // pass through their real status - those messages are documented as
  // client-safe. A third-party SDK error (e.g. @google/genai's ApiError)
  // can carry an unrelated numeric `statusCode` too; without the `code`
  // prefix check it would slip through this branch and leak straight to
  // the client instead of falling through to the generic 500 below.
  if (
    "code" in error &&
    typeof error.code === "string" &&
    error.code.startsWith("FST_") &&
    "statusCode" in error &&
    typeof error.statusCode === "number" &&
    error.statusCode >= 400 &&
    error.statusCode < 500
  ) {
    reply.code(error.statusCode).send({ error: error.message });
    return;
  }

  request.log.error(error);
  captureError(error);
  reply.code(500).send({ error: "Something went wrong." });
}
