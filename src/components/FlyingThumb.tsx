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
  const midX = (from.x + to.x) / 2;
  const midY = Math.min(from.y, to.y) - 100;

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
        left: [from.x, midX, to.x],
        top: [from.y, midY, to.y],
        width: [from.w, from.w * 0.6, 22],
        height: [from.h, from.h * 0.6, 22],
        // 100px >> half of 22px final size, so CSS caps it at a circle
        borderRadius: [12, 12, 100],
        opacity: [1, 1, 0],
      }}
      transition={{ duration: 0.6, ease: "easeInOut", times: [0, 0.5, 1] }}
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
