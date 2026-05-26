import { motion, useTransform, type MotionValue } from "framer-motion";
import { RefreshCw } from "lucide-react";
import { useMotion } from "../lib/use-reduced-motion";
import { PTR_INDICATOR_HEIGHT } from "../lib/use-pull-to-refresh";

export function PullIndicator({
  pullY,
  isRefreshing,
}: {
  pullY: MotionValue<number>;
  isRefreshing: boolean;
}) {
  const { skip: reducedMotion } = useMotion();
  const height = useTransform(
    pullY,
    [0, PTR_INDICATOR_HEIGHT],
    [0, PTR_INDICATOR_HEIGHT],
  );

  if (reducedMotion) return null;

  return (
    <motion.div
      style={{ height }}
      className="overflow-hidden flex justify-center items-center text-[#F4623A]"
      aria-hidden="true"
    >
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
    </motion.div>
  );
}
