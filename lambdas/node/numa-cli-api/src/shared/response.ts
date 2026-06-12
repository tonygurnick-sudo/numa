/**
 * Shared HTTP-response helpers. Every handler returns through these so the
 * shape (statusCode + headers + JSON body) stays consistent and we don't
 * leak inconsistencies across routes.
 */

export const HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'OPTIONS,POST,GET',
  'Access-Control-Allow-Headers': 'Content-Type,Authorization',
  'Content-Type': 'application/json',
};

export interface HttpResponse {
  statusCode: number;
  headers: typeof HEADERS;
  body: string;
}

export const jsonResponse = (statusCode: number, payload: unknown): HttpResponse => ({
  statusCode,
  headers: HEADERS,
  body: JSON.stringify(payload),
});

export const errorResponse = (statusCode: number, message: string): HttpResponse =>
  jsonResponse(statusCode, { error: message });
