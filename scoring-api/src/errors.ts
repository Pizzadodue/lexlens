// src/errors.ts
import type { ErrorCode, ErrorResponse } from "./types.js";

export class LexLensError extends Error {
  public readonly code: ErrorCode;
  public readonly httpStatus: number;
  public readonly extra: Partial<ErrorResponse>;

  constructor(
    code: ErrorCode,
    message: string,
    httpStatus: number,
    extra: Partial<ErrorResponse> = {}
  ) {
    super(message);
    this.name = "LexLensError";
    this.code = code;
    this.httpStatus = httpStatus;
    this.extra = extra;
  }

  toResponse(): ErrorResponse {
    return { error: this.code, message: this.message, ...this.extra };
  }
}

export const Errors = {
  unsupportedJurisdiction: (jurisdiction: string, supported: string[]) =>
    new LexLensError(
      "UNSUPPORTED_JURISDICTION",
      `Jurisdiction ${jurisdiction} is not supported. Supported: ${supported.join(", ")}.`,
      422,
      { supportedJurisdictions: supported }
    ),

  unsupportedLanguage: (language: string, supported: string[]) =>
    new LexLensError(
      "UNSUPPORTED_LANGUAGE",
      `Language ${language} is not supported. Supported: ${supported.join(", ")}.`,
      422,
      { supportedLanguages: supported }
    ),

  textTooShort: () =>
    new LexLensError(
      "TEXT_TOO_SHORT",
      "Insufficient text for reliable analysis (minimum 200 tokens).",
      422
    ),

  analysisUnavailable: () =>
    new LexLensError(
      "ANALYSIS_UNAVAILABLE",
      "Analysis service temporarily unavailable. Please try again.",
      503
    ),
};
