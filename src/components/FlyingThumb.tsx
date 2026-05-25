import { createPortal } from "react-dom";
import { motion } from "framer-motion";

interface FlyingThumbProps {
  src: string | null;
  background: string | null;
  from: { x: number; y: number; w: number; h: number };
  to: { x: number; y: number };
  onDone: () => void;
}

export function FlyingThumb({
  src,
  background,
  from,
  to,
  onDone,
}: FlyingThumbProps) {
  // Arc peak: 160px above the start, reached at 35% of the animation.
  // X barely moves in the first 35% (perpendicular launch feel),
  // then curves toward the target.
  const midX = from.x + (to.x - from.x) * 0.2;
  const midY = from.y - 160;

  return createPortal(
    <motion.div
      className="fixed z-[999] pointer-events-none overflow-hidden"
      style={{
        background: background ?? "linear-gradient(135deg, #FEE9E1, #bbf7d0)",
      }}
      initial={{
        left: from.x,
        top: from.y,
        width: from.w,
        height: from.h,
        borderRadius: 12,
        opacity: 1,
      }}
      animate={{
        // X: smooth ease-out — moves steadily toward target, decelerates at end
        left: [from.x, midX, to.x],
        // Y: fast upward launch (easeOut), then gravity-pull into target (easeIn)
        top: [from.y, midY, to.y],
        width: [from.w, from.w * 0.55, 22],
        height: [from.h, from.h * 0.55, 22],
        borderRadius: [12, 12, 100],
        opacity: [1, 1, 0],
      }}
      transition={{
        duration: 0.65,
        times: [0, 0.35, 1],
        left: { ease: ["easeInOut", "easeOut"] },
        top: { ease: ["easeOut", "easeIn"] },
        width: { ease: ["linear", "easeIn"] },
        height: { ease: ["linear", "easeIn"] },
        borderRadius: { ease: "linear" },
        opacity: { ease: "linear" },
      }}
      onAnimationComplete={() => {
        onDone();
        window.dispatchEvent(new CustomEvent("badge:bounce:plan"));
      }}
    >
      {src && (
        <img
          src={src}
          alt=""
          className="w-full h-full object-cover"
          aria-hidden="true"
        />
      )}
    </motion.div>,
    document.body,
  );
}
