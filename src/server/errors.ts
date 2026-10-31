export type AppErrorCode =
  | "VALIDATION"
  | "EMPTY_CART"
  | "PRODUCT_UNAVAILABLE"
  | "INVALID_QUANTITY"
  | "BELOW_MINIMUM"
  | "POSTCODE_UNSUPPORTED"
  | "SLOT_INVALID"
  | "CHECKOUT_UNAVAILABLE"
  | "RATE_LIMITED"
  | "NOT_FOUND"
  | "UNAUTHORIZED"
  | "CONFLICT"
  | "PAYMENT_ERROR";

export class AppError extends Error {
  constructor(
    public code: AppErrorCode,
    message: string,
    public status = 400,
    public details?: unknown,
  ) {
    super(message);
  }
}

export function errorBody(e: unknown) {
  if (e instanceof AppError)
    return {
      status: e.status,
      body: { error: { code: e.code, message: e.message, details: e.details } },
    };
  return {
    status: 500,
    body: { error: { code: "INTERNAL", message: "Something went wrong" } },
  };
}
