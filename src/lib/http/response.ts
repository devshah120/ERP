import { NextResponse } from "next/server";

interface SuccessBody<T> {
  success: true;
  data: T;
  message?: string;
}

interface ErrorBody {
  success: false;
  message: string;
  code: string;
  errors?: unknown[];
}

export function ok<T>(data: T, message?: string, status = 200) {
  const body: SuccessBody<T> = { success: true, data, message };
  return NextResponse.json(body, { status });
}

export function created<T>(data: T, message?: string) {
  return ok(data, message, 201);
}

export function fail(message: string, status: number, code: string, errors?: unknown[]) {
  const body: ErrorBody = { success: false, message, code, errors };
  return NextResponse.json(body, { status });
}
