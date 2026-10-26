import React, { useState } from "react";
import { Box, Button, ButtonGroup, Stack } from "@chakra-ui/react";
import FloatingWindow from "../../components/FloatingWindow";
import ReceiveSetup from "./ReceiveSetup";
import ReceiveSession from "./ReceiveSession";
import PullOut from "./PullOut";
import useWakeLock from "./useWakeLock";

// Scanning box labels at Adams Foods: in to a freezer location, or out.

const ScanBoxes = ({ isOpen, onClose }) => {
  const [mode, setMode] = useState("receive");
  const [row, setRow] = useState(null); // the row being scanned onto
  useWakeLock(isOpen);

  const close = () => { setRow(null); onClose(); };

  return (
    <FloatingWindow isOpen={isOpen} onClose={close} title="Scan Boxes" width={760}>
      <Stack spacing={4}>
        <ButtonGroup size="sm" isAttached variant="outline">
          <Button colorScheme={mode === "receive" ? "blue" : "gray"} variant={mode === "receive" ? "solid" : "outline"}
            onClick={() => setMode("receive")} isDisabled={Boolean(row)}>
            Receive into freezer
          </Button>
          <Button colorScheme={mode === "pull" ? "blue" : "gray"} variant={mode === "pull" ? "solid" : "outline"}
            onClick={() => setMode("pull")} isDisabled={Boolean(row)}>
            Pull out
          </Button>
        </ButtonGroup>

        {mode === "receive" && (row
          ? <ReceiveSession key={row._id} row={row} active={isOpen} onDone={() => setRow(null)} />
          : <ReceiveSetup onStart={setRow} />)}

        {/* Kept mounted so switching modes never loses an unfinished pull list. */}
        <Box hidden={mode !== "pull"}>
          <PullOut active={isOpen && mode === "pull"} />
        </Box>
      </Stack>
    </FloatingWindow>
  );
};

export default ScanBoxes;
