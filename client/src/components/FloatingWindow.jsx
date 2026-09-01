import React, { useEffect, useRef, useState } from "react";
import { Box, Flex, Text, IconButton, Portal, Tooltip } from "@chakra-ui/react";
import { CloseIcon } from "@chakra-ui/icons";

const MIN_WIDTH = 300;
const MIN_HEIGHT = 220;
const EDGE_MARGIN = 16; // breathing room kept on each side when a window has to shrink
const EDGE = 1;  // grab-zone thickness for straight edges
const CORNER = 2; // grab-zone size for corners — kept small so it doesn't sit over the header's close/fullscreen buttons

// The `width` a caller passes is a desktop *maximum*, not a fixed size — a window
// asked to be 1600px wide has to come down to ~360px on a phone. Accepts a number
// of pixels or a percentage string ("90%") measured against the viewport.
const resolveWidth = (requested, viewportW) => {
  const available = Math.max(240, viewportW - EDGE_MARGIN * 2);
  const desired = typeof requested === "string" && requested.trim().endsWith("%")
    ? (parseFloat(requested) / 100) * viewportW
    : Number(requested);
  const capped = Math.min(Number.isFinite(desired) ? desired : available, available);
  // Never force a window wider than the screen just to honour MIN_WIDTH.
  return Math.max(capped, Math.min(MIN_WIDTH, available));
};

// Invisible grab strip along one edge or corner of the window.
const ResizeHandle = ({ edge, onStart }) => {
  const styles = {
    n:  { top: 0, left: CORNER, right: CORNER, height: EDGE, cursor: "ns-resize" },
    s:  { bottom: 0, left: CORNER, right: CORNER, height: EDGE, cursor: "ns-resize" },
    e:  { right: 0, top: CORNER, bottom: CORNER, width: EDGE, cursor: "ew-resize" },
    w:  { left: 0, top: CORNER, bottom: CORNER, width: EDGE, cursor: "ew-resize" },
    ne: { top: 0, right: 0, width: CORNER, height: CORNER, cursor: "nesw-resize" },
    nw: { top: 0, left: 0, width: CORNER, height: CORNER, cursor: "nwse-resize" },
    se: { bottom: 0, right: 0, width: CORNER, height: CORNER, cursor: "nwse-resize" },
    sw: { bottom: 0, left: 0, width: CORNER, height: CORNER, cursor: "nesw-resize" },
  }[edge];
  return <Box position="absolute" zIndex={10} {...styles} onMouseDown={(e) => onStart(edge, e)} />;
};

const FloatingWindow = ({
  isOpen, onClose, title, children, footer,
  width = "70%", height, isFullScreen = false, onToggleFullScreen,
  bodyProps, dark = false,
}) => {
  const [position, setPosition] = useState(null);
  const [size, setSize] = useState(null); // null height = auto (content-driven) until user resizes
  const [viewport, setViewport] = useState(() => ({
    w: typeof window === "undefined" ? 1024 : window.innerWidth,
    h: typeof window === "undefined" ? 768 : window.innerHeight,
  }));
  const boxRef = useRef(null);
  const dragState = useRef(null);   // { startX, startY, originX, originY }
  const resizeState = useRef(null); // { edge, startX, startY, startWidth, startHeight, startLeft, startTop }

  // Re-measure on every open, not just while open. The browser can be resized
  // (or the window opened on a different display) while this is closed, and a
  // listener that only runs when isOpen leaves the stored size stale.
  useEffect(() => {
    if (!isOpen) return undefined;
    const onResize = () => setViewport({ w: window.innerWidth, h: window.innerHeight });
    onResize();
    window.addEventListener("resize", onResize);
    window.addEventListener("orientationchange", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      window.removeEventListener("orientationchange", onResize);
    };
  }, [isOpen]);

  // Center on first open; on later viewport changes only pull the window back
  // on-screen, rather than yanking it out from under the user.
  useEffect(() => {
    if (!isOpen) { setPosition(null); setSize(null); return; }
    setPosition((prev) => {
      if (!prev) {
        // Measured straight from the browser rather than from viewport state.
        // The setViewport above has not necessarily landed on this pass, and
        // centring against a stale value is exactly the bug this fixes.
        const vw = window.innerWidth;
        const vh = window.innerHeight;
        const liveWidth = resolveWidth(size?.width ?? width, vw);
        return {
          x: Math.max(EDGE_MARGIN, Math.round((vw - liveWidth) / 2)),
          y: Math.max(EDGE_MARGIN, Math.round(vh * 0.06)),
        };
      }
      const w = resolveWidth(size?.width ?? width, viewport.w);
      return {
        x: Math.min(prev.x, Math.max(EDGE_MARGIN, viewport.w - w - EDGE_MARGIN)),
        y: Math.min(prev.y, Math.max(EDGE_MARGIN, viewport.h - 80)),
      };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, viewport.w, viewport.h]);

  useEffect(() => {
    const onMouseMove = (e) => {
      if (resizeState.current) {
        const { edge, startX, startY, startWidth, startHeight, startLeft, startTop } = resizeState.current;
        const dx = e.clientX - startX;
        const dy = e.clientY - startY;
        let newWidth = startWidth, newHeight = startHeight, newLeft = startLeft, newTop = startTop;

        if (edge.includes("e")) newWidth = Math.max(MIN_WIDTH, startWidth + dx);
        if (edge.includes("s")) newHeight = Math.max(MIN_HEIGHT, startHeight + dy);
        if (edge.includes("w")) {
          newWidth = Math.max(MIN_WIDTH, startWidth - dx);
          newLeft = startLeft + (startWidth - newWidth);
        }
        if (edge.includes("n")) {
          newHeight = Math.max(MIN_HEIGHT, startHeight - dy);
          newTop = startTop + (startHeight - newHeight);
        }
        newLeft = Math.max(0, newLeft);
        newTop = Math.max(0, newTop);

        setSize({ width: newWidth, height: newHeight });
        setPosition({ x: newLeft, y: newTop });
        return;
      }
      if (dragState.current) {
        const { startX, startY, originX, originY } = dragState.current;
        const maxX = window.innerWidth - 120;
        const maxY = window.innerHeight - 40;
        setPosition({
          x: Math.min(Math.max(0, originX + (e.clientX - startX)), maxX),
          y: Math.min(Math.max(0, originY + (e.clientY - startY)), maxY),
        });
      }
    };
    const onMouseUp = () => { dragState.current = null; resizeState.current = null; };
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
  }, []);

  if (!isOpen || !position) return null;

  const startDrag = (e) => {
    if (isFullScreen) return;
    // Titles can contain interactive JSX (buttons, toggles) — don't let a
    // click on one of those get swallowed by an armed drag.
    if (e.target.closest('button, input, select, textarea, a, [role="button"]')) return;
    dragState.current = { startX: e.clientX, startY: e.clientY, originX: position.x, originY: position.y };
  };

  const startResize = (edge, e) => {
    if (isFullScreen) return;
    e.stopPropagation();
    e.preventDefault();
    const rect = boxRef.current.getBoundingClientRect();
    resizeState.current = {
      edge, startX: e.clientX, startY: e.clientY,
      startWidth: rect.width, startHeight: rect.height,
      startLeft: rect.left, startTop: rect.top,
    };
  };

  // Routing a manual resize through resolveWidth too keeps a hand-sized window
  // from hanging off the screen after a rotation.
  const currentWidth = resolveWidth(size?.width ?? width, viewport.w);

  return (
    <Portal>
      <Box
        ref={boxRef}
        position="fixed"
        left={isFullScreen ? 0 : `${position.x}px`}
        top={isFullScreen ? 0 : `${position.y}px`}
        width={isFullScreen ? "100vw" : `${currentWidth}px`}
        maxW={isFullScreen ? "100vw" : `calc(100vw - ${EDGE_MARGIN * 2}px)`}
        height={isFullScreen ? "100vh" : `${size?.height ?? height ?? "auto"}${size?.height || height ? "px" : ""}`}
        maxH={isFullScreen ? "100vh" : (size?.height || height) ? "95vh" : "88vh"}
        // Deliberately darker than the gray.50 page behind it. When both were
        // gray.50 the window had nothing but a 1px border separating it from
        // the screen and read as part of the page.
        bg={dark ? "gray.900" : "gray.100"}
        borderRadius={isFullScreen ? 0 : "lg"}
        boxShadow="2xl"
        border="1px solid"
        borderColor={dark ? "gray.700" : "gray.400"}
        zIndex={1400}
        display="flex"
        flexDirection="column"
        overflow="hidden"
      >
        <Flex
          align="center" justify="space-between"
          bg={dark ? "gray.800" : "gray.200"} borderBottom="1px" borderColor={dark ? "gray.700" : "gray.300"}
          px={4} py={2} flexShrink={0}
          cursor={isFullScreen ? "default" : "move"}
          onMouseDown={startDrag}
          userSelect="none"
        >
          <Box fontSize="sm" fontWeight="semibold" color={dark ? "whiteAlpha.900" : "gray.700"} minW={0} flex={1}>
            {title}
          </Box>
          <Flex align="center" gap={1}>
            {onToggleFullScreen && (
              <Tooltip label={isFullScreen ? "Exit full screen" : "Full screen"}>
                <IconButton
                  aria-label={isFullScreen ? "Exit full screen" : "Full screen"}
                  icon={<Text fontSize="md" lineHeight="1">{isFullScreen ? "⤡" : "⤢"}</Text>}
                  size="xs" variant="ghost" color={dark ? "whiteAlpha.900" : undefined} onClick={onToggleFullScreen}
                />
              </Tooltip>
            )}
            <IconButton aria-label="Close" icon={<CloseIcon boxSize={2.5} />}
              size="xs" variant="ghost" color={dark ? "whiteAlpha.900" : undefined} onClick={onClose} />
          </Flex>
        </Flex>

        <Box flex={1} overflowY="auto" px={5} py={4} {...bodyProps}>
          {children}
        </Box>

        {footer && (
          <Flex justify="flex-end" gap={2} borderTop="1px" borderColor={dark ? "gray.700" : "gray.200"} px={5} py={3} flexShrink={0}>
            {footer}
          </Flex>
        )}

        {!isFullScreen && (
          <>
            <ResizeHandle edge="n" onStart={startResize} />
            <ResizeHandle edge="s" onStart={startResize} />
            <ResizeHandle edge="e" onStart={startResize} />
            <ResizeHandle edge="w" onStart={startResize} />
            <ResizeHandle edge="ne" onStart={startResize} />
            <ResizeHandle edge="nw" onStart={startResize} />
            <ResizeHandle edge="se" onStart={startResize} />
            <ResizeHandle edge="sw" onStart={startResize} />
          </>
        )}
      </Box>
    </Portal>
  );
};

export default FloatingWindow;
