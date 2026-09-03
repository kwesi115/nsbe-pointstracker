/**
 * Wraps a route handler so AppError maps to its status and a JSON body, and
 * anything else maps to a generic 500 (logged server-side) instead of leaking
 * an internal error message to the client.
 */

import { NextResponse } from "next/server";
import { AppError } from "./errors";

type RouteHandler<Args extends unknown[]> = (...args: Args) => Promise<Response> | Response;

export function withApiErrors<Args extends unknown[]>(handler: RouteHandler<Args>): RouteHandler<Args> {
  return async (...args: Args) => {
    try {
      return await handler(...args);
    } catch (err) {
      if (err instanceof AppError) {
        return NextResponse.json(
          { code: err.code, message: err.message, fieldErrors: err.fieldErrors },
          { status: err.status },
        );
      }
      console.error(err);
      return NextResponse.json(
        { code: "INTERNAL_ERROR", message: "Something went wrong. Try again." },
        { status: 500 },
      );
    }
  };
}
