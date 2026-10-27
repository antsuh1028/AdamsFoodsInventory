import React, { useCallback, useEffect, useRef, useState } from "react";
import { Alert, AlertIcon, Box, Flex, Spinner, Stack, Text } from "@chakra-ui/react";
import FloatingWindow from "../../components/FloatingWindow";
import axiosInstance from "../../utils/axiosInstance";
import useBarcodeKeys from "../boxScan/useBarcodeKeys";
import { primeAudio, beepSuccess, beepError } from "../../utils/scanFeedback";
import { holdIdle } from "../../utils/idleHold";

// The scan station: left open on the computer the scanner base is plugged into. It only receives
// scans; the tablet picks the lot, item and pallet they go onto, and shows them as they land.

const errText = (err) => err.response?.data?.error || err.message || "Something went wrong.";

const AfStation = ({ isOpen, onClose }) => {
  const [station, setStation] = useState(null);
  const [last, setLast] = useState(null); // { ok, text, detail }
  const [count, setCount] = useState(0);
  const [focused, setFocused] = useState(true);
  const [problem, setProblem] = useState(null);
  const [pending, setPending] = useState(0);
  const chain = useRef(Promise.resolve());

  // Stays signed in while open, however long between deliveries.
  useEffect(() => (isOpen ? holdIdle() : undefined), [isOpen]);

  // The station and its target, refreshed so a change made on the tablet shows here too.
  const load = useCallback(async () => {
    try {
      const { data } = await axiosInstance.get("/af-stations");
      setStation(data[0] || null);
      setProblem(null);
    } catch (err) {
      setProblem(errText(err));
    }
  }, []);
  useEffect(() => {
    if (!isOpen) return undefined;
    load();
    const t = setInterval(load, 1500);
    return () => clearInterval(t);
  }, [isOpen, load]);

  // Scans only land in the window in front; say so the moment it is not.
  useEffect(() => {
    if (!isOpen) return undefined;
    const on = () => setFocused(true);
    const off = () => setFocused(false);
    setFocused(document.hasFocus());
    window.addEventListener("focus", on);
    window.addEventListener("blur", off);
    return () => { window.removeEventListener("focus", on); window.removeEventListener("blur", off); };
  }, [isOpen]);

  // One request at a time, in scan order. notRead reports a label that could not be read.
  const send = useCallback((raw, notRead) => {
    if (!station) return;
    setPending((n) => n + 1);
    chain.current = chain.current.then(async () => {
      try {
        const { data } = await axiosInstance.post(`/af-stations/${station.id}/scan`, { rawBarcode: raw, notRead });
        if (data.station) setStation(data.station);
        setLast({ ok: true, text: `${data.weight} lb`, detail: `${data.station?.itemDescription || ""} · Pallet ${data.palletNo}` });
        setCount((n) => n + 1);
        beepSuccess();
      } catch (err) {
        if (err.response?.data?.station) setStation(err.response.data.station);
        setLast({ ok: false, text: errText(err), detail: "" });
        beepError();
      } finally {
        setPending((n) => n - 1);
      }
    });
  }, [station]);

  useBarcodeKeys(isOpen, (result) => {
    if (result.type === "scan") send(result.raw);
    else {
      setLast({ ok: false, text: `Not read: ${result.reason || result.code}`, detail: "" });
      send(result.raw || "", result.reason || result.code);
    }
  });

  // Live only while a tablet holds the station and has checked in within 30 s.
  const live = Boolean(station && station.live);
  const target = live
    ? `${station.lotNumber} · ${station.itemDescription || "no item"} · Pallet ${station.palletNo}`
    : "No tablet connected. Scans are refused until a tablet turns on Use scan station.";

  return (
    <FloatingWindow isOpen={isOpen} onClose={onClose} title={station ? `Scan Station · ${station.name}` : "Scan Station"} width={720}>
      <Stack spacing={4} onClick={() => primeAudio()}>
        <Text fontSize="sm" color="gray.600">
          Leave this open on the computer the scanner base is plugged into. Pick the lot on the tablet.
        </Text>
        {!focused && (
          <Alert status="error" borderRadius="md" fontWeight="700">
            <AlertIcon />Click here. This window must stay in front or scans will not land.
          </Alert>
        )}
        {problem && <Alert status="error" borderRadius="md" py={2}><AlertIcon />{problem}</Alert>}
        {!station ? <Spinner /> : (
          <>
            <Box p={3} borderRadius="md" border="1px solid"
              bg={live ? "blue.50" : "gray.100"} borderColor={live ? "blue.200" : "gray.300"}>
              <Text fontSize="xs" color="gray.600" textTransform="uppercase" letterSpacing="wide">
                {live ? "Scanning onto" : "Not live"}
              </Text>
              <Text fontSize="xl" fontWeight="700" color={live ? "inherit" : "gray.600"}>{target}</Text>
              {live && station.heldBy && <Text fontSize="xs" color="gray.500">Tablet: {station.heldBy}</Text>}
            </Box>
            <Box p={6} borderRadius="lg" textAlign="center" minH="150px"
              bg={!last ? "gray.50" : last.ok ? "green.50" : "red.50"}
              border="2px solid" borderColor={!last ? "gray.200" : last.ok ? "green.300" : "red.300"}>
              {!last
                ? <Text fontSize="lg" color="gray.500">Waiting for the first scan.</Text>
                : <>
                    <Text fontSize="5xl" fontWeight="800" lineHeight="1.1"
                      color={last.ok ? "green.700" : "red.700"} style={{ fontVariantNumeric: "tabular-nums" }}>
                      {last.text}
                    </Text>
                    {last.detail && <Text mt={2} fontSize="md" color="gray.600">{last.detail}</Text>}
                  </>}
            </Box>
            <Flex justify="space-between" fontSize="sm" color="gray.500">
              <Text>{count} saved since this window opened</Text>
              {pending > 0 && <Text>saving {pending}</Text>}
            </Flex>
          </>
        )}
      </Stack>
    </FloatingWindow>
  );
};

export default AfStation;
