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
  const midY = Math.min(from.y, to.y) - 80;

  return createPortal(
    <motion.div
      className="fixed z-[999] pointer-events-none overflow-hidden"
      style={{
        width: from.w,
        height: from.h,
        borderRadius: 12,
        background: background ?? "linear-gradient(135deg, #FEE9E1, #bbf7d0)",
      }}
      initial={{
        x: from.x,
        y: from.y,
        width: from.w,
        height: from.h,
        opacity: 1,
        borderRadius: 12,
      }}
      animate={{
        x: to.x,
        y: [from.y, midY, to.y],
        width: 20,
        height: 20,
        opacity: [1, 1, 0],
        borderRadius: "50%",
      }}
      transition={{ duration: 0.55, ease: [0.32, 0, 0.67, 0] }}
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
