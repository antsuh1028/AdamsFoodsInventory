import React from "react";
import { Button } from "@chakra-ui/react";

// EN / ES, in the title bar.
//
// tabIndex -1 with mousedown prevented, like every other control on a weighing
// screen: the typing panel commits on Enter and a button left holding focus
// would take that keystroke instead (CLAUDE.md §4). Stopping propagation as
// well keeps a press off the title bar from starting a window drag.
const LangToggle = ({ lang, onToggle, dark = false }) => (
  <Button
    size="xs"
    variant="ghost"
    tabIndex={-1}
    color={dark ? "whiteAlpha.900" : undefined}
    onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); }}
    onClick={onToggle}
    aria-label={lang === "en" ? "Cambiar a español" : "Switch to English"}
    fontWeight="600"
    letterSpacing="wide"
  >
    {lang === "en" ? "ES" : "EN"}
  </Button>
);

export default LangToggle;
