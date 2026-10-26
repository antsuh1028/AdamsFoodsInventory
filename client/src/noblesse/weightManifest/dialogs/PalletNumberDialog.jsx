// Asks for the pallet number before an outgoing manifest or tag prints. Not stored.

import { useRef, useState } from "react";
import { AlertDialog, AlertDialogBody, AlertDialogContent, AlertDialogFooter, AlertDialogHeader, AlertDialogOverlay, Button, Input, Text } from "@chakra-ui/react";

const PalletNumberDialog = ({ ask, onClose, onPrint }) => {
  const cancelRef = useRef(null);
  const [value, setValue] = useState("");

  // The print button is a fresh click, so the print window is not blocked.
  const submit = () => { onPrint(value.trim()); setValue(""); };
  const close = () => { setValue(""); onClose(); };

  return (
    <AlertDialog isOpen={Boolean(ask)} leastDestructiveRef={cancelRef} onClose={close} isCentered>
      <AlertDialogOverlay>
        <AlertDialogContent>
          <AlertDialogHeader fontSize="lg" fontWeight="bold">
            {ask?.kind === "tag" ? "Print pallet tag" : "Print weight manifest"}
          </AlertDialogHeader>
          <AlertDialogBody>
            <Text fontSize="sm" mb={2}>
              Pallet # for {ask?.lotNumber || "this pallet"}. Leave it blank to write it in by hand.
            </Text>
            <Input autoFocus placeholder="Pallet #" value={value}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") submit(); }} />
          </AlertDialogBody>
          <AlertDialogFooter gap={2}>
            <Button ref={cancelRef} onClick={close}>Cancel</Button>
            <Button colorScheme="blue" onClick={submit}>Print</Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialogOverlay>
    </AlertDialog>
  );
};

export default PalletNumberDialog;
