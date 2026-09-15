/* global BigInt */
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Box, Flex, Text, Input, Button, Badge, Progress, ButtonGroup,
  AlertDialog, AlertDialogBody, AlertDialogFooter, AlertDialogHeader,
  AlertDialogContent, AlertDialogOverlay,
} from "@chakra-ui/react";
import { parseTypedWeight, looksWrong, looksLikeReweigh } from "../../utils/typedWeight";
import { beepError } from "../../utils/scanFeedback";
import { toDisplayHundredths, fromHundredths } from "../../utils/weight";

// Same ceiling as the incoming keypad: a typo in the count is otherwise
// thousands of rows.
const MAX_BATCH = 500;

// Typing weights at the bench, one box at a time as each is weighed.
// on the scanning screen. The global keydown handler in boxScanner.jsx bails
// when focus is in an INPUT, so a focused field normally SWALLOWS SCANS (CLAUDE.md
// §4).
const TypeWeights = ({
  onAdd, onAddMany, onUndo, weights = [], expected = null, disabled = false,
}) => {
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(null);   // an outlier awaiting a yes/no
  // "one" | "batch". A pallet of identical cases off the line is a different act
  // from weighing one box, so it is a mode rather than a field always on show.
  const [mode, setMode] = useState("one");
  const [cases, setCases] = useState("");
  const [confirmBatch, setConfirmBatch] = useState(false);
  const inputRef = useRef(null);
  const cancelRef = useRef(null);

  // Re-arm after every commit.
  const refocus = () => {
    // After the dialog closes React restores focus elsewhere, so this waits a
    // tick rather than fighting it.
    setTimeout(() => inputRef.current?.focus(), 0);
  };

  useEffect(() => { if (!disabled) inputRef.current?.focus(); }, [disabled]);

  const parsed = useMemo(() => parseTypedWeight(typed), [typed]);
  const preview = parsed.ok ? parsed.weight : null;

  const caseCount = parseInt(cases, 10);
  const batchReady = parsed.ok && Number.isInteger(caseCount)
    && caseCount > 0 && caseCount <= MAX_BATCH;
  // Shown before committing: the operator agrees to a TOTAL, not to two numbers.
  // Rounded per box then multiplied, like every other total here.
  const batchTotal = batchReady
    ? fromHundredths(toDisplayHundredths(parsed.weight) * BigInt(caseCount))
    : null;

  const submitBatch = async () => {
    if (!batchReady) return;
    setConfirmBatch(false);
    setBusy(true);
    try {
      await onAddMany(Array.from({ length: caseCount }, () => ({
        weight: parsed.weight, weightUnit: "LB", isManual: true,
        entryMethod: "keyed",
        // NOT MEASURED - the figure on the label, and the boxes vary.
        isEstimated: true,
      })));
      setCases("");
      setTyped("");
    } catch {
      beepError();
    } finally {
      setBusy(false);
      refocus();
    }
  };

  // onAdd beeps and reports for itself; what it RETURNS is whether the box actually
  // landed.
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
    // Advisory, never a refusal — the operator is holding the box and this is not.
    const verdict = looksWrong(parsed.weight, weights);
    if (verdict.outlier) {
      beepError();
      setConfirm({ kind: "outlier", weight: parsed.weight, ...verdict });
      return;
    }

    // The same box coming back: a ripped label, or a re-weigh to reprint one.
    const repeat = looksLikeReweigh(parsed.weight, weights);
    if (repeat.reweigh) {
      beepError();
      setConfirm({ kind: "reweigh", weight: parsed.weight, ...repeat });
      return;
    }

    await commit(parsed.weight);
  };

  const onKeyDown = (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      // In batch mode Enter raises the confirmation rather than recording one
      // box, so the same keystroke cannot mean two different things.
      if (mode === "batch") { if (batchReady) setConfirmBatch(true); return; }
      submit();
      return;
    }
    // Backspace on an empty field takes back the last box.
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

      {onAddMany && (
        <ButtonGroup size="xs" isAttached variant="outline" mb={3}>
          {/* tabIndex -1 and mousedown prevented, like the keypad: a scanner
              types Enter, and a button holding focus would be re-pressed. */}
          {[["one", "One box"], ["batch", "Batch"]].map(([m, label]) => (
            <Button key={m} tabIndex={-1} onMouseDown={(e) => e.preventDefault()}
              colorScheme={mode === m ? "blue" : "gray"}
              variant={mode === m ? "solid" : "outline"}
              onClick={() => { setMode(m); refocus(); }}>
              {label}
            </Button>
          ))}
        </ButtonGroup>
      )}

      {mode === "batch" && (
        <Flex gap={3} align="flex-end" wrap="wrap" mb={3}>
          <Box>
            <Text fontSize="xs" color="gray.600" mb={1}>How many boxes</Text>
            <Input value={cases}
              onChange={(e) => setCases(e.target.value.replace(/[^0-9]/g, ""))}
              isDisabled={disabled || busy} placeholder="30" inputMode="numeric"
              autoComplete="off" size="lg" bg="white" width="120px"
              fontSize="2xl" fontWeight="bold" textAlign="center"
              style={{ fontVariantNumeric: "tabular-nums" }} />
          </Box>
          <Box mb={2}>
            <Text fontSize="xs" color="gray.600" mb={1}>Comes to</Text>
            <Text fontSize="xl" fontWeight="bold" color="blue.700" lineHeight="1"
              style={{ fontVariantNumeric: "tabular-nums" }}>
              {batchTotal ? `${batchTotal} lb` : "—"}
            </Text>
          </Box>
          <Button size="sm" colorScheme="blue" mb={2}
            isLoading={busy} isDisabled={disabled || !batchReady}
            onClick={() => setConfirmBatch(true)}>
            Add {batchReady ? caseCount : ""} boxes
          </Button>
          {caseCount > MAX_BATCH && (
            <Text fontSize="xs" color="red.600" mb={3}>
              {MAX_BATCH} at a time is the limit.
            </Text>
          )}
        </Flex>
      )}

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

        {mode === "one" && (
          <Button size="sm" colorScheme="blue" onClick={submit}
            isLoading={busy} isDisabled={disabled || !parsed.ok}>
            Add
          </Button>
        )}
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

      <AlertDialog isOpen={confirmBatch} leastDestructiveRef={cancelRef}
        onClose={() => { setConfirmBatch(false); refocus(); }} isCentered>
        <AlertDialogOverlay>
          <AlertDialogContent>
            <AlertDialogHeader fontSize="lg" fontWeight="bold">
              Add {caseCount} boxes?
            </AlertDialogHeader>
            <AlertDialogBody>
              <Text fontSize="3xl" fontWeight="bold" color="blue.700" lineHeight="1.2"
                style={{ fontVariantNumeric: "tabular-nums" }}>
                {caseCount} × {preview} lb
              </Text>
              <Text fontSize="md" color="gray.700" mb={3}>
                = <b>{batchTotal} lb</b> on this lot
              </Text>
              <Text fontSize="sm">
                Each one is recorded as its own box, so any of them can be
                corrected or voided on its own afterwards.
              </Text>
              <Text fontSize="xs" color="gray.600" mt={2}>
                They are marked <b>estimated</b>: this is the figure on the label,
                and the boxes themselves vary.
              </Text>
            </AlertDialogBody>
            <AlertDialogFooter gap={2}>
              {/* Focus on the safe option - Enter is the key being hammered. */}
              <Button ref={cancelRef}
                onClick={() => { setConfirmBatch(false); refocus(); }}>
                Go back
              </Button>
              <Button colorScheme="blue" onClick={submitBatch}>
                Add {caseCount} boxes
              </Button>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialogOverlay>
      </AlertDialog>

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
