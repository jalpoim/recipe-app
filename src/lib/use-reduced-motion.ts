import { useReducedMotion } from "framer-motion";

export function useMotion() {
  const reduced = useReducedMotion();
  return {
    transition: (t: object) => (reduced ? { duration: 0 } : t),
    skip: reduced ?? false,
  };
}
