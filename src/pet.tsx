import React, { useEffect, useRef, useState } from "react";
import Seal from "./seal";
export function Pet() {
  const [level, setLevel] = useState(0);
  const [state, setState] = useState("Ready");
  const [direction, setDirection] = useState(1);
  const drag = useRef<{ x: number; y: number } | null>(null);
  const command = (name: string, value?: unknown) =>
    void window.teachMe.petCommand(name, value);
  useEffect(() => {
    const off = window.teachMe.subscribe("pet-state", setState);
    const meter = window.teachMe.subscribe("pet-level", setLevel);
    const face = window.teachMe.subscribe("pet-direction", setDirection);
    command("ready");
    const move = (e: MouseEvent) => {
      if (!drag.current)
        command("hover", !!(e.target as Element).closest(".pet-hit"));
    };
    window.addEventListener("mousemove", move);
    return () => {
      off();
      meter();
      face();
      window.removeEventListener("mousemove", move);
    };
  }, []);
  return (
    <div
      className={`pet-stage pet-${state.toLowerCase().replaceAll(" ", "-")}`}
      style={{ "--voice-level": level } as React.CSSProperties}
      role="status"
      aria-label={`Seal: ${state}`}
    >
      <div
        className="pet-hit"
        style={{ transform: `scaleX(${direction})` }}
        onContextMenu={(e) => {
          e.preventDefault();
          command("menu");
        }}
        onPointerDown={(e) => {
          if (e.button !== 0) return;
          drag.current = { x: e.screenX, y: e.screenY };
          e.currentTarget.setPointerCapture(e.pointerId);
          command("drag", true);
        }}
        onPointerMove={(e) => {
          if (!drag.current) return;
          command("move", [
            e.screenX - drag.current.x,
            e.screenY - drag.current.y,
          ]);
          drag.current = { x: e.screenX, y: e.screenY };
        }}
        onPointerUp={() => {
          drag.current = null;
          command("drag", false);
        }}
        onLostPointerCapture={() => {
          drag.current = null;
          command("drag", false);
        }}
        onPointerLeave={() => {
          if (!drag.current) command("hover", false);
        }}
      >
        <Seal state={state} />
      </div>
    </div>
  );
}
