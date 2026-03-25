import { useCallback } from "react";
import { useConnection, usePresence } from "../hooks";
import classes from "./CursorOverlay.module.css";

export function CursorOverlay({ children }: { children: React.ReactNode }) {
  const { awareness } = useConnection();
  const { peers, localClientId } = usePresence(awareness);

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      awareness.setLocal({ cursor: { x: e.clientX, y: e.clientY } });
    },
    [awareness],
  );

  const onPointerLeave = useCallback(() => {
    awareness.setLocal({ cursor: null });
  }, [awareness]);

  return (
    <div className={classes.container} onPointerMove={onPointerMove} onPointerLeave={onPointerLeave}>
      {children}
      {Array.from(peers.entries()).map(([id, peer]) => {
        if (id === localClientId || !peer.cursor) return null;
        return (
          <div key={id} className={classes.cursor} style={{ left: peer.cursor.x, top: peer.cursor.y }}>
            <svg width="16" height="16" viewBox="0 0 16 16" fill={peer.color}>
              <path d="M0 0 L0 14 L4 10 L8 16 L10 15 L6 9 L12 9 Z" />
            </svg>
            <span className={classes.label} style={{ backgroundColor: peer.color }}>
              {peer.name}
            </span>
          </div>
        );
      })}
    </div>
  );
}
