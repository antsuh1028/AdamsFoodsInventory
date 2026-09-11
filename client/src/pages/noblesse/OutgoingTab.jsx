import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  Box, Flex, Text, Button, Badge, Spinner, Input, Select, Checkbox, Alert, AlertIcon,
  AlertDialog, AlertDialogBody, AlertDialogFooter, AlertDialogHeader,
  AlertDialogContent, AlertDialogOverlay, useToast,
} from "@chakra-ui/react";
import axiosInstance from "../../utils/axiosInstance";
import BoxScanner from "../../components/navbar/boxScanner";
import { toDisplay } from "../../utils/weight";
import { fmtDate, today, upper } from "./shared";
import getRole from "../../utils/getRole";
import printPackingList from "./printPackingList";

// Outgoing: product leaving NTI, either back to AdamsFoods for distribution or
// straight to a customer.
//
// A load is built as a draft, then shipped — and shipping is the moment stock
// actually moves, so it is confirmed against the destination, the lots and the
// total rather than being a single tap. A shipped load is never edited or
// deleted; cancelling restores the stock and keeps the record.

const STATUS = {
  draft:     { label: "Draft",     color: "gray" },
  shipped:   { label: "Shipped",   color: "green" },
  cancelled: { label: "Cancelled", color: "red" },
};

const lb = (v) => (v === null || v === undefined || v === "" ? "0.00" : toDisplay(v));

const Field = ({ label, children, w }) => (
  <Box flex={w ? `0 0 ${w}` : "1 1 150px"} minW="120px">
    <Text fontSize="xs" color="gray.500" textTransform="uppercase" letterSpacing="wide" mb={1}>
      {label}
    </Text>
    {children}
  </Box>
);

export const OutgoingTab = ({ refreshSignal = 0 }) => {
  const isAdmin = getRole() === "admin";
  const toast = useToast();

  const [shipments, setShipments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [openId, setOpenId] = useState(null);
  const [detail, setDetail] = useState(null);
  const [available, setAvailable] = useState([]);
  const [busy, setBusy] = useState(false);

  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState(null);

  // A new line being added to the open draft.
  const [line, setLine] = useState({ stockKey: "", weight: "", qtyCases: "" });

  // Weighing sessions that could be tied to the open draft.
  const [batches, setBatches] = useState([]);
  const [pickedBatches, setPickedBatches] = useState(() => new Set());

  const [confirmShip, setConfirmShip] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  // Weighing finished product. Opens the same session machinery the incoming
  // bench uses, pointed the other way.
  const [weighOpen, setWeighOpen] = useState(false);
  const cancelRef = useRef(null);

  const fetchShipments = useCallback(async () => {
    try {
      const { data } = await axiosInstance.get("/shipments");
      setShipments(data || []);
    } catch (err) {
      toast({ title: "Could not load shipments",
        description: err.response?.data?.error || err.message,
        status: "error", duration: 4000, position: "top" });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  const fetchAvailable = useCallback(async () => {
    try {
      const { data } = await axiosInstance.get("/shipments/available");
      setAvailable(data || []);
    } catch {
      // The list of what can be shipped failing must not blank the shipments
      // themselves, which is the part people need to keep working.
    }
  }, []);

  const fetchBatches = useCallback(async () => {
    try {
      const { data } = await axiosInstance.get("/box-batches");
      setBatches(data || []);
    } catch {
      // Tying a session is optional, so failing to list them must not stop a
      // load being built by typing its totals.
    }
  }, []);

  useEffect(() => {
    fetchShipments(); fetchAvailable(); fetchBatches();
  }, [fetchShipments, fetchAvailable, fetchBatches]);

  // The parent polls every 60s and bumps this. Compared against a ref so the
  // mount effect and the signal effect do not both fire on first render — a tab
  // that only fetches on mount looks live but is frozen at page load.
  const lastSignal = useRef(refreshSignal);
  useEffect(() => {
    if (lastSignal.current === refreshSignal) return;
    lastSignal.current = refreshSignal;
    fetchShipments();
    fetchAvailable();
  }, [refreshSignal, fetchShipments, fetchAvailable]);

  const openShipment = async (id) => {
    if (openId === id) { setOpenId(null); setDetail(null); return; }
    setOpenId(id);
    setDetail(null);
    try {
      const { data } = await axiosInstance.get(`/shipments/${id}`);
      setDetail(data);
    } catch (err) {
      toast({ title: "Could not open that shipment",
        description: err.response?.data?.error || err.message,
        status: "error", duration: 4000, position: "top" });
      setOpenId(null);
    }
  };

  const refreshOpen = async (id) => {
    const { data } = await axiosInstance.get(`/shipments/${id}`);
    setDetail(data);
    fetchShipments();
    fetchAvailable();
  };

  const run = async (fn, successTitle) => {
    setBusy(true);
    try {
      await fn();
      if (successTitle) {
        toast({ title: successTitle, status: "success", duration: 3000, position: "top" });
      }
    } catch (err) {
      const body = err.response?.data;
      toast({
        title: "That did not work",
        // The server names the lot and the shortfall when a load asks for more
        // than is on hand, which is exactly what the operator needs to see.
        description: body?.shortfalls
          ? body.shortfalls.map((s) =>
              `${s.lotNumber}: asked ${lb(s.requested)}, on hand ${lb(s.onHand)}`).join(" · ")
          : (body?.error || err.message),
        status: "error", duration: 8000, position: "top", isClosable: true,
      });
      throw err;
    } finally {
      setBusy(false);
    }
  };

  const tieSessions = () => run(async () => {
    await axiosInstance.post(`/shipments/${openId}/box-batches`,
      { batchIds: [...pickedBatches] });
    setPickedBatches(new Set());
    await refreshOpen(openId);
  }, "Weighing sessions tied");

  const untieSession = (batchId) => run(async () => {
    await axiosInstance.delete(`/shipments/${openId}/box-batches/${batchId}`);
    await refreshOpen(openId);
  });

  const startDraft = () => {
    setDraft({
      shipDate: today(), destinationType: "adamsfoods", destinationName: "",
      billOfLading: "", carrier: "", driver: "", shipTo: "",
    });
    setCreating(true);
  };

  const createDraft = () => run(async () => {
    const { data } = await axiosInstance.post("/shipments", draft);
    setCreating(false);
    setDraft(null);
    await fetchShipments();
    setOpenId(data.shipmentId);
    setDetail(data);
  }, "Draft created");

  const addLine = () => run(async () => {
    const stock = available.find((a) => String(a.ntiItemId) === String(line.stockKey));
    if (!stock) return;
    await axiosInstance.post(`/shipments/${openId}/items`, {
      lotId: stock.lotId,
      ntiItemId: stock.ntiItemId,
      weight: String(line.weight).trim(),
      qtyCases: line.qtyCases !== "" ? Number(line.qtyCases) : null,
      description: stock.description,
    });
    setLine({ stockKey: "", weight: "", qtyCases: "" });
    await refreshOpen(openId);
  }, "Lot added");

  const removeLine = (itemId) => run(async () => {
    await axiosInstance.delete(`/shipments/${openId}/items/${itemId}`);
    await refreshOpen(openId);
  });

  const ship = () => run(async () => {
    setConfirmShip(false);
    await axiosInstance.post(`/shipments/${openId}/ship`);
    await refreshOpen(openId);
  }, "Shipped — stock deducted");

  const cancel = () => run(async () => {
    setConfirmCancel(false);
    await axiosInstance.post(`/shipments/${openId}/cancel`);
    await refreshOpen(openId);
  }, "Cancelled — stock restored");

  // The load is gone afterwards, so unlike cancel there is nothing to refresh
  // into — the open row is collapsed and the list reloaded instead.
  //
  // fetchAvailable too: deleting a SHIPPED load puts its weight back, so the
  // stock the picker offers is stale the moment this returns.
  const deleteDraft = () => run(async () => {
    setConfirmDelete(false);
    const { data } = await axiosInstance.delete(`/shipments/${openId}`);
    setOpenId(null);
    setDetail(null);
    await fetchShipments();
    if (data?.stockRestored) await fetchAvailable();
  }, "Shipment deleted");

  const selectedStock = available.find((a) => String(a.ntiItemId) === String(line.stockKey));
  const tiedIds = new Set((detail?.sessions || []).map((b) => b.batchId));
  const untiedBatches = batches.filter((b) => !tiedIds.has(b.batch_id));
  const isDraft = detail && detail.status === "draft";

  return (
    <Box>
      <Flex justify="space-between" align="center" mb={4} gap={3} wrap="wrap">
        <Box>
          <Text fontSize="lg" fontWeight="bold" color="gray.800">Outgoing</Text>
          <Text fontSize="sm" color="gray.500">
            Loads leaving for AdamsFoods or a customer. Stock moves when a load ships.
          </Text>
        </Box>
        <Flex gap={2} wrap="wrap">
          {/* Weighing finished product is a separate act from building a load:
              it happens at the bench as boxes come off the line, often before
              anyone knows which shipment they will go on. So it opens its own
              session rather than hanging off a draft. */}
          <Button size="sm" variant="outline" colorScheme="blue"
            onClick={() => setWeighOpen(true)}>
            Weigh finished boxes
          </Button>
          <Button size="sm" colorScheme="blue" onClick={startDraft}>New shipment</Button>
        </Flex>
      </Flex>

      {loading && <Flex justify="center" py={8}><Spinner color="blue.500" /></Flex>}

      {!loading && shipments.length === 0 && (
        <Box p={5} bg="gray.50" borderRadius="md" border="1px dashed" borderColor="gray.300">
          <Text fontSize="sm" color="gray.600">
            Nothing has shipped yet. Start a shipment, add the lots going on the
            truck, then ship it — that is the point stock comes out of inventory.
          </Text>
        </Box>
      )}

      <Flex direction="column" gap={2}>
        {shipments.map((s) => {
          const st = STATUS[s.status] || STATUS.draft;
          const open = openId === s.shipmentId;
          return (
            <Box key={s.shipmentId} border="1px solid"
              borderColor={open ? "blue.300" : "gray.200"} borderRadius="md" overflow="hidden">
              <Flex px={3} py={2} gap={3} align="center" wrap="wrap" bg={open ? "blue.50" : "white"}
                cursor="pointer" onClick={() => openShipment(s.shipmentId)}>
                <Badge colorScheme={st.color} fontSize="10px">{st.label}</Badge>
                <Text fontSize="sm" fontWeight="bold" color="gray.800">{s.destinationName}</Text>
                <Text fontSize="sm" color="gray.500">{fmtDate(s.shipDate)}</Text>
                {s.billOfLading && <Text fontSize="sm" color="gray.500">BOL {s.billOfLading}</Text>}
                <Text fontSize="sm" color="gray.600">
                  {s.lineCount} lot{s.lineCount === 1 ? "" : "s"}
                </Text>
                <Text fontSize="sm" fontWeight="600" color="gray.800" ml="auto"
                  style={{ fontVariantNumeric: "tabular-nums" }}>
                  {lb(s.totalWeight)} lb
                </Text>
              </Flex>

              {open && (
                <Box p={3} borderTop="1px solid" borderColor="gray.200">
                  {!detail && <Flex justify="center" py={4}><Spinner size="sm" color="blue.500" /></Flex>}

                  {detail && (
                    <>
                      {detail.items.length === 0 && (
                        <Text fontSize="sm" color="gray.500" mb={3}>No lots on this load yet.</Text>
                      )}

                      {detail.items.length > 0 && (
                        <Box borderWidth="1px" borderColor="gray.200" borderRadius="md"
                          overflow="hidden" mb={3}>
                          {detail.items.map((it, i) => (
                            <Flex key={it.itemId} px={3} py={2} gap={3} align="baseline" wrap="wrap"
                              bg={i % 2 ? "gray.50" : "white"}>
                              <Text fontSize="sm" fontWeight="600" color="blue.700">{it.lotNumber}</Text>
                              {it.stage === "raw" && (
                                <Badge colorScheme="yellow" fontSize="9px">Raw</Badge>
                              )}
                              <Text fontSize="sm" color="gray.600">{it.description || "—"}</Text>
                              <Text fontSize="sm" color="gray.700" ml="auto"
                                style={{ fontVariantNumeric: "tabular-nums" }}>
                                {it.qtyCases != null ? `${it.qtyCases} cs · ` : ""}{lb(it.weight)} lb
                              </Text>
                              {isDraft && (
                                <Button size="xs" variant="ghost" colorScheme="red"
                                  isLoading={busy} onClick={() => removeLine(it.itemId)}>
                                  Remove
                                </Button>
                              )}
                            </Flex>
                          ))}
                          <Flex px={3} py={2} gap={3} align="baseline" bg="gray.100"
                            borderTop="1px solid" borderColor="gray.200">
                            <Text fontSize="sm" fontWeight="bold">Total</Text>
                            <Text fontSize="lg" fontWeight="bold" color="blue.800" ml="auto"
                              style={{ fontVariantNumeric: "tabular-nums" }}>
                              {lb(detail.totalWeight)} lb
                            </Text>
                          </Flex>
                        </Box>
                      )}

                      {isDraft && (
                        <Flex gap={2} align="flex-end" wrap="wrap" mb={3}
                          p={3} bg="gray.50" borderRadius="md">
                          <Field label="Lot to ship" w="260px">
                            <Select size="sm" bg="white" placeholder="Pick from stock…"
                              value={line.stockKey}
                              onChange={(e) => {
                                const stock = available.find((a) => String(a.ntiItemId) === e.target.value);
                                setLine({
                                  stockKey: e.target.value,
                                  // Prefilled with everything on hand, which is
                                  // the common case; a partial load is typed over.
                                  weight: stock ? String(stock.onHand) : "",
                                  qtyCases: stock && stock.qtyCases != null ? String(stock.qtyCases) : "",
                                });
                              }}>
                              {available.map((a) => (
                                <option key={a.ntiItemId} value={a.ntiItemId}>
                                  {a.lotNumber} · {a.stage === "raw" ? "RAW · " : ""}
                                  {lb(a.onHand)} lb{a.inProcessing ? " · in processing" : ""}
                                </option>
                              ))}
                            </Select>
                          </Field>
                          <Field label="Weight (lbs)" w="120px">
                            <Input size="sm" bg="white" type="number" value={line.weight}
                              onChange={(e) => setLine((l) => ({ ...l, weight: e.target.value }))} />
                          </Field>
                          <Field label="Cases" w="90px">
                            <Input size="sm" bg="white" type="number" value={line.qtyCases}
                              onChange={(e) => setLine((l) => ({ ...l, qtyCases: e.target.value }))} />
                          </Field>
                          <Button size="sm" colorScheme="blue" isLoading={busy}
                            isDisabled={!line.stockKey || !String(line.weight).trim()}
                            onClick={addLine}>
                            Add lot
                          </Button>

                          {/* Warned, not blocked: there may be a good reason to
                              ship a lot that is mid-processing. */}
                          {selectedStock && selectedStock.inProcessing && (
                            <Alert status="warning" borderRadius="md" fontSize="xs" py={2} flex="1 1 100%">
                              <AlertIcon boxSize={3} />
                              {selectedStock.lotNumber} has processing still open. You can ship it anyway.
                            </Alert>
                          )}
                          {selectedStock && selectedStock.stage === "raw" && (
                            <Alert status="warning" borderRadius="md" fontSize="xs" py={2} flex="1 1 100%">
                              <AlertIcon boxSize={3} />
                              {selectedStock.lotNumber} is raw — it has not been processed.
                            </Alert>
                          )}
                        </Flex>
                      )}

                      {/* What the boxes actually weighed, beside what the
                          lines claim. Deliberately NOT reconciled for you: a
                          difference between the two is the thing worth seeing. */}
                      {detail.sessions && detail.sessions.length > 0 && (
                        <Box mb={3} p={3} bg="blue.50" borderRadius="md"
                          border="1px solid" borderColor="blue.200">
                          <Flex align="baseline" gap={3} wrap="wrap" mb={2}>
                            <Text fontSize="sm" fontWeight="bold" color="blue.800">
                              Weighed on the dock
                            </Text>
                            <Text fontSize="lg" fontWeight="bold" color="blue.800"
                              style={{ fontVariantNumeric: "tabular-nums" }}>
                              {lb(detail.weighedTotal)} lb
                            </Text>
                            {detail.items.length > 0 &&
                              Math.abs(Number(detail.weighedTotal) - Number(detail.totalWeight)) > 0.004 && (
                              <Badge colorScheme="yellow" fontSize="9px">
                                differs from the {lb(detail.totalWeight)} lb being shipped
                              </Badge>
                            )}
                          </Flex>
                          {detail.sessions.map((b) => (
                            <Flex key={b.batchId} align="baseline" gap={2} wrap="wrap"
                              px={2} py={1} bg="white" borderRadius="sm" mb={1}
                              border="1px solid" borderColor="blue.100">
                              <Text fontSize="sm" fontWeight="600" color="blue.700">
                                {b.lotNumber || `Batch ${b.batchId}`}
                              </Text>
                              {b.source === "imported" && (
                                <Badge colorScheme="teal" fontSize="9px">Imported</Badge>
                              )}
                              <Text fontSize="sm" color="gray.700" ml="auto"
                                style={{ fontVariantNumeric: "tabular-nums" }}>
                                {b.boxCount} × {lb(b.total)} lb
                              </Text>
                              {isDraft && (
                                <Button size="xs" variant="ghost" colorScheme="red"
                                  isLoading={busy} onClick={() => untieSession(b.batchId)}>
                                  Untie
                                </Button>
                              )}
                            </Flex>
                          ))}
                        </Box>
                      )}

                      {isDraft && untiedBatches.length > 0 && (
                        <Box mb={3}>
                          <Text fontSize="xs" color="gray.500" textTransform="uppercase"
                            letterSpacing="wide" mb={1}>
                            Tie a weighing session (optional)
                          </Text>
                          <Box maxH="120px" overflowY="auto" bg="white" borderRadius="md"
                            border="1px solid" borderColor="gray.200" px={2} py={1} mb={2}>
                            {untiedBatches.map((b) => (
                              <Checkbox key={b.batch_id} size="sm" width="100%" py={1}
                                isChecked={pickedBatches.has(b.batch_id)}
                                onChange={() => setPickedBatches((prev) => {
                                  const next = new Set(prev);
                                  if (next.has(b.batch_id)) next.delete(b.batch_id);
                                  else next.add(b.batch_id);
                                  return next;
                                })}>
                                <Flex align="baseline" gap={2} wrap="wrap" fontSize="sm">
                                  <Text as="span" fontWeight="600" color="blue.700">
                                    {b.lot_number || `Batch ${b.batch_id}`}
                                  </Text>
                                  <Text as="span" color="gray.500" fontSize="xs">
                                    {b.box_count} boxes
                                  </Text>
                                </Flex>
                              </Checkbox>
                            ))}
                          </Box>
                          <Button size="xs" variant="ghost" colorScheme="blue" px={2}
                            isLoading={busy} isDisabled={pickedBatches.size === 0}
                            onClick={tieSessions}>
                            Tie {pickedBatches.size || ""} session{pickedBatches.size === 1 ? "" : "s"}
                          </Button>
                        </Box>
                      )}

                      <Flex gap={2} wrap="wrap">
                        <Button size="sm" variant="outline" colorScheme="blue"
                          isDisabled={detail.items.length === 0}
                          onClick={() => printPackingList(detail)}>
                          Packing list
                        </Button>
                        {isDraft && (
                          <Button size="sm" colorScheme="green" isLoading={busy}
                            isDisabled={detail.items.length === 0}
                            onClick={() => setConfirmShip(true)}>
                            Ship
                          </Button>
                        )}
                        {detail.status === "shipped" && isAdmin && (
                          <Button size="sm" variant="ghost" colorScheme="red"
                            onClick={() => setConfirmCancel(true)}>
                            Cancel shipment
                          </Button>
                        )}
                        {/* Deleting is for a load that should not exist at all —
                            a duplicate, or a test. Admin only, in any state.
                            Cancel remains the right action for a real load that
                            came back: it restores stock AND keeps the record,
                            where this destroys it. */}
                        {isAdmin && (
                          <Button size="sm" variant="ghost" colorScheme="red"
                            onClick={() => setConfirmDelete(true)}>
                            {isDraft ? "Delete draft" : "Delete shipment"}
                          </Button>
                        )}
                        {detail.shippedAt && (
                          <Text fontSize="xs" color="gray.500" alignSelf="center">
                            Shipped {new Date(detail.shippedAt).toLocaleString()}
                          </Text>
                        )}
                      </Flex>
                    </>
                  )}
                </Box>
              )}
            </Box>
          );
        })}
      </Flex>

      {/* New draft */}
      <AlertDialog isOpen={creating} leastDestructiveRef={cancelRef}
        onClose={() => setCreating(false)} isCentered>
        <AlertDialogOverlay>
          <AlertDialogContent maxW="560px">
            <AlertDialogHeader fontSize="lg" fontWeight="bold">New shipment</AlertDialogHeader>
            <AlertDialogBody>
              {draft && (
                <Flex gap={3} wrap="wrap">
                  <Field label="Going to" w="160px">
                    <Select size="sm" value={draft.destinationType}
                      onChange={(e) => setDraft({ ...draft, destinationType: e.target.value })}>
                      <option value="adamsfoods">AdamsFoods</option>
                      <option value="customer">Customer</option>
                    </Select>
                  </Field>
                  {draft.destinationType === "customer" && (
                    <Field label="Customer" w="220px">
                      <Input size="sm" placeholder="e.g. Sysco" value={draft.destinationName}
                        onChange={(e) => setDraft({ ...draft, destinationName: upper(e.target.value) })} />
                    </Field>
                  )}
                  <Field label="Ship date" w="150px">
                    <Input size="sm" type="date" value={draft.shipDate}
                      onChange={(e) => setDraft({ ...draft, shipDate: e.target.value })} />
                  </Field>
                  <Field label="BOL #" w="120px">
                    <Input size="sm" value={draft.billOfLading}
                      onChange={(e) => setDraft({ ...draft, billOfLading: upper(e.target.value) })} />
                  </Field>
                  <Field label="Carrier" w="150px">
                    <Input size="sm" value={draft.carrier}
                      onChange={(e) => setDraft({ ...draft, carrier: upper(e.target.value) })} />
                  </Field>
                  <Field label="Driver" w="150px">
                    <Input size="sm" value={draft.driver}
                      onChange={(e) => setDraft({ ...draft, driver: upper(e.target.value) })} />
                  </Field>
                </Flex>
              )}
            </AlertDialogBody>
            <AlertDialogFooter gap={2}>
              <Button ref={cancelRef} onClick={() => setCreating(false)}>Go back</Button>
              <Button colorScheme="blue" onClick={createDraft} isLoading={busy}
                isDisabled={!draft || !draft.shipDate ||
                  (draft.destinationType === "customer" && !draft.destinationName.trim())}>
                Create draft
              </Button>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialogOverlay>
      </AlertDialog>

      {/* Ship — the point stock actually moves, so it states what is leaving. */}
      <AlertDialog isOpen={confirmShip} leastDestructiveRef={cancelRef}
        onClose={() => setConfirmShip(false)} isCentered>
        <AlertDialogOverlay>
          <AlertDialogContent>
            <AlertDialogHeader fontSize="lg" fontWeight="bold">Ship this load?</AlertDialogHeader>
            <AlertDialogBody>
              {detail && (
                <>
                  <Text fontSize="sm" mb={3}>
                    This deducts every lot below from stock and closes the shipment
                    to further changes. Cancelling afterwards puts the stock back.
                  </Text>
                  <Box px={3} py={2} bg="gray.50" borderRadius="md"
                    border="1px solid" borderColor="gray.200">
                    <Text fontSize="sm" fontWeight="bold" color="gray.800">
                      {detail.destinationName} · {fmtDate(detail.shipDate)}
                    </Text>
                    {detail.items.map((it) => (
                      <Text key={it.itemId} fontSize="sm" color="gray.700" mt={1}>
                        {it.lotNumber} — {lb(it.weight)} lb
                        {it.qtyCases != null ? ` · ${it.qtyCases} cs` : ""}
                        {it.stage === "raw" ? " · RAW" : ""}
                      </Text>
                    ))}
                    <Text fontSize="lg" fontWeight="bold" color="blue.800" mt={2}
                      style={{ fontVariantNumeric: "tabular-nums" }}>
                      {lb(detail.totalWeight)} lb total
                    </Text>
                  </Box>
                </>
              )}
            </AlertDialogBody>
            <AlertDialogFooter gap={2}>
              <Button ref={cancelRef} onClick={() => setConfirmShip(false)}>Go back</Button>
              <Button colorScheme="green" onClick={ship} isLoading={busy}>Ship it</Button>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialogOverlay>
      </AlertDialog>

      {/* Cancel — restores stock, keeps the record. */}
      <AlertDialog isOpen={confirmCancel} leastDestructiveRef={cancelRef}
        onClose={() => setConfirmCancel(false)} isCentered>
        <AlertDialogOverlay>
          <AlertDialogContent>
            <AlertDialogHeader fontSize="lg" fontWeight="bold">Cancel this shipment?</AlertDialogHeader>
            <AlertDialogBody>
              <Text fontSize="sm">
                Every lot on it goes back into stock. The shipment stays on the
                record marked cancelled — it is not deleted, so what left and
                came back is still visible.
              </Text>
            </AlertDialogBody>
            <AlertDialogFooter gap={2}>
              <Button ref={cancelRef} onClick={() => setConfirmCancel(false)}>Go back</Button>
              <Button colorScheme="red" onClick={cancel} isLoading={busy}>Cancel shipment</Button>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialogOverlay>
      </AlertDialog>

      <AlertDialog isOpen={confirmDelete} leastDestructiveRef={cancelRef}
        onClose={() => setConfirmDelete(false)} isCentered>
        <AlertDialogOverlay>
          <AlertDialogContent>
            <AlertDialogHeader fontSize="lg" fontWeight="bold">
              {isDraft ? "Delete this draft?" : "Delete this shipment?"}
            </AlertDialogHeader>
            <AlertDialogBody>
              <Text fontSize="sm" mb={2}>
                {isDraft
                  ? "The draft and its lines are gone for good. Nothing has shipped from it, so no stock moves and there is nothing to restore."
                  : "The shipment and its lines are gone for good — it will not appear on any record afterwards."}
              </Text>

              {/* A shipped load deducted stock. Deleting puts that weight back
                  first, or inventory would stay short with nothing left to say
                  why — but cancelling is still the action that keeps a record,
                  so it is offered here rather than assumed against. */}
              {detail?.status === "shipped" && (
                <Alert status="warning" borderRadius="md" fontSize="sm" mb={2} py={2}
                  alignItems="flex-start">
                  <AlertIcon />
                  <Box>
                    <Text fontWeight="600">This load has already shipped.</Text>
                    <Text fontSize="xs" color="gray.700">
                      Its weight goes back into stock first, so inventory stays
                      right. But the load itself is destroyed — if you want what
                      went out and came back to stay visible,{" "}
                      <b>cancel it instead</b>.
                    </Text>
                  </Box>
                </Alert>
              )}
              {detail?.status === "cancelled" && (
                <Text fontSize="xs" color="gray.600" mb={2}>
                  Already cancelled, so its stock went back at that point. Nothing
                  moves now — this only removes the record.
                </Text>
              )}
              {/* The reason someone is usually here. Deleting the draft is what
                  frees a weighing session that cannot be deleted while a
                  shipment still points at it. */}
              {detail?.sessions?.length > 0 && (
                <Text fontSize="sm" color="gray.600">
                  {detail.sessions.length} weighing session
                  {detail.sessions.length === 1 ? "" : "s"} tied to it
                  {detail.sessions.length === 1 ? " is" : " are"} released — the
                  sessions and their boxes are untouched.
                </Text>
              )}
            </AlertDialogBody>
            <AlertDialogFooter gap={2}>
              <Button ref={cancelRef} onClick={() => setConfirmDelete(false)}>Go back</Button>
              <Button colorScheme="red" onClick={deleteDraft} isLoading={busy}>
                {isDraft ? "Delete draft" : "Delete shipment"}
              </Button>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialogOverlay>
      </AlertDialog>

      {/* The same session machinery the incoming bench uses, pointed the other
          way: direction="outgoing" is what makes these weights the numerator of
          a yield rather than another arrival.
          Closing refreshes the tie-able sessions, since a session just closed
          here is exactly what someone will want to attach to a load next. */}
      <BoxScanner
        isOpen={weighOpen}
        direction="outgoing"
        onClose={() => { setWeighOpen(false); fetchBatches(); }}
      />
    </Box>
  );
};

export default OutgoingTab;
