import { useEffect, useMemo, useRef, useState, type CSSProperties, type MouseEvent } from "react";
import "./index.css";

type NodeKey = "center" | "app" | "sites";
type Point = { x: number; y: number };

type NodeMap = Record<NodeKey, Point>;

const GRAPH_SIZE = { width: 860, height: 520 };
const NODE_RADIUS = 54;

const defaultPositions: NodeMap = {
  center: { x: GRAPH_SIZE.width / 2, y: GRAPH_SIZE.height / 2 },
  app: { x: GRAPH_SIZE.width / 2 - 230, y: GRAPH_SIZE.height / 2 - 120 },
  sites: { x: GRAPH_SIZE.width / 2 + 230, y: GRAPH_SIZE.height / 2 + 120 },
};

const labels: Record<NodeKey, string> = {
  center: "plotline.nz",
  app: "app.plotline.nz",
  sites: "sites.plotline.nz",
};

export function App() {
  const sceneRef = useRef<HTMLDivElement>(null);
  const graphRef = useRef<HTMLDivElement>(null);
  const [positions, setPositions] = useState<NodeMap>(defaultPositions);
  const [drag, setDrag] = useState<{ key: NodeKey; offsetX: number; offsetY: number } | null>(null);
  const [parallax, setParallax] = useState({ x: 0, y: 0 });

  useEffect(() => {
    if (!drag) return;

    const onPointerMove = (event: PointerEvent) => {
      const graphBounds = graphRef.current?.getBoundingClientRect();
      if (!graphBounds) return;

      const nextX = Math.min(
        Math.max(event.clientX - graphBounds.left - drag.offsetX, NODE_RADIUS),
        graphBounds.width - NODE_RADIUS,
      );
      const nextY = Math.min(
        Math.max(event.clientY - graphBounds.top - drag.offsetY, NODE_RADIUS),
        graphBounds.height - NODE_RADIUS,
      );

      setPositions(previous => ({
        ...previous,
        [drag.key]: {
          x: nextX,
          y: nextY,
        },
      }));
    };

    const onPointerUp = () => setDrag(null);

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);

    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
    };
  }, [drag]);

  const handleSceneMove = (event: MouseEvent<HTMLDivElement>) => {
    const sceneBounds = sceneRef.current?.getBoundingClientRect();
    if (!sceneBounds) return;

    const offsetX = (event.clientX - sceneBounds.left) / sceneBounds.width - 0.5;
    const offsetY = (event.clientY - sceneBounds.top) / sceneBounds.height - 0.5;

    setParallax({
      x: Math.round(offsetX * 2000) / 1000,
      y: Math.round(offsetY * 2000) / 1000,
    });
  };

  const edges = useMemo(
    () => [
      { from: positions.center, to: positions.app },
      { from: positions.center, to: positions.sites },
    ],
    [positions],
  );

  return (
    <div
      ref={sceneRef}
      className="space-page"
      onMouseMove={handleSceneMove}
      style={
        {
          "--parallax-x": `${parallax.x}`,
          "--parallax-y": `${parallax.y}`,
        } as CSSProperties
      }
    >
      <div className="graph" ref={graphRef}>
        <svg className="edges" viewBox={`0 0 ${GRAPH_SIZE.width} ${GRAPH_SIZE.height}`} aria-hidden="true">
          {edges.map((edge, index) => (
            <line key={index} x1={edge.from.x} y1={edge.from.y} x2={edge.to.x} y2={edge.to.y} />
          ))}
        </svg>

        {(Object.keys(labels) as NodeKey[]).map(key => (
          <button
            key={key}
            type="button"
            className={`node ${key === "center" ? "center" : "leaf"}`}
            style={{ left: positions[key].x, top: positions[key].y }}
            onPointerDown={event => {
              const bounds = event.currentTarget.getBoundingClientRect();
              setDrag({
                key,
                offsetX: event.clientX - bounds.left,
                offsetY: event.clientY - bounds.top,
              });
            }}
          >
            {labels[key]}
          </button>
        ))}
      </div>
    </div>
  );
}

export default App;
