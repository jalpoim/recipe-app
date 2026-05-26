import { useRef, useEffect, useState } from "react";
import { useSpring, type MotionValue } from "framer-motion";

export const PTR_INDICATOR_HEIGHT = 44;
const THRESHOLD = 80;
const RESISTANCE = 0.45;

interface Options {
  onRefresh: () => Promise<void> | void;
  containerRef?: React.RefObject<HTMLElement | null>;
  disabled?: boolean;
}

export function usePullToRefresh({
  onRefresh,
  containerRef,
  disabled = false,
}: Options): { pullY: MotionValue<number>; isRefreshing: boolean } {
  const [isRefreshing, setIsRefreshing] = useState(false);
  const isRefreshingRef = useRef(false);
  const startY = useRef(0);
  const pulling = useRef(false);
  const rawDelta = useRef(0);
  const onRefreshRef = useRef(onRefresh);
  useEffect(() => {
    onRefreshRef.current = onRefresh;
  }, [onRefresh]);

  const pullY = useSpring(0, { stiffness: 320, damping: 30 });

  useEffect(() => {
    if (disabled) return;

    const target: EventTarget = containerRef?.current ?? window;

    function getScrollTop(): number {
      return containerRef?.current
        ? containerRef.current.scrollTop
        : window.scrollY;
    }

    function onTouchStart(e: TouchEvent) {
      if (getScrollTop() > 2) return;
      startY.current = e.touches[0].clientY;
      rawDelta.current = 0;
      pulling.current = true;
    }

    function onTouchMove(e: TouchEvent) {
      if (!pulling.current || isRefreshingRef.current) return;
      const delta = e.touches[0].clientY - startY.current;
      if (delta <= 0) {
        rawDelta.current = 0;
        pullY.set(0);
        return;
      }
      rawDelta.current = delta;
      pullY.set(Math.min(delta * RESISTANCE, PTR_INDICATOR_HEIGHT));
    }

    function onTouchEnd() {
      if (!pulling.current) return;
      pulling.current = false;

      if (rawDelta.current >= THRESHOLD) {
        isRefreshingRef.current = true;
        setIsRefreshing(true);
        pullY.set(PTR_INDICATOR_HEIGHT);
        Promise.resolve(onRefreshRef.current()).finally(() => {
          isRefreshingRef.current = false;
          setIsRefreshing(false);
          pullY.set(0);
        });
      } else {
        pullY.set(0);
      }
    }

    target.addEventListener("touchstart", onTouchStart as EventListener, {
      passive: true,
    });
    target.addEventListener("touchmove", onTouchMove as EventListener, {
      passive: true,
    });
    target.addEventListener("touchend", onTouchEnd);

    return () => {
      target.removeEventListener("touchstart", onTouchStart as EventListener);
      target.removeEventListener("touchmove", onTouchMove as EventListener);
      target.removeEventListener("touchend", onTouchEnd);
    };
  }, [disabled, containerRef, pullY]);

  return { pullY, isRefreshing };
}
