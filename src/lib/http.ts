import { NextResponse } from "next/server";

export function ok<T>(data: T) {
  return NextResponse.json(data);
}

export function failure(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}
