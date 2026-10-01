import React, { useState } from "react";
import {
  Menu, MenuButton, MenuList, MenuItem, MenuGroup, MenuDivider, Button, Box, Text, Spinner,
  Portal, useToast,
} from "@chakra-ui/react";
import axiosInstance from "../../utils/axiosInstance";
import LotTimeline from "../../components/LotTimeline";
import { LotFormWindow, LotManifestWindow } from "./LotEntries";
import { fmtDate, fmtWeight, weighedDay } from "./shared";

// A lot number that opens what stands behind it: the form, its manifests, its
// timeline. Sits inside clickable rows, so none of its clicks reach the row.

const stop = (e) => e.stopPropagation();
const totalOf = (b) => (b.totals || []).find((t) => t.unit === "LB")?.total || "0";

const LotMenu = ({ lotNumber, lotId = null, size = "sm", color = "blue.700" }) => {
  const toast = useToast();
  const [sessions, setSessions] = useState(null);   // null until the menu first opens
  const [loading, setLoading] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [manifest, setManifest] = useState(null);    // { batchId } or { batchId: null } for all
  const [timelineId, setTimelineId] = useState(null);

  if (!lotNumber) return <Text as="span">—</Text>;

  // Loaded when the menu opens, so a table of fifty lots makes no calls until one is used.
  const loadSessions = async () => {
    if (sessions || loading) return;
    setLoading(true);
    try {
      const { data } = await axiosInstance.get("/box-batches", { params: { q: lotNumber } });
      setSessions((data || []).filter((b) => String(b.lot_number || "").trim() === lotNumber.trim()));
    } catch {
      setSessions([]);
    } finally {
      setLoading(false);
    }
  };

  // Older forms carry only the number; the timeline needs the registry id.
  const openTimeline = async () => {
    if (lotId) { setTimelineId(lotId); return; }
    try {
      const { data } = await axiosInstance.get("/lots", { params: { q: lotNumber } });
      const hit = (data || []).find((l) => l.lotNumber === lotNumber);
      if (hit) setTimelineId(hit.lotId);
      else toast({ title: `${lotNumber} is not in the lot registry`, status: "info", duration: 4000, position: "top" });
    } catch (err) {
      toast({ title: "Could not open the timeline", description: err.response?.data?.error || err.message,
        status: "error", duration: 4000, position: "top" });
    }
  };

  const label = (b) =>
    `${b.direction === "outgoing" ? "Out" : "In"} · ${fmtDate(weighedDay(b))} · `
    + `${b.box_count} box${Number(b.box_count) === 1 ? "" : "es"} · ${fmtWeight(totalOf(b))} lb`;

  return (
    <Box as="span" display="inline-block" onClick={stop} onDoubleClick={stop}>
      <Menu isLazy placement="bottom-start" onOpen={loadSessions}>
        <MenuButton as={Button} variant="link" size={size} fontWeight="700" color={color}
          onClick={stop} title="Open the form, manifests or timeline">
          {lotNumber}
        </MenuButton>
        {/* Portalled: these tables scroll sideways and would clip the list. */}
        <Portal>
        <MenuList fontSize="sm" minW="240px" zIndex={1500} onClick={stop}>
          <MenuItem onClick={() => setFormOpen(true)}>Registration form</MenuItem>

          {loading || sessions === null ? (
            <MenuItem isDisabled><Spinner size="xs" mr={2} />Weight manifests</MenuItem>
          ) : sessions.length === 0 ? (
            <MenuItem isDisabled>No weight manifests</MenuItem>
          ) : sessions.length === 1 ? (
            <MenuItem onClick={() => setManifest({ batchId: sessions[0].batch_id })}>
              Weight manifest
            </MenuItem>
          ) : (
            <>
              <MenuDivider />
              <MenuGroup title={`Weight manifests (${sessions.length})`} fontSize="xs" color="gray.500">
                <MenuItem onClick={() => setManifest({ batchId: null })}>All together</MenuItem>
                {sessions.map((b) => (
                  <MenuItem key={b.batch_id} pl={6} onClick={() => setManifest({ batchId: b.batch_id })}
                    style={{ fontVariantNumeric: "tabular-nums" }}>
                    {label(b)}
                  </MenuItem>
                ))}
              </MenuGroup>
              <MenuDivider />
            </>
          )}

          <MenuItem onClick={openTimeline}>Lot timeline</MenuItem>
        </MenuList>
        </Portal>
      </Menu>

      <LotFormWindow lotNumber={lotNumber} isOpen={formOpen} onClose={() => setFormOpen(false)} />
      <LotManifestWindow lotNumber={lotNumber} batchId={manifest?.batchId ?? null}
        isOpen={Boolean(manifest)} onClose={() => setManifest(null)} />
      <LotTimeline lotId={timelineId} lotNumber={lotNumber}
        isOpen={Boolean(timelineId)} onClose={() => setTimelineId(null)} />
    </Box>
  );
};

export default LotMenu;
