import { NextResponse } from "next/server";

export function ok<T>(data: T, init?: ResponseInit) {
  return NextResponse.json(data, init);
}

export function failure(message: string, status = 400, init?: ResponseInit) {
  return NextResponse.json({ error: message }, { status, ...init });
}
