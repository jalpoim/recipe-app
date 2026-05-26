import { motion, useTransform, type MotionValue } from "framer-motion";
import { RefreshCw } from "lucide-react";
import { useMotion } from "../lib/use-reduced-motion";
import { PTR_INDICATOR_HEIGHT } from "../lib/use-pull-to-refresh";

interface Props {
  pullY: MotionValue<number>;
  isRefreshing: boolean;
  /** fixed: slides in from top of viewport (page-level scroll pages).
   *  flow: grows in-place inside a bounded scroll container (library). */
  variant?: "fixed" | "flow";
}

function SpinIcon({ isRefreshing }: { isRefreshing: boolean }) {
  return (
    <motion.div
      key={isRefreshing ? "spin" : "idle"}
      animate={isRefreshing ? { rotate: 360 } : { rotate: 0 }}
      initial={isRefreshing ? { rotate: 0 } : false}
      transition={
        isRefreshing
          ? {
              repeat: Infinity,
              duration: 0.75,
              ease: "linear",
              repeatType: "loop",
            }
          : { duration: 0 }
      }
    >
      <RefreshCw size={16} strokeWidth={2.5} />
    </motion.div>
  );
}

export function PullIndicator({
  pullY,
  isRefreshing,
  variant = "flow",
}: Props) {
  const { skip: reducedMotion } = useMotion();

  // Always call hooks — no conditional hook calls
  const flowHeight = useTransform(
    pullY,
    [0, PTR_INDICATOR_HEIGHT],
    [0, PTR_INDICATOR_HEIGHT],
  );
  const fixedY = useTransform(
    pullY,
    [0, PTR_INDICATOR_HEIGHT],
    [-PTR_INDICATOR_HEIGHT, 0],
  );

  const liveRegion = (
    <span
      role="status"
      aria-live="polite"
      aria-atomic="true"
      className="sr-only"
    >
      {isRefreshing ? "A actualizar…" : ""}
    </span>
  );

  // Reduced-motion: static icon, no animation
  if (reducedMotion) {
    if (!isRefreshing) return liveRegion;
    if (variant === "fixed") {
      return (
        <>
          {liveRegion}
          <div
            className="fixed left-0 right-0 z-50 flex justify-center items-center bg-[#FAFAF8] text-[#F4623A]"
            style={{
              top: "env(safe-area-inset-top)",
              height: PTR_INDICATOR_HEIGHT,
            }}
            aria-hidden="true"
          >
            <RefreshCw size={16} strokeWidth={2.5} />
          </div>
        </>
      );
    }
    return (
      <>
        {liveRegion}
        <div
          className="flex justify-center items-center text-[#F4623A]"
          style={{ height: PTR_INDICATOR_HEIGHT }}
          aria-hidden="true"
        >
          <RefreshCw size={16} strokeWidth={2.5} />
        </div>
      </>
    );
  }

  // Fixed variant: slides down from top of screen — transform-only, no layout shift
  if (variant === "fixed") {
    return (
      <>
        {liveRegion}
        <motion.div
          style={{
            y: fixedY,
            top: "env(safe-area-inset-top)",
            height: PTR_INDICATOR_HEIGHT,
          }}
          className="fixed left-0 right-0 z-50 flex justify-center items-center bg-[#FAFAF8] text-[#F4623A]"
          aria-hidden="true"
        >
          <SpinIcon isRefreshing={isRefreshing} />
        </motion.div>
      </>
    );
  }

  // Flow variant: height grows inside bounded scroll container
  return (
    <>
      {liveRegion}
      <motion.div
        style={{ height: flowHeight }}
        className="overflow-hidden flex justify-center items-center text-[#F4623A]"
        aria-hidden="true"
      >
        <SpinIcon isRefreshing={isRefreshing} />
      </motion.div>
    </>
  );
}
