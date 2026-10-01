import { t } from './text';
export type ErrorCode =
  | 'UNAUTHORIZED'
  | 'ROOM_UNAVAILABLE'
  | 'SEAT_TAKEN'
  | 'NAME_TAKEN'
  | 'WRONG_PHASE'
  | 'NOT_YOUR_TURN'
  | 'ILLEGAL_MOVE'
  | 'STALE_STATE'
  | 'RATE_LIMITED'
  | 'INVALID'
  | 'NOT_FOUND'
  | 'SERVICE_UNAVAILABLE'
  | 'SERVER_ERROR';

const STATUS: Record<ErrorCode, number> = {
  UNAUTHORIZED: 401,
  ROOM_UNAVAILABLE: 409,
  SEAT_TAKEN: 409,
  NAME_TAKEN: 409,
  WRONG_PHASE: 409,
  NOT_YOUR_TURN: 409,
  ILLEGAL_MOVE: 422,
  STALE_STATE: 409,
  RATE_LIMITED: 429,
  INVALID: 400,
  NOT_FOUND: 404,
  SERVICE_UNAVAILABLE: 503,
  SERVER_ERROR: 500,
};

/** Carries only player-facing wording; internal detail never reaches the client. */
export class AppError extends Error {
  public readonly status: number;

  constructor(
    public readonly code: ErrorCode,
    message: string,
    public readonly retryAfterMs?: number,
  ) {
    super(message);
    this.name = 'AppError';
    this.status = STATUS[code];
  }
}

export function unauthorized(message = t('server.accessInvalid')): AppError {
  return new AppError('UNAUTHORIZED', message);
}

export function invalid(message: string): AppError {
  return new AppError('INVALID', message);
}
