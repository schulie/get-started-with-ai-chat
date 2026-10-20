import { useEffect, useState } from "react";

function viewportHeight(): number | undefined {
  if (typeof window === "undefined") return undefined;
  const viewport = window.visualViewport;
  // Keep normal page zoom. Only follow the visible height at the default scale.
  if (!viewport || Math.abs(viewport.scale - 1) > 0.01 || viewport.height <= 0) return undefined;
  return Math.round(viewport.height);
}

export function useViewportHeight(): number | undefined {
  const [height, setHeight] = useState(viewportHeight);
  useEffect(() => {
    const viewport = window.visualViewport;
    const resize = () => setHeight(viewportHeight());
    resize();
    viewport?.addEventListener("resize", resize);
    window.addEventListener("resize", resize);
    return () => {
      viewport?.removeEventListener("resize", resize);
      window.removeEventListener("resize", resize);
    };
  }, []);
  return height;
}
