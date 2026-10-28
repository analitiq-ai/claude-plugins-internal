// Anything this hook needs past the guard is loaded with `await import(...)`: a static import would be evaluated
// before the guard runs.
import "../lib/guarded.ts";
