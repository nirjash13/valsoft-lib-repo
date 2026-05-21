/** RFC 7807 ProblemDetails shape — matches what handleServerError returns. */
export interface ProblemDetails {
  type: string;
  title: string;
  status: number;
  detail?: string;
  /** Stable machine-readable error code. Use this for client-side branching instead of `status`. */
  code?: string;
}
