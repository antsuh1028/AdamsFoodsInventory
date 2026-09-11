import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Box, Flex, Text, Input, Button, Badge, Progress,
  AlertDialog, AlertDialogBody, AlertDialogFooter, AlertDialogHeader,
  AlertDialogContent, AlertDialogOverlay,
} from "@chakra-ui/react";
import { parseTypedWeight, looksWrong, looksLikeReweigh } from "../../utils/typedWeight";
import { beepError } from "../../utils/scanFeedback";

// Typing weights at the bench, one box at a time as each is weighed.
//
// The operator is already pressing Print on every box. This is a SECOND
// per-box action on top of that, so the only thing that matters is how few
// keystrokes it costs — five, and never a mouse:
//
//     4 0 6 1 <Enter>     ->  40.61 lb recorded, field cleared, still focused
//
// Digits are read like a till: the last two are the decimals. That removes a
// keystroke and the commonest mis-key. Anyone who prefers the point can type
// 40.61 and it is taken literally.
//
// THIS FIELD HOLDS FOCUS ON PURPOSE, which is the opposite of every other input
// on the scanning screen. The global keydown handler in boxScanner.jsx bails
// when focus is in an INPUT, so a focused field normally SWALLOWS SCANS
// (CLAUDE.md §4). That is fine here and nowhere else: this panel is for the
// outgoing bench, where finished boxes carry no barcode and there is nothing to
// scan. It is a deliberate mode, never the default, and it says so.
const TypeWeights = ({ onAdd, onUndo, weights = [], expected = null, disabled = false }) => {
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(null);   // an outlier awaiting a yes/no
  const inputRef = useRef(null);
  const cancelRef = useRef(null);

  // Re-arm after every commit. Without this the operator has to click back in
  // once per box, which is the whole cost this component exists to remove.
  // Called after a COMMIT, never on blur. Yanking focus back whenever it is
  // lost would trap it: on a desktop there is a mouse and a grid to click, and
  // a field that cannot be left is worse than one keystroke to return to.
  const refocus = () => {
    // After the dialog closes React restores focus elsewhere, so this waits a
    // tick rather than fighting it.
    setTimeout(() => inputRef.current?.focus(), 0);
  };

  useEffect(() => { if (!disabled) inputRef.current?.focus(); }, [disabled]);

  const parsed = useMemo(() => parseTypedWeight(typed), [typed]);
  const preview = parsed.ok ? parsed.weight : null;

  // onAdd beeps and reports for itself; what it RETURNS is whether the box
  // actually landed. Only a true clears the field — leaving the digits in place
  // after a refusal means the box can be retried with one keypress instead of
  // being retyped from the label, and a cleared field would otherwise read as
  // "recorded".
  const commit = async (weight) => {
    setBusy(true);
    let ok = false;
    try {
      ok = await onAdd(weight);
    } catch {
      beepError();
    } finally {
      setBusy(false);
      refocus();
    }
    if (ok) setTyped("");
  };

  const submit = async () => {
    if (!parsed.ok) {
      if (typed.trim()) beepError();
      return;
    }
    // Advisory, never a refusal — the operator is holding the box and this is
    // not. A missed decimal is a 10x error, which is worth one keypress to
    // confirm and impossible to spot afterwards in a column of numbers.
    const verdict = looksWrong(parsed.weight, weights);
    if (verdict.outlier) {
      beepError();
      setConfirm({ kind: "outlier", weight: parsed.weight, ...verdict });
      return;
    }

    // The same box coming back: a ripped label, or a re-weigh to reprint one.
    // Asked AFTER the outlier check because a weight that is both wrong-looking
    // and a repeat is more likely a mis-key than a box.
    const repeat = looksLikeReweigh(parsed.weight, weights);
    if (repeat.reweigh) {
      beepError();
      setConfirm({ kind: "reweigh", weight: parsed.weight, ...repeat });
      return;
    }

    await commit(parsed.weight);
  };

  const onKeyDown = (e) => {
    if (e.key === "Enter") { e.preventDefault(); submit(); return; }
    // Backspace on an empty field takes back the last box. No dialog: undoing
    // is how a mistake gets fixed at speed, and a confirmation here would cost
    // more than the mistake.
    if (e.key === "Backspace" && !typed && onUndo) {
      e.preventDefault();
      onUndo();
    }
  };

  const count = weights.length;
  const remaining = expected ? Math.max(0, expected - count) : null;

  return (
    <Box p={3} bg="blue.50" borderRadius="md" border="1px solid" borderColor="blue.200">
      <Flex align="baseline" gap={3} wrap="wrap" mb={2}>
        <Text fontSize="xs" color="blue.900" fontWeight="600" textTransform="uppercase"
          letterSpacing="wide">
          Type weights
        </Text>
        <Text fontSize="xs" color="gray.600">
          Digits only — <b>4061</b> is 40.61. Enter records it.
        </Text>
        <Box flex={1} />
        {/* Said plainly: with focus in this field the scanner is deaf. */}
        <Badge colorScheme="yellow" fontSize="9px">scanning is off while typing</Badge>
      </Flex>

      <Flex gap={3} align="center" wrap="wrap">
        <Input
          ref={inputRef}
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          onKeyDown={onKeyDown}
          isDisabled={disabled || busy}
          placeholder="4061"
          inputMode="decimal"
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          size="lg"
          bg="white"
          width="160px"
          fontSize="2xl"
          fontWeight="bold"
          textAlign="center"
          style={{ fontVariantNumeric: "tabular-nums" }}
        />

        {/* The echo. Confirms what the digits were read as BEFORE they are
            committed, which is the whole safeguard against the till reading
            surprising someone. */}
        <Box minW="150px">
          {preview ? (
            <Flex align="baseline" gap={2}>
              <Text fontSize="3xl" fontWeight="bold" color="blue.700" lineHeight="1"
                style={{ fontVariantNumeric: "tabular-nums" }}>
                {preview}
              </Text>
              <Text fontSize="md" color="gray.600">lb</Text>
            </Flex>
          ) : (
            <Text fontSize="sm" color={typed.trim() ? "red.600" : "gray.400"}>
              {typed.trim() ? parsed.reason : "waiting"}
            </Text>
          )}
        </Box>

        <Button size="sm" colorScheme="blue" onClick={submit}
          isLoading={busy} isDisabled={disabled || !parsed.ok}>
          Add
        </Button>
        {onUndo && (
          <Button size="sm" variant="ghost" onClick={() => { onUndo(); refocus(); }}
            isDisabled={disabled || count === 0}>
            Undo last
          </Button>
        )}
      </Flex>

      {/* Progress against what was expected, so being short is noticed DURING
          the lot rather than after the truck has gone. */}
      {expected ? (
        <Box mt={3}>
          <Flex justify="space-between" align="baseline" mb={1}>
            <Text fontSize="sm" fontWeight="600" color="gray.700">
              Box {count} of {expected}
            </Text>
            <Text fontSize="xs" color={remaining === 0 ? "green.700" : "gray.500"}>
              {remaining === 0 ? "all expected boxes weighed" : `${remaining} to go`}
            </Text>
          </Flex>
          <Progress value={Math.min(100, (count / expected) * 100)} size="sm"
            colorScheme={count > expected ? "yellow" : "blue"} borderRadius="full" />
          {count > expected && (
            <Text fontSize="xs" color="yellow.800" mt={1}>
              {count - expected} more than expected — not blocked, but worth a look.
            </Text>
          )}
        </Box>
      ) : (
        <Text fontSize="sm" color="gray.600" mt={2}>{count} box{count === 1 ? "" : "es"}</Text>
      )}

      <AlertDialog isOpen={Boolean(confirm)} leastDestructiveRef={cancelRef}
        onClose={() => { setConfirm(null); refocus(); }} isCentered>
        <AlertDialogOverlay>
          <AlertDialogContent>
            <AlertDialogHeader fontSize="lg" fontWeight="bold">
              {confirm?.kind === "reweigh"
                ? "Same weight as the last box"
                : "Is that weight right?"}
            </AlertDialogHeader>
            <AlertDialogBody>
              <Flex align="baseline" gap={2} mb={3}>
                <Text fontSize="3xl" fontWeight="bold" color="yellow.700"
                  style={{ fontVariantNumeric: "tabular-nums" }}>
                  {confirm?.weight}
                </Text>
                <Text fontSize="md" color="gray.600">lb</Text>
              </Flex>

              {confirm?.kind === "reweigh" ? (
                <>
                  <Text fontSize="sm">
                    The box before this one weighed exactly the same. That usually
                    means the <b>same box came back</b> — a torn label, or a re-weigh
                    to reprint one.
                  </Text>
                  <Text fontSize="xs" color="gray.600" mt={2}>
                    If it is the same box it is already on the manifest, and recording
                    it again would count one box as two. Two different boxes landing on
                    the same figure does happen — if that is what this is, add it.
                  </Text>
                </>
              ) : (
                <>
                  <Text fontSize="sm">
                    That is about <b>{confirm ? Math.round(confirm.ratio > 1 ? confirm.ratio : 1 / confirm.ratio) : ""}×</b>
                    {" "}{confirm?.direction === "high" ? "heavier" : "lighter"} than the rest of this
                    lot, which is running around <b>{confirm ? confirm.median.toFixed(2) : ""} lb</b> a box.
                  </Text>
                  <Text fontSize="xs" color="gray.600" mt={2}>
                    A misplaced decimal looks exactly like this. If the box really does weigh
                    that, record it.
                  </Text>
                </>
              )}
            </AlertDialogBody>
            <AlertDialogFooter gap={2}>
              {/* Focus sits on the safe option: Enter is the key being hammered
                  here, and it must not commit a weight that was queried.
                  For a re-weigh the safe answer is NOT recording it — a box
                  counted twice inflates the lot and nothing downstream notices. */}
              <Button ref={cancelRef}
                onClick={() => { setConfirm(null); setTyped(""); refocus(); }}>
                {confirm?.kind === "reweigh" ? "Same box — don't record" : "Let me retype it"}
              </Button>
              <Button colorScheme="yellow"
                onClick={async () => { const w = confirm.weight; setConfirm(null); await commit(w); }}>
                {confirm?.kind === "reweigh" ? "Different box — record it" : `Record ${confirm?.weight}`}
              </Button>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialogOverlay>
      </AlertDialog>
    </Box>
  );
};

export default TypeWeights;
